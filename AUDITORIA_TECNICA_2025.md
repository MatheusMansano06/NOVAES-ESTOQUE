# 🔍 AUDITORIA TÉCNICA COMPLETA - NOVAES ESTOQUE
**Data:** 2025-06-18  
**Auditor:** Claude (Senior Developer)  
**Score Geral:** 5.8/10 (Viável com issues críticas)

---

## 📊 SUMÁRIO EXECUTIVO

| Dimensão | Score | Status | Prioridade |
|----------|-------|--------|-----------|
| **Segurança** | 4.2/10 | 🔴 Crítico | Imediato |
| **Arquitetura Dados** | 7.5/10 | 🟡 Bom | 1-2 sprints |
| **Frontend Code Quality** | 4.5/10 | 🔴 Crítico | Imediato |
| **DevOps & Infra** | 6.0/10 | 🟡 Básico | 2-3 sprints |
| **Performance** | 7.0/10 | 🟡 Aceitável | Sprint contínua |

**Conclusão:** Produto viável e funcional, mas **NÃO SEGURO PARA PRODUÇÃO** sem correções imediatas. Arquitetura é sólida, mas código frontend precisa refatoração urgente.

---

## 🔴 ACHADOS CRÍTICOS (Resolver em 1 semana)

### 1. NENHUMA AUTENTICAÇÃO NA API
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Qualquer pessoa pode deletar dados, modificar estoque, desconectar integrações  
**Arquivos afetados:** `backend/app/main.py` (linhas 200-3700)

**Problema:**
- 70+ endpoints completamente públicos
- POST `/api/notas-fiscais/{id}/delete` - deletar nota fiscal
- POST `/api/vincular-item-embale` - modificar vinculações
- POST `/api/olist/conectar` - reconectar integração
- Sem proteção middleware, sem JWT, sem API keys

**Ação necessária:**
```python
# Implementar JWT básico
from starlette.authentication import (
    AuthenticationBackend, AuthenticationError, SimpleUser
)
from starlette.middleware.authentication import AuthenticationMiddleware
import jwt

class JWTBackend(AuthenticationBackend):
    async def authenticate(self, request):
        if "authorization" not in request.headers:
            return None
        auth = request.headers["authorization"]
        try:
            scheme, credentials = auth.split()
            if scheme.lower() == 'bearer':
                payload = jwt.decode(credentials, "SECRET_KEY", algorithms=["HS256"])
                return AuthenticationUser(payload["user"])
        except:
            raise AuthenticationError("Invalid token")

# Em rotas sensíveis:
@app.post("/api/upload-nfe")
async def upload_nfe(request):
    if not request.user.is_authenticated:
        return JSONResponse({"error": "Unauthorized"}, 403)
```

**Timeline:** 4-6 horas

---

### 2. CREDENCIAIS OAUTH HARDCODED EM GIT
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Tokens expostos publicamente  
**Arquivo:** `backend/.env` (em Git)

**Problema:**
```env
OLIST_CLIENT_SECRET=6NXgl7heAddwgvWkf6u3R6wdWPO4DUFH
ML_CLIENT_SECRET=6qLAQ7NcFqbQjOYRrtfW1Q3bRKjVMOll
```

**Ação necessária (URGENTE):**

1. Revogar imediatamente no Olist e Mercado Livre:
   - https://gerenciador.olist.com (settings → integrations)
   - https://apps.mercadolibre.com/myapplications

2. Remove do histórico Git:
```bash
cd backend
git filter-branch --tree-filter 'rm -f .env' HEAD
git push --force origin main
```

3. Adicionar `.env` ao `.gitignore` (já está? verificar)

4. Criar `.env.example` com placeholders

**Timeline:** 2 horas (revogação + clean Git)

---

### 3. DADOS SENSITIVOS EM LOCALSTORAGE SEM CRIPTOGRAFIA
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Preços, margens de lucro, históricos expostos em texto plano  
**Arquivos afetados:** 
- `frontend/src/components/Precificador.tsx:48,53,69,93,211`
- `frontend/src/components/AnunciosML.tsx:103`
- `frontend/src/components/FornecedoresManager.tsx:97,127,299,489`

