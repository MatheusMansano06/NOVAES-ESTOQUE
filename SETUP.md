# 📋 SETUP - NOVAES-ESTOQUE

Instruções passo-a-passo para setup inicial do projeto.

---

## **1️⃣ Clonar Repositório**

```bash
git clone https://github.com/MatheusMansano06/NOVAES-ESTOQUE.git
cd NOVAES-ESTOQUE
```

---

## **2️⃣ Backend Setup**

```bash
cd backend

# Criar virtual environment
python -m venv venv

# Ativar (escolha seu SO)
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Instalar dependências
pip install -r requirements.txt

# Copiar .env
cp .env.example .env
# EDITAR .env com suas chaves Olist

# Rodar (development)
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Backend rodando em:** http://127.0.0.1:8000

---

## **3️⃣ Frontend Setup**

```bash
# Em outro terminal
cd frontend

# Instalar dependências
npm install

# Rodar (development)
npm run dev
```

**Frontend rodando em:** http://localhost:5173

---

## **4️⃣ Acessar a Aplicação**

| Componente | URL |
|-----------|-----|
| **App** | http://localhost:5173 |
| **API** | http://127.0.0.1:8000 |
| **API Docs** | http://127.0.0.1:8000/docs |

---

## **5️⃣ Para Produção**

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para deploy em **Vercel + Railway**.

---

## **6️⃣ Troubleshooting**

### **"Port 8000 already in use"**
```bash
# Kill processo na porta 8000
lsof -ti:8000 | xargs kill -9  # Mac/Linux
netstat -ano | findstr :8000   # Windows (copiar PID)
taskkill /PID <PID> /F         # Windows
```

### **"npm not found"**
```bash
# Instalar Node.js de https://nodejs.org
node --version  # Confirmar
npm --version   # Confirmar
```

### **"Python not found"**
```bash
# Instalar Python de https://python.org
python --version  # ou python3 --version
```

---

**Pronto! 🚀 Agora você pode fazer desenvolvimento local.**

Para deploy, siga [DEPLOYMENT.md](./DEPLOYMENT.md).
