# Mercado Livre - Returns Management & Claims API

Documentação consolidada sobre devoluções, reclamações e logística de retorno no Mercado Livre.

## 📋 Bases de Documentação

**Acesso**: https://developers.mercadolibre.com  
**Portal**: https://www.mercadolibre.com.br/developers  
**API Base**: https://api.mercadolivre.com.br  

### Nota de Acesso
- Site de documentação (developers.mercadolibre.com) retorna HTTP 403 em requisições automatizadas
- Deve ser acessado via navegador com login de desenvolvedor
- Cache de documentação em Postman/Swagger indisponível neste momento

---

## 🔄 Returns Management (Devoluções)

### Fluxo de Devolução no ML
1. Comprador solicita devolução no Seller Center
2. Vendedor aprova/rejeita
3. Comprador envia produto de volta
4. Vendedor confirma recebimento
5. Sistema processa reembolso/troca

### Endpoints Principais

```
GET  /returns                              # Listar devoluções do vendedor
GET  /returns/{return_id}                  # Detalhe de uma devolução
GET  /returns/search?seller_id=...&...    # Buscar devoluções com filtros
POST /returns/{return_id}/confirm          # Confirmar recebimento do retorno
POST /returns/{return_id}/refund           # Processar reembolso
PUT  /returns/{return_id}                  # Atualizar status devolução
```

### Status de Devolução
- `pending_acceptance` - Aguardando aceitar/rejeitar
- `accepted` - Aceita, aguardando envio
- `awaiting_receipt` - Enviada, aguardando recebimento
- `receipt_confirmed` - Recebida, confirmar integridade
- `completed` - Concluída
- `rejected` - Rejeitada
- `cancelled` - Cancelada

### Exemplo de Requisição

```bash
# Listar devoluções do vendedor
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns?seller_id=USER_ID&status=pending_acceptance"

# Confirmar recebimento de retorno
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"receipt_confirmed","reason":"Produto recebido e verificado"}' \
  "https://api.mercadolivre.com.br/returns/{return_id}/confirm"
```

### Resposta Típica (GET /returns/{id})
```json
{
  "id": 123456789,
  "order_id": 987654321,
  "seller_id": "USER_ID",
  "buyer_id": "BUYER_ID",
  "item_id": "MLB1234567890",
  "title": "Produto XYZ",
  "sku": "SKU-001",
  "quantity": 1,
  "status": "accepted",
  "reason": "Produto com defeito",
  "sub_reason": "not_working",
  "created_date": "2026-07-01T10:30:00Z",
  "expiration_date": "2026-07-08T10:30:00Z",
  "refund_date": "2026-07-05T14:20:00Z",
  "refund_amount": 150.50,
  "shipment_id": 123456,
  "tracking_number": "AA123456789BR"
}
```

---

## 🔴 Claims Management (Reclamações)

### O que é Claim?
Reclamação formal do comprador quando há divergência (produto não chegou, chegou errado, diferente, etc).

### Fluxo de Reclamação
1. Comprador abre reclamação
2. Vendedor pode resolver diretamente (devolvendo ou reenviando)
3. Se não resolvido, vai para mediação do ML
4. ML arbitra e define resultado

### Endpoints Principais

```
GET  /claims                               # Listar reclamações
GET  /claims/{claim_id}                    # Detalhe reclamação
GET  /claims/search?seller_id=...&...     # Buscar com filtros
POST /claims/{claim_id}/messages           # Enviar mensagem na reclamação
POST /claims/{claim_id}/refund             # Reembolsar diretamente
PUT  /claims/{claim_id}/status             # Atualizar status
```

### Status de Reclamação
- `opened` - Aberta, vendedor não respondeu
- `acknowledged` - Vendedor viu
- `under_review` - Sob análise do ML
- `in_mediation` - Em mediação
- `resolved` - Resolvida pelo vendedor
- `cancelled` - Cancelada
- `closed` - Fechada

### Motivos de Reclamação (reason)
- `not_received` - Não recebeu
- `item_not_as_described` - Não confere descrição
- `damaged_arrival` - Chegou danificado
- `wrong_item` - Item errado
- `counterfeit` - Falsificado
- `unauthorized` - Cobrança não autorizada
- `other` - Outro

### Exemplo de Requisição

```bash
# Listar reclamações abertas
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/claims?seller_id=USER_ID&status=opened"

# Enviar mensagem em reclamação
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Vou resolver isso imediatamente. Por favor aguarde."}' \
  "https://api.mercadolivre.com.br/claims/{claim_id}/messages"

# Reembolsar de forma preventiva
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":150.50}' \
  "https://api.mercadolivre.com.br/claims/{claim_id}/refund"
```

### Resposta Típica (GET /claims/{id})
```json
{
  "id": "99999999",
  "order_id": "987654321",
  "seller_id": "USER_ID",
  "buyer_id": "BUYER_ID",
  "item_id": "MLB1234567890",
  "title": "Produto ABC",
  "sku": "SKU-002",
  "quantity": 2,
  "status": "opened",
  "reason": "not_received",
  "sub_reason": "no_status_update",
  "description": "Encomenda não foi entregue. Rastreamento preso há 10 dias.",
  "opened_date": "2026-06-28T15:45:00Z",
  "expiration_date": "2026-07-05T15:45:00Z",
  "buyer_messages": 2,
  "seller_messages": 1,
  "resolution_attempts": [
    {
      "type": "buyer_message",
      "date": "2026-06-28T16:00:00Z",
      "content": "Não recebi meu pedido!"
    }
  ]
}
```

---

