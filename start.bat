@echo off
cd /d Z:\z_youtube_player

if exist "pack\win-unpacked\YouTube Music.exe" (
    start "" "pack\win-unpacked\YouTube Music.exe"
    exit /b 0
)

echo ERROR: No built exe found.
echo Run build.bat first to compile the app.
pause
