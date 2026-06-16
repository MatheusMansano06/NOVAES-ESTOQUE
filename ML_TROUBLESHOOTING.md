# 🔧 Troubleshooting - Problemas Comuns & Soluções

**API Mercado Livre** | **Data**: 16/06/2026

---

## 🔐 Problemas de Autenticação

### Erro: "invalid_grant"
```
POST /oauth/token retorna:
{
  "error": "invalid_grant",
  "error_description": "invalid authorization code"
}
```

**Causas**:
1. `code` expirou (válido por ~10 minutos)
2. `code` já foi usado antes (tokens de uso único!)
3. `redirect_uri` não corresponde ao registrado
4. `client_id` ou `client_secret` incorretos

**Solução**:
```python
# ✓ BOM: Gerar novo code se expirado
try:
    token = trocar_code_por_token(code)
except InvalidGrantError:
    print("Código expirado, redirecionar para autorização de novo")
    return redirect(ml.get_authorization_url())
```

---

### Erro: "Unauthorized" (HTTP 401)
```
GET /items/123 retorna:
HTTP 401 Unauthorized
```

**Causas**:
1. `access_token` expirou
2. `access_token` é inválido (não foi trocado corretamente)
3. Token foi revogado pelo usuário
4. Header `Authorization` ausente ou malformado

**Solução**:
```python
# ✓ Implementado em integracoes_ml.py
def get_access_token(self) -> Optional[str]:
    dados = self._carregar_token()
    if not dados:
        return None
    
    # Checar se expirou
    expires_at = dados.get("expires_at")
    if expires_at:
        try:
            if datetime.utcnow() < (datetime.fromisoformat(expires_at) - timedelta(seconds=120)):
                return dados["access_token"]  # Ainda válido
        except ValueError:
            pass
    
    # Token expirou, renovar
    rt = dados.get("refresh_token")
    return self._renovar_token(rt) if rt else None
```

**Importante**: Não aguardar expiração exata. Renovar 2 minutos antes (`- timedelta(seconds=120)`).

---

### Erro: "refresh_token inválido"
```
POST /oauth/token com grant_type=refresh_token retorna:
{
  "error": "invalid_grant",
  "error_description": "refresh token expired"
}
```

**Causas**:
1. Refresh token expirou (válido por ~6 meses)
2. Refresh token foi usado 2x (tokens são de uso único!)
3. Novo refresh token não foi salvo

**Solução**:
```python
# ⚠️ CRÍTICO: Sempre salvar novo refresh_token
def _renovar_token(self, refresh_token: str) -> Optional[str]:
    dados = self._post_token({"grant_type": "refresh_token", "refresh_token": refresh_token})
    if dados:
        self._salvar_token(dados)  # ← Salvar NOVOS dados com novo refresh_token
        return dados["access_token"]
    return None

# Em _post_token:
def _post_token(self, extra: Dict) -> Optional[Dict]:
    # ...
    if "access_token" in resp:
        dados = {
            "access_token": resp["access_token"],
            "refresh_token": resp.get("refresh_token"),  # ← Novo token!
            "user_id": resp.get("user_id") or self.user_id,
            "expires_at": (datetime.utcnow() + timedelta(seconds=resp.get("expires_in", 21600))).isoformat(),
        }
        self._salvar_token(dados)  # ← Persistir imediatamente
        return dados
```

---

## 🚦 Rate Limiting & Throttling

### Erro: HTTP 429 "Too Many Requests"
```
GET /items/123 retorna:
HTTP 429 Too Many Requests
{
  "message": "You have exceeded the rate limit."
}
```

**Causa**: Ultrapassou 240 requisições/minuto

**Solução**:
```python
# ✓ Implementado em integracoes_ml.py
def _throttle(self):
    with self._lock:
        espera = self._intervalo_min - (time.monotonic() - self._ultima_req)
        if espera > 0:
            time.sleep(espera)  # Aguardar antes de requisitar
        self._ultima_req = time.monotonic()

# Retry automático:
for tentativa in range(3):
    self._throttle()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429 and tentativa < 2:
            time.sleep(1.5 * (tentativa + 1))  # Backoff exponencial
            continue
```