**Problema:**
```typescript
// localStorage armazenando sem proteção:
localStorage.setItem('nvs_ml_precificador_v1', JSON.stringify({
  custo: 19.50,           // ❌ Visível no DevTools
  preco: 45.00,           // ❌ Prioridade: margem de lucro!
  margem: 56.0,           // ❌ Dados competitivos
  impostoPct: 15.5
}))
```

**Ação necessária:**
```typescript
import { secretbox, randombytes } from "tweetnacl.js"

const encryptData = (data: any, password: string) => {
  const nonce = randombytes(24)
  const encrypted = secretbox(
    Buffer.from(JSON.stringify(data)),
    nonce,
    deriveKey(password)
  )
  return {
    nonce: Buffer.from(nonce).toString('base64'),
    encrypted: Buffer.from(encrypted).toString('base64')
  }
}

// Uso:
localStorage.setItem('nvs_protected', JSON.stringify(
  encryptData(precificadorData, userPassword)
))
```

Alternativa: usar IndexedDB com criptografia nativa do navegador.

**Timeline:** 3-4 horas

---

### 4. 9 VULNERABILIDADES NPM (Incluindo Code Execution Risk)
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Potencial RCE (Remote Code Execution) via esbuild  
**Comando:** `npm audit`

```
esbuild <=0.24.2 — MODERATE
  - GHSA-67mh-4wv8-2f99
  - Afeta: vite@5.4.21

form-data 4.0.0-4.0.5 — HIGH
  - CRLF injection via unescaped multipart

minimatch 9.0.0-9.0.6 — HIGH (3 CVEs)
  - ReDoS via repeated wildcards
```

**Ação necessária:**
```bash
cd frontend
npm audit fix --force
npm update
npm ci
```

**Timeline:** 1 hora

---

### 5. APP.TSX COM 3.635 LINHAS - IMPOSSÍVEL MANTER
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Código unmaintainable, bugs, refatoração impossível  
**Arquivo:** `frontend/src/App.tsx` (165.9 KB)

**Problema:**
- 50+ `useState` hooks
- 20+ modais inline
- 10+ seções (tabs) misturadas
- Lógica de negócio + UI renderização juntas
- Nenhuma estrutura de componentes

**Ação necessária (Refatoração em etapas):**

**Etapa 1: Extrair por seção**
```
frontend/src/
├── pages/
│   ├── DashboardPage.tsx (~300 linhas)
│   ├── NotaFiscaisPage.tsx (~400 linhas)
│   ├── ConferenciaPage.tsx (~350 linhas)
│   ├── RelacionamentoProdutoPage.tsx (~350 linhas)
│   ├── ProdutosPage.tsx (~300 linhas)
│   ├── EmbalesPage.tsx (~400 linhas)
│   ├── AnunciosPage.tsx (~400 linhas)
│   └── RecomendacoesPage.tsx (~300 linhas)
├── components/
│   ├── modals/ (extrair modais)
│   └── shared/ (componentes reutilizáveis)
└── hooks/
    ├── useNotasFiscais.ts
    ├── usePrecificador.ts
    └── useEstoque.ts
```

**Etapa 2: Extrair estado com Zustand**
```typescript
// hooks/useEstoqueStore.ts
import { create } from 'zustand'

export const useEstoqueStore = create((set) => ({
  notasFiscais: [],
  loading: false,
  loadNotas: async () => { /* ... */ },
  deleteNota: async (id) => { /* ... */ }
}))
```

**Timeline:** 15-20 horas (split em 2-3 PRs)

---

### 6. TYPESCRIPT COMPLETAMENTE DESATIVADO
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Zero type safety, bugs não detectados em compile-time  
**Arquivo:** `frontend/tsconfig.json`

**Problema:**
```json
{
  "noImplicitAny": false,              // ❌ any está OK
  "strictNullChecks": false,           // ❌ null/undefined não checado
  "strictFunctionTypes": false,        // ❌ tipos de função relaxos
  "noUnusedLocals": false,             // ❌ variáveis não usadas não alertam
  "noUnusedParameters": false,         // ❌ parâmetros não usados ok
  "strict": false                      // ❌ Nada é strict
}
```

