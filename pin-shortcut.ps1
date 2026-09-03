$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$s = $ws.CreateShortcut((Join-Path $desktop "YouTube Music.lnk"))
$s.TargetPath = "cmd.exe"
$s.Arguments = "/c `"cd /d Z:\z_youtube_player && start /min cmd /c pnpm dev`""
$s.WorkingDirectory = "Z:\z_youtube_player"
$s.IconLocation = "Z:\z_youtube_player\icon.ico,0"
$s.WindowStyle = 7
$s.Save()
Write-Host "Shortcut updated - now pinnable"
