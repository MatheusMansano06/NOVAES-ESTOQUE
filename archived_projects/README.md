# 📦 Projetos Arquivados

Este diretório contém funcionalidades pausadas do NOVAES-ESTOQUE que estão prontas para serem retomadas quando necessário.

## Funcionalidades Arquivadas

### 1. **Estoque de Embalagens** 
**Status:** Pausado em 15/07/2026  
**Última alteração:** Commit anterior  
**Descrição:** Sistema de controle de caixas e inserts com baixa automática por venda.

**Arquivos:**
- `estoque_embalagens/EstoqueEmbalagens.tsx` - Componente Frontend
- `estoque_embalagens/embalagens.py` - Utilitário Backend
- `estoque_embalagens/RESTORATION_GUIDE.md` - Guia completo de retomada

**Modelos SQLAlchemy associados:**
- `Embalagem`
- `EmbalagemCompra`
- `EmbalagemMovimento`
- `EmbalagemVinculo`

---

### 2. **Radar de Envio FULL**
**Status:** Pausado em 15/07/2026  
**Última alteração:** Commit anterior  
**Descrição:** Previsão de ruptura de estoque e sugestão do melhor momento para enviar ao FULL.

**Arquivos:**
- `radar_full/RadarFull.tsx` - Componente Frontend
- `radar_full/radar_full.py` - Utilitário Backend
- `radar_full/RESTORATION_GUIDE.md` - Guia completo de retomada

**Dependências:**
- Usa dados do `ml_venda_cache` (snapshot de vendas)
- Usa dados de `embaldes_fu` (inbounds FULL)

---

## Como Retomar uma Funcionalidade

### Passo 1: Ler o Guia de Retomada
Cada projeto arquivado tem um arquivo `RESTORATION_GUIDE.md` com instruções específicas.

### Passo 2: Copiar os Arquivos
```bash
# Exemplo: retomar Estoque de Embalagens
cp archived_projects/estoque_embalagens/EstoqueEmbalagens.tsx frontend/src/components/
cp archived_projects/estoque_embalagens/embalagens.py backend/app/utils/
```

### Passo 3: Restaurar Imports e Menu
- Adicionar import no `frontend/src/App.tsx`
- Adicionar tipo `Pagina` se necessário
- Adicionar item no menu `ShellNavGroup`
- Adicionar renderização condicional `if (pagina === ...)`

### Passo 4: Verificar Banco de Dados
Confirmar que as tabelas SQL associadas existem. Se não existirem, executar migrations pendentes.

### Passo 5: Testar Integração
- Verificar imports no editor
- Testar navegação até a página
- Validar dados e API endpoints

---

## Estrutura de Cada Projeto

Cada pasta de projeto arquivado contém:

```
projeto_nome/
├── [arquivos do frontend/backend]
├── RESTORATION_GUIDE.md    # Instruções detalhadas
└── MANIFEST.json           # Metadados do arquivo
```

---

## Sobre os Arquivos Removidos

Os seguintes itens foram **removidos** do projeto ativo mas estão preservados aqui:

### App.tsx
- ❌ `import { EstoqueEmbalagens } from './components/EstoqueEmbalagens'`
- ❌ `import { RadarFull } from './components/RadarFull'`
- ❌ Páginas: `'estoque-embalagens'` e `'radar-full'` do tipo `Pagina`
- ❌ Items do menu nas `ShellNavGroup`
- ❌ Blocos `if (pagina === 'estoque-embalagens')` e `if (pagina === 'radar-full')`

### main.py (Backend)
- ❌ Endpoints relacionados a embalagens (GET/POST `/api/embalagens/*`)
- ❌ Endpoints relacionados a radar (GET `/api/ml/radar-full`)

---

## Segurança e Integridade

✅ Todos os códigos estão **versionados em git**  
✅ Banco de dados: colunas e tabelas **não foram deletadas**, apenas o código removido  
✅ Você pode restaurar tudo via git se preferir antes de usar os guias  

---

## Dúvidas?

Se tiver problemas ao retomar uma funcionalidade:
1. Consulte o `RESTORATION_GUIDE.md` específico
2. Verifique o histórico git: `git log --all -- archived_projects/`
3. Procure por comentários no código original

