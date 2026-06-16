"""
Integração com o Mercado Livre - API (OAuth2)

Fluxo de token:
- Tokens ficam em ml_token.json (uso único: cada refresh gera novo refresh_token).
- get_access_token() carrega do arquivo e renova automaticamente quando expira.
- Em produção (Railway) ML_DATA_DIR=/data e ML_TOKEN_JSON semeia o token no 1º boot.

Leitura de anúncios:
- /users/{id}/items/search  -> ids dos anúncios (com paginação e filtro de status)
- /items?ids=...            -> detalhes em lote (multiget, até 20 por vez)
"""

import os
import json
import time
import threading
import mimetypes
import uuid
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from dotenv import load_dotenv

load_dotenv()

_BASE_DIR = os.path.abspath(os.path.dirname(__file__))
_DEFAULT_DATA_DIR = os.path.abspath(os.path.join(_BASE_DIR, ".."))
_DATA_DIR = os.path.abspath(os.getenv("ML_DATA_DIR") or _DEFAULT_DATA_DIR)
os.makedirs(_DATA_DIR, exist_ok=True)
TOKEN_FILE = os.path.abspath(os.path.join(_DATA_DIR, "ml_token.json"))
LEGACY_TOKEN_FILE = os.path.abspath(os.path.join(_DEFAULT_DATA_DIR, "ml_token.json"))

# Seed do token em produção (igual padrão Olist)
_token_seed = os.getenv("ML_TOKEN_JSON")
if _token_seed and not os.path.exists(TOKEN_FILE):
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as _f:
            _f.write(_token_seed)
        os.chmod(TOKEN_FILE, 0o600)
        print(f"[ML] Token inicial gravado em {TOKEN_FILE}")
    except Exception as _e:
        print(f"[ML] Falha ao gravar token inicial: {_e}")


# Mapa de tipo de anúncio do ML para nome amigável
LISTING_TYPE_NOME = {
    "gold_pro": "Premium",
    "gold_special": "Clássico",
    "gold_premium": "Premium (antigo)",
    "gold": "Ouro",
    "silver": "Prata",
    "bronze": "Bronze",
    "free": "Grátis",
}
def _term_value(term: Dict[str, Any]) -> str:
    if not isinstance(term, dict):
        return ""
    if term.get("value_name"):
        return str(term["value_name"])
    value_struct = term.get("value_struct") or {}
    number = value_struct.get("number")
    unit = value_struct.get("unit")
    if number is not None:
        return f"{number}{(' ' + unit) if unit else ''}".strip()
    values = term.get("values") or []
    nomes = [str(v.get("name") or "").strip() for v in values if isinstance(v, dict) and (v.get("name") or "").strip()]
    return ", ".join(nomes)


def _parse_dimensions_string(dimensions: str) -> Optional[Dict[str, Any]]:
    if not dimensions or not isinstance(dimensions, str):
        return None
    try:
        medidas, peso = dimensions.split(",", 1)
        altura, largura, comprimento = [float(x.strip()) for x in medidas.split("x")]
        peso_num = float(peso.strip())
        return {
            "altura_cm": altura,
            "largura_cm": largura,
            "comprimento_cm": comprimento,
            "peso_g": peso_num,
            "texto": f"{altura:g} x {largura:g} x {comprimento:g} cm · {peso_num:g} g",
            "origem": "shipping.dimensions",
        }
    except Exception:
        return None


