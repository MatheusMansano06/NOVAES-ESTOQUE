# Índice - Documentação Mercado Livre API (Returns & Claims)

**Total de documentação**: 2.358 linhas | **5 arquivos** | **~15 minutos de leitura**

---

## 📖 Guia de Navegação Rápida

### Se você é novo no tópico
1. Leia **README-ML-API.md** (5 min) - Visão geral
2. Leia **ml-returns-claims-api.md** seção "Fluxo de Devolução" (5 min)
3. Consulte **ml-endpoints-reference.md** para URLs exatas

### Se você está implementando
1. Use **ml-returns-implementation.md** para copiar código
2. Teste com URLs de **ml-endpoints-reference.md**
3. Consulte **ml-returns-faq-troubleshooting.md** se falhar

### Se algo não funciona
1. Procure o problema em **ml-returns-faq-troubleshooting.md**
2. Se não encontrar, consulte seção "Erros Comuns" em **ml-endpoints-reference.md**
3. Último recurso: Acessar https://developers.mercadolibre.com com login

---

## 📚 Arquivos Detalhados

### 1. README-ML-API.md (214 linhas)
**Propósito**: Índice e quick start

**Contém**:
- Sumário de 4 documentos principais
- Resumo de endpoints (8 endpoints)
- Principais conceitos (status, motivos)
- Roadmap de implementação (4 etapas)
- 5 pontos críticos
- Próximos passos (checklist)

**Ler quando**: Primeira vez acessando esta documentação
**Tempo**: 5 minutos

---

### 2. ml-returns-claims-api.md (336 linhas)
**Propósito**: Documentação completa da API

**Contém**:
- **Returns Management**: Fluxo, endpoints, status, exemplos
- **Claims Management**: O que é claim, fluxo, endpoints, status, exemplos
- **Logistics & Return Shipping**: Rastreamento, labels, endpoints
- **Webhooks**: Tópicos, exemplos, configuração
- **Rate Limits**: Quotas por operação, estratégia de retry
- **Endpoints Deprecados**: O que não usar
- **Referências e URLs**: Links úteis

**Ler quando**: Quer entender a API em profundidade
**Tempo**: 20 minutos
**Seções Críticas**: 
- Status de Devolução
- Status de Reclamação
- Webhooks

---

### 3. ml-endpoints-reference.md (558 linhas)
**Propósito**: Referência técnica rápida

**Contém**:
- **Returns Endpoints**: 5 endpoints com exemplos curl
- **Claims Endpoints**: 4 endpoints com exemplos curl
- **Shipment Endpoints**: 2 endpoints
- **Status Codes**: Tabela de HTTP codes
- **Rate Limiting**: Headers, estratégia
- **Erros Comuns**: 5 erros principais com soluções
- **Checklist**: 10 itens para integração

**Ler quando**: Precisa de URL exata e exemplo para testar
**Tempo**: 15 minutos por endpoint que testar
**Copie daqui**: URLs, parâmetros, exemplos curl

---

### 4. ml-returns-implementation.md (764 linhas)
**Propósito**: Código pronto para copiar/colar

**Contém**:
- **Sincronização de Devoluções**: Classe manager completa (Python)
- **Models SQLAlchemy**: 2 models (MercadoLivreReturn, MercadoLivreClaim)
- **Sincronização de Reclamações**: Classe manager completa
- **Endpoints FastAPI**: 6 endpoints prontos
- **Webhook Handler**: Implementação FastAPI
- **Background Jobs**: APScheduler setup
- **Frontend React**: Componente TypeScript completo
- **Checklist**: 10 itens de implementação

**Ler quando**: Vai escrever código
**Tempo**: 30 minutos para entender, 2h para implementar
**Copie daqui**: Código Python, models, endpoints, componentes React

---

### 5. ml-returns-faq-troubleshooting.md (486 linhas)
**Propósito**: Resoluções e perguntas frequentes

**Contém**:
- **FAQ**: 10 perguntas respondidas
  - Diferença Return vs Claim
  - Como resolver devoluções rapidamente
  - Rejeitar devolução (riscos)
  - Claims expirando (ação de urgência)
  - Reduzir devoluções (estratégia)
  - Webhooks (implementação)
  - Prazo de prescrição
  - Integração com estoque
  
- **Troubleshooting**: 10 problemas comuns
  - 401 Unauthorized
  - 404 Not Found
  - 429 Rate Limited
  - Webhook não chega
  - Devoluções e Claims não sincronizam
  - Refund não chega ao cliente
  - Imagem não carrega
  - Claim já resolvida
  
- **Performance**: 3 otimizações
- **Monitores**: 4 queries SQL
- **Roadmap**: Fase 1, 2, 3

**Ler quando**: Algo deu errado ou tem dúvida
**Tempo**: 5-15 minutos por problema
**Consulte**: SQL para monitorar, checklist de otimizações

