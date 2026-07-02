# Mercado Livre - Referência Rápida de Endpoints

Guia rápido com URLs, parâmetros e exemplos de requisições.

---

## Returns Management API

### 1. Listar Devoluções do Vendedor

```
GET /returns?seller_id={seller_id}&status={status}&limit={limit}&offset={offset}
```

**Parâmetros de Query:**
| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `seller_id` | string | ✓ | ID do vendedor |
| `status` | string | - | pending_acceptance, accepted, awaiting_receipt, receipt_confirmed, completed, rejected, cancelled |
| `limit` | int | - | 1-100 (default: 50) |
| `offset` | int | - | Para paginação |
| `created_from` | ISO datetime | - | Filtrar por data de criação (ex: 2026-07-01T00:00:00Z) |
| `created_to` | ISO datetime | - | Até data |

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns?seller_id=123456&status=pending_acceptance&limit=50"
```

**Resposta Sucesso (200):**
```json
{
  "paging": {
    "total": 15,
    "limit": 50,
    "offset": 0
  },
  "results": [
    {
      "id": 123456789,
      "order_id": 987654321,
      "seller_id": 123456,
      "buyer_id": 654321,
      "item_id": "MLB1234567890",
      "title": "Produto XYZ",
      "sku": "SKU-001",
      "quantity": 1,
      "status": "pending_acceptance",
      "reason": "producto_defectuoso",
      "sub_reason": "no_funciona",
      "description": "Produto com defeito no botão",
      "created_date": "2026-07-01T10:30:00Z",
      "expiration_date": "2026-07-08T10:30:00Z",
      "refund_date": null,
      "refund_amount": 150.50,
      "shipment_id": 123456,
      "tracking_number": "AA123456789BR",
      "images": ["https://..."]
    }
  ]
}
```

---

### 2. Obter Detalhe de Uma Devolução

```
GET /returns/{return_id}
```

**Parâmetros de Path:**
| Param | Tipo | Descrição |
|-------|------|-----------|
| `return_id` | string | ID da devolução |

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns/123456789"
```

**Resposta Sucesso (200):**
```json
{
  "id": 123456789,
  "order_id": 987654321,
  "seller_id": 123456,
  "buyer_id": 654321,
  "item_id": "MLB1234567890",
  "title": "Produto XYZ",
  "sku": "SKU-001",
  "quantity": 1,
  "status": "accepted",
  "reason": "producto_defectuoso",
  "sub_reason": "no_funciona",
  "created_date": "2026-07-01T10:30:00Z",
  "expiration_date": "2026-07-08T10:30:00Z",
  "refund_date": "2026-07-05T14:20:00Z",
  "refund_amount": 150.50,
  "shipment_id": 123456,
  "tracking_number": "AA123456789BR",
  "images": ["https://..."],
  "comments": [
    {
      "user_id": 654321,
      "user_type": "buyer",
      "date": "2026-07-01T10:35:00Z",
      "message": "Enviando para vocês"
    }
  ]
}
```

---

### 3. Confirmar Recebimento de Retorno

```
POST /returns/{return_id}/confirm
Content-Type: application/json
```

**Body:**
```json
{
  "status": "receipt_confirmed",
  "reason": "Produto recebido e em perfeito estado"
}
```

**Exemplo:**
```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "receipt_confirmed",
    "reason": "Confirmando recebimento"
  }' \
  "https://api.mercadolivre.com.br/returns/123456789/confirm"
```

**Resposta Sucesso (200):**
```json
{
  "id": 123456789,
  "status": "receipt_confirmed",
  "updated_date": "2026-07-03T15:45:00Z"
}
```

---

### 4. Processar Reembolso

```
POST /returns/{return_id}/refund
Content-Type: application/json
```

**Body:**
```json
{
  "amount": 150.50,
  "reason": "Reembolso total aprovado"
}
```

**Exemplo:**
```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 150.50,
    "reason": "Reembolso total aprovado"
  }' \
  "https://api.mercadolivre.com.br/returns/123456789/refund"
```

