# 📊 Guia de Retomada: Radar de Envio FULL

**Pausado em:** 15/07/2026  
**Funcionalidade:** Previsão de ruptura e sugestão do melhor momento para enviar ao Mercado Livre FULL

## ✅ O que foi pausado

- Aba "Radar de Envio" no menu FULL
- Análise de velocidade de venda vs estoque
- Previsão de ruptura (dias até zerar)
- Sugestão de quanto e quando enviar
- KPI "Envie HOJE" no dashboard

## 📋 Checklist de Retomada

### 1. **Restaurar Componente Frontend**
```bash
git mv archived_projects/radar_full/RadarFull.tsx frontend/src/components/
```

### 2. **Backend: nada a fazer**

`backend/app/utils/radar_full.py` **nunca saiu do lugar** e o endpoint
`/api/ml/radar-full` segue ativo e importado no `main.py`. Só o frontend foi
arquivado — não há `.py` para copiar de volta.

⚠️ O `RadarFull` recebe uma prop opcional `onVerListaCompra`, que abria a Lista
de Compra. Essa página também está pausada (ver `../lista_compra/`). Ou restaure
as duas juntas, ou simplesmente omita a prop — ela é opcional e o botão some.

### 3. **Atualizar `frontend/src/App.tsx`**

Adicione em `imports`:
```tsx
import { RadarFull } from './components/RadarFull'
```

Adicione ao tipo `Pagina` (linha ~88):
```tsx
type Pagina = '...' | 'radar-full'
```

Localize `ShellNavGroup` (procure por `FULL`) e adicione:
```tsx
{ key: 'radar-full', label: 'Radar de Envio', icon: 'radar', active: pagina === 'radar-full', onClick: () => setPagina('radar-full') },
```

Adicione renderização (antes do `return null` final):
```tsx
if (pagina === 'radar-full') {
  return renderComShell(
    'Radar de Envio Full',
    'O momento certo de enviar cada produto pro Full — antes da ruptura.',
    <RadarFull onVerListaCompra={() => setPagina('lista-compra')} />
  )
}
```

### 4. **Atualizar `backend/app/main.py`**

Adicione import:
```python
from app.utils.radar_full import calcular_radar_full
```

Adicione endpoint (após `/api/ml/conectar`):
```python
@router.get("/api/ml/radar-full")
async def radar_full(
    meta_dias: int = 30,
    lead_time: int = 5,
    horizonte: int = 21,
    refresh: int = 0,
    db: Session = Depends(get_db)
):
    return calcular_radar_full(
        db, meta_dias, lead_time, horizonte, refresh=bool(refresh)
    )
```

### 5. **Verificar Dependências de Dados**

O Radar precisa que existam:

✅ **Tabelas necessárias** (já devem existir):
- `ml_item_cache` - Estoque atual do ML
- `ml_venda_cache` - Histórico de vendas recentes
- `ml_sync_state` - Último sync com ML
- `embaldes_fu` - Inbounds FULL em andamento

✅ **Dados requeridos**:
- Estoque sincronizado do Mercado Livre (via `/api/ml/sync-estoque`)
- Histórico de vendas (via `/api/ml/sync-vendas`)
- Inbounds FULL ativos (via `/api/embaldes`)

### 6. **Verificar Integração com Mercado Livre**

O Radar depende de token válido do ML:
1. Acesse "Anúncios ML" no menu
2. Clique "Conectar Mercado Livre" se necessário
3. Autorize o acesso
4. Execute `/api/ml/sync-estoque` e `/api/ml/sync-vendas`

Sem esses dados, o Radar mostrará "Mercado Livre desconectado".

### 7. **Testar Integração**

1. Inicie o backend: `python -m uvicorn app.main:app --reload`
2. Inicie o frontend: `npm run dev`
3. Navegue até "FULL" → "Radar de Envio"
4. Teste:
   - ✅ Página carrega com SKUs do Full
   - ✅ Filtro de busca funciona
   - ✅ Placares (Envie HOJE, Esta semana, Programe) atualizam
   - ✅ Mudar alvo (dias) e lead time recalcula
   - ✅ Botão "Ver Lista de Compra" navega para lista

## 🔗 Dependências Internas

- Usa `MLSyncState` para verificar sincronização com ML
- Lê cache de estoque (`ml_item_cache`)
- Lê snapshot de vendas (`ml_venda_cache`)
- Integra com `embaldes_fu` para ver inbounds em andamento

## 🧮 Lógica do Cálculo

1. **Velocidade** = vendas últimos 30 dias ÷ 30
2. **Dias até ruptura** = estoque_disponível ÷ velocidade_dia
3. **Dias para agendar envio** = dias_ruptura - lead_time
4. **Momento** = classifica em "Hoje", "Esta semana", "Programe"
5. **Quanto enviar** = velocidade_dia × meta_dias

Exemplo:
```
Estoque: 100 un | Vendo: 10/dia | Lead time: 5d | Meta: 30d
→ Dias ruptura: 100÷10 = 10 dias
→ Dias agendar: 10-5 = 5 dias
→ Enviar: 10×30 = 300 un
→ Status: "Esta semana"
```

## 📊 Cache e Performance

O Radar usa cache de 10 minutos no backend:
- Primeira requisição: calcula tudo (pode levar 5-10s)
- Requisições seguintes: responde do cache
- Use `&refresh=1` para forçar recálculo

## 📞 Suporte

Se o Radar não carregar:
1. ✅ ML está conectado? ("Anúncios ML" → conectar)
2. ✅ Estoque sincronizado? (/api/ml/sync-estoque)
3. ✅ Vendas sincronizadas? (/api/ml/sync-vendas)
4. ✅ Endpoint retorna dados? (GET `/api/ml/radar-full`)
5. ❓ Se tudo OK mas erro "sem_token" = reconectar ML

