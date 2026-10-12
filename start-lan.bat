@echo off
cd /d "%~dp0"
python -c "import websockets; assert int(websockets.__version__.split('.')[0]) == 16" >nul 2>&1
if errorlevel 1 (
  echo WebSocket relay requires: python -m pip install -r requirements-relay.txt
  pause
  exit /b 1
)
python lan_server.py
pause
