param(
    [ValidatePattern('^root@[a-zA-Z0-9][a-zA-Z0-9.-]*$')]
    [string]$Server = 'root@180.93.126.48',
    [switch]$Watch,
    [switch]$InstallKey
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$paths = @('index.js', 'package.json', 'package-lock.json', 'commands', 'utils', 'handlers', 'assets', 'config', 'scripts', 'web')
$sshOptions = @('-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3')
$identity = Join-Path $HOME '.ssh\discord-bot-vps_ed25519'
$identityOptions = @('-o', 'IdentitiesOnly=yes', '-i', $identity)

function Connect-AutomaticSsh([string[]]$Options) {
    & ssh.exe @Options -T $Server true | Out-Host
    if ($LASTEXITCODE -eq 0) { return $true }

    if (-not (Test-Path -LiteralPath $identity -PathType Leaf)) {
        Write-Host 'Mo lai UPDATE_VPS.bat va chon 3 de cai SSH key.' -ForegroundColor Red
        return $false
    }
    $agent = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue
    if ($agent.Status -ne 'Running') {
        Write-Host 'Neu SSH key co passphrase, mo PowerShell bang Run as administrator va chay:' -ForegroundColor Yellow
        Write-Host 'Set-Service -Name ssh-agent -StartupType Automatic'
        Write-Host 'Start-Service ssh-agent'
        Write-Host 'Sau do mo lai UPDATE_VPS.bat va chon 2.'
        return $false
    }

    Write-Host 'Nhap passphrase cua SSH key de mo khoa cho che do tu dong.'
    & ssh-add.exe $identity | Out-Host
    if ($LASTEXITCODE -ne 0) { return $false }
    & ssh.exe @Options -T $Server true | Out-Host
    return $LASTEXITCODE -eq 0
}

if ($InstallKey) {
    $publicKey = "$identity.pub"
    $hasPrivateKey = Test-Path -LiteralPath $identity -PathType Leaf
    $hasPublicKey = Test-Path -LiteralPath $publicKey -PathType Leaf
    if ($hasPrivateKey -xor $hasPublicKey) {
        throw "Cap khoa $identity dang thieu mot file. Khoi phuc file bi thieu hoac doi ten file con lai roi chay lai muc 3."
    }
    if (-not $hasPrivateKey) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $identity) -Force | Out-Null
        Write-Host 'Dang tao SSH key rieng cho bot.'
        Write-Host 'Neu muon dung tu dong ma khong can SSH agent, nhan Enter hai lan tai cau hoi passphrase.'
        & ssh-keygen.exe -t ed25519 -C discord-bot-vps -f $identity
        if ($LASTEXITCODE -ne 0) { throw 'Tao SSH key that bai.' }
    }

    $keyText = (Get-Content -LiteralPath $publicKey -Raw).Trim()
    if ($keyText -notmatch '^ssh-ed25519 ([A-Za-z0-9+/=]+)(?:[ \t]+[^\r\n]*)?$') {
        throw 'File khoa cong khai Ed25519 khong hop le.'
    }
    $key = 'ssh-ed25519 ' + $Matches[1]
    $command = "umask 077; mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys && chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys && (grep -qF '$key' /root/.ssh/authorized_keys || printf '\n%s\n' '$key' >> /root/.ssh/authorized_keys)"
    Write-Host 'Dang them khoa cong khai tren VPS. Nhap mat khau VPS khi SSH hoi.'
    & ssh.exe @sshOptions -T $Server $command
    if ($LASTEXITCODE -ne 0) { throw 'Khong cai duoc khoa tren VPS. Kiem tra dang nhap SSH roi thu lai.' }

    $automaticOptions = $sshOptions + $identityOptions + @('-o', 'BatchMode=yes')
    if (-not (Connect-AutomaticSsh $automaticOptions)) {
        Write-Host 'Da gui khoa cong khai, nhung VPS chua chap nhan dang nhap tu dong.' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Cai SSH key xong. Mo lai UPDATE_VPS.bat va chon 2.'
    exit 0
}

if (Test-Path -LiteralPath $identity -PathType Leaf) {
    $sshOptions += $identityOptions
}
if ($Watch) { $sshOptions += @('-o', 'BatchMode=yes') }

foreach ($program in @('tar.exe', 'scp.exe', 'ssh.exe')) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) {
        throw "Khong tim thay $program. Kiem tra Windows OpenSSH Client va tar."
    }
}

function Get-ProjectSnapshot {
    $entries = foreach ($path in $paths) {
        $item = Get-Item -LiteralPath (Join-Path $project $path) -Force -ErrorAction SilentlyContinue
        if ($item -and $item.PSIsContainer) {
            Get-ChildItem -LiteralPath $item.FullName -Recurse -File -ErrorAction SilentlyContinue
        } elseif ($item) {
            $item
        }
    }
    $stamps = foreach ($file in ($entries | Sort-Object FullName)) {
        '{0}|{1}|{2}' -f $file.FullName, $file.Length, $file.LastWriteTimeUtc.Ticks
    }
    return $stamps -join "`n"
}

function Publish-Project {
    foreach ($path in $paths) {
        if (-not (Test-Path -LiteralPath (Join-Path $project $path))) {
            throw "Thieu $path trong thu muc du an."
        }
    }

    $name = 'discord-bot-' + [guid]::NewGuid().ToString('N') + '.tar.gz'
    $archive = Join-Path ([System.IO.Path]::GetTempPath()) $name
    $remoteArchive = "/root/$name"
    try {
        Write-Host "Dong goi ma nguon cho $Server..."
        & tar.exe --exclude=.env --exclude='.env.*' --exclude=node_modules --exclude=.runtime --exclude=.git -czf $archive -C $project @paths
        if ($LASTEXITCODE -ne 0) { throw 'Dong goi that bai.' }

        Write-Host 'Dang gui ma nguon...'
        & scp.exe @sshOptions $archive "${Server}:$remoteArchive"
        if ($LASTEXITCODE -ne 0) { throw 'Tai len VPS that bai.' }

        $command = "set -o pipefail; tar -xOzf $remoteArchive scripts/deploy-ubuntu.sh | sed 's/\r$//' | bash -s -- $remoteArchive"
        & ssh.exe @sshOptions -T $Server $command
        if ($LASTEXITCODE -ne 0) { throw 'VPS bao loi khi cap nhat. Xem cac dong phia tren.' }
    } finally {
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    }
}

if (-not $Watch) {
    Publish-Project
    exit 0
}

if (-not (Connect-AutomaticSsh $sshOptions)) {
    Write-Host 'Chua dang nhap tu dong duoc. Co the dung muc 1 de cap nhat thu cong.' -ForegroundColor Red
    exit 1
}

$lastAttempt = Get-ProjectSnapshot
$observed = $lastAttempt
$changedAt = [DateTime]::UtcNow
Write-Host 'Dang theo doi code. Se gui sau 8 giay on dinh. Nhan Ctrl+C de dung.'
while ($true) {
    Start-Sleep -Seconds 2
    $snapshot = Get-ProjectSnapshot
    $now = [DateTime]::UtcNow
    if ($snapshot -cne $observed) {
        $observed = $snapshot
        $changedAt = $now
        continue
    }
    if ($snapshot -ceq $lastAttempt -or ($now - $changedAt).TotalSeconds -lt 8) { continue }

    $lastAttempt = $snapshot
    try {
        Publish-Project
    } catch {
        Write-Warning $_.Exception.Message
        Write-Host 'Luu lai code hoac dung muc 1 de thu cap nhat lai.'
    }
}
