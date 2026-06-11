# 🚀 DEPLOYMENT - NOVAES-ESTOQUE

Guia completo para fazer deploy do NOVAES-ESTOQUE em produção (Vercel + Railway).

---

## **PASSO 1: Preparar Local**

```bash
git clone https://github.com/MatheusMansano06/NOVAES-ESTOQUE.git
cd NOVAES-ESTOQUE
```

---

## **PASSO 2: Railway (Backend + Database)**

### **2.1 Criar conta Railway**
- Ir em https://railway.app
- Sign up com GitHub (MatheusMansano06)

### **2.2 Criar novo projeto**
- Dashboard → New Project
- Selecionar "GitHub Repo"
- Escolher `NOVAES-ESTOQUE`

### **2.3 Adicionar PostgreSQL**
- "Add Service" → PostgreSQL
- Railway cria `DATABASE_URL` automaticamente
- Copiar a URL (vai precisar)

### **2.4 Configurar Backend**
- Railway detecta `railway.toml`
- Ir em "Variables" e adicionar:
  ```
  OLIST_API_TOKEN_SIMPLE = sua_chave
  OLIST_CLIENT_ID = seu_id
  OLIST_CLIENT_SECRET = seu_secret
  OLIST_REDIRECT_URI = https://seu-projeto.railway.app/api/olist/callback
  DEBUG = False
  ```

### **2.5 Deploy automático**
- Railway faz deploy automaticamente
- Sua API está em: `https://seu-projeto.railway.app`

---

## **PASSO 3: Vercel (Frontend)**

### **3.1 Criar conta Vercel**
- Ir em https://vercel.com
- Sign up com GitHub (MatheusMansano06)

### **3.2 Criar novo projeto**
- Dashboard → Add New → Project
- Importar repositório `NOVAES-ESTOQUE`

### **3.3 Configurar Build**
- Framework: Vite
- Root Directory: `frontend`
- Build Command: `npm run build` (já em vercel.json)
- Output Directory: `dist`

### **3.4 Variáveis de Ambiente**
- Environment Variables:
  ```
  VITE_API_URL = https://seu-projeto.railway.app
  ```

### **3.5 Deploy**
- Clicar "Deploy"
- Seu site está em: `https://seu-projeto.vercel.app`

---

## **PASSO 4: Conectar Frontend ↔ Backend**

1. Ir no frontend em `src/services/api.ts`
2. Confirmar que usa `VITE_API_URL`:
   ```typescript
   const API_URL = process.env.VITE_API_URL || 'http://127.0.0.1:8000'
   ```

3. Fazer push com a URL correta da API:
   ```bash
   git add .
   git commit -m "Update API_URL for production"
   git push
   ```

4. Vercel redeploy automático ✅

---

## **PASSO 5: Comprar Domínio (Opcional)**

**Frontend (Vercel):**
- Dashboard → seu-projeto → Settings → Domains
- Adicionar seu domínio
- Seguir instruções de DNS

**Backend (Railway):**
- Railway → seu-projeto → Settings → Networking
- Custom Domain (plano pago) OU usar `seu-projeto.railway.app`

---

## **TROUBLESHOOTING**

### **"502 Bad Gateway" no Frontend**
- Verificar se `VITE_API_URL` está correto
- Confirmar que Railway está rodando (check logs)
- Fazer redeploy do Vercel

### **"CORS Error"**
- Backend `main.py` tem CORS configurado
- Se quebrar, adicionar domínio do Vercel em:
  ```python
  allow_origins=["https://seu-dominio.vercel.app"]
  ```

### **Database não funciona**
- Ir em Railway → Postgres → Data
- Confirmar que tem conexão
- Tentar rodar migrations:
  ```bash
  alembic upgrade head
  ```

---

## **CUSTOS**

| Serviço | Custo | Limite |
|---------|-------|--------|
| Vercel | **GRÁTIS** | 100GB/mês |
| Railway | **GRÁTIS** (trial) | $5-10 postgresql/mês |
| Domínio | ~$12/ano | - |

---

## **RESUMO DE URLs**

```
Frontend:  https://seu-projeto.vercel.app
Backend:   https://seu-projeto.railway.app
API Docs:  https://seu-projeto.railway.app/docs
Banco:     PostgreSQL (gerado Railway)
```

---

**Qualquer dúvida, checa os logs em Railway e Vercel! 🚀**
