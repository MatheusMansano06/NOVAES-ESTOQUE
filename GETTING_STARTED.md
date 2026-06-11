# Getting Started - Estoque Virtual

## Project Initialization ✅ Complete

This project has been initialized with all required dependencies and configuration files.

### What Was Done

✅ **Backend Setup**
- Updated `requirements.txt` with missing packages (nfelib, pytesseract, pdf2image, Pillow)
- Installed all Python dependencies in virtual environment
- Created `.env` file with Olist/Tiny ERP integration credentials
- Verified SQLite database exists (estoque_virtual.db)

✅ **Frontend Setup**
- Verified npm dependencies installed
- Created `.env.local` with API base URL (http://localhost:8000/api)
- Fixed common security issues in package.json

✅ **Project Configuration**
- Created `.gitignore` to protect sensitive files (.env, .db, venv, node_modules, etc.)
- Created startup scripts for easy local development

---

## Running the Project

### Option 1: Run Both Services (Recommended)

**Terminal 1 - Backend:**
```powershell
# Windows PowerShell
.\run-backend.ps1
```

**Terminal 2 - Frontend:**
```powershell
# Windows PowerShell
.\run-frontend.ps1
```

**Then open in browser:**
- Application: http://localhost:5173
- API Docs: http://localhost:8000/docs

---

### Option 2: Manual Startup

**Backend:**
```powershell
cd backend
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload
```

**Frontend:**
```powershell
cd frontend
npm run dev
```

---

## System Requirements

### Backend
- **Python**: 3.11+ (required for nfelib)
- **Tesseract OCR**: Install from https://github.com/UB-Mannheim/tesseract/wiki (required for PDF OCR)
  - Windows installer: Direct download recommended
  - After install, environment variable may need: `C:\Program Files\Tesseract-OCR`

### Frontend
- **Node.js**: 18+ (recommend 20 LTS)
- **npm**: 9+

---

## Configuration Files

### Backend (.env)
Located: `backend/.env`

Key Variables:
- `DATABASE_URL` - SQLite database path (default: local file)
- `OLIST_CLIENT_ID` / `OLIST_CLIENT_SECRET` - OAuth2 credentials (already configured)
- `OLIST_API_TOKEN_SIMPLE` - Fallback API token (already configured)
- `UPLOAD_DIR` - Where NF-e files are stored

### Frontend (.env.local)
Located: `frontend/.env.local`

Key Variables:
- `VITE_API_BASE` - Backend API URL (default: http://localhost:8000/api)

---

## First-Time Setup Checklist

- [ ] Python 3.11+ installed
- [ ] Node.js 18+ LTS installed
- [ ] All dependencies installed (pip + npm)
- [ ] Backend virtual environment activated
- [ ] Tesseract OCR installed (for PDF uploads)
- [ ] Test backend API: `curl http://localhost:8000/`
- [ ] Test frontend: Open http://localhost:5173 in browser

---

## Quick Test

1. **Check Backend:**
   ```
   curl http://localhost:8000/
   ```
   Should return: `{"message":"Estoque Virtual API - Phase 1"}`

2. **Check API Docs:**
   ```
   http://localhost:8000/docs
   ```
   Should show Swagger UI with all endpoints

3. **Check Frontend:**
   ```
   http://localhost:5173
   ```
   Should show Estoque Virtual application

---

## Troubleshooting

### Backend fails to start
- **Error**: `ModuleNotFoundError: No module named 'nfelib'`
  - Solution: Ensure venv is activated, run `pip install -r requirements.txt`

- **Error**: `pytesseract.TesseractNotFoundError`
  - Solution: Install Tesseract OCR from https://github.com/UB-Mannheim/tesseract/wiki

### Frontend won't compile
- **Error**: `npm ERR! code E404`
  - Solution: Run `npm install` again, delete `package-lock.json` if issues persist

### Port already in use
- **Backend**: Change port in run-backend.ps1 (default: 8000)
- **Frontend**: Change port in `frontend/vite.config.ts` (default: 5173)

### CORS errors in browser console
- Ensure backend is running on port 8000
- Check `VITE_API_BASE` in `frontend/.env.local`

---

## Database

**SQLite Database**: `backend/estoque_virtual.db` (600 KB)

### Schema Overview
- `notas_fiscais` - Invoice headers
- `itens_estoque` - Line items with status (quarentena/confirmado/bloqueado)
- `confirmacoes_estoque` - Verification audit trail
- `fornecedores` - Supplier master data
- `vinculos_olist` - Product-to-listing mapping memory
- `divergencias` - Discrepancy tracking

### Reset Database (Optional)
If you need to start fresh:
```bash
rm backend/estoque_virtual.db
# Database will auto-recreate on backend startup
```

---

## Development Commands

### Backend
```bash
cd backend
.\venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload          # Dev with auto-reload
python -m uvicorn app.main:app --reload --host 0.0.0.0  # Accept remote connections
```

### Frontend
```bash
cd frontend
npm run dev                                        # Dev server
npm run build                                      # Production build
npm run lint                                       # Check code style
npm run preview                                    # Preview production build
```

---

## Next Steps

1. **Try uploading a test NF-e**
   - Use Files menu to upload XML or PDF
   - System will parse and create inventory items

2. **Test checkout workflow**
   - Go to "Notas Fiscais" tab
   - Select a note and verify quantities
   - Register discrepancies if needed

3. **Link to Olist** (if configured)
   - Products can be linked to Olist listings
   - Stock levels auto-sync to marketplace

4. **View API Documentation**
   - Visit http://localhost:8000/docs for Swagger UI
   - Interactive endpoint testing available

---

## Issues & Support

See `CLAUDE.md` for project documentation and architecture details.

Common issues documented in audit memory files:
- `project_overview.md` - System design
- `key_issues.md` - Known bugs and TODOs

---

**Status**: ✅ Project ready for development

Generated: 2026-06-09
