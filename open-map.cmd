@echo off
cd /d "%~dp0"
set "NODE_EXE=C:\Users\Nagz\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Unable to find Node.js. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

rem Open the browser after a short delay so the server is already listening.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:4173"
"%NODE_EXE%" scripts\serve-standalone.mjs
