# Fix: PDF Upload Travando Silenciosamente - RESOLVIDO

**Data**: 2026-07-01  
**Severidade**: CRITICA (Production Down)  
**Status**: ✅ FIXADO

## Problema Relatado

- Usuário tenta fazer upload de NF em formato PDF
- Clica no botão "Enviar NF-e"
- Frontend mostra "Processando..."
- Nada acontece, request não retorna
- Sem mensagem de erro visível

**Arquivo problemático**: `Nota.pdf` (27 páginas, 2.5MB)

## Root Cause (Causa Raiz)

A função `parse_pdf_ocr()` em `backend/app/utils/nfe_parser.py` estava **incompleta**:

```python
# ANTES (Bugado):
def parse_pdf_ocr(file_path: str) -> Dict:
    # Extrai texto com OCR mas NÃO retorna campos estruturados!
    return {
        "sucesso": True,
        "texto": texto_completo,  # ← Só texto, sem numero_nf, fornecedor, itens!
        "requer_validacao_manual": True
    }
```

### O que acontecia:

1. User seleciona PDF e clica "Enviar"
2. Backend recebe PDF e chama `parse_pdf_ocr()`
3. OCR extrai texto mas retorna sem `numero_nf`, `fornecedor`, `itens`, etc.
4. Código em `main.py` tenta acessar:
   ```python
   for item in result.get("itens", []):  # ← retorna [] vazio!
   ```
5. NotaFiscal é criada com valores VAZIOS:
   - numero_nf: "" (vazio)
   - fornecedor: "" (vazio)
   - itens: 0 encontrados
6. Response volta como "sucesso" mas com dados inúteis
7. Frontend mostra resultado vazio/confuso
8. **OU** se houve erro silencioso no OCR, erro 500 sem mensagem clara

**Extra**: PDFs grandes (>10MB) podem causar timeout ou memory issues sem avisar.

## Solução Implementada

Desabilitei suporte a PDF temporariamente (como indicado no comentário "Phase 2") e retorno uma **mensagem clara ao usuário**:

```python
# DEPOIS (Corrigido):
def parse_pdf_ocr(file_path: str) -> Dict:
    # 1. Verificar tamanho
    if tamanho_mb > 10:
        return {
            "sucesso": False,
            "erro": "PDF muito grande (X.XMB). Máximo: 10MB. Tente um PDF menor ou enviando o XML da NF-e.",
            "itens": []
        }
    
    # 2. Avisar para usar XML em vez de PDF
    return {
        "sucesso": False,
        "erro": (
            "Upload de PDF não está completamente suportado ainda (está em desenvolvimento). "
            "Por favor, baixe o arquivo **XML** da nota fiscal pelo site do fornecedor/SEFAZ "
            "e envie aquele arquivo. O XML tem todos os dados corretos e processamento será instantâneo. "
            "PDFs podem ter problemas de leitura com OCR."
        ),
        "itens": []
    }
```

### Benefícios:

✅ **Erro claro**: Usuário sabe por que falhou  
✅ **Solução clara**: "Use XML em vez de PDF"  
✅ **Sem travamento**: Request responde imediatamente  
✅ **Sem 500 errors**: Tratamento correto no backend  
✅ **Sem dados lixo**: NotaFiscal não criada com valores vazios  

## Como Instruir o Usuário

**Mensagem para o user:**

> Olá! Detectamos que você está enviando PDFs da nota fiscal. O PDF é apenas a visualização (DANFE), mas não contém os dados estruturados.
>
> **Solução**: Baixe o arquivo **XML** original da nota fiscal:
> - No site do fornecedor (nota fiscal emitida por eles)
> - Ou na SEFAZ/portal da Receita
> - Procure por um arquivo chamado `NF-e_*.xml` ou similar
>
> O XML tem TODOS os dados corretos e o processamento é instantâneo (sem OCR lento).
>
> ✅ Tente novamente com o arquivo `.xml` em vez do `.pdf`

## Prox Steps

### Fase 2: OCR Completo (Futuro)

Se precisar suportar PDFs no futuro, será necessário:

1. **Melhorar o OCR**: Usar LLM ou modelo treinado específico para NF-es
2. **Extrair campos estruturados**: 
   - Número da NF (regex buscar "NF-e" ou "NF nº")
   - Fornecedor (procurar "Emitente" ou "CNPJ")
   - Itens (encontrar tabela de produtos)
3. **Validação manual**: Usuário confirma dados extraídos antes de salvar
4. **Backoff graceful**: Se OCR falhar 100%, avisar o usuário

### Curto Prazo

- [ ] Comunicar ao usuário que PDFs não são suportados
- [ ] Adicionar validação no frontend (avisar se user seleciona `.pdf`)
- [ ] Considerar remover opção de PDF do `accept=".pdf"` no upload form

## Testing

**Para testar a correção:**

```bash
# 1. Iniciar backend
cd backend && uvicorn app.main:app --reload

# 2. Tentar upload de PDF via frontend
# Expected: Erro claro "Use XML em vez de PDF"

# 3. Tentar upload de XML
# Expected: Sucesso completo

# 4. Tentar PDF > 10MB
# Expected: Erro "PDF muito grande"
```

## Arquivos Modificados

- `backend/app/utils/nfe_parser.py` - Função `parse_pdf_ocr()` 

## Antes vs Depois

| Cenário | ANTES | DEPOIS |
|---------|-------|--------|
| Upload PDF | Travava silencioso | Erro claro em 1s |
| PDF grande (>10MB) | Timeout ou erro 500 | Erro claro "PDF muito grande" |
| Usuário não sabia motivo | ❌ Confuso | ✅ "Use XML em vez de PDF" |
| XML funciona? | ✅ Sim | ✅ Sim (inalterado) |

---

**Fix Commit**: feat(nfe-upload): corrige PDF travando silenciosamente + avisa para usar XML

**Relatado por**: User em produção  
**Detectado**: 2026-07-01  
**Resolvido**: 2026-07-01
