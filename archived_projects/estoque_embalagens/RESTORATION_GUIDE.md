# 📦 Guia de Retomada: Estoque de Embalagens

**Pausado em:** 15/07/2026  
**Funcionalidade:** Controle de caixas e inserts com baixa automática por venda

## ✅ O que foi pausado

- Aba "Estoque de Embalagens" no menu principal
- Controle de caixas/inserts com dimensões
- Histórico de compras e movimentos
- Vinculação automática de produtos por dimensão

## 📋 Checklist de Retomada

### 1. **Restaurar Componente Frontend**
```bash
cp archived_projects/estoque_embalagens/EstoqueEmbalagens.tsx frontend/src/components/
```

### 2. **Restaurar Utilitário Backend**
```bash
cp archived_projects/estoque_embalagens/embalagens.py backend/app/utils/
```

### 3. **Atualizar `frontend/src/App.tsx`**

Adicione em `imports`:
```tsx
import { EstoqueEmbalagens } from './components/EstoqueEmbalagens'
```

Adicione ao tipo `Pagina` (linha ~88):
```tsx
type Pagina = '...' | 'estoque-embalagens'
```

Localize `ShellNavGroup` (procure por `Ferramentas`) e adicione:
```tsx
{ key: 'estoque-embalagens', label: 'Estoque de Embalagens', icon: 'box', active: pagina === 'estoque-embalagens', onClick: () => setPagina('estoque-embalagens') },
```

Adicione renderização (antes do `return null` final):
```tsx
if (pagina === 'estoque-embalagens') {
  return renderComShell(
    'Estoque de Embalagens',
    'Controle de caixas e inserts com baixa automática por venda.',
    <EstoqueEmbalagens />
  )
}
```

### 4. **Atualizar `backend/app/main.py`**

Adicione import:
```python
from app.utils.embalagens import (
    carregar_embalagens, carregar_produtos_embalagens,
    salvar_embalagem, processar_baixas_embalagens,
    vincular_embalagem, registrar_compra_embalagem,
    ajustar_estoque_embalagem, carregar_movimentos_embalagens
)
```

Adicione endpoints (após `/api/lista-compra`):
```python
@router.get("/api/embalagens")
async def get_embalagens(db: Session = Depends(get_db)):
    return carregar_embalagens(db)

@router.post("/api/embalagens")
async def create_embalagem(req: dict, db: Session = Depends(get_db)):
    return salvar_embalagem(req, db)

@router.get("/api/embalagens/produtos")
async def get_embalagens_produtos(db: Session = Depends(get_db)):
    return carregar_produtos_embalagens(db)

@router.post("/api/embalagens/compra")
async def registrar_compra(req: dict, db: Session = Depends(get_db)):
    return registrar_compra_embalagem(req, db)

@router.post("/api/embalagens/ajuste")
async def ajuste_embalagem(req: dict, db: Session = Depends(get_db)):
    return ajustar_estoque_embalagem(req, db)

@router.post("/api/embalagens/processar-baixas")
async def processar_baixas(db: Session = Depends(get_db)):
    return processar_baixas_embalagens(db)

@router.post("/api/embalagens/vinculo")
async def vincular(req: dict, db: Session = Depends(get_db)):
    return vincular_embalagem(req, db)

@router.get("/api/embalagens/movimentos")
async def movimentos(limit: int = 200, db: Session = Depends(get_db)):
    return carregar_movimentos_embalagens(db, limit)
```

### 5. **Verificar Banco de Dados**

Confirme que as seguintes tabelas existem (em `backend/app/models.py`):

- `Embalagem` ✓
- `EmbalagemCompra` ✓
- `EmbalagemMovimento` ✓
- `EmbalagemVinculo` ✓

Se as tabelas não existirem no banco, o SQLAlchemy as criará automaticamente na próxima inicialização.

### 6. **Testar Integração**

1. Inicie o backend: `python -m uvicorn app.main:app --reload`
2. Inicie o frontend: `npm run dev`
3. Navegue até "Ferramentas" → "Estoque de Embalagens"
4. Teste:
   - ✅ Criar uma nova embalagem
   - ✅ Editar dimensões
   - ✅ Processar baixas
   - ✅ Ver histórico

## 🔗 Dependências Internas

- Usa `ml_venda_cache` para buscar vendas recentes
- Integra com modelo `MLSyncState` para atualizar sincronização
- Reusa estilo CSS de botões do AppShell

## 📞 Suporte

Se encontrar erros:
1. Verifique que os endpoints estão em `main.py`
2. Confirme que as tabelas SQL existem
3. Veja imports em `App.tsx`
4. Limpe o cache do navegador (F5)

