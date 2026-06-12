Get-Process VoxDrop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process "$env:LOCALAPPDATA\Programs\VoxDrop\VoxDrop.exe"
Start-Sleep 6
Get-Process VoxDrop -ErrorAction SilentlyContinue | Format-Table Id,StartTime -AutoSize
