@echo off
echo ============================================
echo  YouTube Music - Build ^& Install
echo ============================================
echo.

cd /d Z:\z_youtube_player

echo [1/3] Cleaning previous build...
call pnpm clean
if errorlevel 1 (
    echo ERROR: Clean failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Building app...
call pnpm build
if errorlevel 1 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Packaging for Windows...
call pnpm electron-builder --win dir:x64 -p never
if errorlevel 1 (
    echo ERROR: Packaging failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build complete!
echo  Exe: pack\win-unpacked\YouTube Music.exe
echo ============================================
echo.
echo Run start.bat or the desktop shortcut to launch.
pause
