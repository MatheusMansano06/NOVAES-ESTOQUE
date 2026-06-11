# 🔐 Transferir Segredos entre PCs (sem GitHub)

Os arquivos sensíveis (`backend/.env` e `backend/olist_token.json`) **não vão para o GitHub**
por segurança. Para rodar o projeto em outro PC, use os scripts abaixo para levá-los
manualmente (pendrive, e-mail privado, etc.).

## 📦 No PC atual (gerar o backup)

1. Dê **duplo clique** em `backup-secrets.bat`
2. Vai ser gerado o arquivo **`estoque-virtual-secrets.zip`** na raiz do projeto
3. Copie esse `.zip` para o pendrive

> O zip contém: `.env` (Client ID/Secret + token API) e `olist_token.json` (token OAuth).

## 📥 No outro PC (restaurar)

1. Clone o projeto do GitHub:
   ```
   git clone https://github.com/MatheusMansano06/estoque-virtual.git
   ```
2. Copie o **`estoque-virtual-secrets.zip`** do pendrive para a **raiz do projeto**
3. Dê **duplo clique** em `restore-secrets.bat`
   - Isso recria `backend/.env` e `backend/olist_token.json`
4. Instale as dependências e rode:
   ```
   cd backend
   pip install -r requirements.txt
   python -m uvicorn app.main:app --reload

   cd ../frontend
   npm install
   npm run dev
   ```

## ⚠️ Importante

- **Nunca** suba o `estoque-virtual-secrets.zip` no GitHub (já está no `.gitignore`).
- Trate esse zip como uma senha: ele dá acesso à sua conta Olist.
- Se o token OAuth expirar/parar de funcionar no outro PC, basta acessar
  `http://localhost:8000/api/olist/conectar` e autorizar de novo.
