param(
    [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')]
    [string]$DatabaseName = 'discord_bot',
    [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')]
    [string]$RoleName = 'discord_bot',
    [ValidatePattern('^postgresql-x64-\d+$')]
    [string]$ServiceName
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-service.ps1')
$service = Select-BotPostgresService $ServiceName
$installation = Get-BotPostgresInstallation $service
$psql = $installation.Psql
$port = $installation.Port
Write-Host "PostgreSQL: $($service.Name) | Cong: $port"
Start-BotPostgresService $service.Name

$adminUser = Read-Host 'Tài khoản quản trị PostgreSQL [postgres]'
if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = 'postgres' }
if ($adminUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$') { throw 'Tên tài khoản PostgreSQL không hợp lệ.' }
$adminPasswordSecure = Read-Host "Nhập mật khẩu PostgreSQL của $adminUser" -AsSecureString
$adminPasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPasswordSecure)
$adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPtr)

function Invoke-Psql([string]$Database, [string]$Sql) {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $psql
    $start.Arguments = "--no-psqlrc --no-password --set=ON_ERROR_STOP=1 --no-align --tuples-only --host=127.0.0.1 --port=$port --username=$adminUser --dbname=$Database"
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['PGPASSWORD'] = $adminPassword
    $start.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '8'
    $start.EnvironmentVariables['PGOPTIONS'] = '-c statement_timeout=15000 -c lock_timeout=5000'
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'Không khởi chạy được psql.' }
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine($Sql)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(30000)) {
        try { $process.Kill() } catch {}
        $process.Dispose()
        throw 'PostgreSQL không phản hồi trong 30 giây. Kiểm tra dịch vụ rồi chạy lại.'
    }
    $output = $outputTask.Result.Trim()
    $errorText = $errorTask.Result.Trim()
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($exitCode -ne 0) {
        foreach ($secret in @($adminPassword, $appPassword)) {
            if ($secret) { $errorText = $errorText.Replace($secret, '[redacted]') }
        }
        throw "PostgreSQL từ chối thao tác: $errorText"
    }
    return $output
}

try {
    [void](Invoke-Psql -Database 'postgres' -Sql 'SELECT 1;')
    $actualData = Invoke-Psql -Database 'postgres' -Sql 'SHOW data_directory;'
    if ([IO.Path]::GetFullPath($actualData).TrimEnd('\','/') -ine [IO.Path]::GetFullPath($installation.Data).TrimEnd('\','/')) {
        throw 'Cong ket noi thuoc ban PostgreSQL khac. Dung dich vu trung cong, roi chay lai setup.'
    }

    $marker = 'bot_discord PostgreSQL setup v1'
    $ownershipSql = "SELECT json_build_object('roleExists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RoleName'), 'roleMarker', (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = '$RoleName'), 'databaseExists', EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'), 'databaseMarker', (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '$DatabaseName'), 'databaseOwner', (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$DatabaseName'))::text;"
    $ownership = (Invoke-Psql -Database 'postgres' -Sql $ownershipSql) | ConvertFrom-Json
    if (($ownership.roleExists -and $ownership.roleMarker -ne $marker) -or
        ($ownership.databaseExists -and ($ownership.databaseMarker -ne $marker -or $ownership.databaseOwner -ne $RoleName))) {
        throw 'Tên tài khoản hoặc database đã được ứng dụng khác sử dụng. Chạy script với -DatabaseName và -RoleName mới; công cụ chưa đổi mật khẩu hoặc quyền sở hữu hiện có.'
    }

    $randomBytes = New-Object byte[] 36
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    $appPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $roleSql = "BEGIN; DO `$setup`$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RoleName') THEN ALTER ROLE $RoleName WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$appPassword'; ELSE CREATE ROLE $RoleName WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$appPassword'; END IF; END `$setup`$; COMMENT ON ROLE $RoleName IS '$marker'; COMMIT;"
    [void](Invoke-Psql -Database 'postgres' -Sql $roleSql)

    if (-not $ownership.databaseExists) {
        [void](Invoke-Psql -Database 'postgres' -Sql "CREATE DATABASE $DatabaseName OWNER $RoleName ENCODING 'UTF8' TEMPLATE template0;")
        [void](Invoke-Psql -Database 'postgres' -Sql "COMMENT ON DATABASE $DatabaseName IS '$marker';")
    }

    $envFile = Join-Path $projectRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envFile
    }
    $lines = @(Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' })
    $lines += 'DATABASE_URL=postgresql://' + $RoleName + ':' + $appPassword + '@127.0.0.1:' + $port + '/' + $DatabaseName
    [IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'PostgreSQL đã sẵn sàng. DATABASE_URL đã được ghi vào .env mà không hiển thị mật khẩu.' -ForegroundColor Green
    Write-Host 'Cơ sở dữ liệu mới được tạo rỗng nếu chưa tồn tại; script không xóa hoặc nhập dữ liệu.'
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $portableNode = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.runtime') -Directory -Filter 'node-v22.*-win-x64' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') -PathType Leaf } | Select-Object -First 1
    $nodeExe = if ($portableNode) { Join-Path $portableNode.FullName 'node.exe' } elseif ($node) { $node.Source } else { $null }
    if ($nodeExe -and (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\pg\package.json'))) {
        Push-Location -LiteralPath $projectRoot
        try {
            & $nodeExe scripts/database.js init
            if ($LASTEXITCODE -ne 0) { throw 'Đã cấu hình kết nối nhưng chưa khởi tạo được bảng PostgreSQL.' }
        } finally { Pop-Location }
    } else {
        Write-Host 'Chạy START_BOT.bat để chuẩn bị Node/thư viện và khởi tạo các bảng ứng dụng.'
    }
} finally {
    $adminPassword = $null
    $appPassword = $null
    $adminPasswordSecure.Dispose()
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPtr)
}
