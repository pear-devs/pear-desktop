Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("Z:\z_youtube_player\assets\icon.png")
$bmp = New-Object System.Drawing.Bitmap $img
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create("Z:\z_youtube_player\icon.ico")
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
$img.Dispose()
Write-Host "icon.ico created"
