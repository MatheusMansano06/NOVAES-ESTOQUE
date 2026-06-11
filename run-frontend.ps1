# Estoque Virtual - Frontend Startup Script
# Runs the React dev server on http://localhost:5173

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  ESTOQUE VIRTUAL - FRONTEND" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

$frontendPath = "$PSScriptRoot\frontend"

# Start frontend
Write-Host "Starting Vite dev server..." -ForegroundColor Yellow
Write-Host "Application: http://localhost:5173`n" -ForegroundColor Cyan

cd $frontendPath
npm run dev

Write-Host "`n✗ Frontend server stopped" -ForegroundColor Red
