$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$s = $ws.CreateShortcut((Join-Path $desktop "YouTube Music.lnk"))
$s.TargetPath = "Z:\z_youtube_player\pack\win-unpacked\YouTube Music.exe"
$s.WorkingDirectory = "Z:\z_youtube_player\pack\win-unpacked"
$s.IconLocation = "Z:\z_youtube_player\icon.ico,0"
$s.Save()
Write-Host "Desktop shortcut updated to built exe."