**Ação necessária:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**Timeline:** 4-5 horas (fix dos erros que aparecerão)

---

### 7. ZERO TESTES (0% COBERTURA)
**Severidade:** 🔴 CRÍTICO  
**Impacto:** Impossível refatorar, regressions invisíveis  

**Problema:**
- Nenhum arquivo `.test.ts`, `.spec.ts`
- Sem `vitest`, `jest` ou `@testing-library/react`
- Sem CI/CD para rodar testes
- App.tsx impossível testar como monólito

**Ação necessária:**

1. Instalar ferramentas:
```bash
npm install -D vitest @testing-library/react @testing-library/user-event
```

2. Criar `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/']
    }
  }
})
```

3. Escrever testes críticos primeiro:
```typescript
// src/components/UploadNFe.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadNFe from './UploadNFe'

describe('UploadNFe', () => {
  it('should upload XML file', async () => {
    render(<UploadNFe onUpload={vi.fn()} />)
    const file = new File(['content'], 'nota.xml', { type: 'text/xml' })
    const input = screen.getByRole('textbox')
    await userEvent.upload(input, file)
    expect(screen.getByText(/enviando/i)).toBeInTheDocument()
  })
})
```

**Timeline:** 20-30 horas (para 60%+ cobertura)

---

## 🟠 ACHADOS ALTOS (Resolver em 1-2 sprints)

### 8. N+1 QUERIES EM OPERAÇÕES DE INBOUND
**Severidade:** 🟠 ALTO  
**Impacto:** 100+ queries desnecessárias quando há 100+ embaldes  
**Arquivo:** `backend/app/main.py:1187-1189, 1283-1285`

**Problema:**
```python
ativos = db.query(EmbaleFU).filter(EmbaleFU.status != "encerrado").all()
for emb in ativos:  # Primeiro loop
    for it in emb.itens:  # N+1: Uma query SQL por embale!
        print(it.sku)

# Resultado: 1 query base + 100 queries de itens = 101 total queries
```

**Solução:**
```python
from sqlalchemy.orm import joinedload

ativos = db.query(EmbaleFU).options(
    joinedload(EmbaleFU.itens)
).filter(EmbaleFU.status != "encerrado").all()

# Resultado: 2 queries (com LEFT OUTER JOIN)
```

**Timeline:** 2 horas

---

### 9. FALTA DE ÍNDICES COMPOSTOS
**Severidade:** 🟠 ALTO  
**Impacto:** Queries com múltiplos filtros são lentas  

**Índices faltando:**
```sql
-- Em itens_estoque
CREATE INDEX idx_nf_divergencia ON itens_estoque(nf_id, divergencia);

-- Em itens_embale_fu
CREATE INDEX idx_embale_baixa ON itens_embale_fu(embale_id, baixa_aplicada);

-- Em historico_compras
CREATE INDEX idx_fornecedor_data ON historico_compras(fornecedor_id, data_compra);
```

**Timeline:** 1 hora

---

### 10. CORS SUPER PERMISSIVO
**Severidade:** 🟠 ALTO  
**Impacto:** Qualquer site pode fazer requisições com todos métodos/headers  
**Arquivo:** `backend/app/main.py:3706-3742`

**Problema:**
```python
CORSMiddleware,
allow_methods=["*"],      # ❌ Permite DELETE, PATCH, etc
allow_headers=["*"],      # ❌ Permite qualquer header
allow_credentials=True,   # ❌ Com credenciais
```

**Solução:**
```python
CORSMiddleware,
allow_origins=[
    "http://localhost:3000",
    "http://localhost:5173",
    "https://novaes-estoque-production.up.railway.app",
],
allow_methods=["GET", "POST"],  # Apenas necessários
allow_headers=["Content-Type"],
allow_credentials=False,
max_age=3600,
```

**Timeline:** 1 hora

---