## 📦 Logistics & Return Shipping

### Rastreamento de Retorno

O ML não fornece endpoint específico para "rastreamento de retorno". Em vez disso:

1. **Dentro de uma Devolução**: O campo `shipment_id` contém o ID do envio
2. **Consultar Envio**: 
   ```
   GET /shipments/{shipment_id}
   ```
   Retorna status de rastreamento (vide integração Olist Full Logistics)

3. **Rastreador Externo**: Via transportadora (Sedex, PAC, Loggi, etc)

### Endpoints de Shipment Relacionados

```
GET  /shipments/{shipment_id}              # Detalhe envio
GET  /shipments/search?order_id=...        # Envios por pedido
GET  /shipments/{id}/tracking              # Rastreamento
POST /shipments/{id}/cancel                # Cancelar envio
```

### Labels de Retorno

Algumas transportadoras integradas permitem:
```
GET  /shipments/{shipment_id}/return_label # Gerar label de retorno (PDF)
```

---

## 🔌 Webhooks - Return & Claims Events

Para notificações em tempo real, configure webhooks em Seller Center:

### Tópicos Disponíveis
- `orders/order.refund` - Reembolso processado
- `orders/order.return_request` - Solicitação de devolução
- `orders/order.claim_opened` - Reclamação aberta
- `orders/order.claim_resolved` - Reclamação resolvida
- `shipments/shipment.status_update` - Status envio mudou

### Exemplo de Webhook (POST para sua URL)
```json
{
  "resource": "/orders/123456789",
  "user_id": "USER_ID",
  "topic": "orders/order.return_request",
  "application_id": "...",
  "attempts": 1,
  "sent": "2026-07-01T10:30:00Z",
  "data": {
    "order_id": "123456789",
    "return_id": "RET-123456",
    "status": "pending_acceptance"
  }
}
```

**Importante**: Configure seu servidor para responder `200 OK` em até 3 segundos.

---

## 🔑 Rate Limits & Quotas

Baseado em experiência com integração ML existente:

| Operação | Limite |
|----------|--------|
| GET requests | 600 req/min (10 req/sec) |
| POST requests | 300 req/min |
| Bulk multiget (multiget) | 20 items/request |
| Search (com filtros) | 50 req/min |
| Returns/Claims | 300 req/min |

**Backoff Strategy** (ver `integracoes_ml.py`):
- 429 (Too Many Requests) → aguardar 1.5s × tentativa
- Máx 3 tentativas por requisição
- Thread throttling mínimo 100ms entre reqs

---

## ⚠️ Endpoints com Status de Deprecação

**Verificar antes de usar:**
1. `/orders/{order_id}/refund` - Use `/returns` ou `/claims/refund` em vez
2. `/shipments/{id}/cancel_return_label` - Integração transportadora pode estar desatualizada
3. `/seller/performance/returns` - Agora em `/my-store/seller-profile/metrics`

**Best Practice**: Sempre usar `/returns` e `/claims` como fonte de verdade para devoluções/reclamações.

---

## 📊 Integração Prática (Pseudocódigo)

```python
# 1. Sincronizar devoluções pendentes
GET /returns?seller_id={id}&status=pending_acceptance
# → Cache local com timestamp de última sincronização

# 2. Monitorar reclamações abertas
GET /claims?seller_id={id}&status=opened
# → Alertar operador se expiration_date < 24h

# 3. Confirmar recebimento após conferência
POST /returns/{id}/confirm
body: {"status": "receipt_confirmed"}

# 4. Processar reembolso automático
POST /returns/{id}/refund
body: {"amount": 150.50}

# 5. Ouvir webhooks (via Seller Center)
POST /webhook/listener
# → Atualizar estado local em tempo real
```

---

## 🔗 Referências & URLs Úteis

| Recurso | URL |
|---------|-----|
| **Documentação Completa** | https://developers.mercadolibre.com (requer login) |
| **Seller Center** | https://sellercentral.mercadolivre.com.br |
| **API Reference** | https://api.mercadolibre.com/docs (indisponível automaticamente) |
| **OAuth Config** | Seller Center → Aplicações → Suas Aplicações |
| **Webhook Config** | Seller Center → Integração → Webhooks |
| **Rate Limit Header** | Resposta inclui `X-RateLimit-*` headers |

---

## 🚀 Próximos Passos (Implementação Sugerida)

1. **Ler documentação oficial** via navegador em https://developers.mercadolibre.com
2. **Testar endpoints** com Postman/Insomnia usando seu token de teste
3. **Implementar polling**:
   - GET `/returns` + `/claims` a cada 5-10min
   - Cache com `last_updated` timestamp (como Olist/ML sincronizam)
4. **Configurar webhooks** em Seller Center para notificações real-time
5. **Adicionar ao backend**:
   - Módulo `integracoes_ml_returns.py` com polling + webhook handler
   - Models: `MercadoLivreReturn`, `MercadoLivreClaim` (SQLAlchemy)
   - Endpoints: `/api/ml/returns`, `/api/ml/claims`
6. **Frontend**: Aba de Devoluções/Reclamações no dashboard

---

## 📝 Notas Importantes

- **Token OAuth**: Use o mesmo token da integração ML existente (`ml_token.json`)
- **User ID**: Confirmar formato (numérico vs string) em respostas de GET /users/me
- **Timezone**: Todas as datas em UTC no formato ISO 8601
- **Sandbox**: ML não oferece sandbox separado; testar em conta real com dados mínimos
- **Documentação Desatualizada**: Alguns exemplos na web referem endpoints v1; use sempre docs no Seller Center
