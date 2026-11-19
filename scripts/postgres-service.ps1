function Select-BotPostgresService([string]$ServiceName) {
    $services = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match '^postgresql-x64-\d+$' } |
        Sort-Object { [int]($_.Name -replace '^postgresql-x64-', '') } -Descending)
    if (-not $services.Count) { throw 'Khong tim thay dich vu PostgreSQL da cai.' }
    if ($ServiceName) {
        $selected = $services | Where-Object { $_.Name -eq $ServiceName } | Select-Object -First 1
        if (-not $selected) { throw "Khong tim thay dich vu $ServiceName." }
        return $selected
    }
    if ($services.Count -eq 1) { return $services[0] }
    Write-Host 'May co nhieu ban PostgreSQL. Chon DUNG ban da dat lai mat khau:'
    for ($index = 0; $index -lt $services.Count; $index++) {
        Write-Host ("{0}. {1} ({2})" -f ($index + 1), $services[$index].Name, $services[$index].State)
    }
    $choice = 0
    $answer = Read-Host 'Nhap so thu tu'
    if (-not [int]::TryParse($answer, [ref]$choice) -or $choice -lt 1 -or $choice -gt $services.Count) {
        throw 'Lua chon khong hop le. Chua thay doi dich vu.'
    }
    return $services[$choice - 1]
}

function Get-BotPostgresInstallation($Service) {
    if ($Service.PathName -notmatch '^"([^"]+pg_ctl\.exe)".*\s-D\s+"([^"]+)"') {
        throw 'Khong doc duoc duong dan data tu dich vu PostgreSQL.'
    }
    $bin = Split-Path -Parent $Matches[1]
    $data = $Matches[2]
    $postgres = Join-Path $bin 'postgres.exe'
    $psql = Join-Path $bin 'psql.exe'
    if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) { throw 'Khong tim thay psql.exe cua dich vu da chon.' }
    $portResult = & $postgres -D $data -C port 2>$null
    $portCode = $LASTEXITCODE
    $port = 0
    if ($portCode -ne 0 -or -not [int]::TryParse(($portResult -join '').Trim(), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw 'Khong doc duoc cong PostgreSQL. Kiem tra quyen doc thu muc data.'
    }
    return [pscustomobject]@{ Bin=$bin; Data=$data; Postgres=$postgres; Psql=$psql; Port=$port }
}

function Start-BotPostgresService([string]$ServiceName) {
    if ($ServiceName -notmatch '^postgresql-x64-\d+$') { throw 'Invalid PostgreSQL service name.' }
    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq 'Running') { return }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Start-Service -Name $ServiceName
    } else {
        Write-Host 'Windows se hoi quyen quan tri de khoi dong dich vu. Bam Yes trong hop thoai UAC.'
        $startCode = '$ErrorActionPreference = ''Stop''; try { Start-Service -Name ''' + $ServiceName +
            '''; (Get-Service -Name ''' + $ServiceName + ''').WaitForStatus(''Running'', [TimeSpan]::FromSeconds(30)); exit 0 } catch { exit 1 }'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($startCode))
        try {
            $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -PassThru
        } catch { throw 'Chua cap quyen khoi dong dich vu. Mo services.msc va Start dung PostgreSQL da chon, roi chay lai setup.' }
        try {
            if (-not $helper.WaitForExit(45000) -or $helper.ExitCode -ne 0) {
                throw "Khong khoi dong duoc $ServiceName. Kiem tra trang thai dich vu trong services.msc."
            }
        } finally { $helper.Dispose() }
    }
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}
