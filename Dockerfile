FROM python:3.11-slim

WORKDIR /app

# Backend está em subdiretório
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Criar diretório de uploads
RUN mkdir -p uploads

EXPOSE 8000

# Rodar FastAPI
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
