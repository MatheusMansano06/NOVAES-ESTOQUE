@echo off
REM Script para iniciar Backend e Frontend do Estoque Virtual

title Estoque Virtual - Servidores

echo.
echo ========================================================
echo ESTOQUE VIRTUAL - INICIANDO SERVIDORES
echo ========================================================
echo.

REM Iniciar Backend em nova janela
echo [1] Iniciando Backend (porta 8000)...
start "Backend - Estoque Virtual" cmd /k "cd backend && python -m uvicorn app.main:app --reload"

REM Aguardar um pouco
timeout /t 3

REM Iniciar Frontend em nova janela
echo [2] Iniciando Frontend (porta 5173)...
start "Frontend - Estoque Virtual" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================================
echo SERVIDORES INICIADOS!
echo ========================================================
echo.
echo Backend:  http://localhost:8000
echo           http://localhost:8000/docs (API Docs)
echo.
echo Frontend: http://localhost:5173
echo.
echo Feche as janelas para parar os servidores.
echo.
pause
