param(
    [ValidatePattern('^[a-zA-Z0-9_-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*$')]
    [string]$Server = 'root@180.93.126.48',
    [ValidateRange(1, 65535)]
    [int]$LocalPort = 3001,
    [ValidateRange(1, 65535)]
    [int]$RemotePort = 3001
)

$ErrorActionPreference = 'Stop'
$identity = Join-Path $HOME '.ssh\discord-bot-vps_ed25519'
$tunnel = $null
$errorLog = Join-Path ([System.IO.Path]::GetTempPath()) ('discord-play-ssh-' + [guid]::NewGuid().ToString('N') + '.log')
$url = "http://127.0.0.1:$LocalPort/play/"

function Test-LocalPort([int]$Port) {
    $probe = New-Object System.Net.Sockets.TcpClient
    try {
        $connecting = $probe.ConnectAsync('127.0.0.1', $Port)
        if (-not $connecting.Wait(200)) { return $false }
        return $probe.Connected
    } catch { return $false }
    finally { $probe.Dispose() }
}

function Test-PlayEndpoint {
    try {
        $response = Invoke-WebRequest -Uri "${url}api/session" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ne 200) { return $false }
        $data = $response.Content | ConvertFrom-Json
        return $data.app -ceq 'may-skins'
    } catch { return $false }
}

try {
    if (Test-LocalPort $LocalPort) {
        if (-not (Test-PlayEndpoint)) {
            throw "Cong $LocalPort dang duoc chuong trinh khac dung, hoac trang choi chua duoc bat. Khong co tien trinh nao bi dung."
        }
        Write-Host 'Da co ket noi May Skins. Dung lai ket noi hien tai.' -ForegroundColor Green
        Write-Host 'Giu cua so SSH hoac OPEN_ADMIN dang ket noi chay de tiep tuc truy cap.'
        Start-Process $url
        return
    }

    $ssh = Get-Command ssh.exe -ErrorAction Stop
    $arguments = @('-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-L', "127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort}")
    if (Test-Path -LiteralPath $identity -PathType Leaf) {
        $arguments += @('-o', 'IdentitiesOnly=yes', '-i', ('"{0}"' -f $identity))
    }
    $arguments += $Server
    Write-Host "Dang ket noi bang SSH toi $Server..."
    $tunnel = Start-Process -FilePath $ssh.Source -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError $errorLog
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    $opened = $false
    while ([DateTime]::UtcNow -lt $deadline -and -not $tunnel.HasExited) {
        if ((Test-LocalPort $LocalPort) -and (Test-PlayEndpoint)) { $opened = $true; break }
        Start-Sleep -Milliseconds 200
        $tunnel.Refresh()
    }
    if (-not $opened) {
        $detail = if (Test-Path -LiteralPath $errorLog) { (Get-Content -LiteralPath $errorLog -Raw).Trim() } else { '' }
        throw "Chua mo duoc trang choi. Kiem tra PLAYER_ENABLED, PLAYER_ORIGIN tren VPS va khoa SSH. $detail"
    }
    Write-Host "Mo $url" -ForegroundColor Green
    Write-Host 'Lay ma dang nhap bang /web trong Discord, roi dan ma vao trang.'
    Write-Host 'Giu cua so nay mo. Nhan Ctrl+C de dong duong ham; bot tren VPS van chay.'
    if ($LocalPort -ne 3001) {
        Write-Host "PLAYER_ORIGIN tren VPS phai la http://127.0.0.1:$LocalPort de dang nhap." -ForegroundColor Yellow
    }
    Start-Process $url
    while (-not $tunnel.HasExited) {
        Start-Sleep -Seconds 1
        $tunnel.Refresh()
    }
    if ($tunnel.ExitCode -ne 0) { throw 'Ket noi SSH da dong. Mo lai OPEN_PLAY.bat de ket noi lai.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $tunnel) {
        if (-not $tunnel.HasExited) { $tunnel.Kill(); $tunnel.WaitForExit(2000) | Out-Null }
        $tunnel.Dispose()
    }
    if (Test-Path -LiteralPath $errorLog) { Remove-Item -LiteralPath $errorLog -Force }
}
