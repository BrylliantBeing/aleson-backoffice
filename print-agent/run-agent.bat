@echo off
REM Starts the Aleson print agent, creating its virtualenv on first run.
REM Point a Windows "At log on" scheduled task at this file so every counter
REM has the agent up before the first sale of the day.

setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtualenv...
  py -3 -m venv .venv || goto :fail
  ".venv\Scripts\python.exe" -m pip install --upgrade pip || goto :fail
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :fail
)

".venv\Scripts\python.exe" agent.py
goto :eof

:fail
echo.
echo Setup failed. Check that Python 3.10+ is installed and on PATH.
pause
