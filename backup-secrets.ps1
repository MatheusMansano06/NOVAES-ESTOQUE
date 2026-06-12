# ============================================================
# Backup dos arquivos sensiveis do Estoque Virtual
# Gera 'estoque-virtual-secrets.zip' para levar a outro PC
# (NAO passa pelo GitHub - este zip esta no .gitignore)
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "=== BACKUP DE SEGREDOS - ESTOQUE VIRTUAL ===" -ForegroundColor Cyan
Write-Host ""

# Arquivos sensiveis que precisam ir para o outro PC
$arquivos = @(
    'backend\.env',
    'backend\olist_token.json'
)
$existentes = $arquivos | Where-Object { Test-Path $_ }

if ($existentes.Count -eq 0) {
    Write-Host "[ERRO] Nenhum arquivo de segredo encontrado." -ForegroundColor Red
    Write-Host "       Esperado: backend\.env e/ou backend\olist_token.json"
    Read-Host "`nPressione ENTER para sair"
    exit 1
}

$destino = Join-Path $root 'estoque-virtual-secrets.zip'
if (Test-Path $destino) { Remove-Item $destino -Force }

Compress-Archive -Path $existentes -DestinationPath $destino -Force

Write-Host "[OK] Backup criado com sucesso!" -ForegroundColor Green
Write-Host "     Arquivo: estoque-virtual-secrets.zip"
Write-Host ""
Write-Host "Incluidos:"
$existentes | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow }
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Cyan
Write-Host "  1. Copie 'estoque-virtual-secrets.zip' para o pendrive"
Write-Host "  2. No outro PC, clone o projeto do GitHub"
Write-Host "  3. Coloque o zip na raiz do projeto"
Write-Host "  4. Rode 'restore-secrets.bat' la"
Write-Host ""
Write-Host "ATENCAO: este zip contem senhas/tokens. Nao compartilhe publicamente!" -ForegroundColor Red
Read-Host "`nPressione ENTER para sair"