---

## 🎯 Matriz de Decisão

| Situação | Arquivo | Seção |
|----------|---------|-------|
| "Qual é a diferença entre Return e Claim?" | ml-returns-claims-api.md | Introdução |
| "Preciso da URL exata de um endpoint" | ml-endpoints-reference.md | Endpoints |
| "Vou escrever o código agora" | ml-returns-implementation.md | Todos |
| "Recebi erro 401" | ml-returns-faq-troubleshooting.md | Troubleshooting |
| "Qual o prazo para responder?" | ml-returns-faq-troubleshooting.md | FAQ |
| "Como configurar webhooks?" | ml-returns-claims-api.md | Webhooks |
| "Rate limit excedido, o que fazer?" | ml-endpoints-reference.md | Rate Limiting |
| "Status código 429?" | ml-endpoints-reference.md | Status Codes |
| "Síntaxe do endpoint para testar" | ml-endpoints-reference.md | Exemplos curl |
| "Preciso otimizar performance" | ml-returns-faq-troubleshooting.md | Performance |

---

## 🔗 Mapa de Referências Cruzadas

```
README-ML-API.md
├─→ ml-returns-claims-api.md (visão completa)
├─→ ml-endpoints-reference.md (URLs exatas)
├─→ ml-returns-implementation.md (código)
└─→ ml-returns-faq-troubleshooting.md (problemas)

ml-returns-claims-api.md
├─→ ml-endpoints-reference.md (para URLs)
└─→ ml-returns-faq-troubleshooting.md (para FAQ)

ml-endpoints-reference.md
└─→ ml-returns-implementation.md (para implementar)

ml-returns-implementation.md
├─→ ml-endpoints-reference.md (URL correcta)
└─→ ml-returns-faq-troubleshooting.md (troubleshoot)

ml-returns-faq-troubleshooting.md
└─→ ml-endpoints-reference.md (para verificar status codes)
```

---

## 📊 Estatísticas

| Documento | Linhas | Seções | Exemplos | Código |
|-----------|--------|--------|----------|--------|
| README-ML-API.md | 214 | 7 | 2 | Bash |
| ml-returns-claims-api.md | 336 | 9 | 8 | JSON, Bash |
| ml-endpoints-reference.md | 558 | 10 | 15+ | curl, JSON |
| ml-returns-implementation.md | 764 | 6 | 10+ | Python, TypeScript, JSON |
| ml-returns-faq-troubleshooting.md | 486 | 8 | 20+ | Python, SQL, JSON |
| **TOTAL** | **2.358** | **40** | **50+** | **Multi-lang** |

---

## 🚀 Quick Commands

### Teste um endpoint agora
```bash
# Copiar URL de ml-endpoints-reference.md
# Trocar TOKEN pelo seu token ML
# Executar:
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns?seller_id=SEU_ID&limit=10"
```

### Implemente o backend
```bash
# 1. Copiar models de ml-returns-implementation.md
# 2. Copiar manager de ml-returns-implementation.md
# 3. Copiar endpoints de ml-returns-implementation.md
# 4. Adaptar para seu projeto
# 5. Testar
```

### Resolva um erro
```bash
# 1. Procurar erro em ml-returns-faq-troubleshooting.md
# 2. Se não encontrar, procurar em ml-endpoints-reference.md
# 3. Se ainda não encontrar, consultar:
#    https://developers.mercadolibre.com (requer login)
```

---

## 📅 Histórico

| Data | Versão | Documentos | Linhas |
|------|--------|-----------|--------|
| 2026-07-02 | 1.0 | 5 | 2.358 |

**Criado por**: Claude AI  
**Para**: Projeto NOVAES-ESTOQUE  
**Escopo**: Integração Returns & Claims API Mercado Livre  
**Status**: Completo e pronto para uso

---

## ✅ Checklist de Uso

- [ ] Li README-ML-API.md
- [ ] Entendo diferença entre Return e Claim
- [ ] Testei um endpoint com curl
- [ ] Copiei código de ml-returns-implementation.md
- [ ] Implementei os models SQLAlchemy
- [ ] Implementei o backend (endpoints + jobs)
- [ ] Testei com dados reais
- [ ] Configurei webhooks no Seller Center
- [ ] Implementei frontend React
- [ ] Documentei no CLAUDE.md do projeto

---

## 💬 Feedback

Se você encontrou:
- ✅ Erro na documentação → Corrigir neste índice
- ✅ URL incorreta → Verificar em https://developers.mercadolibre.com
- ✅ Código que não funciona → Consultar ml-returns-faq-troubleshooting.md
- ✅ Pergunta não respondida → Adicionar a FAQ

---

**Início aqui** → Abra [README-ML-API.md](README-ML-API.md)
