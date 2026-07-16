# Projetos Pausados

Funcionalidades tiradas da navegação, mas **não deletadas**. Cada pasta guarda o
componente React e um guia de restauração passo a passo.

A regra aqui é: **só o frontend é arquivado.** O backend — endpoints, utilitários
e tabelas — fica onde está, ativo e intacto. Retomar uma funcionalidade é, na
prática, devolver o componente e religar quatro pontos no `App.tsx`.

## O que está pausado

Nada. Os três projetos que estavam aqui foram **retomados em 16/07/2026** e voltaram
para a navegação, no grupo **Arquivados** da sidebar:

| Projeto | Pausado em | Retomado em | Componente (hoje) |
|---|---|---|---|
| Estoque de Embalagens | 15/07/2026 | 16/07/2026 | `frontend/src/components/EstoqueEmbalagens.tsx` |
| Radar de Envio FULL | 15/07/2026 | 16/07/2026 | `frontend/src/components/RadarFull.tsx` |
| Lista de Compra | 15/07/2026 | 16/07/2026 | `frontend/src/components/ListaCompra.tsx` |

Os `RESTORATION_GUIDE.md` de cada pasta seguem aqui como registro do que foi feito
— e servem de receita caso algum deles seja pausado de novo.

## O backend nunca foi tocado

Foi por isso que a retomada custou só o `App.tsx`: os utilitários e endpoints
seguiram no ar o tempo todo, em `backend/app/utils/`.

| Utilitário (ativo) | Endpoints |
|---|---|
| `backend/app/utils/embalagens.py` | `/api/embalagens/*` |
| `backend/app/utils/radar_full.py` | `/api/ml/radar-full` |
| `backend/app/utils/lista_compra.py` | `/api/lista-compra`, `/api/lista-compra/atualizar-estoque` |

As tabelas também estão intactas: `embalagens`, `embalagem_compras`,
`embalagem_movimentos`, `embalagem_vinculos`, `ml_item_cache`, `ml_venda_cache`,
`ml_sync_state`. Nenhum dado histórico foi perdido.

## Como pausar/retomar (~5 min)

1. Leia o `RESTORATION_GUIDE.md` do projeto — cada um lista os pontos exatos, com código.
2. Mova o componente: `git mv` entre `archived_projects/<projeto>/` e `frontend/src/components/`.
3. Religue no `App.tsx`, nesta ordem: **tipo `Pagina`** → **import** → **item de menu** → **bloco `if (pagina === ...)`**.
4. Valide: `cd frontend && npx tsc --noEmit && npm run build`

⚠️ Os passos "4. Atualizar `backend/app/main.py`" dos guias do Radar e do Estoque de
Embalagens estão **obsoletos**: mandam criar endpoints com sintaxe FastAPI
(`@router.get`), mas este backend usa `Route(...)` do Starlette e as rotas já
existem e nunca saíram. Siga o passo 2 de cada guia ("Backend: nada a fazer").

### ⚠️ A armadilha do tipo `Pagina`

Os KPIs do dashboard navegam via `ir: 'x' as Pagina`. Esse `as` é um **cast** — o
TypeScript não valida se a página existe. Um link para uma página sem bloco `if`
correspondente não gera erro de compilação: o app renderiza **tela branca**.

É por isso que o passo 3 pede o tipo `Pagina` **primeiro**. Mantendo a união do
tipo honesta, link órfão quebra no `tsc` em vez de quebrar na cara do operador.

Vale lembrar que `npm run build` (Vite/esbuild) **não faz typecheck** — só remove
os tipos. Rodar `npx tsc --noEmit` é o que pega esse tipo de erro.

## Por que pausar em vez de deletar

Preserva o trabalho, mantém o histórico, e o backend continuar no ar significa que
retomar é só frontend — como a retomada de 16/07/2026 comprovou.

---

Contexto adicional nas memórias do projeto: `estoque-embalagens.md`,
`radar-envio-full.md`, `lista-de-compra.md`.
