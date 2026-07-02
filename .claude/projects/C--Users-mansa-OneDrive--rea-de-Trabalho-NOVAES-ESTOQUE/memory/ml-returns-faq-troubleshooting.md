# Mercado Livre Returns & Claims - FAQ & Troubleshooting

Perguntas frequentes e soluções para problemas comuns.

---

## FAQ - Perguntas Frequentes

### P: Qual a diferença entre Return e Claim?

**R:** Conceitual:
- **Return (Devolução)**: Comprador quer devolver o produto (quebrado, arrependimento)
- **Claim (Reclamação)**: Comprador reclama que algo saiu errado (não recebeu, chegou errado)

Na prática no ML:
- **Return**: Fluxo de logística reversa (comprador envia de volta)
- **Claim**: Disputa/mediação formal que pode resultar em reembolso sem devolução

Ambos impactam sua reputação no ML.

---

### P: Como posso resolver uma devolução rapidamente?

**R:** Priorize por status:

1. **pending_acceptance** → Aprove rapidamente (status → "accepted")
2. **awaiting_receipt** → Prepare recebimento no endereço de retorno
3. **receipt_confirmed** → Confirme estado do produto
4. **Após confirmar** → Processe reembolso

Dica: ML oferece um endereço de retorno único por região. Integre-o ao seu sistema logístico.

---

### P: Posso rejeitar uma devolução?

**R:** Sim, mas cuidado. Opções:

```json
POST /returns/{id}
{
  "status": "rejected",
  "reason": "Fora do período de devolução"
}
```

**Consequências:**
- Comprador pode abrir **Claim**
- Sua reputação (seller metrics) piora
- ML pode arbitar a seu desfavor

**Use apenas quando legítimo** (produto não é de você, comprador não qualificado, etc).

---

### P: Uma reclamação está perto de expirar. O que faço?

**R:** Checklist de urgência:

1. **Tempo restante < 24h?** → Alertar operador imediatamente
2. **Tentar resolver com mensagem** → `POST /claims/{id}/messages`
3. **Pode enviar reembolso preventivo?** → `POST /claims/{id}/refund`
4. **Enviar desconto em próxima compra?** → Ofertar via mensagem
5. **Se não responder a tempo** → ML arbitra contra você

---

### P: Como reduzir devoluções/reclamações?

**R:** Estratégia operacional:

1. **Descrições precisas** - Fotos de todos ângulos, medidas, peso
2. **Estoque alertado** - Não vender fora do real
3. **Packaging reforçado** - Reduz danos em trânsito
4. **Alertas de rastreamento** - Monitorar entregas problemáticas
5. **Responder rápido** - <2h para claims abertas
6. **Oferta pós-compra** - Contato 3 dias após entrega

---

### P: Posso sincronizar devoluções em tempo real (webhooks)?

**R:** Sim, mas com cuidado:

**Webhooks do ML:**
- `orders/order.return_request` - Devolução solicitada
- `orders/order.claim_opened` - Reclamação aberta
- Entregues em HTTP POST para sua URL

**Implementar:**
1. Configurar URL webhook em Seller Center
2. Sua URL deve responder `200 OK` em <3 segundos
3. Salvar webhook em banco de dados
4. Disparar sincronização completa em background job
5. Não confiar 100% em webhook (redundância: polling a cada 5min)

---

### P: Qual o prazo de prescrição de uma devolução/claim?

**R:** Depende do motivo:

| Motivo | Prazo |
|--------|-------|
| Produto com defeito | 30 dias após entrega |
| Não recebeu | Até 180 dias |
| Chegou errado | 30 dias após entrega |
| Qualidade | 30 dias após entrega |

**Após prazo expirar:**
- Claim é `closed` (mais nenhuma ação)
- Operador pode ver no histórico mas não pode responder

---

### P: Como integrar com meu sistema de estoque?

**R:** Fluxo recomendado:

```
GET /returns (status=completed)
  ↓
Decrementa estoque?
  ├─ NÃO (retorno em análise) → Bloqueia quantidade
  └─ SIM (reembolsado) → Remove do estoque real
  
GET /claims (status=resolved)
  ↓
Montar relatório de perdas
```

**SQL exemplo:**
```sql
SELECT 
  r.sku,
  SUM(r.quantity) as qtd_devolvida,
  SUM(r.refund_amount) as valor_reembolso
FROM ml_returns r
WHERE r.status = 'completed'
  AND r.refund_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY r.sku
ORDER BY valor_reembolso DESC;
```

---

## Troubleshooting

### Problema: "401 Unauthorized - Token inválido"