def _parse_dimensions_from_attributes(attributes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    attrs = {str(a.get("id") or ""): a for a in (attributes or []) if isinstance(a, dict)}

    def pick(*ids: str) -> Optional[float]:
        for attr_id in ids:
            attr = attrs.get(attr_id)
            if not attr:
                continue
            value_struct = attr.get("value_struct") or {}
            number = value_struct.get("number")
            if number is not None:
                try:
                    return float(number)
                except (TypeError, ValueError):
                    pass
            value_name = attr.get("value_name")
            if value_name:
                try:
                    return float(str(value_name).replace(",", ".").split()[0])
                except (TypeError, ValueError):
                    pass
        return None

    altura = pick("PACKAGE_HEIGHT", "HEIGHT")
    largura = pick("PACKAGE_WIDTH", "WIDTH")
    comprimento = pick("PACKAGE_LENGTH", "LENGTH")
    peso = pick("PACKAGE_WEIGHT", "WEIGHT")

    if altura is None and largura is None and comprimento is None and peso is None:
        return None

    partes = []
    if altura is not None and largura is not None and comprimento is not None:
        partes.append(f"{altura:g} x {largura:g} x {comprimento:g} cm")
    if peso is not None:
        partes.append(f"{peso:g} g")

    return {
        "altura_cm": altura,
        "largura_cm": largura,
        "comprimento_cm": comprimento,
        "peso_g": peso,
        "texto": " · ".join(partes) if partes else None,
        "origem": "attributes",
    }


class MLIntegration:
    AUTH_URL = "https://auth.mercadolivre.com.br/authorization"
    TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
    API_BASE = "https://api.mercadolibre.com"

    def __init__(self):
        self.client_id = os.getenv("ML_CLIENT_ID", "")
        self.client_secret = os.getenv("ML_CLIENT_SECRET", "")
        self.user_id = os.getenv("ML_USER_ID", "")
        self.redirect_uri = os.getenv("ML_REDIRECT_URI", "")
        self.enabled = bool(self.client_id and self.client_secret)

        self._lock = threading.Lock()
        self._ultima_req = 0.0
        self._intervalo_min = 60.0 / 240.0  # margem sob o limite do ML

    # ---------- rate limit ----------
    def _throttle(self):
        with self._lock:
            espera = self._intervalo_min - (time.monotonic() - self._ultima_req)
            if espera > 0:
                time.sleep(espera)
            self._ultima_req = time.monotonic()

    # ---------- persistência de token ----------
    def _salvar_token(self, dados: Dict):
        try:
            with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                json.dump(dados, f, indent=2)
            os.chmod(TOKEN_FILE, 0o600)
        except Exception as e:
            print(f"[ML] Erro ao salvar token: {e}")

    def _carregar_token(self) -> Optional[Dict]:
        for path in [TOKEN_FILE, LEGACY_TOKEN_FILE]:
            try:
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f:
                        dados = json.load(f)
                    if path != TOKEN_FILE:
                        print(f"[ML] Usando token legado em {path}")
                    return dados
            except Exception as e:
                print(f"[ML] Erro ao carregar token em {path}: {e}")
        return None

    # ---------- OAuth ----------
    def get_authorization_url(self) -> str:
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
        }
        return f"{self.AUTH_URL}?{urllib.parse.urlencode(params)}"

    def _post_token(self, extra: Dict) -> Optional[Dict]:
        data = {"client_id": self.client_id, "client_secret": self.client_secret}
        data.update(extra)
        post = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(
            self.TOKEN_URL, data=post,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                resp = json.loads(r.read().decode("utf-8"))
            if "access_token" in resp:
                dados = {
                    "access_token": resp["access_token"],
                    "refresh_token": resp.get("refresh_token"),
                    "user_id": resp.get("user_id") or self.user_id,
                    "expires_at": (datetime.utcnow() + timedelta(seconds=resp.get("expires_in", 21600))).isoformat(),
                    "obtido_em": datetime.utcnow().isoformat(),
                }
                self._salvar_token(dados)
                return dados
        except urllib.error.HTTPError as e:
            print(f"[ML] Erro token HTTP {e.code}: {e.read().decode()[:200]}")
        except Exception as e:
            print(f"[ML] Erro token: {e}")
        return None

    def trocar_code_por_token(self, code: str) -> bool:
        dados = self._post_token({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
        })
        return dados is not None

    def _renovar_token(self, refresh_token: str) -> Optional[str]:
        print("[ML] Renovando access_token...")
        dados = self._post_token({"grant_type": "refresh_token", "refresh_token": refresh_token})
        if dados:
            print("[ML] Token renovado")
            return dados["access_token"]
        return None

    def get_access_token(self) -> Optional[str]:
        dados = self._carregar_token()
        if not dados:
            return None
        expires_at = dados.get("expires_at")
        if expires_at:
            try:
                if datetime.utcnow() < (datetime.fromisoformat(expires_at) - timedelta(seconds=120)):
                    return dados["access_token"]
            except ValueError:
                pass
        rt = dados.get("refresh_token")
        return self._renovar_token(rt) if rt else None

    def _get(self, path: str, params: Optional[Dict] = None) -> Optional[Dict]:
        token = self.get_access_token()
        if not token:
            return None
        url = f"{self.API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        for tentativa in range(3):
            self._throttle()
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 429 and tentativa < 2:
                    time.sleep(1.5 * (tentativa + 1))
                    continue
                print(f"[ML] GET {path} HTTP {e.code}: {e.read().decode()[:200]}")
                return None
            except Exception as e:
                print(f"[ML] GET {path} erro: {e}")
                return None
        return None

    def _get_json(self, path: str, params: Optional[Dict] = None):
        return self._get(path, params)

    def _request_json(self, method: str, path: str, body: Optional[Dict] = None, params: Optional[Dict] = None) -> Optional[Any]:
        token = self.get_access_token()
        if not token:
            return None
        url = f"{self.API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        payload = None
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=payload, headers=headers, method=method.upper())
        self._throttle()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                raw = ""
            print(f"[ML] {method.upper()} {path} HTTP {e.code}: {raw[:400]}")
            return {"erro": raw or f"HTTP {e.code}", "status_code": e.code}
        except Exception as e:
            print(f"[ML] {method.upper()} {path} erro: {e}")
            return {"erro": str(e), "status_code": 500}

    def _post_multipart(self, path: str, file_name: str, file_bytes: bytes, mime_type: Optional[str] = None, fields: Optional[Dict[str, str]] = None) -> Optional[Any]:
        token = self.get_access_token()
        if not token:
            return None
        boundary = f"----CodexBoundary{uuid.uuid4().hex}"
        mime = mime_type or mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        parts: List[bytes] = []
        for key, value in (fields or {}).items():
            parts.extend([
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ])
        parts.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'.encode("utf-8"),
            f"Content-Type: {mime}\r\n\r\n".encode("utf-8"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ])
        data = b"".join(parts)
        req = urllib.request.Request(
            f"{self.API_BASE}{path}",
            data=data,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        self._throttle()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                raw = ""
            print(f"[ML] POST multipart {path} HTTP {e.code}: {raw[:400]}")
            return {"erro": raw or f"HTTP {e.code}", "status_code": e.code}
        except Exception as e:
            print(f"[ML] POST multipart {path} erro: {e}")
            return {"erro": str(e), "status_code": 500}

    # ---------- status ----------
    def status(self) -> Dict:
        autorizado = self.get_access_token() is not None
        return {
            "credenciais_configuradas": self.enabled,
            "autorizado": autorizado,
            "user_id": self.user_id,
            "status": "OK" if autorizado else ("PRECISA AUTORIZAR" if self.enabled else "SEM CREDENCIAIS"),
            "url_autorizacao": self.get_authorization_url() if (self.enabled and not autorizado) else None,
        }

    # ---------- anúncios ----------
    def _simplificar_item(self, body: Dict) -> Dict:
        attributes = body.get("attributes") or []
        attrs = {a.get("id"): a.get("value_name") for a in attributes}
        sku = body.get("seller_custom_field") or attrs.get("SELLER_SKU") or ""
        shipping = body.get("shipping") or {}
        sale_terms = body.get("sale_terms") or []
        tags = body.get("tags") or []
        pictures = body.get("pictures") or []
        lt = body.get("listing_type_id", "")
        wholesale = None
        for term in sale_terms:
            term_id = str(term.get("id") or "").upper()
            term_name = str(term.get("name") or "").lower()
            if "WHOLESALE" in term_id or "ATACAD" in term_name or "MAYOR" in term_name:
                wholesale = {
                    "id": term.get("id"),
                    "nome": term.get("name"),
                    "valor": _term_value(term),
                }
                break

        dimensions = _parse_dimensions_string(shipping.get("dimensions") or "") or _parse_dimensions_from_attributes(attributes)
        logistica = shipping.get("logistic_type")
        eh_flex = logistica in {"same_day", "self_service"} or any(tag in {"self_service_out", "flex"} for tag in tags)
        eh_full = logistica == "fulfillment" or "fulfillment" in tags

        return {
            "id": body.get("id"),
            "titulo": body.get("title"),
            "sku": sku,
            "preco": body.get("price"),
            "preco_original": body.get("original_price"),
            "moeda": body.get("currency_id"),
            "disponivel": body.get("available_quantity"),
            "vendidos": body.get("sold_quantity"),
            "status": body.get("status"),
            "tipo_anuncio": LISTING_TYPE_NOME.get(lt, lt),
            "tipo_anuncio_id": lt,
            "frete_gratis": bool(shipping.get("free_shipping")),
            "frete_custo": None,
            "logistica": logistica,
            "flex": bool(eh_flex),
            "full": bool(eh_full),
            "preco_atacado": wholesale,
            "imagens_total": len(pictures),
            "imagem_principal": ((pictures[0] or {}).get("secure_url") if pictures else None) or (body.get("thumbnail") or "").replace("http://", "https://"),
            "dimensoes": dimensions,
            "thumbnail": (body.get("thumbnail") or "").replace("http://", "https://"),
            "permalink": body.get("permalink"),
            "categoria_id": body.get("category_id"),
        }

    def _custos_frete_gratis(self, item_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        custos: Dict[str, Dict[str, Any]] = {}
        ids = [str(item_id) for item_id in item_ids if item_id]
        if not ids:
            return custos

        for i in range(0, len(ids), 50):
            lote = ids[i:i + 50]
            res = self._get_json(f"/users/{self.user_id}/shipping_options/free", {"item_id": lote[0], "verbose": "true"}) if len(lote) == 1 else None
            if isinstance(res, list):
                for entry in res:
                    item_id = str(entry.get("id") or "")
                    body = entry.get("body") if isinstance(entry.get("body"), dict) else entry
                    coverage = (body.get("coverage") or {}).get("all_country") or {}
                    if item_id and coverage:
                        custos[item_id] = {
                            "valor": coverage.get("list_cost"),
                            "moeda": coverage.get("currency_id"),
                        }
            elif isinstance(res, dict):
                for item_id, body in res.items():
                    if not isinstance(body, dict):
                        continue
                    coverage = (body.get("coverage") or {}).get("all_country") or {}
                    if coverage:
                        custos[str(item_id)] = {
                            "valor": coverage.get("list_cost"),
                            "moeda": coverage.get("currency_id"),
                        }

        faltantes = [item_id for item_id in ids if item_id not in custos]
        for item_id in faltantes:
            body = self._get_json(f"/users/{self.user_id}/shipping_options/free", {"item_id": item_id, "verbose": "true"})
            if not isinstance(body, dict):
                continue
            coverage = (body.get("coverage") or {}).get("all_country") or {}
            if coverage:
                custos[item_id] = {
                    "valor": coverage.get("list_cost"),
                    "moeda": coverage.get("currency_id"),
                }

        return custos

    def precificacao(self, price: float, category_id: Optional[str] = None) -> Dict:
        """Tarifa de venda real do ML (Clássico=gold_special, Premium=gold_pro) p/ um preço/categoria."""
        params = {"price": price}
        if category_id:
            params["category_id"] = category_id
        data = self._get("/sites/MLB/listing_prices", params)
        out: Dict = {"classico": None, "premium": None}
        for entry in (data or []):
            lt = entry.get("listing_type_id")
            det = entry.get("sale_fee_details") or {}
            info = {
                "percentual": det.get("percentage_fee"),
                "fixo": det.get("fixed_fee", 0),
                "tarifa": entry.get("sale_fee_amount"),
            }
            if lt == "gold_special":
                out["classico"] = info
            elif lt == "gold_pro":
                out["premium"] = info
        return out

    def obter_anuncio(self, item_id: str) -> Optional[Dict]:
        body = self._get(f"/items/{item_id}", {"attributes": "id,title,price,category_id,listing_type_id,seller_custom_field,available_quantity"})
        return self._simplificar_item(body) if body else None

    def obter_anuncio_completo(self, item_id: str) -> Dict:
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anúncio não encontrado"}

        desc = self._get(f"/items/{item_id}/description") or {}
        prices = self._get(f"/items/{item_id}/prices") or {}
        sale_price = self._get(f"/items/{item_id}/sale_price") or {}
        frete = self._get(f"/users/{self.user_id}/shipping_options/free", {"item_id": item_id, "verbose": "true"}) or {}
        zip_code = (((body.get("seller_address") or {}).get("zip_code")) or os.getenv("ML_DEFAULT_ZIP_CODE") or "").strip()
        shipping_options = self._get(f"/items/{item_id}/shipping_options", {"zip_code": zip_code}) if zip_code else None
        precificacao = self.precificacao(float(body.get("price") or 0), body.get("category_id"))

        atributos = []
        for attr in (body.get("attributes") or []):
            atributos.append({
                "id": attr.get("id"),
                "name": attr.get("name"),
                "value_id": attr.get("value_id"),
                "value_name": attr.get("value_name"),
                "value_type": attr.get("value_type"),
            })

        pictures = [{
            "id": pic.get("id"),
            "url": pic.get("secure_url") or pic.get("url"),
        } for pic in (body.get("pictures") or [])]

        tarifa_atual = None
        lt = body.get("listing_type_id")
        if lt == "gold_special":
            tarifa_atual = precificacao.get("classico")
        elif lt == "gold_pro":
            tarifa_atual = precificacao.get("premium")

        recommended_shipping = None
        if isinstance(shipping_options, dict):
            options = shipping_options.get("options") or []
            if options:
                recommended_shipping = options[0]

        item = self._simplificar_item(body)
        item["frete_custo"] = ((frete.get("coverage") or {}).get("all_country") or {}).get("list_cost")
        item["frete_moeda"] = ((frete.get("coverage") or {}).get("all_country") or {}).get("currency_id")

        return {
            "item": item,
            "description": desc,
            "attributes": atributos,
            "pictures": pictures,
            "prices": prices.get("prices") or [],
            "sale_price": sale_price,
            "shipping_fee": (frete.get("coverage") or {}).get("all_country"),
            "shipping_preview": recommended_shipping,
            "shipping_tags": (body.get("shipping") or {}).get("tags") or [],
            "tags": body.get("tags") or [],
            "sale_terms": body.get("sale_terms") or [],
            "tarifa_atual": tarifa_atual,
            "zip_code_usado": zip_code or None,
        }

    B2B_CONTEXT = "channel_marketplace,user_type_business"
    AMOSTRA_QUANTIDADES = [1, 5, 10, 25]

    def _preco_b2b(self, item_id: str, quantidade: int) -> Optional[float]:
        sp = self._get(f"/items/{item_id}/sale_price", {"context": self.B2B_CONTEXT, "quantity": quantidade})
        if isinstance(sp, dict) and sp.get("amount") is not None:
            try:
                return float(sp["amount"])
            except (TypeError, ValueError):
                return None
        return None

    def obter_precos_quantidade(self, item_id: str) -> Dict:
        data = self._get(f"/items/{item_id}/prices")
        if not data:
            return {"erro": "Não foi possível ler os preços do anúncio"}
        prices = data.get("prices") or []
        standard = next((p for p in prices if p.get("type") == "standard"), None)
        amostra = [{"quantidade": q, "amount": self._preco_b2b(item_id, q)} for q in self.AMOSTRA_QUANTIDADES]
        tem_atacado = any(
            a["amount"] is not None and standard and a["amount"] < float(standard.get("amount") or 0) - 0.01
            for a in amostra
        )
        return {
            "standard": ({
                "id": standard.get("id"),
                "amount": standard.get("amount"),
                "currency_id": standard.get("currency_id"),
            } if standard else None),
            "amostra_b2b": amostra,
            "tem_atacado": tem_atacado,
        }

    def salvar_precos_quantidade(self, item_id: str, tiers: List[Dict[str, Any]]) -> Dict:
        data = self._get(f"/items/{item_id}/prices")
        if not data:
            return {"erro": "Não foi possível ler o preço padrão do anúncio"}
        prices = data.get("prices") or []
        standard = next((p for p in prices if p.get("type") == "standard"), None)
        if not standard or not standard.get("id"):
            return {"erro": "Preço padrão não encontrado neste anúncio"}
        currency = standard.get("currency_id") or "BRL"

        payload: List[Dict[str, Any]] = [{"id": standard["id"]}]
        for t in (tiers or [])[:5]:
            amount = t.get("amount")
            mpu = t.get("min_purchase_unit")
            try:
                amount = float(amount)
                mpu = int(mpu)
            except (TypeError, ValueError):
                continue
            if amount <= 0 or mpu <= 1:
                continue
            payload.append({
                "amount": amount,
                "currency_id": currency,
                "conditions": {
                    "context_restrictions": ["channel_marketplace", "user_type_business"],
                    "min_purchase_unit": mpu,
                },
            })

        resp = self._request_json("POST", f"/items/{item_id}/prices/standard/quantity", {"prices": payload})
        if not resp or resp.get("erro"):
            return resp or {"erro": "Falha ao salvar preços por quantidade"}

        pendentes = {int(t["conditions"]["min_purchase_unit"]): float(t["amount"]) for t in payload if t.get("conditions")}
        for tentativa in range(5):
            if not pendentes:
                break
            if tentativa > 0:
                time.sleep(2.0)
            for mpu, esperado in list(pendentes.items()):
                obtido = self._preco_b2b(item_id, mpu)
                if obtido is not None and abs(obtido - esperado) <= 0.01:
                    pendentes.pop(mpu, None)
        if pendentes:
            return {
                "erro": "O Mercado Livre não aplicou as faixas de atacado. Isso costuma acontecer quando o anúncio tem uma promoção/campanha ativa que conflita com preços por quantidade.",
                "aplicado": False,
                "faltando": sorted(pendentes.keys()),
            }
        return {"ok": True, "aplicado": True, "tiers_enviados": len(payload) - 1}

    def atualizar_descricao(self, item_id: str, plain_text: str) -> Dict:
        return self._request_json("PUT", f"/items/{item_id}/description", {"plain_text": plain_text}) or {"erro": "Falha ao atualizar descrição"}

    def _merge_attribute_values(self, current_attrs: List[Dict[str, Any]], updates: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        seen = set()
        for attr in current_attrs:
            attr_id = str(attr.get("id") or "")
            if not attr_id:
                continue
            update = updates.get(attr_id)
            if update:
                value_name = update.get("value_name")
                value_id = update.get("value_id")
                merged.append({"id": attr_id, **({"value_id": value_id} if value_id else {"value_name": value_name})})
            else:
                if attr.get("value_id"):
                    merged.append({"id": attr_id, "value_id": attr.get("value_id")})
                elif attr.get("value_name") is not None:
                    merged.append({"id": attr_id, "value_name": attr.get("value_name")})
            seen.add(attr_id)

        for attr_id, update in updates.items():
            if attr_id in seen:
                continue
            value_name = update.get("value_name")
            value_id = update.get("value_id")
            merged.append({"id": attr_id, **({"value_id": value_id} if value_id else {"value_name": value_name})})
        return merged

    def atualizar_atributos(self, item_id: str, updates: Dict[str, Dict[str, Any]]) -> Dict:
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anúncio não encontrado"}
        attrs = self._merge_attribute_values(body.get("attributes") or [], updates)
        return self._request_json("PUT", f"/items/{item_id}", {"attributes": attrs}) or {"erro": "Falha ao atualizar atributos"}

    @staticmethod
    def _num(texto: Any) -> Optional[float]:
        if texto is None:
            return None
        try:
            return float(str(texto).replace(",", ".").split()[0])
        except (ValueError, IndexError):
            return None

    def atualizar_dimensoes(self, item_id: str, largura_cm: str, altura_cm: str, comprimento_cm: str, peso_g: str, package_type: str) -> Dict:
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "AnÃºncio nÃ£o encontrado"}

        logistic = (body.get("shipping") or {}).get("logistic_type")
        if logistic == "fulfillment":
            return {
                "erro": "Dimensões controladas pelo Mercado Livre (Full). O galpão mede o produto fisicamente e a alteração não é aplicada.",
                "locked": True,
                "logistic_type": logistic,
            }

        updates = {
            "SELLER_PACKAGE_WIDTH": {"value_name": f"{largura_cm} cm"},
            "SELLER_PACKAGE_HEIGHT": {"value_name": f"{altura_cm} cm"},
            "SELLER_PACKAGE_LENGTH": {"value_name": f"{comprimento_cm} cm"},
            "SELLER_PACKAGE_WEIGHT": {"value_name": f"{peso_g} g"},
            "SELLER_PACKAGE_TYPE": {"value_name": package_type},
        }
        attrs = self._merge_attribute_values(body.get("attributes") or [], updates)
        resp = self._request_json("PUT", f"/items/{item_id}", {"attributes": attrs})
        if not resp or resp.get("erro"):
            return resp or {"erro": "Falha ao atualizar dimensões"}

        confere = self._get(f"/items/{item_id}", {"attributes": "attributes"}) or {}
        atuais = {a.get("id"): a.get("value_name") for a in (confere.get("attributes") or [])}
        esperado = {
            "SELLER_PACKAGE_WIDTH": self._num(largura_cm),
            "SELLER_PACKAGE_HEIGHT": self._num(altura_cm),
            "SELLER_PACKAGE_LENGTH": self._num(comprimento_cm),
            "SELLER_PACKAGE_WEIGHT": self._num(peso_g),
        }
        aplicado = all(self._num(atuais.get(k)) == v for k, v in esperado.items() if v is not None)
        if not aplicado:
            return {
                "erro": "O Mercado Livre não aplicou as dimensões neste anúncio (a logística pode estar travando a edição).",
                "aplicado": False,
                "logistic_type": logistic,
            }
        return {"ok": True, "aplicado": True, "logistic_type": logistic}

    def atualizar_imagens(self, item_id: str, pictures: List[Dict[str, str]]) -> Dict:
        payload = []
        for picture in pictures:
            if picture.get("id"):
                payload.append({"id": picture["id"]})
            elif picture.get("source"):
                payload.append({"source": picture["source"]})
        return self._request_json("PUT", f"/items/{item_id}", {"pictures": payload}) or {"erro": "Falha ao atualizar imagens"}

    def upload_imagem_e_atualizar(self, item_id: str, files: List[Dict[str, Any]], existing_picture_ids: List[str]) -> Dict:
        uploaded = []
        for file in files:
            resp = self._post_multipart("/pictures/items/upload", file["name"], file["bytes"], file.get("mime"))
            if not isinstance(resp, dict) or resp.get("erro"):
                return resp or {"erro": f"Falha no upload de {file['name']}"}
            source = resp.get("secure_url") or resp.get("url")
            if source:
                uploaded.append({"source": source})
        final_pictures = [{"id": pic_id} for pic_id in existing_picture_ids if pic_id] + uploaded
        result = self.atualizar_imagens(item_id, final_pictures)
        result["uploaded"] = uploaded
        return result

    def listar_anuncios(self, status: str = "active", offset: int = 0, limit: int = 50) -> Dict:
        """Lista anúncios do vendedor (uma página). status: active|paused|closed|under_review."""
        if not self.user_id:
            return {"erro": "ML_USER_ID não configurado", "anuncios": [], "total": 0}

        params = {"offset": offset, "limit": min(limit, 100)}
        if status and status != "todos":
            params["status"] = status
        busca = self._get(f"/users/{self.user_id}/items/search", params)
        if busca is None:
            return {"erro": "Falha ao consultar o Mercado Livre (token/conexão)", "anuncios": [], "total": 0}

        ids = busca.get("results", [])
        total = (busca.get("paging") or {}).get("total", len(ids))

        anuncios: List[Dict] = []
        # multiget em lotes de 20
        atributos = "id,title,price,original_price,currency_id,available_quantity,sold_quantity,status,listing_type_id,seller_custom_field,attributes,shipping,thumbnail,permalink,category_id,pictures,sale_terms,tags"
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": atributos})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    anuncios.append(self._simplificar_item(entry["body"]))

        custos_frete = self._custos_frete_gratis([a["id"] for a in anuncios if a.get("frete_gratis")])
        for anuncio in anuncios:
            frete = custos_frete.get(str(anuncio.get("id")))
            if frete:
                anuncio["frete_custo"] = frete.get("valor")
                anuncio["frete_moeda"] = frete.get("moeda")

        return {"total": total, "offset": offset, "limit": limit, "anuncios": anuncios}


ml = MLIntegration()
