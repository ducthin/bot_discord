param(
    [string]$ServiceName,
    [ValidatePattern('^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$')]
    [string]$RoleName = 'postgres'
)

$ErrorActionPreference = 'Stop'

function New-PostgresPasswordVerifier([Security.SecureString]$Password) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $plain = $null
    $derived = $null
    $hmac = $null
    $sha = $null
    $generator = $null
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plain.Length -lt 8 -or $plain.Length -gt 256 -or $plain -match '[^\x20-\x7e]') {
            throw 'Mat khau moi can 8-256 ky tu: chu khong dau, so va ky hieu.'
        }
        $salt = New-Object byte[] 16
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        $generator.GetBytes($salt)
        $derived = New-Object Security.Cryptography.Rfc2898DeriveBytes($plain, $salt, 4096, [Security.Cryptography.HashAlgorithmName]::SHA256)
        $salted = $derived.GetBytes(32)
        $hmac = New-Object Security.Cryptography.HMACSHA256
        $hmac.Key = $salted
        $clientKey = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('Client Key'))
        $sha = [Security.Cryptography.SHA256]::Create()
        $storedKey = $sha.ComputeHash($clientKey)
        $serverKey = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('Server Key'))
        return 'SCRAM-SHA-256$4096:' + [Convert]::ToBase64String($salt) + '$' +
            [Convert]::ToBase64String($storedKey) + ':' + [Convert]::ToBase64String($serverKey)
    } finally {
        if ($derived) { $derived.Dispose() }
        if ($hmac) { $hmac.Dispose() }
        if ($sha) { $sha.Dispose() }
        if ($generator) { $generator.Dispose() }
        foreach ($buffer in @($salted, $clientKey, $storedKey, $serverKey)) {
            if ($buffer -is [byte[]]) { [Array]::Clear($buffer, 0, $buffer.Length) }
        }
        $plain = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Set-PostgresPasswordOffline([string]$PostgresExe, [string]$DataDirectory, [string]$Role, [string]$Verifier) {
    if ($Role -notmatch '^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$' -or
        $Verifier -notmatch '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$') {
        throw 'Invalid recovery parameters.'
    }
    $dataPath = (Resolve-Path -LiteralPath $DataDirectory).ProviderPath
    if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION') -PathType Leaf)) { throw 'Invalid PostgreSQL data directory.' }
    if (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid')) {
        throw 'PostgreSQL dang chay hoac chua dung sach. Dung dich vu truoc; khong xoa postmaster.pid.'
    }
    $pgCtl = Join-Path (Split-Path -Parent $PostgresExe) 'pg_ctl.exe'
    & $pgCtl status -D $dataPath *> $null
    if ($LASTEXITCODE -ne 3) { throw 'Khong xac nhan duoc PostgreSQL da dung. Chua doi mat khau.' }

    $marker = 'password_reset_' + [guid]::NewGuid().ToString('N')
    # Send only a SCRAM verifier to PostgreSQL; the plaintext never enters SQL or logs.
    $sql = 'DO $recover$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ' + "'$Role'" +
        ") THEN RAISE EXCEPTION 'Role does not exist'; END IF; EXECUTE format('ALTER ROLE %I PASSWORD %L', " +
        "'$Role', '$Verifier'); END " + '$recover$;' + "`nSELECT '$marker' FROM pg_authid WHERE rolname = '$Role' AND rolpassword = '$Verifier';"
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $PostgresExe
    $start.Arguments = '--single -D "' + $dataPath + '" -c logging_collector=off -c log_statement=none' +
        ' -c log_min_error_statement=panic -c log_min_duration_statement=-1 -c log_duration=off postgres'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Khong khoi chay duoc PostgreSQL phuc hoi.' }
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine($sql)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(30000)) {
            try { $process.Kill() } catch {}
            throw 'Phuc hoi vuot qua 30 giay. Kiem tra dich vu PostgreSQL truoc khi thu lai.'
        }
        $output = $outputTask.Result
        $errors = $errorTask.Result
        if ($process.ExitCode -ne 0 -or -not ($output.Contains($marker) -or $errors.Contains($marker))) {
            throw 'Chua doi duoc mat khau. Chay bang tai khoan Windows so huu data, khong chon Run as administrator.'
        }
    } finally { $process.Dispose() }
}

function Invoke-PasswordRecovery {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Hay nhap dup RESET_POSTGRES_PASSWORD.bat binh thuong, khong chon Run as administrator.'
    }
    . (Join-Path $PSScriptRoot 'postgres-service.ps1')
    $service = Select-BotPostgresService $ServiceName
    if ($service.State -ne 'Stopped') {
        throw "Dung dich vu $($service.Name) trong services.msc roi chay lai. Khong dung khi bot dang chay."
    }
    if ($service.PathName -notmatch '^"([^"]+pg_ctl\.exe)".*\s-D\s+"([^"]+)"') {
        throw 'Khong doc duoc duong dan data tu dich vu PostgreSQL.'
    }
    $postgresExe = Join-Path (Split-Path -Parent $Matches[1]) 'postgres.exe'
    $dataPath = $Matches[2]
    Write-Host "Dich vu: $($service.Name) | Tai khoan PostgreSQL: $RoleName"
    Write-Host 'Dat mat khau moi 8-256 ky tu, dung chu khong dau, so va ky hieu.'
    $password = Read-Host 'Mat khau moi' -AsSecureString
    $confirm = Read-Host 'Nhap lai mat khau moi' -AsSecureString
    try {
        $verifier = New-PostgresPasswordVerifier $password
        $first = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
        $second = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
        try {
            if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($first) -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($second)) {
                throw 'Hai mat khau khong trung nhau. Chua thay doi gi.'
            }
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($first)
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($second)
        }
        Set-PostgresPasswordOffline $postgresExe $dataPath $RoleName $verifier
        Write-Host "Da dat lai mat khau PostgreSQL cua $RoleName. Tai khoan va du lieu database van giu nguyen." -ForegroundColor Green
        Write-Host 'Chay SETUP_POSTGRES.bat va dung mat khau vua dat. Cong cu setup se khoi dong dich vu PostgreSQL.'
    } finally {
        $password.Dispose()
        $confirm.Dispose()
        $verifier = $null
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-PasswordRecovery }
    catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}
