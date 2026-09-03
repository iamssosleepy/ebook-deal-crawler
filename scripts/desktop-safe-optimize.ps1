$ErrorActionPreference = 'Stop'

$expectedHost = 'ERICFRACTAL'
if ($env:COMPUTERNAME -ne $expectedHost) {
    throw "Refusing to run on unexpected host: $env:COMPUTERNAME"
}

$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
if ($computer.Manufacturer -notmatch 'Gigabyte' -or $processor.Name -notmatch 'Ryzen 5 5600X') {
    throw 'Refusing to run: hardware identity does not match the Luzhou desktop'
}

Write-Output "HOST=$env:COMPUTERNAME"
Write-Output 'POWER_BEFORE'
powercfg /getactivescheme

# Keep the 24/7 worker awake on AC power while still allowing the display to turn off.
powercfg /change standby-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'Unable to disable AC sleep timeout' }
powercfg /change hibernate-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'Unable to disable AC hibernate timeout' }
powercfg /change monitor-timeout-ac 15
if ($LASTEXITCODE -ne 0) { throw 'Unable to set AC display timeout' }

Write-Output 'POWER_AFTER'
powercfg /getactivescheme
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE
powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE
Write-Output 'DESKTOP_SAFE_OPTIMIZE_DONE'
