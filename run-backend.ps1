# Estoque Virtual - Backend Startup Script
# Runs the FastAPI backend on http://localhost:8000

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  ESTOQUE VIRTUAL - BACKEND" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

$backendPath = "$PSScriptRoot\backend"

# Activate virtual environment
Write-Host "Activating Python virtual environment..." -ForegroundColor Yellow
& "$backendPath\venv\Scripts\Activate.ps1"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Virtual environment activated`n" -ForegroundColor Green
} else {
    Write-Host "✗ Failed to activate virtual environment" -ForegroundColor Red
    exit 1
}

# Start backend
Write-Host "Starting FastAPI backend server..." -ForegroundColor Yellow
Write-Host "API Documentation: http://localhost:8000/docs`n" -ForegroundColor Cyan

cd $backendPath
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Write-Host "`n✗ Backend server stopped" -ForegroundColor Red