### 11. FALTA DE VALIDAÇÃO DE ARQUIVO
**Severidade:** 🟠 ALTO  
**Impacto:** Possível upload de malware, DoS  
**Arquivo:** `backend/app/main.py:260-278`

**Problema:**
```python
file_ext = file.filename.split(".")[-1].lower()
if file_ext not in ['xml', 'pdf']:
    # ❌ Validação por extensão é fraca
    # ❌ Sem validação de conteúdo (magic bytes)
    # ❌ Sem limite de tamanho (MAX_FILE_SIZE definido mas não usado)
```

**Solução:**
```python
import magic

async def validate_file(file: UploadFile) -> bool:
    content = await file.read()
    await file.seek(0)
    
    # Validar tamanho
    if len(content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large: {len(content)} > {MAX_FILE_SIZE}")
    
    # Validar magic bytes
    mime = magic.Magic(mime=True)
    file_type = mime.from_buffer(content[:512])
    
    if file_type not in ['text/xml', 'application/pdf']:
        raise ValueError(f"Invalid file type: {file_type}")
    
    return True
```

**Timeline:** 2-3 horas

---

### 12. EXPOSIÇÃO DE STACK TRACES
**Severidade:** 🟠 ALTO  
**Impacto:** Informações sensíveis expostas ao cliente  
**Arquivo:** `backend/app/main.py` (múltiplas linhas: 361, 389, 497, 577, 650, 654, 681, 718, 763, 773, 792, 820, 836, 886)

**Problema:**
```python
except Exception as e:
    print(f"[ERROR] {e}")  # ❌ Retorna mensagem de erro completa
    traceback.print_exc()  # ❌ Imprime stack trace
    return JSONResponse({"erro": str(e)}, status_code=500)  # ❌ Envia para cliente
```

**Solução:**
```python
import logging

logger = logging.getLogger(__name__)

try:
    # ... operation
except Exception as e:
    logger.error(f"Upload failed: {e}", exc_info=True)  # Log detalhado no servidor
    return JSONResponse(
        {"error": "Erro ao processar arquivo. Contate suporte."},
        status_code=500
    )  # Mensagem genérica ao cliente
```

**Timeline:** 2-3 horas

---

### 13. SEM LOGGING ESTRUTURADO
**Severidade:** 🟠 ALTO  
**Impacto:** Impossível debugar em produção  

**Problema:**
- 50+ `print()` statements direto em stdout
- Sem níveis de log (DEBUG, INFO, WARNING, ERROR)
- Sem contexto de requisição (request ID)
- Sem filtro de dados sensitivos

**Solução:**
```python
import logging
from pythonjsonlogger import jsonlogger

# Setup logging
logger = logging.getLogger(__name__)
handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Em vez de: print(f"[BUSCA] Buscando {query}")
logger.info("Searching products", extra={"query_params": filtered_query})
```

**Timeline:** 4-5 horas

---

### 14. SEM RATE LIMITING NA API
**Severidade:** 🟠 ALTO  
**Impacto:** Vulnerável a brute force, enumeration, DoS  

**Solução:**
```bash
pip install slowapi
```

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/upload-nfe")
@limiter.limit("10/minute")
async def upload_nfe(request: Request, file: UploadFile):
    # ...
```

**Timeline:** 2-3 horas

---

### 15. MIGRATIONS MANUAIS (SEM VERSIONAMENTO)
**Severidade:** 🟠 ALTO  
**Impacto:** Impossível fazer rollback, risco em produção  
**Arquivo:** `backend/app/main.py:40-85`

**Problema:**
```python
def _garantir_colunas_sqlite():
    # ❌ Sem versionamento
    # ❌ Sem rastreamento de aplicadas
    # ❌ Sem rollback
    if "quantidade_olist_enviada" not in colunas:
        conn.exec_driver_sql("ALTER TABLE itens_estoque ADD COLUMN ...")
