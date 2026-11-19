$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-windows.ps1'
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$taskName = 'DiscordMusicBot'

try {
    if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
        throw 'Windows ScheduledTasks module is unavailable.'
    }
    & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcher -CheckOnly
    if ($LASTEXITCODE -ne 0) { throw 'Configure and test START_BOT.bat first, then close its window before enabling autostart.' }

    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $launcher + '" -Background'
    $existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($existing -and $existing.Actions[0].Arguments -ne $arguments) {
        throw 'A task with this name already points to a different launcher. Review it in Task Scheduler first.'
    }
    if ($existing.State -eq 'Running') { throw 'Stop the existing DiscordMusicBot task before changing it.' }

    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $credential = Get-Credential -UserName $account -Message 'Enter the Windows password for the account that owns this bot folder.'
    if (-not $credential) { throw 'No Windows credentials were entered.' }
    $action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $taskOptions = @{
        TaskName = $taskName
        TaskPath = '\'
        Action = $action
        Trigger = $trigger
        Settings = $settings
        User = $credential.UserName
        Password = $credential.GetNetworkCredential().Password
        RunLevel = 'Limited'
        Force = $true
    }
    Register-ScheduledTask @taskOptions | Out-Null
    Write-Host 'Autostart is enabled for the next Windows boot. To test now, select Run on DiscordMusicBot in Task Scheduler.'
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