**Prevenção**:
- Cálculo: 60s / 240 req = 250ms por requisição
- Implementar fila de processamento para múltiplas requisições
- Monitorar e alertar se taxa exceder 200 req/min

---

### Como Monitorar Rate Limit

```python
# Adicionar logging
import logging
logger = logging.getLogger("ml_api")

class MLIntegration:
    def _throttle(self):
        with self._lock:
            espera = self._intervalo_min - (time.monotonic() - self._ultima_req)
            if espera > 0:
                logger.debug(f"Throttle: aguardando {espera:.2f}s")
                time.sleep(espera)
            self._ultima_req = time.monotonic()

# Dashboard simples
GET /api/ml/rate-limit-status
{
  "requisicoes_minuto": 145,
  "limite": 240,
  "percentual_uso": 60.4,
  "tempo_reset": "2026-06-16T09:05:00Z",
  "proximas_requisicoes_permitidas": 95
}
```

---

## 📦 Problemas de Dados de Anúncios

### Erro: "item not found" (HTTP 404)
```
GET /items/MLB9999999 retorna:
HTTP 404 Not Found
```

**Causas**:
1. Item ID inválido
2. Anúncio foi deletado
3. Anúncio pertence a outro vendedor (user_id diferente)
4. Anúncio foi suspenso

**Solução**:
```python
# Validar antes de usar
def obter_anuncio(self, item_id: str) -> Optional[Dict]:
    if not item_id or not str(item_id).startswith("MLB"):
        return None
    
    try:
        return self._get(f"/items/{item_id}")
    except HTTPError as e:
        if e.code == 404:
            logger.warning(f"Item não encontrado: {item_id}")
            return None
        raise
```

---

### Erro: Atributos vazios ou inconsistentes
```
GET /items/MLB123
{
  "attributes": [
    {
      "id": "PACKAGE_HEIGHT",
      "value_name": null,           # ← Vazio!
      "value_id": null
    }
  ]
}
```

**Causa**: Dimensão não foi definida no anúncio original

**Solução**:
```python
# ✓ Parse defensivo implementado em integracoes_ml.py
def _parse_dimensions_from_attributes(attributes: List[Dict]) -> Optional[Dict]:
    attrs = {str(a.get("id") or ""): a for a in (attributes or [])}
    
    # Tentar múltiplas alternativas
    altura = pick("PACKAGE_HEIGHT", "HEIGHT")
    largura = pick("PACKAGE_WIDTH", "WIDTH")
    comprimento = pick("PACKAGE_LENGTH", "LENGTH")
    peso = pick("PACKAGE_WEIGHT", "WEIGHT")
    
    # Retornar apenas se encontrou algo
    if altura is None and largura is None and comprimento is None and peso is None:
        return None  # Sem dados válidos
    
    return { "altura_cm": altura, ... }
```

---

### Erro: Shipping.dimensions formato estranho
```
{
  "shipping": {
    "dimensions": "13.3x22.2x29.8,130"  # ← String!
  }
}
```

**Causa**: Formato legado ou variação regional

**Solução**:
```python
def _parse_dimensions_string(dimensions: str) -> Optional[Dict]:
    if not dimensions or not isinstance(dimensions, str):
        return None
    
    try:
        # Esperado: "13.3x22.2x29.8,130" → altura x largura x comprimento, peso
        medidas, peso = dimensions.split(",", 1)
        altura, largura, comprimento = [float(x.strip()) for x in medidas.split("x")]
        peso_num = float(peso.strip())
        
        return {
            "altura_cm": altura,
            "largura_cm": largura,
            "comprimento_cm": comprimento,
            "peso_g": peso_num,
        }
    except (ValueError, IndexError):
        return None  # Formato inválido, ignorar
```

---

## 💰 Problemas de Precificação

