Get-Process VoxDrop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

$setup = Get-ChildItem "C:\Users\SaschaBigger\Artis Treuhand GmbH\OneDrive - Artis Treuhand GmbH\Claude\VOXDROP\output\VoxDrop-Setup-v*.exe" |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "Using setup: $($setup.Name)"
Start-Process $setup.FullName -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART" -Wait
Write-Host "Setup done"

$exe = "$env:LOCALAPPDATA\Programs\VoxDrop\VoxDrop.exe"
Get-Item $exe | Format-Table Name,Length,LastWriteTime -AutoSize

Start-Process $exe
Start-Sleep 8
Write-Host "Running:"
Get-Process VoxDrop -ErrorAction SilentlyContinue | Format-Table Id,StartTime -AutoSize