**Resposta Sucesso (200):**
```json
{
  "id": 123456789,
  "status": "completed",
  "refund_amount": 150.50,
  "refund_date": "2026-07-03T16:00:00Z",
  "refund_id": "REF-999999"
}
```

---

### 5. Buscar Devoluções (Avançado)

```
GET /returns/search?seller_id={id}&{filtros}
```

**Parâmetros de Query Avançados:**
| Param | Tipo | Descrição |
|-------|------|-----------|
| `reason` | string | producto_defectuoso, cambio_de_idea, otra_razon, etc |
| `sub_reason` | string | no_funciona, falta_componente, diferente_anuncio, etc |
| `order_id` | string | Filtrar por pedido específico |

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns/search?seller_id=123456&reason=producto_defectuoso&created_from=2026-07-01T00:00:00Z"
```

---

## Claims Management API

### 1. Listar Reclamações

```
GET /claims?seller_id={seller_id}&status={status}&limit={limit}&offset={offset}
```

**Status Válidos:**
- `opened` - Aberta, esperando resposta do vendedor
- `acknowledged` - Vendedor viu
- `under_review` - ML está revisando
- `in_mediation` - Em mediação
- `resolved` - Resolvida pelo vendedor
- `cancelled` - Cancelada
- `closed` - Fechada

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/claims?seller_id=123456&status=opened&limit=50"
```

**Resposta (200):**
```json
{
  "paging": {
    "total": 8,
    "limit": 50,
    "offset": 0
  },
  "results": [
    {
      "id": "99999999",
      "order_id": 987654321,
      "seller_id": 123456,
      "buyer_id": 654321,
      "item_id": "MLB1234567890",
      "title": "Produto ABC",
      "sku": "SKU-002",
      "quantity": 2,
      "status": "opened",
      "reason": "not_received",
      "sub_reason": "no_status_update",
      "description": "Encomenda não foi entregue",
      "opened_date": "2026-06-28T15:45:00Z",
      "expiration_date": "2026-07-05T15:45:00Z",
      "buyer_messages_count": 2,
      "seller_messages_count": 0,
      "messages": []
    }
  ]
}
```

---

### 2. Obter Detalhe de Reclamação

```
GET /claims/{claim_id}
```

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/claims/99999999"
```

**Resposta Completa (200):**
```json
{
  "id": "99999999",
  "order_id": 987654321,
  "seller_id": 123456,
  "buyer_id": 654321,
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
  "last_update": "2026-06-29T10:00:00Z",
  "buyer_messages_count": 2,
  "seller_messages_count": 1,
  "messages": [
    {
      "id": "MSG-001",
      "author": "buyer",
      "date": "2026-06-28T15:50:00Z",
      "message": "Não recebi meu pedido!"
    },
    {
      "id": "MSG-002",
      "author": "seller",
      "date": "2026-06-29T09:30:00Z",
      "message": "Vou investigar o rastreamento e retorno"
    }
  ]
}
```

---

### 3. Enviar Mensagem em Reclamação

```
POST /claims/{claim_id}/messages
Content-Type: application/json
```

**Body:**
```json
{
  "message": "Vou resolver isso imediatamente. Obrigado pela paciência!"
}
```

**Exemplo:**
```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Resolvi o problema. Enviarei compensação."}' \
  "https://api.mercadolivre.com.br/claims/99999999/messages"
```

**Resposta (201):**
```json
{
  "id": "MSG-003",
  "author": "seller",
  "date": "2026-06-29T10:15:00Z",
  "message": "Resolvi o problema. Enviarei compensação."
}
```

---

### 4. Reembolsar Reclamação (Resolução Rápida)

```
POST /claims/{claim_id}/refund
Content-Type: application/json
```

**Body:**
```json
{
  "amount": 150.50,
  "message": "Reembolso por produto não recebido"
}
```

**Exemplo:**
```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 150.50,
    "message": "Reembolso por produto não recebido"
  }' \
  "https://api.mercadolivre.com.br/claims/99999999/refund"