### Erro: Categoria não encontrada para tarifa
```
GET /sites/MLB/listing_prices?price=42.99&category_id=MLB99999
{
  "error": "category_id not found"
}
```

**Causa**: `category_id` inválido ou não existe

**Solução**:
```python
def precificacao(self, price: float, category_id: Optional[str] = None) -> Dict:
    if not category_id:
        # Retornar tarifa padrão
        return {
            "classico": {"percentual": 14, "fixo": 6.75},
            "premium": {"percentual": 17, "fixo": 0}
        }
    
    try:
        data = self._get("/sites/MLB/listing_prices", {"price": price, "category_id": category_id})
        # ... processar data ...
    except Exception as e:
        logger.warning(f"Falha ao buscar tarifa para {category_id}: {e}")
        # Retornar padrão como fallback
        return self.precificacao(price, None)
```

---

### Tarifa inconsistente com a documentação
```
Esperado: 42.99 * 0.12 = 5.16
Obtido: 5.15
```

**Causa**: Arredondamento diferente na API

**Solução**:
```python
# Usar exatamente o valor retornado pela API, não recalcular
response = ml.precificacao(42.99, "MLB46678")
# {
#   "classico": {
#     "percentual": 12,
#     "fixo": 0,
#     "tarifa": 5.16  # ← Usar este valor, não recalcular!
#   }
# }
```

---

## 🖼️ Problemas com Imagens

### Erro: "invalid image" ao fazer upload
```
POST /pictures/items/upload
Response: HTTP 400 Bad Request
{
  "error": "invalid_image_format"
}
```

**Causas**:
1. Formato não suportado (não é JPG, PNG, GIF, BMP)
2. Resolução < 460x460px
3. Arquivo corrompido
4. Tamanho > 20MB

**Solução**:
```python
def _post_multipart(self, path: str, file_name: str, file_bytes: bytes, 
                    mime_type: Optional[str] = None) -> Optional[Any]:
    # Validar ANTES de enviar
    if not self._validar_imagem(file_bytes, file_name):
        return {"erro": "Imagem inválida"}
    
    # ... proceed com upload ...

def _validar_imagem(self, file_bytes: bytes, file_name: str) -> bool:
    # Validar tamanho
    if len(file_bytes) > 20 * 1024 * 1024:  # 20MB
        return False
    
    # Validar extensão
    ext = file_name.split(".")[-1].lower()
    if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
        return False
    
    # Validar dimensões (requer PIL/Pillow)
    try:
        from PIL import Image
        from io import BytesIO
        img = Image.open(BytesIO(file_bytes))
        if img.width < 460 or img.height < 460:
            return False
    except:
        pass  # Não conseguiu validar, assumir ok
    
    return True
```

---

### Imagem não aparece após upload
```
POST /pictures/items/upload → Sucesso
PUT /items/{id} com pictures → Sucesso
Mas imagem não aparece no anúncio
```

**Causa**: Imagem aguardando aprovação por conteúdo (spam filter)

**Solução**:
- Aguardar 5-10 minutos
- Se não aparecer, verificar se a imagem tem conteúdo proibido (watermarks, logos, telefones)

---

## 📝 Problemas com Descrição

### Erro: "HTML/content validation failed"
```
PUT /items/{id}/description
Response: HTTP 400
{
  "error": "content_validation_failed",
  "details": "forbidden_content_detected"
}
```

**Conteúdos Proibidos**:
- Telefones/WhatsApp como texto
- Links externos (exceto URLs de imagens)
- Conteúdo adulto
- Fake reviews/testimonials

**Solução**:
```python
def atualizar_descricao(self, item_id: str, plain_text: str) -> Dict:
    # Sanitizar antes de enviar
    texto_limpo = self._sanitizar_descricao(plain_text)
    
    return self._request_json("PUT", f"/items/{item_id}/description", 
                             {"plain_text": texto_limpo})

def _sanitizar_descricao(self, texto: str) -> str:
    import re
    
    # Remover padrões de telefone
    texto = re.sub(r'\(?\d{2}\)?\s?\d{4,5}-?\d{4}', '', texto)
    
    # Remover WhatsApp
    texto = re.sub(r'[wW]hats[aA]pp', '', texto)
    
    # Remover URLs (exceto jpg/png)
    texto = re.sub(r'https?://(?!.*\.(?:jpg|png|jpeg))\S+', '', texto)
    
    return texto.strip()
```

