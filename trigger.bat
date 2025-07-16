@echo off

@REM echo Killing all pm2 processes...
@REM call pm2 kill

:: Run audio2face headless process
echo Starting audio2face headless process...
start "" "C:\Users\mynam\AppData\Local\ov\pkg\audio2face-2023.2.0\audio2face_headless.bat"

echo Starting all services with pm2 using ecosystem.config.js...
start "" pm2 start "C:/Users/mynam/Downloads/holobox/ecosystem.config.js"

timeout /t 10 /nobreak

:: Run the new command to connect audio2face
echo Running connect_audio2face.py...
python "C:/Users/mynam/Downloads/S2S-Lipsync-UnrealAvatar-Backend/audio2face/connect_a2f.py"

timeout /t 2 /nobreak

:: Minimize all windows using PowerShell
@REM powershell -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"

:: Execute ue.exe after minimizing windows
echo Running Unreal Engine...
start "" "C:\Users\mynam\Desktop\UE\UE.exe"

