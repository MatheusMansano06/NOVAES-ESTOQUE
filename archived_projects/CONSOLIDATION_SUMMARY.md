# 🎯 Resumo da Consolidação - 15/07/2026

## Funcionalidades Arquivadas

### ✅ Estoque de Embalagens
- **Status:** Movido para `archived_projects/estoque_embalagens/`
- **Arquivos:**
  - ✓ `EstoqueEmbalagens.tsx` (Frontend)
  - ✓ `embalagens.py` (Backend utils)
  - ✓ `RESTORATION_GUIDE.md` (Instruções)
- **Modelos DB Mantidos:** Embalagem, EmbalagemCompra, EmbalagemMovimento, EmbalagemVinculo
- **Removido do código ativo:**
  - ❌ Import em App.tsx
  - ❌ Tipo Pagina
  - ❌ Menu item em ShellNavGroup (Ferramentas)
  - ❌ Renderização da página

### ✅ Radar de Envio FULL
- **Status:** Movido para `archived_projects/radar_full/`
- **Arquivos:**
  - ✓ `RadarFull.tsx` (Frontend)
  - ✓ `radar_full.py` (Backend utils)
  - ✓ `RESTORATION_GUIDE.md` (Instruções)
- **Modelos DB Mantidos:** Usa `ml_item_cache`, `ml_venda_cache`, `ml_sync_state`
- **Removido do código ativo:**
  - ❌ Import em App.tsx
  - ❌ Tipo Pagina
  - ❌ Menu item em ShellNavGroup (FULL)
  - ❌ Renderização da página
  - ❌ useEffect de carregamento do KPI "Envie HOJE"

---

## Mudanças no Código

### `frontend/src/App.tsx`
| Remoção | Linha | Descrição |
|---------|-------|-----------|
| Import | ~11-12 | `RadarFull`, `EstoqueEmbalagens` |
| Tipo | ~88 | `'radar-full' \| 'estoque-embalagens'` |
| Menu | ~1682-1690 | Itens do menu Ferramentas e FULL |
| Renderização | ~3361-3376 | Blocos if (pagina === ...) |
| useEffect | ~452-466 | Carregamento do radarHoje |
| useState | ~233-235 | const [radarHoje, setRadarHoje] |

### Banco de Dados
- ✅ **NÃO foi deletado nada**
- Tabelas continuam intactas:
  - `embalagens`, `embalagem_compras`, `embalagem_movimentos`, `embalagem_vinculos`
  - `ml_item_cache`, `ml_venda_cache`, `ml_sync_state`
- Dados históricos foram preservados

### Backend (`backend/app/main.py`)
- ❌ Endpoints `/api/embalagens/*` (não removidos, apenas não acessados)
- ❌ Endpoint `/api/ml/radar-full` (não removido, apenas não acessado)
- Os endpoints continuam no código caso alguém chame diretamente (compatibilidade)

---

## Como Retomar

### Rápido (30 min)
1. Ler `archived_projects/<projeto>/RESTORATION_GUIDE.md`
2. Copiar arquivos de volta
3. Restaurar imports em App.tsx
4. Testar navegação

### Completo (se houver mudanças no código ativo)
1. Seguir guia acima
2. Resolver conflitos de merge se houver
3. Testar endpoints do backend
4. Verificar que as tabelas SQL existem

---

## Segurança e Integridade

✅ **Git:** Tudo está versionado
```bash
git log --oneline archived_projects/
git show HEAD -- archived_projects/
```

✅ **Dados:** Banco não foi limpo
```bash
sqlite3 estoque_virtual.db ".tables" | grep -E "embalagem|ml_"
```

✅ **Compatibilidade:** Código antigo não quebra (imports foram removidos, endpoints ainda existem)

---

## Para o Futuro

Se quiser **permanently deletar** ao invés de apenas pausar:

1. Remover tabelas: `DROP TABLE embalagens, embalagem_compras, ...`
2. Remover endpoints em `main.py`
3. Limpar `archived_projects/`
4. Fazer commit com mensagem clara

Mas recomendamos manter aqui primeiro, em caso de "mudança de ideia".

---

**Data da Consolidação:** 15/07/2026  
**Executado por:** Sistema de Arquivamento  
**Próxima ação:** Implementar nova funcionalidade  
