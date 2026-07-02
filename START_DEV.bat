@echo off
REM Inicia backend e frontend em paralelo

echo [BACKEND] Iniciando servidor FastAPI...
start "NVS Backend" cmd /k "cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak

echo [FRONTEND] Iniciando servidor Vite...
start "NVS Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo =====================================
echo FRONTEND: http://localhost:5173
echo BACKEND:  http://localhost:8000/api
echo DOCS:     http://localhost:8000/docs
echo =====================================
echo.
echo Aguardando inicializacao...
timeout /t 5

start http://localhost:5173
