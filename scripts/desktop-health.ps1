$ErrorActionPreference = 'Continue'

Write-Output "HOST=$env:COMPUTERNAME"
Write-Output "USER=$env:USERNAME"
Write-Output "TIME=$(Get-Date -Format o)"

Get-CimInstance Win32_ComputerSystem |
    Select-Object Manufacturer, Model,
        @{Name = 'MemoryGB'; Expression = { [math]::Round($_.TotalPhysicalMemory / 1GB, 1) }} |
    Format-List

Get-CimInstance Win32_Processor |
    Select-Object Name, NumberOfCores, NumberOfLogicalProcessors |
    Format-List

Get-CimInstance Win32_OperatingSystem |
    Select-Object Caption, Version, BuildNumber, LastBootUpTime |
    Format-List

Get-CimInstance Win32_VideoController |
    Select-Object Name, DriverVersion, DriverDate, Status |
    Format-List

Get-PSDrive -PSProvider FileSystem |
    Select-Object Name,
        @{Name = 'FreeGB'; Expression = { [math]::Round($_.Free / 1GB, 1) }},
        @{Name = 'UsedGB'; Expression = { [math]::Round($_.Used / 1GB, 1) }} |
    Format-Table -AutoSize

Write-Output 'SSH_SERVICES'
Get-Service -ErrorAction SilentlyContinue |
    Where-Object Name -match 'ssh' |
    Select-Object Name, DisplayName, Status, StartType |
    Format-Table -AutoSize

Write-Output 'SSH_LISTENERS'
Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess, State |
    Format-Table -AutoSize

Write-Output 'NETWORK_PROFILES'
Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity, IPv6Connectivity |
    Format-Table -AutoSize

Write-Output 'IPV4_ADDRESSES'
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object InterfaceAlias, IPAddress, PrefixLength |
    Format-Table -AutoSize

Write-Output 'SSH_FIREWALL_RULES'
Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'OpenSSH|sshd' -or $_.DisplayName -match 'OpenSSH|sshd' } |
    Select-Object Name, DisplayName, Enabled, Profile, Direction, Action |
    Format-Table -AutoSize

Write-Output 'LOCAL_SSH_TEST'
Test-NetConnection -ComputerName 127.0.0.1 -Port 22 -InformationLevel Detailed -WarningAction SilentlyContinue |
    Select-Object ComputerName, RemotePort, TcpTestSucceeded |
    Format-List

Write-Output 'AIWORKBENCH_TASKS'
Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -match 'AIWorkbench|SSH|WSL|Runner|Backup' } |
    Select-Object TaskPath, TaskName, State |
    Format-Table -AutoSize

Write-Output 'PRESENT_DEVICE_ERRORS'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object Status -ne 'OK' |
    Select-Object Class, FriendlyName, Status, Problem |
    Format-Table -AutoSize

Write-Output 'RECENT_CRITICAL_EVENTS'
Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    StartTime = (Get-Date).AddDays(-3)
    Level = 1, 2
} -MaxEvents 150 -ErrorAction SilentlyContinue |
    Where-Object ProviderName -match 'WHEA|Display|nvlddmkm|Kernel-Power|WindowsUpdateClient' |
    Select-Object -First 30 TimeCreated, ProviderName, Id, Message |
    Format-List

Write-Output 'DESKTOP_HEALTH_DONE'
