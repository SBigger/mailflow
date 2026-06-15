Get-Process VoxDrop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

$setup = "C:\Users\SaschaBigger\Artis Treuhand GmbH\OneDrive - Artis Treuhand GmbH\Claude\VOXDROP\output\VoxDrop-Setup-v1.5.0.exe"
Start-Process $setup -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART" -Wait
Write-Host "Setup done"

$exe = "$env:LOCALAPPDATA\Programs\VoxDrop\VoxDrop.exe"

# Erste Instanz
Start-Process $exe
Start-Sleep 25
Write-Host "Nach 1. Start (warte 25s damit Bootloader fertig extrahiert):"
Get-CimInstance Win32_Process -Filter "Name='VoxDrop.exe'" | Select-Object ProcessId,ParentProcessId,CreationDate | Format-Table -AutoSize

# Zweiten Start versuchen
Start-Process $exe
Start-Sleep 25
Write-Host "Nach 2. Start (warte 25s, Mutex sollte 2. Instanz killen):"
Get-CimInstance Win32_Process -Filter "Name='VoxDrop.exe'" | Select-Object ProcessId,ParentProcessId,CreationDate | Format-Table -AutoSize
