# 📖 Bíblia da API Mercado Livre - Referência Completa

**Versão**: 2.0 | **Data**: 16 de junho de 2026 | **Site**: https://developers.mercadolibre.com

---

## 🔐 Autenticação OAuth2

### Fluxo de Token
```
1. Redirecionar usuário para:
   https://auth.mercadolivre.com.br/authorization?
   response_type=code&
   client_id={CLIENT_ID}&
   redirect_uri={REDIRECT_URI}

2. Usuário autoriza → recebe 'code' no callback

3. Trocar code por access_token:
   POST https://api.mercadolibre.com/oauth/token
   {
     "grant_type": "authorization_code",
     "client_id": "{CLIENT_ID}",
     "client_secret": "{CLIENT_SECRET}",
     "code": "{CODE}",
     "redirect_uri": "{REDIRECT_URI}"
   }

4. Resposta (importante):
   {
     "access_token": "...",          // Token de acesso (validade ~6h)
     "refresh_token": "...",         // Novo refresh_token (uso único!)
     "user_id": 221832146,
     "expires_in": 21600             // segundos até expiração
   }
```

### Renovar Token (Critical!)
**⚠️ IMPORTANTE**: Cada refresh_token é de **uso único**. Após usar, você recebe um novo refresh_token.

```
POST https://api.mercadolibre.com/oauth/token
{
  "grant_type": "refresh_token",
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}",
  "refresh_token": "{REFRESH_TOKEN_ANTIGO}"
}

Resposta:
{
  "access_token": "novo_token",
  "refresh_token": "novo_refresh_token",  // ← SEMPRE SALVAR ESTE NOVO
  "expires_in": 21600,
  "user_id": 221832146
}
```

### Headers de Requisição
```
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
Content-Type: application/json  (para POST/PUT)
```

---

## 📊 Rate Limiting

**Limite**: 240 requisições por minuto (4 req/seg)

**Backoff Strategy**:
- Se HTTP 429 (Too Many Requests) → esperar 1.5s * (tentativa+1)
- Retry automático até 3 tentativas
- Throttle preventivo: 60/240 = 250ms entre requisições

**Implementação no projeto**:
```python
# Em integracoes_ml.py
self._intervalo_min = 60.0 / 240.0  # 250ms
self._throttle()  # Antes de cada requisição
```

---

## 🛍️ Items (Anúncios)

### GET /items/{item_id}
Obter dados básicos de um anúncio.

```
GET https://api.mercadolibre.com/items/MLB1039363055?
    attributes=id,title,price,category_id,listing_type_id,seller_custom_field,available_quantity

Resposta:
{
  "id": "MLB1039363055",
  "title": "Viseira Fume Capacete...",
  "price": 42.99,
  "currency_id": "BRL",
  "available_quantity": 82,
  "sold_quantity": 594,
  "status": "active",
  "listing_type_id": "gold_special",  // Clássico
  "seller_custom_field": "VISFUMSPA-VAR",  // SKU do vendedor
  "shipping": {
    "free_shipping": false,
    "logistic_type": "fulfillment",
    "dimensions": "13.3x22.2x29.8,130"  // altura x largura x comprimento, peso(g)
  },
  "attributes": [
    {
      "id": "PACKAGE_HEIGHT",
      "value_struct": { "number": 13.3, "unit": "cm" }
    },
    ...
  ],
  "category_id": "MLB46678"
}
```

**Atributos Disponíveis**:
- `id`, `title`, `price`, `original_price`, `currency_id`
- `available_quantity`, `sold_quantity`, `status`
- `listing_type_id`, `seller_custom_field`
- `shipping`, `attributes`, `pictures`, `category_id`
- `permalink`, `tags`, `sale_terms`

### GET /items (MultiGet)
Buscar múltiplos anúncios em lote (até 20 por requisição).

```
GET https://api.mercadolibre.com/items?
    ids=MLB1039363055,MLB1570473908,MLB928636981&
    attributes=id,title,price,category_id

Resposta:
[
  {
    "code": 200,
    "body": { "id": "MLB1039363055", "title": "...", ... }
  },
  {
    "code": 200,
    "body": { "id": "MLB1570473908", "title": "...", ... }
  },
  ...
]
```