---

## 🔄 Problemas de Sincronização

### Erro: "Dados desincronizados entre local e ML"
```
Seu BD: preço R$50
ML: preço R$45

Qual é a fonte da verdade?
```

**Regra**: **Sempre ML é a fonte da verdade**

```python
# ✓ BOM: Buscar do ML antes de qualquer operação crítica
async def precificar_anuncio(item_id: str, novo_preco: float):
    # 1. Buscar estado ATUAL do ML
    atual = await ml.obter_anuncio_completo(item_id)
    
    # 2. Verificar se alguém já alterou
    if atual["item"]["preco"] != cache_local["preco"]:
        return {
            "erro": "Anúncio foi alterado externamente",
            "preco_atual_ml": atual["item"]["preco"],
            "seu_preco_local": cache_local["preco"]
        }
    
    # 3. Atualizar no ML
    resultado = await ml.atualizar_preco(item_id, novo_preco)
    
    # 4. Sincronizar cache local
    cache_local.update(resultado)
    
    return resultado
```

---

### Erro: "Edições perdidas" em ambiente com múltiplos workers
```
Worker A: atualiza descrição
Worker B: atualiza preço

Resultado: Uma das edições é perdida
```

**Causa**: Não há lock pessimista na API ML. Última escrita vence.

**Solução**: Implementar transação otimista
```python
# ✓ BOM: Usar versionamento
class AnuncioCache:
    def __init__(self):
        self.versao = 0
        self.dados = {}
    
    def atualizar(self, novos_dados: Dict) -> bool:
        self.versao += 1
        self.dados = novos_dados
        return True

async def atualizar_anuncio_safe(item_id: str, mudancas: Dict):
    cache = cache_global[item_id]
    versao_anterior = cache.versao
    
    # Buscar do ML
    atual = await ml.obter_anuncio(item_id)
    
    # Se foi alterado externamente, desistir
    if cache.versao != versao_anterior:
        return {"erro": "Conflito: anúncio foi alterado por outro processo"}
    
    # Mesclar mudanças
    novo = {**atual, **mudancas}
    
    # Enviar para ML
    resultado = await ml.atualizar_anuncio(item_id, novo)
    
    # Atualizar cache
    cache.atualizar(resultado)
    
    return resultado
```

---

## 🆘 Problemas Comuns Não Óbvios

### "Por que alguns atributos voltam vazios?"
**Resposta**: Nem todos os atributos são preenchidos por padrão. Alguns são opcionais por categoria.

```python
# ✓ Sempre fazer check
def obter_atributo_safe(attributes, id):
    attr = next((a for a in attributes if a["id"] == id), None)
    return attr.get("value_name") or attr.get("value_id") if attr else None
```

### "Por que o preço não atualiza imediatamente?"
**Resposta**: ML tem cache que pode levar até 15 minutos para atualizar em buscas.

### "Por que não consigo atualizar a categoria?"
**Resposta**: ML não permite alterar categoria após publicação inicial. É uma restrição de design.

---

## 📞 Checklist de Debug

Quando algo não funciona:

- [ ] Verificar logs (backend + frontend)
- [ ] Testar endpoint com curl/Postman
- [ ] Validar token (ainda válido?)
- [ ] Checar rate limit (não ultrapassou 240 req/min?)
- [ ] Verificar se dados vêm do ML (não são do cache local desatualizado)
- [ ] Validar formato de resposta (estrutura mudou?)
- [ ] Testar com outro item_id (problema específico do item?)
- [ ] Consultar status em https://status.mercadolibre.com (API em maintenance?)

---

**Última atualização**: 16/06/2026 | **Mantido por**: Equipe Novaes Estoque
