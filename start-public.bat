@echo off
cd /d "%~dp0"
python lan_server.py --network public-rtc
pause
