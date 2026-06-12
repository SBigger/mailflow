$paths = @(
    "$env:LOCALAPPDATA\Programs\VoxDrop",
    "$env:ProgramFiles\VoxDrop",
    "${env:ProgramFiles(x86)}\VoxDrop"
)
foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "FOUND: $p"
        Get-ChildItem $p | Format-Table Name,Length,LastWriteTime -AutoSize
    }
}
