# Inicia Backend e Frontend em paralelo (PowerShell)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "NVS ESTOQUE - Inicializando ambiente de dev..." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Função para iniciar processo
function Start-Service {
    param([string]$Name, [string]$Path, [string]$Command)

    Write-Host "`n[*] Iniciando $Name..." -ForegroundColor Green
    $proc = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Path'; $Command" -PassThru
    Write-Host "[$($proc.Id)] $Name iniciado" -ForegroundColor Green
    return $proc
}

# Backend
$backendProc = Start-Service `
    -Name "Backend (FastAPI)" `
    -Path "backend" `
    -Command "python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

# Aguarda um pouco
Start-Sleep -Seconds 3

# Frontend
$frontendProc = Start-Service `
    -Name "Frontend (Vite)" `
    -Path "frontend" `
    -Command "npm run dev"

# Aguarda mais um pouco para inicializar
Start-Sleep -Seconds 3

# Exibe URLs
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "✓ Serviços iniciados com sucesso!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "`nURLs importantes:" -ForegroundColor Yellow
Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor White
Write-Host "  Backend:   http://localhost:8000/api" -ForegroundColor White
Write-Host "  Docs:      http://localhost:8000/docs" -ForegroundColor White
Write-Host "`nPIDs dos processos:" -ForegroundColor Yellow
Write-Host "  Backend:   $($backendProc.Id)" -ForegroundColor White
Write-Host "  Frontend:  $($frontendProc.Id)" -ForegroundColor White
Write-Host "`nPressione CTRL+C aqui para encerrar ambos os serviços" -ForegroundColor Yellow
Write-Host "================================================`n" -ForegroundColor Cyan

# Abre navegador
Start-Process "http://localhost:5173"

# Aguarda processos
$backendProc, $frontendProc | Wait-Process
