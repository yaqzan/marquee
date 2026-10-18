# Registers Marquee's scheduled task. It runs through hidden_run.vbs (no console flash).
#   "Marquee Watchdog"  every 5 min + at logon: restart the server / tunnel if down
#
# This machine:  .\install-tasks.ps1 -Controller C:\Development\server.ps1
# Register-ScheduledTask can need elevation; this falls back to schtasks unelevated.
param(
    [int]$Port = 5007,
    [string]$Tunnel = 'marquee',
    [string]$Controller = '',
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'

$watchdog = Join-Path $PSScriptRoot 'watchdog.ps1'
$vbs = Join-Path $PSScriptRoot 'hidden_run.vbs'
if ($Controller -and -not (Test-Path $Controller)) { throw "controller not found at $Controller" }

function Quote([string[]]$parts) { ($parts | ForEach-Object { "`"$_`"" }) -join ' ' }

# Only non-default args, so the command stays under schtasks' 261-char /tr limit.
$wdArgs = @()
if ($Port -ne 5007) { $wdArgs += @('-Port', $Port) }
if ($Tunnel -ne 'marquee') { $wdArgs += @('-Tunnel', $Tunnel) }
if ($Python -ne 'python') { $wdArgs += @('-Python', $Python) }
if ($Controller) { $wdArgs += @('-Controller', (Resolve-Path $Controller).Path) }
$wdLine = "//B //Nologo `"$vbs`" " + (Quote (@('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watchdog) + $wdArgs))

try {
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $wdLine
    $triggers = @(
        (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
            -RepetitionInterval (New-TimeSpan -Minutes 5) `
            -RepetitionDuration (New-TimeSpan -Days 3650)),
        (New-ScheduledTaskTrigger -AtLogOn)
    )
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName 'Marquee Watchdog' -Action $action `
        -Trigger $triggers -Settings $settings -Force -ErrorAction Stop | Out-Null
    Write-Host 'Registered task: Marquee Watchdog (every 5 min + at logon)'
} catch {
    Write-Host "Register-ScheduledTask failed ($($_.Exception.Message.Trim())) - falling back to schtasks"
    schtasks /create /tn "Marquee Watchdog" /sc minute /mo 5 /tr "wscript.exe $wdLine" /f
    if ($LASTEXITCODE -ne 0) { throw "schtasks fallback failed with exit code $LASTEXITCODE" }
    Write-Host 'Registered task: Marquee Watchdog (every 5 min, current user)'
}
