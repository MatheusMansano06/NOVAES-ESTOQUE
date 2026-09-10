# Shopee Open Platform — API Reference Completa
**Data**: 2026-09-10 | **Fonte**: open.shopee.com Developer Guide + SDK shopee-sdk v2 (100% coverage)

## 📋 Índice
1. [Autenticação & OAuth](#1-autenticação--oauth)
2. [Shop API](#2-shop-api)
3. [Produto: CRUD, Variações, Mídia](#3-produto-crud-variações-mídia)
4. [Categoria, Atributos, Limites](#4-categoria-atributos-limites)
5. [Pedidos & Logística](#5-pedidos--logística)
6. [Fulfillment by Shopee (FBS/FULL)](#6-fulfillment-by-shopee-fbsfull)
7. [Retornos & Reembolso](#7-retornos--reembolso)
8. [Finance & Comissões](#8-finance--comissões)
9. [Ads (Publicidade)](#9-ads-publicidade)
10. [Chat (Mensagens)](#10-chat-mensagens)
11. [Account Health & Performance](#11-account-health--performance)
12. [Webhooks & Push](#12-webhooks--push)
13. [Regras Gerais & Assinatura](#13-regras-gerais--assinatura)

---

## 1. Autenticação & OAuth

### Conceitos-chave
- **partner_id** / **partner_key**: App credentials (não reutilize `partner_key` publicamente — só local para sign)
- Tokens são **per-shop**, não por App
- **Autorização válida**: até 365 dias (escolhida pelo vendedor); refresh_token = 30 dias, use-once

### Fluxo: 3 passos
1. **Gerar link de autorização** → vendedor clica → aprova → recebe `code` (válido 10 min, 1 uso)
2. **GetAccessToken**: trocar `code` por `access_token` (4h) + `refresh_token` (30d, uso único)
3. **Reutilizar**: mesma loja → mesmo `access_token` por 4h; expires → refresh_token → novo par

### URLs por Ambiente/Região
| Ambiente | Região | Auth URL | API Base |
|---|---|---|---|
| Prod | Global | https://open.shopee.com/auth | https://partner.shopeemobile.com/api/v2 |
| Prod | China | https://open.shopee.cn/auth | https://openplatform.shopee.cn/api/v2 |
| **Prod** | **Brasil** | https://open.shopee.com.br/auth | https://openplatform.shopee.com.br/api/v2 |
| Sandbox | Global | https://open.sandbox.test-stable.shopee.com/auth | https://openplatform.sandbox.test-stable.shopee.sg/api/v2 |

### GetAccessToken — `POST /api/v2/auth/token/get`
```json
Request: {
  "partner_id": int,
  "code": "xxx",  // válido 1x, 10 min
  "shop_id": int  // OU "main_account_id"
}
Response: {
  "access_token": "...",     // 4h, reutilizável
  "refresh_token": "...",    // 30d, 1 uso
  "expire_in": 14400,        // segundos
  "merchant_id_list": [...]  // se veio via main_account_id
}
```

### RefreshAccessToken — `POST /api/v2/auth/access_token/get`
```json
Request: {
  "refresh_token": "...",  // uso único → novo refresh_token na resposta
  "partner_id": int,
  "shop_id": int  // OU merchant_id / supplier_id / user_id
}
Response: {
  "access_token": "...",
  "refresh_token": "...",  // novo
  "expire_in": 14400
}
```

### GetTokenByResendCode — Recuperação de emergência (produção only)
Se perdeu os tokens salvos: vendedor gera "resend code" no Seller Center → você troca por tokens novos.
- Endpoint: `POST /api/v2/public/get_token_by_resend_code`
- **Não disponível em sandbox**

### Assinatura (HMAC-SHA256)
Toda chamada precisa de `sign = HMAC-SHA256(partner_id + api_path + timestamp [+ access_token + shop_id], partner_key)`.
- Timestamp válido: ±5 minutos
- String base varia por tipo de endpoint (ver `open.shopee.com/documents?module=87&type=2&id=58` para regras por tipo)

---

## 2. Shop API

### GetShopInfo / GetProfile
```
GET /api/v2/shop/get_shop_info
GET /api/v2/shop/get_profile
Response: shop_name, logo, description, status, region, categories_for_sales, ...
```

### UpdateProfile
```
POST /api/v2/shop/update_profile
Body: shop_name, logo, description, ... (parcial, sobrescreve só o informado)
```

### GetWarehouseDetail (multi-armazém — whitelist only)
```
GET /api/v2/shop/get_warehouse_detail
Response: warehouse_list[] com warehouse_id, warehouse_name, address, enabled_regions, ...
```

### GetShopHolidayMode / SetShopHolidayMode
```
GET /api/v2/shop/get_shop_holiday_mode
POST /api/v2/shop/set_shop_holiday_mode
Body: enabled (bool), start_date, end_date, holiday_mode ("PARTIAL" | "FULL")
```

### GetBrShopOnboardingInfo (KYC — Brasil)
```
GET /api/v2/shop/get_br_shop_onboarding_info
Response: onboarding_status, requirements_status, ...
```

---

## 3. Produto: CRUD, Variações, Mídia

### AddItem — Criar produto
```
POST /api/v2/product/add_item
Body: {
  "original_price": float,
  "description": string (10–2000 chars),
  "weight": float,
  "item_name": string (5–100 chars),
  "category_id": int,
  "image": {
    "image_id_list": [...]  // uploadar antes via MediaSpace
  },
  "logistic_info": [
    { "enabled": true, "shipping_fee": float, "is_free": bool }
  ],
  "dimension": { "height": float, "width": float, "length": float },
  "attribute_list": [...],  // obrigatórios por categoria
  "tax_info": {  // Brasil — campos opcionais
    "ncm": "12345678",       // Nomenclatura Comum do MERCOSUL (8 dígitos)
    "same_state_cfop": "5102",  // CFOP intra-estado
    "diff_state_cfop": "6102",  // CFOP inter-estado
    "csosn": "102",          // CSOSN (IPI)
    "origin": "0",           // 0=Brasil, 1=Importado
    "cest": "0100100",       // CEST (7 dígitos ou "00")
    "measure_unit": "UN",    // enum: KG, UN, CX, PC, PACOTE, ...
    "pis": "7.65",           // alíquota PIS (%)
    "cofins": "7.65"         // alíquota COFINS (%)
  },
  "pre_order": { "is_pre_order": true, "days_to_ship": 30 },
  "item_status": "NORMAL" | "UNLIST",
  "condition": "NEW" | "USED",
  "gtin_code": "1234567890",
  "brand": "Brand Name",
  "video_upload_id": "..."  // de MediaSpace
}
Response: {
  "item_id": int
}
```

### UpdateItem — Atualizar produto
```
POST /api/v2/product/update_item
Body: {
  "item_id": int,
  "item_name": string,  // atualiza nome
  "description": string,
  "weight": float,      // sobrescreve TODOS os modelos
  "dimension": {...},   // idem
  "category_id": int,
  "attribute_list": [...],
  "image": {...},
  "item_sku": string,
  "item_status": "NORMAL" | "UNLIST",
  "tax_info": {...},    // parcial — Brazil tax fields
  "brand": string,
  "condition": "NEW" | "USED",
  "gtin_code": string
}
Response: {
  "item_id": int
}
```

⚠️ **NÃO atualiza preço/estoque** — usar `update_price` / `update_stock` dedicados.

### DeleteItem
```
POST /api/v2/product/delete_item
Body: { "item_id": int }
Response: { "item_id": int }
```

### UnlistItem — Pausar item (sem deletar)
```
POST /api/v2/product/unlist_item
Body: { "item_id_list": [int, ...] }  // até 50
Response: { "failed_list": [...] }    // só falhas
```

### Variações (Tier)
```
POST /api/v2/product/init_tier_variation
Body: {
  "item_id": int,
  "tier_variation": [
    {
      "name": "Cor",  // até 14 chars
      "option_list": ["Vermelho", "Azul", ...]  // até 20 chars cada
    },
    {
      "name": "Tamanho",
      "option_list": ["P", "M", "G"]
    }
  ],
  "model_list": [
    {
      "tier_index": [0, 0],  // Índices em tier_variation (Cor 0 + Tamanho 0 = "Vermelho P")
      "normal_stock": 100,
      "model_sku": "SKU-RED-P",
      "original_price": 29.99,
      "weight": 0.5
    },
    ...
  ]
}
Response: { "item_id": int }
```
**Limite**: máximo 2 tiers, até 50 modelos por chamada.

### UpdateStock
```
POST /api/v2/product/update_stock
Body: {
  "item_id": int,
  "stock_list": [
    {
      "model_id": int,
      "normal_stock": 100,  // quantidade disponível
      "reserved_stock": 0   // bloqueado por promoções (leitura)
    }
  ]
}
Response: {
  "affected_rows": int,
  "failed_model_list": [...]
}
```

### UpdatePrice
```
POST /api/v2/product/update_price
Body: {
  "item_id": int,
  "price_list": [
    {
      "model_id": int,
      "original_price": 29.99
    }
  ]
}
Response: {
  "affected_rows": int,
  "failed_model_list": [...]
}
```

### Kit/Combo (suporte nativo)
```
POST /api/v2/product/add_kit_item
Body: {
  "kit_name": "Kit Combo",
  "kit_description": "...",
  "kit_category_id": int,
  "kit_image_id_list": [...],
  "component_list": [
    {
      "item_id": int,         // item já cadastrado
      "model_id": int,        // qual modelo/variação
      "quantity": 2           // quantos dele
    }
  ]
}
Response: { "item_id": int }  // novo item kit
```
⚠️ **Shopee NÃO baixa estoque dos componentes automaticamente** — implementar baixa-por-componente no picker (como NOVAES já faz para Olist/ML).

---

## 4. Categoria, Atributos, Limites

### GetCategory — Árvore de categorias
```
GET /api/v2/product/get_category?language=pt-br
Response: {
  "category_list": [
    {
      "category_id": int,
      "parent_category_id": int,  // 0 = root
      "original_category_name": string,
      "display_category_name": string,
      "has_children": bool
    }
  ]
}
```
**Sem paginação** — retorna árvore inteira. Cliente monta hierarquia localmente.

### GetAttributeTree — Atributos obrigatórios/opcionais
```
GET /api/v2/product/get_attribute_tree?category_id_list=123,456
// até 20 categorias por chamada
Response: {
  "category_attributes_info": [
    {
      "category_id": int,
      "attribute_list": [
        {
          "attribute_id": int,
          "mandatory": bool,  // ← chave para saber se é obrigatório
          "name": string,
          "attribute_info": {
            "input_type": "SINGLE_DROP_DOWN" | "FREE_TEXT_FILED" | ...,
            "input_validation_type": "no-validate" | "int" | "string",
            "max_value_count": int,  // multi-select
            "support_search_value": bool
          },
          "attribute_value_list": [
            { "value_id": int, "value_name": string, "child_attribute_list": [...] }
          ]
        }
      ]
    }
  ]
}
```

### GetItemLimit — Limites por categoria
```
GET /api/v2/product/get_item_limit?category_id=123
Response: {
  "price_limit": { "min_limit": float, "max_limit": float },
  "stock_limit": { "min_limit": int, "max_limit": int },
  "item_name_length_limit": { "min_length": 5, "max_length": 100 },
  "item_description_length_limit": { "min_length": 10, "max_length": 2000 },
  "item_image_count_limit": { "min_count": 1, "max_count": 9 },
  "item_count_limit": { "max_limit": 50001 },
  "tier_variation_name_length_limit": 14,
  "tier_variation_option_length_limit": 20,
  "weight_limit": { "weight_mandatory": bool },
  "dimension_limit": { "dimension_mandatory": bool },
  "gtin_limit": {
    "gtin_validation_rule": "MANDATORY" | "FLEXIBLE" | "OPTIONAL"
  },
  "size_chart_limit": {
    "size_chart_mandatory": bool,
    "support_image_size_chart": bool,
    "support_template_size_chart": bool
  }
}
```

### GetBrandList
```
GET /api/v2/product/get_brand_list?category_id=123&offset=0&page_size=100
Response: {
  "brand_list": [
    { "brand_id": int, "brand_name": string, "is_mandatory": bool }
  ]
}
```

---

## 5. Pedidos & Logística

### GetOrderList — Listar pedidos
```
GET /api/v2/order/get_order_list
Params: {
  "time_range_field": "create_time" | "update_time",
  "time_from": timestamp,
  "time_to": timestamp,
  // ⚠️ Máxima 15 dias entre from/to
  "order_status": "UNPAID" | "READY_TO_SHIP" | "PROCESSED" | "SHIPPED" | 
                  "COMPLETED" | "IN_CANCEL" | "CANCELLED" | "INVOICE_PENDING" | "PENDING",
  "page_size": 1-100,
  "cursor": "opaque_string",  // para paginação
  "logistics_channel_id": 91007  // 91007 = Fulfilled by Shopee (FBS)
}
Response: {
  "order_list": [
    {
      "order_sn": string,
      "order_status": string,
      "create_time": timestamp,
      "update_time": timestamp,
      "total_amount": float,
      "currency": "BRL",
      "shipping_carrier": "Correios" | "Loggi" | ...
    }
  ],
  "more": bool,
  "next_cursor": "..."
}
```

### GetOrderDetail — Detalhe de pedido
```
GET /api/v2/order/get_order_detail
Params: {
  "order_sn_list": "order1,order2,order3",  // até 50, separados por vírgula
  "response_optional_fields": "buyer_user_id,buyer_username,item_list,recipient_address,..."
}
Response: {
  "order_list": [
    {
      "order_sn": string,
      "order_status": string,
      "create_time": timestamp,
      "ship_by_date": timestamp,
      "buyer_user_id": int,
      "buyer_username": string,
      "recipient_address": {
        "name": "...",  // pode vir mascarado como "****"
        "phone": "...",
        "full_address": string,
        "country": "BR"
      },
      "item_list": [
        {
          "item_id": int,
          "item_name": string,
          "model_id": int,
          "model_name": string,
          "model_sku": string,
          "order_item_id": int,
          "model_quantity": int,
          "model_original_price": float,
          "model_discounted_price": float
        }
      ],
      "package_list": [
        {
          "package_number": string,
          "logistics_status": string,
          "shipping_carrier": string,
          "tracking_number": string,
          "item_list": [...]
        }
      ],
      "fulfillment_flag": "FBS" | "FBM" | "OTHERS",  // FBS = Fulfilled by Shopee
      "invoice_data": {
        "nf_e_status": string,
        "nf_e_number": string
      },
      "payment_method": "Credit Card" | "Bank Transfer" | ...,
      "cod": bool,
      "total_amount": float,
      "actual_shipping_fee": float
    }
  ]
}
```

### CancelOrder — Cancelar (vendedor)
```
POST /api/v2/order/cancel_order
Body: {
  "order_sn": string,
  "cancel_reason": "OUT_OF_STOCK" | "CUSTOMER_REQUEST" | "UNDELIVERABLE_AREA",
  "item_list": [  // opcional, só se OUT_OF_STOCK e cancelamento parcial
    { "item_id": int, "model_id": int, "cancel_quantity": int }
  ]
}
Response: {
  "order_sn": string
}
```

### ShipOrder — Organizar envio
```
POST /api/v2/logistics/ship_order
Body: {
  "order_sn": string,
  "package_number": string,  // opcional, se já tiver package
  "logistics_channel": int,   // ID da transportadora (obter via get_channel_list)
  "tracking_number": string   // opcional — se informado, Shopee valida
}
Response: {
  "order_sn": string,
  "package_number": string,
  "tracking_number": string
}
```

### Geração de etiqueta — 4 passos
```
1. GET /api/v2/logistics/get_shipping_document_parameter
   → Returns: required_fields, label_format, ...

2. POST /api/v2/logistics/create_shipping_document
   Body: {
     "order_sn_list": [...],  // até 50
     "shipping_document_type": "SHIPPING_LABEL"
   }
   Response: { "document_id": string, "status": "processing" }

3. GET /api/v2/logistics/get_shipping_document_result
   Params: { "document_id": "..." }
   Response: { "status": "completed", "document_url": "..." }

4. Baixar PDF do `document_url`
```

### GetChannelList — Transportadoras disponíveis
```
GET /api/v2/logistics/get_channel_list
Response: {
  "logistics_channel_list": [
    {
      "logistics_channel_id": int,
      "logistics_channel_name": "Correios" | "Loggi" | "Sequoia" | ...,
      "enabled": bool,
      "pickup_instruction_list": [...]
    }
  ]
}
```

---

## 6. Fulfillment by Shopee (FBS/FULL)

### Acesso Read-Only via API
- **FBS status**: visto via `fulfillment_flag="FBS"` em `get_order_detail`
- **Estoque FBS**: `get_item_base_info` → `shopee_stock` (read-only)
- **Ordem FBS**: identificado por `logistics_channel_id=91007` em `get_order_list`

### Configuração: Seller Center only
- Agendamento de entrega ao armazém Shopee → **sem endpoint de API**
- Emissão de NF-e → **sem endpoint de API**
- Nomeação de produtos → **sem endpoint de API**

### Equivalência com Mercado Livre
- FBS ≈ FULL (Fulfillment by Marketplace)
- Diferença: FULL exige NF-e via API (ML tem endpoint); FBS da Shopee não exige (Seller Center manda tudo)

---

## 7. Retornos & Reembolso

### GetReturnList — Listar devoluções
```
GET /api/v2/return/get_return_list
Params: {
  "page_no": int,      // paginação por página (NÃO cursor)
  "page_size": 1-100,
  "return_status": "REQUESTED" | "PROCESSING" | "COMPLETED" | ...
}
Response: {
  "return_list": [
    {
      "return_id": int,
      "order_sn": string,
      "return_status": string,
      "reason": string,
      "return_creation_time": timestamp,
      "return_expiry_time": timestamp,
      ...
    }
  ],
  "page_size": int,
  "page_no": int,
  "total": int
}
```

### ConfirmReturn — Aceitar devolução
```
POST /api/v2/return/confirm_return
Body: {
  "return_id": int,
  "reimbursement_amount": float  // montante a reembolsar
}
Response: { "return_id": int }
```

### OfferReturn — Propor plano de devolução
```
POST /api/v2/return/offer_return
Body: {
  "return_id": int,
  "reimbursement_amount": float,
  "shippable": bool,             // se precisa devolver o item
  "additional_explanation": string
}
Response: { "return_id": int }
```

### DisputeReturn — Contestar (somente quando status = REQUESTED/PROCESSING)
```
POST /api/v2/return/dispute_return
Body: {
  "return_id": int,
  "dispute_reason": string,
  "proof_list": [
    {
      "proof_type": "image",
      "content": "base64_encoded_image",
      "description": string
    }
  ]
}
Response: { "return_id": int }
```

---

## 8. Finance & Comissões

### GetEscrowDetail / GetEscrowDetailBatch
```
GET /api/v2/payment/get_escrow_detail?order_sn=ORDER123
GET /api/v2/payment/get_escrow_detail_batch
Body: { "order_sn_list": ["ORDER1", "ORDER2", ...] }  // até 50

Response: {
  "escrow_list": [
    {
      "order_sn": string,
      "escrow_amount": float,          // o que o seller recebe
      "buyer_total_amount": float,
      "item_price": float,
      "shipping_fee_original": float,
      "shipping_fee_buyer": float,
      "commission": float,             // comissão Shopee
      "transaction_fee": float,        // taxa de transação
      "service_fee": float,
      "vat": float,
      "currency": "BRL",
      "escrow_release_time": timestamp
    }
  ]
}
```

### GetEscrowList — Listar por período de payout
```
GET /api/v2/payment/get_escrow_list
Params: {
  "release_time_from": timestamp,
  "release_time_to": timestamp,
  "page_no": int,
  "page_size": 1-100
}
Response: {
  "escrow_list": [
    {
      "order_sn": string,
      "payout_amount": float,
      "escrow_release_time": timestamp
    }
  ]
}
```
**Uso**: varrer por `release_time` para reconciliação tipo Olist/ML (equivalente a endpoint de "vendas com margem").

### GetWalletTransactionList — Extrato (lojas locais)
```
GET /api/v2/payment/get_wallet_transaction_list
Params: {
  "page_no": int,
  "page_size": 1-100,
  "create_time_from": timestamp,
  "create_time_to": timestamp
}
Response: {
  "transaction_list": [
    {
      "transaction_id": string,
      "type": string,
      "amount": float,
      "balance": float,
      "create_time": timestamp
    }
  ]
}
```
**Limitação**: só lojas locais (não cross-border).

---

## 9. Ads (Publicidade)

### ⚠️ Limitação Crítica
- **Requer permissão especial** concedida pela Shopee
- **Não suportado em todas as regiões** — verificar disponibilidade para Brasil antes de integrar

### GetTotalBalance — Saldo de crédito
```
GET /api/v2/ads/get_total_balance
Response: { "balance": float, "currency": "BRL" }
```

### CreateManualProductAds — Criar campanha manual
```
POST /api/v2/ads/create_manual_product_ads
Body: {
  "reference_id": string,  // único para evitar duplicação
  "budget": float,
  "start_date": "DD-MM-YYYY",  // datas em DD-MM-YYYY
  "campaign_name": string,
  "bidding_method": "PPC" | "PPS",
  "item_id": int,
  "roas_target": float       // target ROAS
}
Response: { "campaign_id": int }
```

### GetProductCampaignDailyPerformance — Métricas
```
GET /api/v2/ads/get_product_campaign_daily_performance
Params: {
  "start_date": "DD-MM-YYYY",
  "end_date": "DD-MM-YYYY",
  "campaign_id_list": [int, ...]
}
Response: {
  "data": [
    {
      "date": "YYYY-MM-DD",
      "campaign_id": int,
      "impressions": int,
      "clicks": int,
      "spend": float,
      "orders": int,
      "gmv": float,  // Gross Merchandise Value
      "conversion": "Direct" | "Broad"  // Direct=anúncio, Broad=outro produto da loja
    }
  ]
}
```

---

## 10. Chat (Mensagens)

### Status: Não Público / Whitelist-only
- **A Chat API não está documentada** na Developer Guide pública
- **Existe um endpoint real** (`v2.sellerchat.*`) mas é **restrito a parceiros whitelisted**
- Único vestígio: webhook de "Webchat push" (código 10) sem payload documentado
- **Ação necessária**: abrir solicitação de whitelist com o time de parceiros da Shopee se quiser automação de resposta

---

## 11. Account Health & Performance

### GetShopPerformance
```
GET /api/v2/shop/get_shop_performance
Response: {
  "rating": 1-4,  // 1=excelente, 4=ruim
  "fulfillment_rating": float,
  "listing_rating": float,
  "service_rating": float,
  "penalty_score": int
}
```

### GetPenaltyPointHistory
```
GET /api/v2/shop/get_penalty_point_history
Response: {
  "penalty_list": [
    {
      "type": string,
      "point": int,
      "create_time": timestamp,
      "expiry_time": timestamp
    }
  ]
}
```

---

## 12. Webhooks & Push

### Configuração
```
POST /api/v2/app/set_app_push_config
Body: {
  "push_url": "https://seu-backend.com/api/shopee/webhook",
  "push_account_type": "seller"
}
Response: {
  "push_url": string,
  "live_push_status": "Normal" | "Warning" | "Suspended"
}
```

### Tipos de evento (13 identificados)
| Código | Evento |
|---|---|
| 1 | Autorização do app |
| 2 | Desautorização do app |
| 3 | Atualização de status do pedido |
| 4 | Atualização de rastreamento |
| 5 | Item banido |
| 6 | Expiração de autorização |
| 7 | Devolução iniciada |
| 8 | Reembolso processado |
| 9 | Chat recebida |
| 10 | Webchat push |
| 11 | Sincronização de inventário |
| 12 | Pedido cancelado |
| 13 | Atualização de preço |

### Resposta esperada
```
Status 200 + JSON { "ok": true }
```
**Importante**: Shopee desativa o webhook se Taxa de sucesso cair (verificar `live_push_status`).

### GetLostPushMessage — Recuperar mensagens perdidas
```
GET /api/v2/app/get_lost_push_message
Response: {
  "lost_push_message_list": [...]  // últimas 100 msgs dos últimos 3 dias
}
```

---

## 13. Regras Gerais & Assinatura

### Common Request Parameters
```
Toda chamada assinada inclui:
- partner_id (int) — do App
- timestamp (int) — expira em ±5 minutos
- access_token (string) — 4h, reutilizável (exceto Public endpoints)
- shop_id (int) — obrigatório na maioria (exceto Public, media_space.upload_image)
- sign (string) — HMAC-SHA256
```

### HMAC-SHA256 (Assinatura)
```
// Exemplo Python
import hmac, hashlib

partner_key = "seu_partner_key"
path = "/api/v2/product/get_item_limit"
timestamp = "1694000000"
access_token = "seu_token_4h"
shop_id = "12345"

// String base varia por tipo de endpoint; exemplo padrão:
base = f"{partner_id}{path}{timestamp}{access_token}{shop_id}"
sign = hmac.new(
    partner_key.encode(),
    base.encode(),
    hashlib.sha256
).hexdigest()
```

### Ambientes de Teste
- **Sandbox Global**: `openplatform.sandbox.test-stable.shopee.sg`
- **Sandbox China**: `openplatform.sandbox.test-stable.shopee.cn`
- **Sandbox Brasil**: `openplatform.sandbox.test-stable.shopee.com.br`

### Rate Limits
- **Documentação pública**: ausente (campos retornam `[0, 0, 0]`)
- **Recomendação**: implementar retry/backoff defensivo (exponential backoff 1s → 2s → 4s)

### Paginação
- **Cursor-based** (orders): `get_order_list` → `next_cursor`
- **Page-based** (returns): `get_return_list` → `page_no` / `page_size`
- **Sem paginação** (categories): `get_category` → retorna árvore inteira

---

## Referências
- Official Docs: https://open.shopee.com/developer-guide/4
- API Reference: https://open.shopee.com/documents/v2/
- Brasil Guide: https://open.shopee.com/developer-guide/[BR-specific IDs]
- Open-source SDK: github.com/congminh1254/shopee-sdk (100% endpoint coverage, v2)

---

**Atualizado em**: 2026-09-10 | **Pesquisa feita por**: 4 subagentes paralelos (auth, produtos, pedidos, finance)
