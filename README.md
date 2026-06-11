# 🏍️ NOVAES-ESTOQUE

**Sistema de Gestão de Estoque e Inbound para Operações de E-commerce**

Solução profissional para gerenciar notas fiscais, inbounds (separação de produtos), vinculação com marketplaces e sincronização de estoque em tempo real.

---

## **Tecnologias**

- **Backend:** FastAPI (Python 3.11+)
- **Frontend:** React 18 + Vite + TypeScript
- **Database:** PostgreSQL (produção) / SQLite (desenvolvimento)
- **Integração:** Olist API v3, Mercado Livre

---

## **Características**

✅ Upload e parsing automático de Notas Fiscais (XML/PDF)  
✅ Gerenciamento de inbounds (Frete/Separação do Mercado Livre)  
✅ Vinculação automática com anúncios Olist  
✅ Sincronização de estoque em tempo real  
✅ Reserva automática para FULL (inbounds)  
✅ Revisão e confirmação de entradas  
✅ Dashboard operacional com filtros avançados  

---

## **Quick Start (Desenvolvimento)**

### **Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # ou venv\Scripts\activate (Windows)
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### **Frontend**
```bash
cd frontend
npm install
npm run dev
```

Acessa: **http://localhost:5173**

---

## **Deploy em Produção**

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para instruções completo de deploy em **Vercel + Railway**.

---

## **Documentação**

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Guia de deploy Vercel/Railway
- [CLAUDE.md](./CLAUDE.md) - Arquitetura e padrões
- [Backend API](http://localhost:8000/docs) - Swagger automático

---

## **Variáveis de Ambiente**

Copiar `.env.example` → `.env` e preencher suas chaves Olist:

```bash
cp backend/.env.example backend/.env
```

---

## **Estrutura**

```
.
├── backend/              # FastAPI + SQLAlchemy
│   ├── app/
│   │   ├── main.py      # Routes e lógica principal
│   │   ├── models.py    # ORM models
│   │   ├── schemas.py   # Pydantic validators
│   │   └── integracoes_olist.py
│   ├── Dockerfile       # Deploy em containers
│   └── requirements.txt
├── frontend/            # React + Vite
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── services/api.ts
│   ├── vercel.json      # Deploy em Vercel
│   └── package.json
├── DEPLOYMENT.md        # Guia de deployment
└── railway.toml         # Config Railway
```

---

## **Licença**

Proprietary - NOVAES

---

**Desenvolvido com ❤️ por MatheusMansano06**
