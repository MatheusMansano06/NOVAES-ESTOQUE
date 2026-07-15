# Projetos Pausados

Funcionalidades tiradas da navegação, mas **não deletadas**. Cada pasta guarda o
componente React e um guia de restauração passo a passo.

A regra aqui é: **só o frontend é arquivado.** O backend — endpoints, utilitários
e tabelas — fica onde está, ativo e intacto. Retomar uma funcionalidade é, na
prática, devolver o componente e religar quatro pontos no `App.tsx`.

## O que está pausado

| Projeto | Pausado em | Componente | Guia |
|---|---|---|---|
| Estoque de Embalagens | 15/07/2026 | `estoque_embalagens/EstoqueEmbalagens.tsx` | [guia](estoque_embalagens/RESTORATION_GUIDE.md) |
| Radar de Envio FULL | 15/07/2026 | `radar_full/RadarFull.tsx` | [guia](radar_full/RESTORATION_GUIDE.md) |
| Lista de Compra | 15/07/2026 | `lista_compra/ListaCompra.tsx` | [guia](lista_compra/RESTORATION_GUIDE.md) |

## O backend NÃO foi tocado

Estes arquivos **continuam em `backend/app/utils/`**. Não estão nesta pasta e não
devem ser copiados de volta:

| Utilitário (no backend, ativo) | Endpoints que seguem no ar |
|---|---|
| `backend/app/utils/embalagens.py` | `/api/embalagens/*` |
| `backend/app/utils/radar_full.py` | `/api/ml/radar-full` |
| `backend/app/utils/lista_compra.py` | `/api/lista-compra`, `/api/lista-compra/atualizar-estoque` |

Os três seguem importados no `main.py` e respondendo normalmente — só não há mais
tela que os consuma. Um `curl` neles funciona hoje.

As tabelas também estão intactas: `embalagens`, `embalagem_compras`,
`embalagem_movimentos`, `embalagem_vinculos`, `ml_item_cache`, `ml_venda_cache`,
`ml_sync_state`. Nenhum dado histórico foi perdido.

## Como retomar (~5 min)

1. Leia o `RESTORATION_GUIDE.md` do projeto — cada um lista os pontos exatos, com código.
2. Devolva o componente: `git mv archived_projects/<projeto>/<Componente>.tsx frontend/src/components/`
3. Religue no `App.tsx`, nesta ordem: **tipo `Pagina`** → **import** → **item de menu** → **bloco `if (pagina === ...)`**.
4. Valide: `cd frontend && npx tsc --noEmit && npm run build`

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
retomar é só frontend. Se um dia quiser remover de vez: derrube as tabelas, apague
os endpoints do `main.py` e limpe esta pasta.

---

Contexto adicional nas memórias do projeto: `estoque-embalagens.md`,
`radar-envio-full.md`, `lista-de-compra.md`.
