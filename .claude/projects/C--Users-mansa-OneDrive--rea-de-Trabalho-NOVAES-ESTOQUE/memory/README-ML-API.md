# Documentação Mercado Livre - Returns, Claims & Logistics

## 📚 Documentos Criados

Exploração completa da API do Mercado Livre para gestão de devoluções, reclamações e logística de retorno. Toda a documentação está integrada à memória do projeto para referência rápida.

### 1. **ml-returns-claims-api.md** - Visão Geral Completa
- Fluxos de devolução e reclamação no ML
- Endpoints principais e status válidos
- Exemplos de requisição/resposta
- Webhooks e eventos em tempo real
- Rate limits e quotas
- Endpoints deprecados
- Referências e URLs úteis

**Quando usar:** Primeira leitura para entender conceitos e arquitetura

---

### 2. **ml-endpoints-reference.md** - Referência Rápida
- URL exata de cada endpoint
- Parâmetros de query documentados
- Exemplos curl prontos para copiar/colar
- Respostas JSON exemplificadas
- Tratamento de status codes
- Erros comuns e soluções
- Discoverer: Obter seu User ID

**Quando usar:** Durante desenvolvimento - copiar endpoint exato e adaptar

---

### 3. **ml-returns-implementation.md** - Guia Prático
- Código Python pronto para integração
- Classes manager para returns e claims
- Models SQLAlchemy completos
- Endpoints FastAPI para implementar
- Webhook handler
- Background jobs (APScheduler)
- Componente React para UI
- Checklist de implementação

**Quando usar:** Implementar feature de returns/claims no código

---

### 4. **ml-returns-faq-troubleshooting.md** - Resoluções
- 10+ FAQ respondidas
- Troubleshooting para 10+ problemas comuns
- Otimizações de performance
- Queries SQL para monitoramento
- Roadmap de implementação

**Quando usar:** Quando algo não funciona ou precisa de esclarecimento

---

## 🎯 Quick Start (5 minutos)

1. **Ler**: `ml-returns-claims-api.md` (seções 1-2)
2. **Entender fluxos**: Retorno vs Claim vs Shipment
3. **Implementar**: Copiar código de `ml-returns-implementation.py`
4. **Testar**: Usar URLs de `ml-endpoints-reference.md` com seu token
5. **Deploy**: Adicionar ao `backend/app/integracoes_ml_returns.py`

---

## 📋 Resumo de Endpoints

### Returns (Devoluções)
```
GET    /returns                        # Listar
GET    /returns/{return_id}            # Detalhe
POST   /returns/{return_id}/confirm    # Confirmar recebimento
POST   /returns/{return_id}/refund     # Processar reembolso
```

### Claims (Reclamações)
```
GET    /claims                         # Listar
GET    /claims/{claim_id}              # Detalhe
POST   /claims/{claim_id}/messages     # Responder
POST   /claims/{claim_id}/refund       # Reembolsar
```

### Shipments (Rastreamento)
```
GET    /shipments/{shipment_id}        # Rastreamento
GET    /shipments/{id}/return_label    # Label de retorno
```

**Base URL**: `https://api.mercadolivre.com.br`  
**Auth**: Bearer token (OAuth2 - reuse de `integracoes_ml.py`)

---

## 🔑 Principais Conceitos

### Status de Devolução
- `pending_acceptance` → Aguardando você aceitar/rejeitar
- `accepted` → Você aprovou, comprador enviando
- `awaiting_receipt` → Comprador já mandou, aguardando você receber
- `receipt_confirmed` → Você confirmou o recebimento
- `completed` → Devolução finalizada (reembolso processado)

### Status de Reclamação
- `opened` → Aberta, responda em <7 dias
- `acknowledged` → Você viu
- `under_review` → ML analisando
- `in_mediation` → ML tentando mediar
- `resolved` → Você resolveu
- `closed` → Não pode mais responder

### Motivos de Devolução
- `producto_defectuoso` - Produto com defeito
- `cambio_de_idea` - Arrependimento
- `producto_diferente` - Não confere descrição
- `otra_razon` - Outro

### Motivos de Claim
- `not_received` - Não recebeu
- `item_not_as_described` - Não confere
- `damaged_arrival` - Chegou danificado
- `wrong_item` - Item errado

---

## 🚀 Implementação Recomendada

### Etapa 1: Setup (30 min)
```bash
# Copiar models SQLAlchemy
# Copiar managers (MercadoLivreReturnsManager, MercadoLivreClaimsManager)
# Testar endpoints com curl
```

### Etapa 2: Backend (2h)
```bash
# Adicionar endpoints FastAPI
# Configurar jobs APScheduler (polling 5min)
# Implementar webhook handler
# Testar com dados reais
```

### Etapa 3: Frontend (1h)
```bash
# Criar componente React
# Listar returns/claims
# Alertas para claims expirando
# Botões de confirmação/reembolso
```

### Etapa 4: Monitoramento (30 min)
```bash
# Configurar alertas (claims <24h)
# Dashboard de métricas
# Rastreamento de taxa de devolução
```

---

## ⚠️ Pontos Críticos

1. **Token Refresh**: Token ML é uso único. Sistema tem lock para evitar refresh concorrente (vide `integracoes_ml.py`)

2. **Rate Limits**: 600 req/min em GET, 300 em POST. Implementar retry automático com backoff exponencial

3. **Webhook Timeout**: Responder webhook em <3 segundos. Processar em background task

4. **Prazo de Resposta**: Claims expiram se não responder em ~7 dias. Alertar operador automaticamente

5. **Seller ID**: Confirmar formato (string vs int) de seu seller_id. Chamar `GET /users/me` para descobrir

---

## 🔗 Próximos Passos

- [ ] Ler ml-returns-claims-api.md (30min)
- [ ] Ler ml-endpoints-reference.md (20min)
- [ ] Implementar modelos SQLAlchemy (30min)
- [ ] Implementar managers (1h)
- [ ] Testar endpoints com curl (30min)
- [ ] Adicionar ao backend (1h)
- [ ] Criar frontend (1h)
- [ ] Testar com devolução real (2h)
- [ ] Documentar no CLAUDE.md (30min)
- [ ] Deploy em produção (Railway)

---

## 📞 Suporte

**Problemas?** Consulte `ml-returns-faq-troubleshooting.md`

**API Oficial**: https://developers.mercadolibre.com (login requerido)

**Seu Seller Center**: https://sellercentral.mercadolivre.com.br

---

## 📊 Arquivos Criados

```
.claude/projects/.../memory/
├── README-ML-API.md                          ← Você está aqui
├── ml-returns-claims-api.md                  # Documentação completa (API + webhooks)
├── ml-endpoints-reference.md                 # URLs + parâmetros + exemplos curl
├── ml-returns-implementation.md              # Código Python + React pronto
└── ml-returns-faq-troubleshooting.md         # FAQ + troubleshooting + SQL
```

**Data de Criação**: 2026-07-02  
**Última Atualização**: 2026-07-02  
**Versão API**: Mercado Livre API v2
