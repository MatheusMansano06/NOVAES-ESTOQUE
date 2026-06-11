# ============================================================
# Restaura os arquivos sensiveis do Estoque Virtual
# Le 'estoque-virtual-secrets.zip' e coloca em backend\
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "=== RESTAURAR SEGREDOS - ESTOQUE VIRTUAL ===" -ForegroundColor Cyan
Write-Host ""

$zip = Join-Path $root 'estoque-virtual-secrets.zip'
if (-not (Test-Path $zip)) {
    Write-Host "[ERRO] 'estoque-virtual-secrets.zip' nao encontrado nesta pasta." -ForegroundColor Red
    Write-Host "       Copie o arquivo do pendrive para a raiz do projeto e tente de novo."
    Read-Host "`nPressione ENTER para sair"
    exit 1
}

$backend = Join-Path $root 'backend'
if (-not (Test-Path $backend)) { New-Item -ItemType Directory -Path $backend | Out-Null }

Expand-Archive -Path $zip -DestinationPath $backend -Force

Write-Host "[OK] Segredos restaurados em backend\" -ForegroundColor Green
Write-Host ""
if (Test-Path (Join-Path $backend '.env')) { Write-Host "  - backend\.env" -ForegroundColor Yellow }
if (Test-Path (Join-Path $backend 'olist_token.json')) { Write-Host "  - backend\olist_token.json" -ForegroundColor Yellow }
Write-Host ""
Write-Host "Pronto! Agora pode rodar o backend normalmente." -ForegroundColor Cyan
Read-Host "`nPressione ENTER para sair"
