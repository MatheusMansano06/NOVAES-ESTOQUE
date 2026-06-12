# ============================================================
# NOVAES-ESTOQUE — imagem única (frontend + backend) p/ Railway
# Stage 1: compila o frontend React/Vite
# Stage 2: backend FastAPI/Starlette servindo a API + o frontend
# ============================================================

# ---------- Stage 1: build do frontend ----------
FROM node:20-alpine AS frontend
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Base vazia => o frontend chama a API no MESMO domínio (/api/...). Sem CORS.
ENV VITE_API_URL=""
RUN npm run build

# ---------- Stage 2: backend + estáticos ----------
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Frontend compilado vai para /app/static (o main.py monta isso na raiz "/")
COPY --from=frontend /app/frontend/dist ./static

# Banco SQLite em volume persistente (monte um volume do Railway em /data).
# No primeiro boot o seed.db é copiado para cá automaticamente (database.py).
ENV DATABASE_URL=sqlite:////data/estoque_virtual.db
RUN mkdir -p /data uploads

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