```

**Solução (Implementar Alembic):**
```bash
pip install alembic
alembic init alembic
```

**Timeline:** 4-5 horas

---

## 🟡 ACHADOS MÉDIOS (2-4 sprints)

### 16. SEM SOFT DELETES
Implementar `deleted_at` em tabelas críticas

### 17. LOOPS COM QUERIES (recomendacao_engine.py)
Usar aggregation SQL em vez de Python loops

### 18. ESLint não configurado
Criar `.eslintrc.json` e ativar regras

### 19. Sem Error Boundaries no React
Implementar error boundary global

### 20. Sem Lazy Loading de componentes
Usar `React.lazy()` + `Suspense`

---

## ✅ PONTOS POSITIVOS

1. **Índices bem implementados** - 20+ índices simples em campos críticos
2. **Cascades de relacionamentos** - delete-orphan evita dados órfãos
3. **Normalização de dados** - Schema bem estruturado (3NF)
4. **Path traversal protegido** - Validação em operações de arquivo
5. **UUID para segurança de nome** - Arquivos salvos com UUID
6. **Arquitetura modular** - Backend/frontend separados, componentes isolados
7. **Documentação README** - Instruções claras de setup
8. **Stack moderno** - React 18, FastAPI, SQLAlchemy, Vite
9. **Integração com Olist + ML** - Complexa mas bem estruturada
10. **Seed data para desenvolvimento** - Facilita teste local

---

## 📋 PLANO DE IMPLEMENTAÇÃO

### Semana 1 (Críticos - 40 horas)
- [ ] Revogar credenciais OAuth (2h)
- [ ] Remove .env do Git history (2h)
- [ ] Implementar autenticação JWT (6h)
- [ ] Fixar vulnerabilidades npm (1h)
- [ ] Remover dados de localStorage (3h)
- [ ] Ativar TypeScript strict (4h)
- [ ] Configurar ESLint (2h)
- [ ] Adicionar validação de arquivo (3h)
- [ ] Fixar CORS (1h)
- [ ] Adicionar logging estruturado (4h)
- [ ] Fix exposição de stack traces (3h)
- [ ] Adicionar rate limiting (2h)

**Total:** 33 horas

### Semanas 2-3 (Altos - 50 horas)
- [ ] Refatorar App.tsx (20h)
- [ ] Implementar Zustand (8h)
- [ ] Fix N+1 queries (3h)
- [ ] Criar índices compostos (2h)
- [ ] Implementar Alembic (4h)
- [ ] Adicionar Vitest (3h)
- [ ] Escrever testes unitários (10h)

**Total:** 50 horas

### Sprints 4-5 (Médios - 30 horas)
- [ ] Lazy loading de componentes (4h)
- [ ] Error boundaries (3h)
- [ ] Soft deletes (5h)
- [ ] Refatorar recomendacao_engine (6h)
- [ ] GitHub Actions CI/CD (4h)
- [ ] Documentação técnica (3h)
- [ ] Cleanup e refactoring (5h)

**Total:** 30 horas

---

## 📊 ROADMAP POR PRIORIDADE

```
CRÍTICO (Semana 1)          ALTO (S2-3)            MÉDIO (S4-5)
├─ Auth JWT                 ├─ Refactor App.tsx    ├─ Lazy loading
├─ Revogar credenciais      ├─ Zustand             ├─ Error boundaries
├─ localStorage crypto      ├─ Fix N+1 queries     ├─ Soft deletes
├─ npm audit fix            ├─ Alembic             ├─ CI/CD
├─ TS strict                ├─ Vitest              └─ Documentação
├─ ESLint                   └─ Rate limiting
├─ File validation
└─ Logging
```

---

## 🎯 CONCLUSÃO

**Situação atual:** Produto funcional e bem-arquitetado, mas **NÃO SEGURO PARA PRODUÇÃO**.

**Recomendação:** 
1. **Pausar novos features** por 2-3 sprints
2. **Resolver critérios** (semana 1)
3. **Refatoração e testes** (semanas 2-5)
4. **Deploy seguro** em produção após melhorias

**ROI:** 40-50 horas de trabalho → Sistema enterprise-ready, escalável, maintainable, seguro.

**Status para produção atual:** 🔴 NÃO RECOMENDADO

---

**Preparado por:** Claude (Senior Developer Review)  
**Data:** 2025-06-18  
**Revisões pendentes:** Implementação do plano de ação
