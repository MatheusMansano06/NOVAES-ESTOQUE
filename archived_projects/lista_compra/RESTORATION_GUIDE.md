# Restauração — Lista de Compra

**Pausado em:** 15/07/2026
**Motivo:** removida da navegação a pedido; o backend continua intacto.

## O que ainda existe (nada foi deletado)

| Item | Onde | Status |
|------|------|--------|
| Endpoint `GET /api/lista-compra` | `backend/app/main.py:5494` | ✅ ativo |
| Endpoint `POST /api/lista-compra/atualizar-estoque` | `backend/app/main.py:5495` | ✅ ativo |
| Lógica de curva ABC / velocidade | `backend/app/main.py:5121` | ✅ ativa |
| Componente React | `archived_projects/lista_compra/ListaCompra.tsx` | 📦 arquivado |

Os endpoints seguem no ar e respondem normalmente — só não há mais tela que os consuma.

## Como retomar (~5 min)

### 1. Devolver o componente
```bash
git mv archived_projects/lista_compra/ListaCompra.tsx frontend/src/components/ListaCompra.tsx
```

### 2. `frontend/src/App.tsx` — quatro pontos

**a) Import** (junto dos outros, ~linha 9):
```tsx
import { ListaCompra } from './components/ListaCompra'
```

**b) Tipo `Pagina`** (~linha 85) — adicionar `'lista-compra'` à união:
```tsx
type Pagina = ... | 'operadores' | 'lista-compra' | 'garimpador'
```

**c) Item de menu** no grupo `Ferramentas` (~linha 1673):
```tsx
{ key: 'lista-compra', label: 'Lista de Compra', icon: 'receipt', active: pagina === 'lista-compra', onClick: () => setPagina('lista-compra') },
```

**d) Renderização da página** (antes de `// ===== PÁGINA DO GARIMPADOR =====`):
```tsx
if (pagina === 'lista-compra') {
  return renderComShell(
    'Lista de Compra',
    'Prioridade de compra pela curva ABC do ML cruzada com estoque e velocidade de venda.',
    <ListaCompra />
  )
}
```

### 3. (Opcional) KPI "Compra urgente" no dashboard

Eram três peças, todas removidas juntas:

```tsx
// estado, junto dos outros useState (~linha 230)
const [compraUrgente, setCompraUrgente] = useState<number | null>(null)

// efeito que carrega em segundo plano (o backend tem cache)
useEffect(() => {
  if (pagina !== 'inicial' || !operadorSessao) return
  let vivo = true
  fetch(`${API_BASE}/api/lista-compra?meta_dias=75`, { cache: 'no-store' })
    .then(r => r.json())
    .then(d => { if (vivo && d?.resumo) setCompraUrgente(d.resumo.maxima ?? 0) })
    .catch(() => {})
  return () => { vivo = false }
}, [pagina, operadorSessao])

// primeiro card do array nvs-kpi-grid (~linha 2096)
{ tag: 'CU', cor: 'yellow', titulo: 'Compra urgente', valor: compraUrgente ?? '…', helper: compraUrgente == null ? 'calculando prioridade…' : (compraUrgente > 0 ? 'SKUs abaixo do mínimo' : 'estoque saudável'), ir: 'lista-compra' as Pagina },
```

⚠️ O `ir:` usa `as Pagina`, que é um cast — o TypeScript **não** avisa se a página deixar de existir. Restaure o passo 2b antes deste, senão o card leva pra tela branca.

### 4. Conferir
```bash
cd frontend && npx tsc --noEmit && npm run build
```

## Regra de negócio (pra contexto)

Meta de estoque = velocidade de venda × 75 dias. Um SKU com ≤ 20% da meta entra como **urgente**. O `meta_dias=75` é parâmetro de query, dá pra ajustar sem tocar em código.

Ver também: memória `lista-de-compra.md`.
