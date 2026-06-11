@echo off
cd /d "%~dp0backend"
echo Iniciando Backend na porta 8000...
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause
