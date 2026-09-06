@echo off
cd /d "%~dp0"
set "NODE_EXE=C:\Users\Nagz\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo Unable to find the bundled Node.js runtime.
  pause
  exit /b 1
)

start "" "http://localhost:4173"
"%NODE_EXE%" scripts\serve-standalone.mjs