```

**Resposta (200):**
```json
{
  "id": "99999999",
  "status": "resolved",
  "resolution_type": "seller_refund",
  "refund_amount": 150.50,
  "updated_date": "2026-06-29T10:20:00Z"
}
```

---

## Shipment API (para rastreamento de retorno)

### 1. Obter Detalhe de Envio

```
GET /shipments/{shipment_id}
```

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/shipments/123456"
```

**Resposta (200):**
```json
{
  "id": 123456,
  "order_id": 987654321,
  "status": "delivered",
  "status_history": [
    {
      "status": "delivered",
      "date": "2026-07-02T14:30:00Z",
      "detail": "Entregue ao destinatário"
    },
    {
      "status": "in_transit",
      "date": "2026-07-01T08:00:00Z",
      "detail": "Em transporte"
    }
  ],
  "tracking_number": "AA123456789BR",
  "carrier_id": "199",
  "carrier_name": "Correios",
  "receiver_address": {
    "address_line": "Rua A, 123",
    "city": "São Paulo",
    "state": "SP",
    "zip_code": "01234-567"
  },
  "sender_address": {
    "address_line": "Avenida B, 456",
    "city": "Rio de Janeiro",
    "state": "RJ",
    "zip_code": "20000-000"
  }
}
```

---

### 2. Gerar Label de Retorno (se disponível)

```
GET /shipments/{shipment_id}/return_label
```

**Parâmetros Query:**
| Param | Descrição |
|-------|-----------|
| `return_type` | "free_return" ou "paid_return" |
| `format` | "pdf" (padrão) ou "png" |

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/shipments/123456/return_label?format=pdf" \
  -o return_label.pdf
```

**Resposta:**
- Arquivo PDF/PNG binário com código de retorno

---

## Status Codes Comuns

| Code | Significado |
|------|------------|
| `200` | OK - Sucesso |
| `201` | Created - Recurso criado |
| `400` | Bad Request - Parâmetro inválido |
| `401` | Unauthorized - Token inválido/expirado |
| `403` | Forbidden - Sem permissão |
| `404` | Not Found - Recurso não existe |
| `429` | Too Many Requests - Rate limit excedido |
| `500` | Internal Server Error - Erro no servidor ML |

---

## Rate Limiting

### Headers de Resposta
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 599
X-RateLimit-Reset: 1719857400
```

### Estratégia de Retry
```python
def retry_on_429(func, max_attempts=3):
    for attempt in range(max_attempts):
        try:
            return func()
        except HTTPError as e:
            if e.code == 429 and attempt < max_attempts - 1:
                wait = 1.5 * (attempt + 1)  # 1.5s, 3s, 4.5s
                time.sleep(wait)
                continue
            raise
```

---

## Erros Comuns & Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| `{"error": "invalid_token"}` | Token expirado | Renovar token com refresh_token |
| `{"error": "invalid_seller_id"}` | Seller ID incorreto | Chamar GET /users/me para obter ID correto |
| `{"error": "return_not_found"}` | ID de devolução inexistente | Verificar ID (pode ser de outro vendedor) |
| `{"error": "claim_expired"}` | Prazo de reclamação expirou | Não pode mais responder (status fecha) |
| `429 Too Many Requests` | Excedido rate limit | Aguardar X segundos (header X-RateLimit-Reset) |

---

## Checklist de Integração

- [ ] Implementar função `_get()` com Bearer token
- [ ] Adicionar retry automático para 429
- [ ] Cachear resultados com timestamp
- [ ] Sincronizar a cada 5-10 minutos
- [ ] Alertar quando claim expira em <24h
- [ ] Testar confirmação de retorno (POST /returns/{id}/confirm)
- [ ] Testar reembolso (POST /returns/{id}/refund)
- [ ] Monitorar X-RateLimit-Remaining headers
- [ ] Documentar razões de devolução para operador
- [ ] Integrar webhooks em Seller Center

---

## Útil: Obter User ID

```bash
# Descobrir seu seller_id
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/users/me"

# Resposta inclui:
# {
#   "id": 123456,
#   "nickname": "seu_username",
#   "email": "seu@email.com"
# }
```

Usar este `id` como `seller_id` em todas as queries.
