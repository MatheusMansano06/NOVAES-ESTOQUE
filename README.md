# 🏍️ NOVAES-ESTOQUE

Sistema de gestão de estoque, notas fiscais e inbounds (FULL) com integração Olist/Tiny.

- **Backend:** Starlette (FastAPI-style) + SQLAlchemy — Python 3.11
- **Frontend:** React 18 + Vite + TypeScript
- **Banco:** SQLite (arquivo único, persistido em volume no Railway)
- **Integração:** Olist/Tiny ERP (OAuth2 API v3)

A aplicação roda como **um único serviço**: o backend serve a API em `/api/...`
e o frontend já compilado na raiz `/`. Mesma origem → sem CORS, uma URL só.

---

## Desenvolvimento local

**Backend** (porta 8000):
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows  (Linux/Mac: source venv/bin/activate)
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

**Frontend** (porta 5173, com hot-reload):
```bash
cd frontend
npm install
npm run dev
```
O frontend lê `VITE_API_URL` de `frontend/.env.local` (já aponta para
`http://127.0.0.1:8000`). Acesse **http://localhost:5173**.

---

## Deploy no Railway (tudo em 1 serviço)

O `Dockerfile` da raiz compila o frontend e o embute no backend. Passos:

1. **New Project → Deploy from GitHub repo** → selecione `NOVAES-ESTOQUE`.
   O Railway detecta o `Dockerfile` da raiz automaticamente.
2. **Volume (persistência do banco):** em *Settings → Volumes*, adicione um
   volume montado em **`/data`**. No 1º boot o `backend/seed.db` (seus dados
   reais) é copiado para lá automaticamente; depois disso os dados ficam no
   volume e sobrevivem a redeploys.
3. **Variáveis de ambiente** (*Variables*) — para ativar a integração Olist:
   ```
   OLIST_CLIENT_ID=...
   OLIST_CLIENT_SECRET=...
   OLIST_REDIRECT_URI=https://SEU-APP.up.railway.app/api/olist/callback
   ```
   `DATABASE_URL` já vem definida na imagem (`sqlite:////data/estoque_virtual.db`).
4. **Deploy.** A app sobe em `https://SEU-APP.up.railway.app` — frontend e API
   no mesmo domínio.

> **Atualizar os dados de produção depois:** substitua `backend/seed.db` por um
> novo snapshot, faça commit e limpe o volume `/data` (o seed é recopiado).

---

## Dados incluídos (`backend/seed.db`)

6 notas fiscais · 338 itens de estoque · 84 confirmações · 29 vínculos Olist ·
1 inbound (#69525707) com 131 itens.

---

## Estrutura

```
.
├── Dockerfile            # build único: frontend (Vite) + backend (uvicorn)
├── railway.toml          # config de deploy do Railway
├── backend/
│   ├── app/
│   │   ├── main.py            # rotas /api + mount do frontend em /
│   │   ├── models.py          # ORM
│   │   ├── schemas.py
│   │   ├── integracoes_olist.py
│   │   ├── jobs.py            # scheduler (inbounds, notificações)
│   │   └── utils/
│   ├── database.py           # engine + seed automático do SQLite
│   ├── requirements.txt
│   └── seed.db               # dados reais (vão para o volume no 1º boot)
└── frontend/
    ├── src/ (App.tsx, components/, services/api.ts)
    └── package.json
```

Configuração de chaves: copie `backend/.env.example` → `backend/.env`.
Setup detalhado da Olist em [SETUP_OLIST_APP.md](./SETUP_OLIST_APP.md).