### GET /users/{user_id}/items/search
Listar anúncios do vendedor com paginação.

```
GET https://api.mercadolibre.com/users/221832146/items/search?
    status=active&
    offset=0&
    limit=50

Resposta:
{
  "results": [
    "MLB1039363055",
    "MLB1570473908",
    ...
  ],
  "paging": {
    "total": 391,          // Total de anúncios
    "limit": 50,
    "offset": 0
  }
}
```

**Status válidos**: `active`, `paused`, `closed`, `under_review`

### PUT /items/{item_id}
Atualizar anúncio (preço, atributos, imagens, etc).

```
PUT https://api.mercadolibre.com/items/MLB1039363055
Content-Type: application/json

{
  "price": 45.00,
  "title": "Novo título...",
  "attributes": [
    {
      "id": "PACKAGE_HEIGHT",
      "value_name": "13.3 cm"
    },
    ...
  ],
  "pictures": [
    { "id": "pic_id_1" },
    { "source": "https://..." }
  ]
}

Resposta: 200 OK
```

---

## 💰 Tarifas de Venda (Precificação)

### GET /sites/{site}/listing_prices
Obter tarifa real para um preço e categoria específicos.

```
GET https://api.mercadolibre.com/sites/MLB/listing_prices?
    price=42.99&
    category_id=MLB46678

Resposta:
[
  {
    "listing_type_id": "gold_special",  // Clássico
    "sale_fee_amount": 5.16,            // Valor absoluto da tarifa
    "sale_fee_details": {
      "percentage_fee": 12,             // 12%
      "fixed_fee": 0
    }
  },
  {
    "listing_type_id": "gold_pro",      // Premium
    "sale_fee_amount": 7.31,
    "sale_fee_details": {
      "percentage_fee": 17,             // 17%
      "fixed_fee": 0
    }
  }
]

// Fórmula: tarifa = (price * percentage_fee / 100) + fixed_fee
// Ex: 42.99 * 0.12 + 0 = 5.16 ✓
```

**Tipos de Listing**:
- `gold_special` = Clássico (básico)
- `gold_pro` = Premium (mais visibilidade)
- `gold_premium` = Premium (antigo, descontinuado)
- `gold` = Ouro (legado)

---

## 📦 Shipping (Frete)

### GET /users/{user_id}/shipping_options/free
Custo de frete grátis para um anúncio (cobertura país inteiro).

```
GET https://api.mercadolibre.com/users/221832146/shipping_options/free?
    item_id=MLB1039363055&
    verbose=true

Resposta:
{
  "coverage": {
    "all_country": {
      "list_cost": 6.95,        // Custo real do frete para ML cobrir
      "currency_id": "BRL",
      "billable_weight": 500    // Peso faturado (g)
    }
  }
}
```

### GET /items/{item_id}/shipping_options
Simular opções de frete para um CEP.

```
GET https://api.mercadolibre.com/items/MLB1039363055/shipping_options?
    zip_code=01310100  // CEP de São Paulo

Resposta:
{
  "options": [
    {
      "id": "73328",
      "shipping_method_type": "custom",
      "list_cost": 15.00,
      "cost": 0  // Se seller oferece grátis
    },
    ...
  ]
}
```

---

## 📝 Descrições

### GET /items/{item_id}/description
Obter descrição do anúncio.

```
GET https://api.mercadolibre.com/items/MLB1039363055/description

Resposta:
{
  "text": "<img src='...'/>",
  "plain_text": "Novaes Motos...",
  "last_updated": "2018-05-29T13:44:10.000Z",
  "snapshot": {
    "url": "http://descriptions.mlstatic.com/...",
    "width": 0,
    "height": 0
  }
}
```

### PUT /items/{item_id}/description
Atualizar descrição (plain text ou HTML).

```
PUT https://api.mercadolibre.com/items/MLB1039363055/description
{
  "plain_text": "Nova descrição do produto..."
}

Resposta: 200 OK
```

---

## 🖼️ Imagens

### PUT /items/{item_id}
Reordenar/atualizar imagens de um anúncio.

