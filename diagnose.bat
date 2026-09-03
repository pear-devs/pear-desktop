@echo off
echo ============================================
echo  YouTube Music - Diagnostic Mode
echo ============================================
echo.
echo Killing any existing YouTube Music instances...
taskkill /f /im "YouTube Music.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting YouTube Music with debug port 9222...
start "" "Z:\z_youtube_player\pack\win-unpacked\YouTube Music.exe" --remote-debugging-port=9222

echo Waiting for app to start...
timeout /t 5 /nobreak >nul

echo Launching monitor...
node "Z:\z_youtube_player\monitor.cjs"
pause
