$ErrorActionPreference = 'Stop'

$expectedHost = 'ERICFRACTAL'
$expectedProfile = 'mexico777_5G 3'
$expectedInterface = 'Wi-Fi'

if ($env:COMPUTERNAME -ne $expectedHost) {
    throw "Refusing to run on unexpected host: $env:COMPUTERNAME"
}

$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
if ($computer.Manufacturer -notmatch 'Gigabyte' -or $processor.Name -notmatch 'Ryzen 5 5600X') {
    throw "Refusing to run: hardware identity does not match the Luzhou desktop"
}

$profile = Get-NetConnectionProfile -InterfaceAlias $expectedInterface -ErrorAction Stop
if ($profile.Name -ne $expectedProfile) {
    throw "Refusing to change unexpected network profile: $($profile.Name)"
}

Write-Output "HOST=$env:COMPUTERNAME"
Write-Output "PROFILE_BEFORE=$($profile.NetworkCategory)"

if ($profile.NetworkCategory -eq 'Public') {
    Set-NetConnectionProfile -InterfaceAlias $expectedInterface -NetworkCategory Private
} elseif ($profile.NetworkCategory -ne 'Private') {
    throw "Unexpected network category: $($profile.NetworkCategory)"
}

$after = Get-NetConnectionProfile -InterfaceAlias $expectedInterface -ErrorAction Stop
if ($after.NetworkCategory -ne 'Private') {
    throw "Network profile change did not take effect"
}

$sshRules = Get-NetFirewallRule -ErrorAction Stop |
    Where-Object {
        ($_.Name -match 'OpenSSH|sshd' -or $_.DisplayName -match 'OpenSSH|sshd') -and
        $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow'
    }
if (-not $sshRules) {
    throw "No enabled inbound allow rule for OpenSSH was found"
}

$sshd = Get-Service sshd -ErrorAction Stop
if ($sshd.Status -ne 'Running') {
    Start-Service sshd
}
Set-Service sshd -StartupType Automatic

$localTest = Test-NetConnection -ComputerName 127.0.0.1 -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $localTest) {
    throw "Local SSH listener validation failed"
}

Write-Output "PROFILE_AFTER=$($after.NetworkCategory)"
Write-Output "SSHD_STATUS=$((Get-Service sshd).Status)"
Write-Output 'DESKTOP_NETWORK_REPAIR_DONE'