```
PUT https://api.mercadolibre.com/items/MLB1039363055
{
  "pictures": [
    { "id": "pic_id_1" },      // Manter imagem existente
    { "source": "https://..." } // Adicionar nova imagem
  ]
}
```

### POST /pictures/items/upload
Fazer upload de imagem para depois adicionar ao anúncio.

```
POST https://api.mercadolibre.com/pictures/items/upload
Content-Type: multipart/form-data

file: <binary image data>

Resposta:
{
  "id": "pic_id_123",
  "url": "http://...",
  "secure_url": "https://..."
}
```

**Limites**:
- Máximo 100 imagens por anúncio
- Resolução mínima: 460x460px
- Tamanho máximo: 20MB
- Formatos: JPG, PNG, GIF, BMP

---

## 📊 Atributos e Ficha Técnica

### Atributos Especiais (Dimensões - Read-Only em PUT)
Não podem ser editados via PUT /items/{id}/description. Usar atributos:

```
SELLER_PACKAGE_HEIGHT   → Altura da embalagem (cm)
SELLER_PACKAGE_WIDTH    → Largura da embalagem (cm)
SELLER_PACKAGE_LENGTH   → Comprimento da embalagem (cm)
SELLER_PACKAGE_WEIGHT   → Peso da embalagem (g)
SELLER_PACKAGE_TYPE     → Tipo de embalagem (com/sem embalagem)
```

### PUT /items/{item_id} com Atributos
Atualizar atributos da ficha técnica:

```
PUT https://api.mercadolibre.com/items/MLB1039363055
{
  "attributes": [
    {
      "id": "SELLER_PACKAGE_HEIGHT",
      "value_name": "13.3 cm"
    },
    {
      "id": "SELLER_PACKAGE_WIDTH",
      "value_name": "22.2 cm"
    },
    {
      "id": "COLOR",
      "value_id": "color_id_123"  // ou value_name se não tiver value_id
    }
  ]
}
```

---

## 🚚 Logística (Fulfillment vs Seller)

**Tipos de Logística**:

| Tipo | Sigla | Descrição |
|------|-------|-----------|
| Fulfillment ML | `fulfillment` | ML cuida do armazém, picking, packing, shipping |
| Seller (Próprio) | `self_service` | Vendedor entrega direto |
| Flex | `flex` / `same_day` | ML entrega em até 24h (cidades grandes) |
| Mercado Envios | `meli_carrier` | ML gerencia carrier parceiro |

**Tags de Shipping**:
- `fulfillment` = Usando fulfillment
- `self_service_out` = Opção seller (saída)
- `self_service_in` = Opção seller (entrada)
- `flex` = Mercado Envios Flex disponível
- `standard_price_by_quantity` = Preço por quantidade (atacado)
- `free_shipping` = Frete grátis

---

## 💳 Preços e Promoções

### GET /items/{item_id}/prices
Obter histórico/estrutura de preços.

```
GET https://api.mercadolibre.com/items/MLB1039363055/prices

Resposta:
{
  "prices": [
    {
      "id": "default_purchase_price",
      "type": "DEFAULT",
      "amount": 42.99,
      "currency_id": "BRL"
    }
  ]
}
```

### GET /items/{item_id}/sale_price
Obter preço de venda (pode ser diferente se houver promoção).

```
GET https://api.mercadolibre.com/items/MLB1039363055/sale_price

Resposta:
{
  "amount": 42.99,
  "regular_amount": 49.99,  // Preço original se houver desconto
  "currency_id": "BRL",
  "discount": 14
}
```

---

## 🏷️ Tipos de Anúncio (Listing Types)

### Custos e Limites

| Tipo | Custo | % de Tarifa | Limite | Duração |
|------|-------|------------|--------|---------|
| **Clássico** (gold_special) | R$0 | 12% | Ilimitado | Até vender |
| **Premium** (gold_pro) | R$0 | 17% | Ilimitado | Até vender |
| **Ouro** (gold) | R$0 | 15% | Ilimitado | Até vender |

**Nota**: Não há custo fixo de publicação. A tarifa é percentual sobre o valor de venda.

