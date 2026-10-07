# Sistema Novaes

Central de operação de e-commerce: notas fiscais e estoque virtual, inbounds do FULL,
anúncios e vendas do Mercado Livre, Shopee, vínculos e estoque na Olist (Tiny) e
Central de Devoluções.

| | |
|---|---|
| **Backend** | Python 3.11 · Starlette · SQLAlchemy · SQLite |
| **Frontend** | React 18 · TypeScript · Vite |
| **Integrações** | Mercado Livre, Olist/Tiny (API v3), Shopee — OAuth2 |
| **Deploy** | Railway, um único serviço (API em `/api`, frontend compilado em `/`) |

---

## Arquitetura

```
backend/
├── app/
│   ├── main.py              # monta o app: rotas de cada área, middlewares, frontend
│   ├── seguranca.py         # login por PIN, sessão assinada (cookie HttpOnly), anti força bruta
│   ├── rotas/               # uma área por arquivo; peças compartilhadas em comum.py
│   │   ├── acesso.py        #   login, sessão, operadores
│   │   ├── notas_fiscais.py #   upload de NF-e, estoque virtual, conferência, divergências
│   │   ├── inbound.py       #   inbounds do FULL: separação, balanço, baixas, histórico
│   │   ├── mercado_livre.py #   anúncios, vendas, promoções, Full
│   │   ├── olist.py         #   produtos, vínculos, estoque, imagem quadrada
│   │   ├── shopee.py        #   integração e negociação de campanhas
│   │   ├── embalagens.py    #   caixas e inserts com baixa automática
│   │   ├── compras.py       #   lista de compra, custos, preços, calculadora TikTok
│   │   └── comum.py
│   ├── integracoes/         # clientes das APIs: mercado_livre.py, olist.py, shopee.py
│   ├── central/             # Central de Devoluções (módulos próprios)
│   ├── utils/               # parsers (NF-e, inbound, Shopee) e regras puras
│   ├── models.py            # tabelas (SQLAlchemy)
│   └── jobs.py              # agendador: syncs, encerramento de inbounds, monitor de estoque
├── tests/                   # pytest
└── database.py              # engine SQLite (WAL) + seed no primeiro boot
frontend/src/
├── App.tsx                  # navegação e páginas
├── components/              # telas (GestaoInbound, AnunciosMercadoLivre, TelaLogin, ...)
├── central/                 # Central de Devoluções
└── services/api.ts          # cliente HTTP e sessão
docs/                        # referências de API e guias
scripts/                     # utilitários locais (backup de segredos, start)
```

As rotas `async` rodam em threads (`comum.Route`): uma chamada lenta ao Mercado Livre
ou à Olist não trava as outras requisições.

## Segurança

- Toda rota `/api/*` exige sessão; só login, health, webhooks, callbacks OAuth e
  `/api/imagem-quadrada` são públicos (`seguranca.py`).
- Operador entra com o PIN inicial e define o PIN pessoal no primeiro acesso
  (guardado com scrypt). O master pode resetar o PIN de um operador.
- Sessão em cookie `HttpOnly` assinado (HMAC-SHA256); identidade nunca vem de header.
- 5 PINs errados por IP em 15 minutos bloqueiam o login.

Variáveis obrigatórias em produção: `SESSION_SECRET`, `MASTER_PIN`, `OPERADOR_PIN`,
além das credenciais das integrações (veja `backend/.env.example`). Nunca versione `.env`.

## Desenvolvimento local

```bash
cd backend
python -m venv venv && venv\Scripts\activate     # Linux/Mac: source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Use `localhost` (não `127.0.0.1`) no `VITE_API_URL` do `frontend/.env.local`: o cookie
de sessão é `SameSite=Lax`. Sem as variáveis de PIN, o ambiente local aceita `1234`.

## Testes

```bash
cd backend
python -m pytest
```

`tests/test_rotas_registradas.py` congela a tabela de rotas da API: se uma refatoração
fizer alguma rota sumir, mudar de método ou de ordem, o teste falha.

## Deploy (Railway)

O `Dockerfile` da raiz compila o frontend e o embute no backend. O banco SQLite fica
em um volume montado em `/data` (`DATABASE_URL=sqlite:////data/estoque_virtual.db`).
Cada push na `main` gera um deploy.

Setup da Olist: [docs/SETUP_OLIST_APP.md](docs/SETUP_OLIST_APP.md).