**Causas:**
1. Token expirado (verificar `expires_at` em `ml_token.json`)
2. Token foi renovado em outra thread (refresh_token único)
3. Credenciais incorretas (client_id/client_secret)

**Solução:**
```python
# 1. Verificar arquivo de token
cat backend/ml_token.json  # Existe? Está válido?

# 2. Se expirado, forçar refresh
# Deletar ml_token.json e fazer login novamente via /api/ml/conectar

# 3. Se lock de token, aguardar 5 segundos
# O sistema tem lock para evitar refresh concorrente
```

---

### Problema: "404 Not Found - return_id não existe"

**Causas:**
1. ID de devolução está errado
2. Devolução é de outro vendedor (você não tem acesso)
3. Devolução foi deletada (rara)

**Solução:**
```bash
# Verificar se return_id está no seu banco
SELECT * FROM ml_returns WHERE return_id = 'ABC123';

# Se vazio, sincronizar manualmente
POST /api/ml/sync/returns

# Verificar seller_id
SELECT DISTINCT seller_id FROM ml_returns LIMIT 1;
```

---

### Problema: "429 Too Many Requests"

**Causas:**
1. Muitas requisições em curto tempo
2. Polling muito frequente (<100ms)
3. Múltiplas threads fazendo sync simultâneas

**Solução:**
```python
# Implementar backoff exponencial
import time

def retry_with_backoff(func, max_attempts=3):
    for attempt in range(max_attempts):
        try:
            return func()
        except HTTPError as e:
            if e.code == 429 and attempt < max_attempts - 1:
                wait = 1.5 ** (attempt + 1)  # 1.5s, 2.25s, 3.375s
                print(f"Rate limit. Aguardando {wait}s")
                time.sleep(wait)
            else:
                raise

# Usar no polling job
retry_with_backoff(lambda: manager.sync_returns(db))
```

---

### Problema: "Webhook não está chegando"

**Causas:**
1. Configuração incorreta em Seller Center
2. Sua URL não está acessível (firewall)
3. Sua URL não responde em <3 segundos
4. SSL certificate inválido

**Solução:**
```python
# 1. Testar endpoint manualmente
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"topic":"test","data":{}}' \
  https://seu-dominio.com/webhook/mercadolivre

# 2. Verificar logs de resposta
# Webhook deve retornar 200 OK rapidamente

# 3. Adicionar logging
@app.post("/webhook/mercadolivre")
async def webhook(request: Request):
    body = await request.json()
    print(f"[Webhook] Recebido: {body['topic']}")
    
    # Processar em background (não no webhook)
    background_tasks.add_task(process_webhook, body)
    
    return {"status": "received"}  # Responder rápido!

# 4. Configurar em Seller Center
# Integração → Webhooks → Adicionar
# URL: https://seu-dominio.com/webhook/mercadolivre
# Tópicos: orders/order.return_request, orders/order.claim_opened
```

---

### Problema: "Devoluções sincronizam mas Claims não aparecem"

**Causas:**
1. Job de claims não está rodando
2. Filtro de status está muito restritivo
3. Nenhuma claim aberta no seu vendedor

**Solução:**
```python
# 1. Verificar se job está ativo
SELECT * FROM apscheduler_jobs WHERE id LIKE '%claims%';

# 2. Verificar logs de sincronização
tail -f /var/log/app.log | grep "Claims"

# 3. Forçar sync manual
POST /api/ml/sync/claims

# 4. Listar claims com todos os status
GET /api/ml/claims?status=opened
GET /api/ml/claims?status=under_review
GET /api/ml/claims?status=in_mediation

# Se nenhuma aparecer, não há claims abertas
```

---

### Problema: "Refund processado mas cliente ainda não recebeu"

**Causas:**
1. Reembolso em processamento (pode levar 3-5 dias)
2. Método de pagamento não aceita crédito (ex: boleto)
3. Reembolso para conta bancária errada

**Solução:**
```bash
# 1. Verificar status em GET /returns/{id}
curl -H "Authorization: Bearer TOKEN" \
  "https://api.mercadolivre.com.br/returns/ABC123"

# Verificar refund_date e status

# 2. Deixar claro ao cliente
# Adicionar mensagem em:
POST /returns/{id}/messages ou
POST /claims/{id}/messages

Mensagem: "Reembolso aprovado. Pode levar 3-5 dias bancários para chegar."
```

---

### Problema: "Imagem de devolução não carrega"

**Causas:**
1. URL de imagem expirada (válida por ~24h)
2. Comprador deletou foto