### Premium vs Clássico
- **Premium**: Mais visibilidade, destaque, melhor conversão
- **Clássico**: Menos visibilidade, custo efetivo maior

---

## ⚠️ Limitações Conhecidas

### 1. **Não é possível editar via API**:
- ❌ Preço por quantidade (atacado) — apenas visualizar tag `standard_price_by_quantity`
- ❌ Mercado Envios Flex — apenas visualizar se ativo
- ❌ Tipo de listing — alterar de Clássico para Premium requer painel web
- ❌ Categorias — não mudar categoria após publicação

### 2. **Atributos obrigatórios por categoria**:
- Algumas categorias exigem atributos específicos (marca, modelo, tamanho, cor)
- Não é possível publicar sem atender aos atributos obrigatórios

### 3. **Imagens**:
- Mínimo de 1, máximo de 100 imagens
- Mínimo 460x460px de resolução
- Primeira imagem é sempre a principal

### 4. **Descrição**:
- Máximo 50.000 caracteres
- Pode ser HTML ou plain text
- Conteúdo é escaneado (não permite certos tipos de conteúdo)

### 5. **Edições simultâneas**:
- Se dois processos editarem o mesmo anúncio ao mesmo tempo, última escrita vence
- Sem lock pessimista

---

## 🔄 Fluxo Recomendado para Edições

```javascript
// ✓ BOM - Usar estrutura de transação local
async function editarAnuncio(itemId, changes) {
  try {
    // 1. Buscar estado atual
    const atual = await ml.obter_anuncio_completo(itemId);
    
    // 2. Mesclar mudanças (não sobrescrever tudo)
    const novo = { ...atual, ...changes };
    
    // 3. Validar antes de enviar
    if (!validar(novo)) throw new Error("Validação falhou");
    
    // 4. Enviar para ML
    const resultado = await ml.atualizar_xxx(itemId, novo);
    
    // 5. Confirmar localmente
    salvarCacheLocal(resultado);
    
    return resultado;
  } catch (e) {
    // Reverter se necessário
    console.error("Falha na edição:", e);
    throw e;
  }
}
```

---

## 📌 Endpoints Implementados no Projeto

```
✓ GET    /api/ml/status                           → ml.status()
✓ GET    /api/ml/anuncios                        → ml.listar_anuncios()
✓ GET    /api/ml/anuncios/{id}                   → ml.obter_anuncio_completo()
✓ GET    /api/ml/precificacao                    → ml.precificacao()
✓ POST   /api/ml/anuncios/{id}/description       → ml.atualizar_descricao()
✓ POST   /api/ml/anuncios/{id}/attributes        → ml.atualizar_atributos()
✓ POST   /api/ml/anuncios/{id}/dimensions        → ml.atualizar_dimensoes()
✓ POST   /api/ml/anuncios/{id}/pictures          → ml.atualizar_imagens()
✓ POST   /api/ml/anuncios/{id}/pictures/upload   → ml.upload_imagem_e_atualizar()

❌ NÃO IMPLEMENTADO (Limitações API)
  - Editar tipo de listing (Clássico → Premium)
  - Editar preço por quantidade
  - Ativar/desativar Flex
  - Editar categoria
```

---

## 🎯 Próximas Features (Baseadas em Docs)

1. **Sincronizar Preços**: Atualizar preço de venda de múltiplos anúncios em lote
2. **Monitorar Estoque**: Webhook para quando anúncio sai/volta do estoque
3. **Histórico de Edições**: Log de quem editou o quê e quando
4. **Bulk Operations**: Atualizar 100+ anúncios em paralelo (respeitando rate limit)
5. **Preço por Quantidade**: Visualizar e calcular margem para atacado (leitura apenas)

---

## 📚 Recursos Adicionais

- **Portal Desenvolvedor**: https://developers.mercadolibre.com
- **Status API**: https://status.mercadolibre.com
- **Comunidade**: Fórum de desenvolvedores do ML
- **Rate Limiting**: Monitor em dashboard ML Developers

---

**Última atualização**: 16/06/2026
**Mantido por**: Auditoria do Projeto Novaes Estoque
