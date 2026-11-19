param([switch]$CheckOnly, [switch]$Background, [switch]$ResetData)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$runtime = Join-Path $projectRoot '.runtime'
$lockStream = $null

function Download-File($Url, $Destination) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 300
}

function Expand-CompatibleZip($Archive, $Destination) {
    # .NET 4.5 works on PowerShell versions without Expand-Archive.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    [IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationRoot, $entry.FullName))
            if (-not $target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Archive contains a path outside its destination.'
            }
            if ([string]::IsNullOrEmpty($entry.Name)) {
                [IO.Directory]::CreateDirectory($target) | Out-Null
            } else {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
            }
        }
    } finally { $zip.Dispose() }
}

try {
    $vpsMigrationMarker = Join-Path $runtime 'vps-migrated.json'
    if (-not $CheckOnly -and (Test-Path -LiteralPath $vpsMigrationMarker)) {
        throw "This bot has moved to the VPS. Keep the local bot stopped to avoid running two copies. To move back, stop the VPS bot first, then remove $vpsMigrationMarker."
    }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows 64-bit is required.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    try {
        $lockStream = [IO.File]::Open((Join-Path $runtime 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch { throw 'This project already has a launcher running. Close that window first.' }

    # Prefer the project's portable runtime, otherwise a compatible installed Node.
    $nodeDir = Join-Path $runtime 'node'
    $nodeExe = Join-Path $nodeDir 'node.exe'
    $portableNode = Get-ChildItem -LiteralPath $runtime -Directory -Filter 'node-v22.*-win-x64' | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } | Select-Object -First 1
    if ($portableNode) {
        $nodeDir = $portableNode.FullName
        $nodeExe = Join-Path $nodeDir 'node.exe'
    }
    if (-not (Test-Path -LiteralPath $nodeExe)) {
        $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($systemNode) {
            $version = (& $systemNode.Source --version).TrimStart('v')
            if ([version]$version -ge [version]'22.12.0' -and [version]$version -lt [version]'23.0.0') {
                $nodeExe = $systemNode.Source
                $nodeDir = Split-Path -Parent $nodeExe
            }
        }
    }
    if (-not (Test-Path -LiteralPath $nodeExe)) {
        if ($CheckOnly) { throw 'Node 22.12+ (22.x) is missing. Run START_BOT.bat to install.' }
        $baseUrl = 'https://nodejs.org/dist/latest-v22.x'
        $checksums = (Invoke-WebRequest -UseBasicParsing "$baseUrl/SHASUMS256.txt" -TimeoutSec 60).Content
        $match = [regex]::Match($checksums, '(?m)^([a-f0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-win-x64\.zip)\s*$')
        if (-not $match.Success) { throw 'Cannot find the official Node Windows archive.' }
        $archive = Join-Path $runtime 'node.zip'
        Download-File "$baseUrl/$($match.Groups[2].Value)" $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) { throw 'Node download checksum mismatch.' }
        Expand-CompatibleZip $archive $runtime
        $extracted = Join-Path $runtime ($match.Groups[2].Value -replace '\.zip$', '')
        # The archive path and destination are both explicitly inside .runtime.
        $nodeDir = $extracted
        $nodeExe = Join-Path $nodeDir 'node.exe'
    }
    $env:PATH = "$nodeDir;$env:PATH"
    $npm = Join-Path $nodeDir 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { throw 'npm.cmd is missing from the Node installation.' }

    if (-not $CheckOnly) {
        $pythonDir = Join-Path $runtime 'python'
        $pythonExe = Join-Path $pythonDir 'python.exe'
        if (-not (Test-Path -LiteralPath $pythonExe)) {
            $pythonZip = Join-Path $runtime 'python.zip'
            Download-File 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' $pythonZip
            Expand-CompatibleZip $pythonZip $pythonDir
        }
        $env:PATH = "$pythonDir;$env:PATH"
        & $pythonExe --version
        if ($LASTEXITCODE -ne 0) { throw 'Portable Python could not start.' }

        $manifestHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot 'package.json')).Hash + '|' +
            (Get-FileHash -LiteralPath (Join-Path $projectRoot 'package-lock.json')).Hash
        $stamp = Join-Path $runtime 'dependencies.txt'
        $identity = "$env:COMPUTERNAME|$projectRoot|$(& $nodeExe --version)|$manifestHash"
        if (-not (Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw) -ne $identity -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
            Write-Host 'Installing dependencies. The first run can take several minutes...'
            & $npm ci --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check the error above and network access to npm/GitHub.' }
            & $nodeExe scripts/preflight.js --dependencies-only
            if ($LASTEXITCODE -ne 0) { throw 'Dependency checks failed.' }
            [IO.File]::WriteAllText($stamp, $identity)
        }
    }

    $envFile = Join-Path $projectRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        if ($CheckOnly -or $Background) { throw 'The .env file is missing. Run START_BOT.bat once to configure it.' }
        Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envFile
    }
    & $nodeExe scripts/preflight.js
    if ($LASTEXITCODE -ne 0) {
        if ($CheckOnly -or $Background) { throw 'Preflight failed. Run START_BOT.bat interactively to fix the configuration.' }
        Write-Host 'Opening .env. Fill in Discord settings, save, then close Notepad.'
        Start-Process notepad.exe -ArgumentList ('"' + $envFile + '"') -Wait
        & $nodeExe scripts/preflight.js
        if ($LASTEXITCODE -ne 0) { throw 'Configuration is still invalid. Correct .env and run START_BOT.bat again.' }
    }
    if ($CheckOnly) { Write-Host 'Checks passed. Bot was NOT started.'; exit 0 }
    if ($ResetData) {
        & $nodeExe scripts/database.js reset --yes
        if ($LASTEXITCODE -ne 0) { throw 'Data reset failed. See the error above.' }
        Write-Host 'Data reset finished. Run START_BOT.bat to start with empty data.'
        exit 0
    }

    $env:DISCORD_BOT_LAUNCHER_PID = [string]$PID
    Write-Host 'Starting bot. Keep this window open. Close it or press Ctrl+C to stop.'
    $failures = 0
    while ($true) {
        $startedAt = Get-Date
        if ($Background) {
            $processOptions = @{
                FilePath = $nodeExe
                ArgumentList = 'index.js'
                WorkingDirectory = $projectRoot
                WindowStyle = 'Hidden'
                RedirectStandardOutput = Join-Path $runtime 'bot.stdout.log'
                RedirectStandardError = Join-Path $runtime 'bot.stderr.log'
                Wait = $true
                PassThru = $true
            }
            $botProcess = Start-Process @processOptions
            $botExit = $botProcess.ExitCode
        } else {
            & $nodeExe index.js
            $botExit = $LASTEXITCODE
        }
        if ($botExit -eq 0 -or $botExit -eq -1073741510 -or $botExit -eq 130) { break }
        if ($botExit -eq 78) { throw 'Bot cannot start due to a port conflict or configuration error. See the bot log above or .runtime\bot.stderr.log.' }
        if (((Get-Date) - $startedAt).TotalMinutes -gt 5) { $failures = 0 }
        $failures++
        if ($failures -ge 5) { throw 'Bot failed 5 times. Fix the error above, then start again.' }
        Write-Host "Bot exited ($botExit). Retrying in 10 seconds ($failures/5)..."
        Start-Sleep -Seconds 10
    }
} catch {
    if ($Background -and (Test-Path -LiteralPath $runtime)) {
        Add-Content -LiteralPath (Join-Path $runtime 'launcher.log') -Value "$(Get-Date -Format o) ERROR: $($_.Exception.Message)" -ErrorAction SilentlyContinue
    }
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($lockStream) { $lockStream.Dispose() }
}