**Solução:**
```python
# Cachear imagens localmente
import urllib.request
from datetime import datetime

def save_return_image(return_id, image_url, local_dir="./uploads/returns"):
    try:
        filename = f"{return_id}_{datetime.now().timestamp()}.jpg"
        filepath = os.path.join(local_dir, filename)
        urllib.request.urlretrieve(image_url, filepath)
        return filepath
    except Exception as e:
        print(f"Erro ao salvar imagem: {e}")
        return None

# Chamar quando sincronizar returns
for ret in returns:
    for img_url in ret.get("images", []):
        save_return_image(ret["id"], img_url)
```

---

### Problema: "Claim já resolvida mas operador tenta responder"

**Causas:**
1. Status é `resolved` ou `closed`
2. Prazo de resposta expirou
3. Mediação do ML finalizou

**Solução:**
```python
# Bloquear resposta se status não é respondível
RESPONDABLE_STATUSES = ["opened", "acknowledged", "under_review"]

def pode_responder_claim(claim_status):
    return claim_status in RESPONDABLE_STATUSES

if not pode_responder_claim(claim["status"]):
    return {"error": "Claim não pode ser respondida (status: {})".format(claim["status"])}
```

---

## Performance & Otimizações

### 1. Reduzir Latência de Sincronização

```python
# ❌ Lento: sync sequencial por status
for status in ["opened", "acknowledged", "under_review", "in_mediation"]:
    response = api.get(f"/claims?status={status}")  # 4 × latência

# ✅ Rápido: paralelo
from concurrent.futures import ThreadPoolExecutor

def fetch_claims_by_status(status):
    return api.get(f"/claims?status={status}")

with ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(fetch_claims_by_status, statuses))
```

### 2. Cachear Últimas Sincronizações

```python
# ✅ Usar timestamps de última sincronização
# Ao invés de refetch tudo, usar created_from/created_to

last_sync = db.query(MercadoLivreSyncState).filter_by(scope="returns").first()
params = {
    "created_from": last_sync.last_updated,
    "created_to": datetime.utcnow().isoformat()
}
response = api.get("/returns", params)
```

### 3. Paginação Eficiente

```python
# ✅ Iterar com offset
for offset in range(0, total, limit):
    response = api.get("/returns", {"offset": offset, "limit": 100})
    # processar response["results"]
    if len(response["results"]) < limit:
        break
```

---

## Monitores Recomendados

```sql
-- 1. Devoluções aguardando confirmação
SELECT 
  return_id, 
  title, 
  status,
  DATE_SUB(NOW(), INTERVAL 5 DAY) as dias_desde_criacao
FROM ml_returns
WHERE status IN ("accepted", "awaiting_receipt")
  AND created_at < DATE_SUB(NOW(), INTERVAL 5 DAY)
ORDER BY created_at ASC;

-- 2. Claims expirando em <24h
SELECT 
  claim_id, 
  title, 
  status,
  TIMEDIFF(expiration_date, NOW()) as tempo_restante
FROM ml_claims
WHERE TIMEDIFF(expiration_date, NOW()) < '24:00:00'
  AND status IN ("opened", "acknowledged")
ORDER BY expiration_date ASC;

-- 3. Taxa de devolução por SKU
SELECT 
  sku,
  COUNT(*) as total_devolvidas,
  ROUND(COUNT(*) / total_vendidas * 100, 2) as taxa_percentual
FROM ml_returns r
GROUP BY sku
ORDER BY taxa_percentual DESC
LIMIT 10;

-- 4. Valor total de reembolsos (últimos 30 dias)
SELECT 
  DATE(refund_date) as data,
  COUNT(*) as qtd,
  SUM(refund_amount) as total
FROM ml_returns
WHERE refund_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  AND status = "completed"
GROUP BY DATE(refund_date)
ORDER BY data DESC;
```

---

## Roadmap de Implementação

**Fase 1 (MVP):**
- [ ] Sincronização básica de returns/claims
- [ ] Alerts quando claim expira em <24h
- [ ] Endpoint para confirmar recebimento

**Fase 2 (Core):**
- [ ] Webhooks em Seller Center
- [ ] Resposta automática via IA (análise de claim)
- [ ] Dashboard de métricas

**Fase 3 (Avançado):**
- [ ] Previsão de devolução por SKU (ML)
- [ ] Automação de reembolso (regras)
- [ ] Integração com logística de retorno

---

## Recursos Adicionais

| Recurso | Link |
|---------|------|
| Documentação ML | https://developers.mercadolibre.com (requer login) |
| Seller Center | https://sellercentral.mercadolivre.com.br |
| API Docs (PDF) | Disponível em Seller Center → Integrações |
| Stack Overflow (ML) | Tag: `mercado-livre-api` |
| Fórum Oficial | https://forumlibres.mercadolibre.com.br |
