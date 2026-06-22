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
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from database import SessionLocal
from app.models import MercadoLivreItemCache, MercadoLivreSyncState

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
    LIST_CACHE_TTL_SECONDS = int(os.getenv("ML_LIST_CACHE_TTL_SECONDS", "300"))
    DETAIL_CACHE_TTL_SECONDS = int(os.getenv("ML_DETAIL_CACHE_TTL_SECONDS", "900"))

    def __init__(self):
        self.client_id = os.getenv("ML_CLIENT_ID", "")
        self.client_secret = os.getenv("ML_CLIENT_SECRET", "")
        self.user_id = os.getenv("ML_USER_ID", "")
        self.redirect_uri = os.getenv("ML_REDIRECT_URI", "")
        self.enabled = bool(self.client_id and self.client_secret)

        self._lock = threading.Lock()
        self._catalog_sync_lock = threading.Lock()
        self._ultima_req = 0.0
        self._intervalo_min = 60.0 / 240.0  # margem sob o limite do ML

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.utcnow()

    @staticmethod
    def _parse_dt_iso(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None

    @staticmethod
    def _json_dump(value: Any) -> Optional[str]:
        if value is None:
            return None
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return None

    @staticmethod
    def _json_load(value: Optional[str], default: Any):
        if not value:
            return default
        try:
            return json.loads(value)
        except Exception:
            return default

    def _db(self) -> Session:
        return SessionLocal()

    def _sync_scope(self, status: str) -> str:
        return f"items:{status or 'todos'}"

    def _is_fresh(self, expires_at: Optional[datetime]) -> bool:
        return bool(expires_at and expires_at > self._utcnow())

    def _cache_query(self, db: Session, item_id: str) -> Optional[MercadoLivreItemCache]:
        return db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.item_id == str(item_id)).first()

    def _sync_state_query(self, db: Session, scope: str) -> Optional[MercadoLivreSyncState]:
        return db.query(MercadoLivreSyncState).filter(MercadoLivreSyncState.scope == scope).first()

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

    def _cache_to_simple_item(self, row: MercadoLivreItemCache) -> Dict[str, Any]:
        dimensions = self._json_load(row.dimensoes_json, None)
        return {
            "id": row.item_id,
            "titulo": row.titulo,
            "sku": row.sku or "",
            "preco": row.preco,
            "preco_original": row.preco_original,
            "moeda": row.moeda,
            "disponivel": row.estoque_disponivel,
            "vendidos": row.vendidos,
            "status": row.status,
            "tipo_anuncio": row.tipo_anuncio,
            "tipo_anuncio_id": row.listing_type_id,
            "frete_gratis": bool(row.frete_gratis),
            "frete_custo": row.frete_custo,
            "frete_moeda": row.frete_moeda,
            "logistica": row.logistic_type,
            "flex": bool(row.flex),
            "full": bool(row.full),
            "preco_atacado": None,
            "imagens_total": row.imagens_total or 0,
            "imagem_principal": row.imagem_principal,
            "dimensoes": dimensions,
            "thumbnail": row.thumbnail,
            "permalink": row.permalink,
            "categoria_id": row.categoria_id,
            "date_created": row.date_created.isoformat() if row.date_created else None,
        }

    def _build_detalhe_from_cache(self, row: MercadoLivreItemCache) -> Dict[str, Any]:
        item = self._cache_to_simple_item(row)
        prices = self._json_load(row.prices_json, [])
        sale_price = self._json_load(row.sale_price_json, {})
        shipping_preview = self._json_load(row.shipping_preview_json, None)
        sale_terms = self._json_load(row.sale_terms_json, [])
        tags = self._json_load(row.tags_json, [])
        shipping_fee = self._json_load(row.shipping_fee_json, None)
        attributes_raw = self._json_load(row.attributes_json, [])
        pictures_raw = self._json_load(row.pictures_json, [])

        atributos = []
        for attr in attributes_raw:
            if not isinstance(attr, dict):
                continue
            atributos.append({
                "id": attr.get("id"),
                "name": attr.get("name"),
                "value_id": attr.get("value_id"),
                "value_name": attr.get("value_name"),
                "value_type": attr.get("value_type"),
            })

        pictures = []
        for pic in pictures_raw:
            if not isinstance(pic, dict):
                continue
            pictures.append({
                "id": pic.get("id"),
                "url": pic.get("secure_url") or pic.get("url"),
            })

        tarifa_atual = None
        if row.tarifa_valor is not None:
            # tarifa já gravada no sync — evita chamada ao vivo
            tarifa_atual = {"tarifa": row.tarifa_valor, "percentual": row.tarifa_pct, "fixo": row.tarifa_fixo}
        else:
            preco_efetivo = None
            if isinstance(sale_price, dict):
                preco_efetivo = sale_price.get("amount")
            if preco_efetivo is None:
                preco_efetivo = row.preco_promocional or row.preco
            if preco_efetivo:
                precificacao = self.precificacao(float(preco_efetivo), row.categoria_id)
                if row.listing_type_id == "gold_special":
                    tarifa_atual = precificacao.get("classico")
                elif row.listing_type_id == "gold_pro":
                    tarifa_atual = precificacao.get("premium")

        return {
            "item": item,
            "description": self._json_load(row.description_json, {}),
            "attributes": atributos,
            "pictures": pictures,
            "prices": prices,
            "sale_price": sale_price if isinstance(sale_price, dict) else {},
            "shipping_fee": shipping_fee,
            "shipping_preview": shipping_preview,
            "shipping_tags": self._json_load(row.shipping_tags_json, []),
            "tags": tags,
            "sale_terms": sale_terms,
            "tarifa_atual": tarifa_atual,
            "zip_code_usado": None,
            "cache": {
                "synced_at": row.synced_at.isoformat() if row.synced_at else None,
                "expires_at": row.cache_expires_at.isoformat() if row.cache_expires_at else None,
            },
        }

    def _upsert_item_cache(
        self,
        db: Session,
        body: Dict[str, Any],
        *,
        detail: Optional[Dict[str, Any]] = None,
        sale_price: Optional[Dict[str, Any]] = None,
        prices: Optional[Dict[str, Any]] = None,
        shipping_fee: Optional[Dict[str, Any]] = None,
        shipping_preview: Optional[Dict[str, Any]] = None,
        description: Optional[Dict[str, Any]] = None,
        cache_ttl_seconds: Optional[int] = None,
    ) -> MercadoLivreItemCache:
        item = self._simplificar_item(body)
        row = self._cache_query(db, str(item.get("id")))
        now = self._utcnow()
        if not row:
            row = MercadoLivreItemCache(item_id=str(item.get("id")))
            db.add(row)

        old_raw = row.raw_item_json
        row.status = item.get("status")
        row.titulo = item.get("titulo")
        row.sku = item.get("sku")
        row.categoria_id = item.get("categoria_id")
        row.listing_type_id = item.get("tipo_anuncio_id")
        row.tipo_anuncio = item.get("tipo_anuncio")
        row.moeda = item.get("moeda")
        row.preco = item.get("preco")
        row.preco_original = item.get("preco_original")
        row.estoque_disponivel = item.get("disponivel")
        row.vendidos = item.get("vendidos")
        row.frete_gratis = 1 if item.get("frete_gratis") else 0
        row.logistic_type = item.get("logistica")
        row.flex = 1 if item.get("flex") else 0
        row.full = 1 if item.get("full") else 0
        row.imagens_total = item.get("imagens_total") or 0
        row.imagem_principal = item.get("imagem_principal")
        row.thumbnail = item.get("thumbnail")
        row.permalink = item.get("permalink")
        row.dimensoes_json = self._json_dump(item.get("dimensoes"))
        row.dimensoes_texto = ((item.get("dimensoes") or {}).get("texto") if isinstance(item.get("dimensoes"), dict) else None)
        row.sale_terms_json = self._json_dump(body.get("sale_terms") or [])
        row.tags_json = self._json_dump(body.get("tags") or [])
        row.attributes_json = self._json_dump(body.get("attributes") or [])
        row.pictures_json = self._json_dump(body.get("pictures") or [])
        row.raw_item_json = self._json_dump(body)
        row.ml_last_updated = self._parse_dt_iso(body.get("last_updated"))
        if body.get("date_created"):
            row.date_created = self._parse_dt_iso(body.get("date_created"))
        row.synced_at = now
        row.cache_expires_at = now + timedelta(seconds=cache_ttl_seconds or self.DETAIL_CACHE_TTL_SECONDS)
        row.last_error = None

        if description is not None:
            row.description_json = self._json_dump(description)
        if prices is not None:
            row.prices_json = self._json_dump(prices.get("prices") if isinstance(prices, dict) else prices)
        if sale_price is not None:
            row.sale_price_json = self._json_dump(sale_price)
            if isinstance(sale_price, dict):
                row.preco_promocional = sale_price.get("amount")
                if sale_price.get("regular_amount") is not None:
                    row.preco_original = sale_price.get("regular_amount")
        elif row.preco_promocional is None:
            row.preco_promocional = row.preco
        if shipping_fee is not None:
            row.shipping_fee_json = self._json_dump(shipping_fee)
            if isinstance(shipping_fee, dict):
                row.frete_custo = shipping_fee.get("list_cost")
                row.frete_moeda = shipping_fee.get("currency_id")
        if shipping_preview is not None:
            row.shipping_preview_json = self._json_dump(shipping_preview)
        if detail is not None:
            row.shipping_tags_json = self._json_dump(detail.get("shipping_tags") or [])

        if old_raw != row.raw_item_json:
            row.ml_last_changed_at = now
        elif row.ml_last_changed_at is None:
            row.ml_last_changed_at = now
        return row

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
            "date_created": body.get("date_created"),
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

    def _set_sync_state(self, db: Session, scope: str, resource: str, status: Optional[str], total: int, offset: int, limit: int, ttl_seconds: int, last_error: Optional[str] = None) -> None:
        state = self._sync_state_query(db, scope)
        now = self._utcnow()
        if not state:
            state = MercadoLivreSyncState(scope=scope, resource=resource, status=status)
            db.add(state)
        state.remote_total = total
        state.offset = offset
        state.limit = limit
        state.synced_at = now
        state.cache_expires_at = now + timedelta(seconds=ttl_seconds)
        state.last_error = last_error

    def _listar_anuncios_cache(self, status: str, offset: int, limit: int, q: str = "") -> Dict[str, Any]:
        db = self._db()
        try:
            scope = self._sync_scope(status)
            state = self._sync_state_query(db, scope)
            query = db.query(MercadoLivreItemCache)
            termo = (str(q or "")).strip().lower()
            # Quando há busca, procura em TODOS os status (o placeholder promete
            # "todos os anuncios"). Sem busca, mantém o filtro da aba selecionada.
            if termo:
                # Multi-palavra: cada token precisa casar (AND) em título, SKU ou
                # item_id (OR). Assim "painel cg 150" acha "Painel Completo Cg 150"
                # independente da ordem/posição das palavras.
                for token in termo.split():
                    like = f"%{token}%"
                    query = query.filter(or_(
                        func.lower(func.coalesce(MercadoLivreItemCache.titulo, "")).like(like),
                        func.lower(func.coalesce(MercadoLivreItemCache.sku, "")).like(like),
                        func.lower(func.coalesce(MercadoLivreItemCache.item_id, "")).like(like),
                    ))
            elif status and status != "todos":
                query = query.filter(MercadoLivreItemCache.status == status)
            # Ordenação estável (item_id) p/ paginação consistente; total vem da
            # contagem LOCAL — o catálogo inteiro fica espelhado no cache.
            total = query.count()
            rows = query.order_by(MercadoLivreItemCache.item_id.asc()).offset(offset).limit(limit).all()

            # Backfill leve do date_created só para os itens da página que ainda não
            # têm (campo novo): 1 chamada batch ao ML, não trava se falhar.
            faltando = [r for r in rows if r.date_created is None and r.item_id]
            if faltando:
                try:
                    mapa = self._date_created_map([r.item_id for r in faltando])
                    mudou = False
                    for r in faltando:
                        dc = mapa.get(str(r.item_id))
                        if dc:
                            r.date_created = dc
                            mudou = True
                    if mudou:
                        db.commit()
                except Exception:
                    db.rollback()

            anuncios = [self._cache_to_simple_item(row) for row in rows]
            return {
                "total": total,
                "offset": offset,
                "limit": limit,
                "anuncios": anuncios,
                "cache": {
                    "fonte": "sqlite",
                    "scope": scope,
                    "q": termo or None,
                    "synced_at": state.synced_at.isoformat() if state and state.synced_at else None,
                    "expires_at": state.cache_expires_at.isoformat() if state and state.cache_expires_at else None,
                    "stale": not self._is_fresh(state.cache_expires_at if state else None),
                    "sincronizando": self._catalog_sync_lock.locked(),
                },
            }
        finally:
            db.close()

    def sync_item(self, item_id: str, force: bool = False) -> Dict[str, Any]:
        db = self._db()
        try:
            row = self._cache_query(db, item_id)
            detalhe_completo = bool(row and row.description_json and row.prices_json is not None and row.sale_price_json)
            if row and not force and detalhe_completo and self._is_fresh(row.cache_expires_at):
                return self._build_detalhe_from_cache(row)

            body = self._get(f"/items/{item_id}")
            if not body:
                if row:
                    return self._build_detalhe_from_cache(row)
                return {"erro": "Anúncio não encontrado"}

            desc = self._get(f"/items/{item_id}/description") or {}
            prices = self._get(f"/items/{item_id}/prices") or {}
            sale_price = self._get(f"/items/{item_id}/sale_price", {"quantity": 1}) or {}
            frete = self._get(f"/users/{self.user_id}/shipping_options/free", {"item_id": item_id, "verbose": "true"}) or {}
            zip_code = (((body.get("seller_address") or {}).get("zip_code")) or os.getenv("ML_DEFAULT_ZIP_CODE") or "").strip()
            shipping_options = self._get(f"/items/{item_id}/shipping_options", {"zip_code": zip_code}) if zip_code else None
            recommended_shipping = None
            if isinstance(shipping_options, dict):
                options = shipping_options.get("options") or []
                if options:
                    recommended_shipping = options[0]

            shipping_fee = (frete.get("coverage") or {}).get("all_country")
            row = self._upsert_item_cache(
                db,
                body,
                sale_price=sale_price,
                prices=prices,
                shipping_fee=shipping_fee,
                shipping_preview=recommended_shipping,
                description=desc,
                detail={"shipping_tags": (body.get("shipping") or {}).get("tags") or []},
            )
            valor, pct, fixo = self._tarifa_para(row.preco_promocional or row.preco, row.categoria_id, row.listing_type_id)
            if valor is not None:
                row.tarifa_valor = valor
                row.tarifa_pct = pct
                row.tarifa_fixo = fixo
            db.commit()
            db.refresh(row)
            return self._build_detalhe_from_cache(row)
        except Exception as e:
            db.rollback()
            print(f"[ML] sync_item erro {item_id}: {e}")
            row = self._cache_query(db, item_id)
            if row:
                return self._build_detalhe_from_cache(row)
            return {"erro": str(e)}
        finally:
            db.close()

    def _sync_list_page(self, status: str, offset: int, limit: int) -> Dict[str, Any]:
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
        anuncios: List[Dict[str, Any]] = []
        body_by_id: Dict[str, Dict[str, Any]] = {}
        atributos = "id,title,price,original_price,currency_id,available_quantity,sold_quantity,status,listing_type_id,seller_custom_field,attributes,shipping,thumbnail,permalink,category_id,pictures,sale_terms,tags,last_updated,date_created"
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": atributos})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    body = entry["body"]
                    body_by_id[str(body.get("id"))] = body
                    anuncios.append(self._simplificar_item(body))

        custos_frete = self._custos_frete_gratis([a["id"] for a in anuncios if a.get("frete_gratis")])
        db = self._db()
        try:
            for anuncio in anuncios:
                frete = custos_frete.get(str(anuncio.get("id")))
                if frete:
                    anuncio["frete_custo"] = frete.get("valor")
                    anuncio["frete_moeda"] = frete.get("moeda")
                body = body_by_id.get(str(anuncio.get("id")))
                if body:
                    row = self._upsert_item_cache(
                        db,
                        body,
                        shipping_fee={"list_cost": anuncio.get("frete_custo"), "currency_id": anuncio.get("frete_moeda")} if anuncio.get("frete_custo") is not None else None,
                        cache_ttl_seconds=self.LIST_CACHE_TTL_SECONDS,
                    )
                    if row.preco_promocional is None:
                        row.preco_promocional = row.preco

            self._set_sync_state(db, self._sync_scope(status), "items", status, total, offset, limit, self.LIST_CACHE_TTL_SECONDS)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[ML] _sync_list_page erro: {e}")
            return {"erro": str(e), "anuncios": [], "total": 0}
        finally:
            db.close()

        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "anuncios": anuncios,
            "cache": {
                "fonte": "mercado_livre",
                "scope": self._sync_scope(status),
                "synced_at": self._utcnow().isoformat(),
                "stale": False,
            },
        }

    # ---------- sincronização de catálogo (cache-first + incremental) ----------
    def _buscar_todos_ids(self, status: str) -> Optional[List[str]]:
        """Todos os ids de anúncios do vendedor para um status (paginando a busca)."""
        if not self.user_id:
            return None
        ids: List[str] = []
        offset = 0
        while True:
            params = {"offset": offset, "limit": 100}
            if status and status != "todos":
                params["status"] = status
            busca = self._get(f"/users/{self.user_id}/items/search", params)
            if busca is None:
                return ids or None
            results = busca.get("results", []) or []
            ids.extend(str(i) for i in results)
            total = (busca.get("paging") or {}).get("total", len(ids))
            offset += 100
            # offset/limit da busca do ML é limitado a 1000; acima disso usar scan.
            if not results or offset >= total or offset >= 1000:
                break
        return ids

    def _last_updated_map(self, ids: List[str]) -> Dict[str, Optional[datetime]]:
        """Mapa item_id -> last_updated (multiget leve, só 2 campos)."""
        out: Dict[str, Optional[datetime]] = {}
        ids = [str(i) for i in ids if i]
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": "id,last_updated"})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    body = entry["body"]
                    out[str(body.get("id"))] = self._parse_dt_iso(body.get("last_updated"))
        return out

    def _date_created_map(self, ids: List[str]) -> Dict[str, Optional[datetime]]:
        """Mapa item_id -> date_created (multiget leve, só 2 campos)."""
        out: Dict[str, Optional[datetime]] = {}
        ids = [str(i) for i in ids if i]
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": "id,date_created"})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    body = entry["body"]
                    out[str(body.get("id"))] = self._parse_dt_iso(body.get("date_created"))
        return out

    def _sync_itens(self, db: Session, ids: List[str]) -> int:
        """Busca o detalhe de lista (multiget) e faz upsert no cache p/ os ids dados."""
        ids = [str(i) for i in ids if i]
        if not ids:
            return 0
        atributos = "id,title,price,original_price,currency_id,available_quantity,sold_quantity,status,listing_type_id,seller_custom_field,attributes,shipping,thumbnail,permalink,category_id,pictures,sale_terms,tags,last_updated,date_created"
        body_by_id: Dict[str, Dict[str, Any]] = {}
        simples: List[Dict[str, Any]] = []
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": atributos})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    body = entry["body"]
                    body_by_id[str(body.get("id"))] = body
                    simples.append(self._simplificar_item(body))
        custos_frete = self._custos_frete_gratis([s["id"] for s in simples if s.get("frete_gratis")])
        fee_cache: Dict[Any, Dict] = {}
        n = 0
        for s in simples:
            body = body_by_id.get(str(s.get("id")))
            if not body:
                continue
            frete = custos_frete.get(str(s.get("id")))
            shipping_fee = {"list_cost": frete.get("valor"), "currency_id": frete.get("moeda")} if frete else None
            row = self._upsert_item_cache(db, body, shipping_fee=shipping_fee, cache_ttl_seconds=self.LIST_CACHE_TTL_SECONDS)
            if row.preco_promocional is None:
                row.preco_promocional = row.preco
            # grava a tarifa real; só sobrescreve quando obteve valor (preserva último bom)
            valor, pct, fixo = self._tarifa_para(row.preco_promocional or row.preco, row.categoria_id, row.listing_type_id, fee_cache)
            if valor is not None:
                row.tarifa_valor = valor
                row.tarifa_pct = pct
                row.tarifa_fixo = fixo
            n += 1
        return n

    def sync_catalogo(self, status: str = "active", force_full: bool = False) -> Dict[str, Any]:
        """Espelha o catálogo INTEIRO do status no cache local, mas só busca o detalhe
        dos anúncios que realmente mudaram no ML (compara last_updated). É a base do
        'só atualiza quando o Mercado Livre muda'. Roda no polling em segundo plano.
        """
        if not self.user_id:
            return {"erro": "ML_USER_ID não configurado", "total": 0, "atualizados": 0}
        if not self._catalog_sync_lock.acquire(blocking=False):
            return {"skipped": True, "motivo": "sync já em andamento"}
        try:
            ids = self._buscar_todos_ids(status)
            if ids is None:
                return {"erro": "Falha ao consultar o Mercado Livre (token/conexão)", "total": 0, "atualizados": 0}
            id_set = set(ids)

            db = self._db()
            try:
                existentes = {
                    r.item_id: r
                    for r in db.query(
                        MercadoLivreItemCache.item_id,
                        MercadoLivreItemCache.ml_last_updated,
                        MercadoLivreItemCache.status,
                    ).all()
                }
                if force_full:
                    mudados = list(ids)
                else:
                    lu_map = self._last_updated_map(ids)
                    mudados = []
                    for iid in ids:
                        row = existentes.get(iid)
                        novo = lu_map.get(iid)
                        if row is None or row.ml_last_updated is None:
                            mudados.append(iid)
                        elif novo is not None and novo > row.ml_last_updated:
                            mudados.append(iid)

                # itens que saíram deste status (pausados/encerrados): re-sincroniza
                # para atualizar o status guardado no cache.
                sumidos = [
                    iid for iid, row in existentes.items()
                    if row.status == status and iid not in id_set
                ] if status and status != "todos" else []

                atualizados = 0
                alvos = mudados + sumidos
                for i in range(0, len(alvos), 100):
                    atualizados += self._sync_itens(db, alvos[i:i + 100])
                    db.commit()

                self._set_sync_state(db, self._sync_scope(status), "items", status, len(ids), 0, len(ids), self.LIST_CACHE_TTL_SECONDS)
                db.commit()
                return {
                    "ok": True,
                    "status": status,
                    "total": len(ids),
                    "atualizados": atualizados,
                    "recategorizados": len(sumidos),
                    "modo": "full" if force_full else "incremental",
                }
            except Exception as e:
                db.rollback()
                print(f"[ML] sync_catalogo erro: {e}")
                return {"erro": str(e), "total": 0, "atualizados": 0}
            finally:
                db.close()
        finally:
            self._catalog_sync_lock.release()

    def _sync_catalogo_async(self, status: str = "active") -> None:
        """Dispara sync_catalogo em thread (usado no cold start, sem travar a request)."""
        def run():
            try:
                self.sync_catalogo(status=status)
            except Exception as e:
                print(f"[ML] sync_catalogo async erro: {e}")
        threading.Thread(target=run, daemon=True).start()

    def _tarifa_para(self, price: Optional[float], categoria_id: Optional[str], listing_type_id: Optional[str], fee_cache: Optional[Dict[Any, Dict]] = None):
        """Tarifa de venda real (valor, %, fixo) p/ um preço/categoria/tipo.
        Só Clássico (gold_special) e Premium (gold_pro) têm tarifa via listing_prices.
        fee_cache evita recalcular o mesmo (categoria, tipo, preço) no mesmo sync.
        """
        if not price or listing_type_id not in ("gold_special", "gold_pro"):
            return (None, None, None)
        key = (categoria_id, listing_type_id, round(float(price), 2))
        pr = fee_cache.get(key) if fee_cache is not None else None
        if pr is None:
            pr = self.precificacao(float(price), categoria_id)
            if fee_cache is not None:
                fee_cache[key] = pr
        info = pr.get("classico") if listing_type_id == "gold_special" else pr.get("premium")
        if not info:
            return (None, None, None)
        return (info.get("tarifa"), info.get("percentual"), info.get("fixo"))

    def margens_por_sku(self, skus: Optional[List[str]] = None) -> Dict[str, Any]:
        """Para cada SKU, devolve os dados do anúncio ML ativo correspondente
        (preço/promo/frete reais do cache + tarifa real via listing_prices).
        Base do Catálogo mostrar a margem direto dos nossos anúncios. Se `skus`
        vier, filtra só esses (uppercase); senão devolve todos com SKU.
        """
        alvo = {str(s).strip().upper() for s in (skus or []) if str(s).strip()}
        db = self._db()
        try:
            rows = db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.status == "active").all()
        finally:
            db.close()

        por_sku: Dict[str, MercadoLivreItemCache] = {}
        for r in rows:
            s = (r.sku or "").strip().upper()
            if not s or (alvo and s not in alvo):
                continue
            atual = por_sku.get(s)
            # se houver mais de um anúncio com o mesmo SKU, fica o de maior preço
            if atual is None or (r.preco or 0) > (atual.preco or 0):
                por_sku[s] = r

        out: Dict[str, Any] = {}
        for s, r in por_sku.items():
            promo = r.preco_promocional or r.preco
            out[s] = {
                "item_id": r.item_id,
                "titulo": r.titulo,
                "preco": r.preco,
                "promocional": promo,
                "frete": r.frete_custo,
                # tarifa vem do cache (gravada no sync) — sem chamada ao vivo
                "tarifa": r.tarifa_valor,
                "tarifa_pct": r.tarifa_pct,
                "tipo_anuncio": r.tipo_anuncio,
                "tipo_anuncio_id": r.listing_type_id,
                "permalink": r.permalink,
            }
        return {"margens": out, "total": len(out)}

    def imagens_por_sku(self) -> Dict[str, Any]:
        """Mapa SKU -> imagem do anúncio, lendo TODO o cache local (qualquer status).
        Usado na Lista de Separação p/ mostrar a foto de cada item do inbound.
        Direto do SQLite, sem chamada ao vivo e sem o teto de paginação."""
        db = self._db()
        try:
            rows = db.query(MercadoLivreItemCache).all()
        finally:
            db.close()
        out: Dict[str, str] = {}
        for r in rows:
            s = (r.sku or "").strip().upper()
            img = r.imagem_principal or r.thumbnail
            if not s or not img:
                continue
            # se houver mais de um anúncio com o mesmo SKU, mantém o primeiro com imagem
            out.setdefault(s, img)
        return {"imagens": out, "total": len(out)}

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
        db = self._db()
        try:
            row = self._cache_query(db, item_id)
            if row:
                return self._cache_to_simple_item(row)
        finally:
            db.close()
        body = self._get(f"/items/{item_id}", {"attributes": "id,title,price,category_id,listing_type_id,seller_custom_field,available_quantity"})
        return self._simplificar_item(body) if body else None

    def obter_anuncio_completo(self, item_id: str, force_refresh: bool = False) -> Dict:
        return self.sync_item(item_id, force=force_refresh)
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anúncio não encontrado"}

        desc = self._get(f"/items/{item_id}/description") or {}
        prices = self._get(f"/items/{item_id}/prices") or {}
        sale_price = self._get(f"/items/{item_id}/sale_price", {"quantity": 1}) or {}
        frete = self._get(f"/users/{self.user_id}/shipping_options/free", {"item_id": item_id, "verbose": "true"}) or {}
        zip_code = (((body.get("seller_address") or {}).get("zip_code")) or os.getenv("ML_DEFAULT_ZIP_CODE") or "").strip()
        shipping_options = self._get(f"/items/{item_id}/shipping_options", {"zip_code": zip_code}) if zip_code else None
        preco_efetivo = sale_price.get("amount") if isinstance(sale_price, dict) and sale_price.get("amount") is not None else body.get("price")
        precificacao = self.precificacao(float(preco_efetivo or 0), body.get("category_id"))

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

    # ---------- preços por quantidade (atacado B2B) ----------
    B2B_CONTEXT = "channel_marketplace,user_type_business"
    AMOSTRA_QUANTIDADES = [1, 5, 10, 25]

    def _preco_b2b(self, item_id: str, quantidade: int) -> Optional[float]:
        """Preço efetivo que um comprador EMPRESA vê numa dada quantidade."""
        sp = self._get(f"/items/{item_id}/sale_price", {"context": self.B2B_CONTEXT, "quantity": quantidade})
        if isinstance(sp, dict) and sp.get("amount") is not None:
            try:
                return float(sp["amount"])
            except (TypeError, ValueError):
                return None
        return None

    def obter_precos_quantidade(self, item_id: str) -> Dict:
        """Preço padrão + amostra do preço B2B por quantidade.

        Os preços por quantidade do ML são B2B (só comprador empresa) e a API NÃO
        expõe um endpoint que liste os tiers configurados — só dá para observá-los
        consultando /sale_price com contexto B2B numa quantidade. Por isso devolvemos
        uma amostra (qty 1/5/10/25) em vez de tiers exatos.
        """
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
        """Cria/atualiza os tiers de atacado B2B via POST /prices/standard/quantity.

        `tiers` = [{amount, min_purchase_unit}, ...] (até 5). O preço padrão é
        referenciado por id (obrigatório no payload). Lista vazia remove os tiers.
        """
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

        # O ML responde 200 (e o echo do POST devolve as faixas otimisticamente) mesmo
        # quando NÃO aplica — ex.: anúncio com promoção/campanha ativa. A única forma
        # confiável de confirmar é reler o preço B2B na quantidade de cada faixa.
        # A aplicação é assíncrona (propaga em alguns segundos), então repetimos a
        # checagem por algumas rodadas antes de concluir que falhou.
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

    # ---------- preço de venda (cheio + promocional) ----------
    def resumo_preco(self, item_id: str, force_refresh: bool = False) -> Dict:
        """Valor cheio (preço base) + valor promocional efetivo (o que o consumidor paga)."""
        detail = self.sync_item(item_id, force=force_refresh)
        if detail.get("erro"):
            return detail
        item = detail.get("item") or {}
        sale_price = detail.get("sale_price") or {}
        cheio = item.get("preco")
        promocional = sale_price.get("amount") if isinstance(sale_price, dict) and sale_price.get("amount") is not None else (item.get("preco_original") or cheio)
        if promocional is None:
            promocional = cheio
        tem_promocao = (cheio is not None and promocional is not None and float(promocional) < float(cheio) - 0.01)
        return {
            "cheio": cheio,
            "promocional": promocional,
            "tem_promocao": bool(tem_promocao),
            "catalogo": False,
            "status": item.get("status"),
            "cache": detail.get("cache"),
        }
        body = self._get(f"/items/{item_id}", {"attributes": "id,price,base_price,catalog_listing,status"})
        if not body:
            return {"erro": "Anúncio não encontrado"}
        cheio = body.get("price")
        if cheio is None:
            cheio = body.get("base_price")
        sp = self._get(f"/items/{item_id}/sale_price", {"quantity": 1})
        promocional = sp.get("amount") if isinstance(sp, dict) and sp.get("amount") is not None else cheio
        tem_promocao = (cheio is not None and promocional is not None and float(promocional) < float(cheio) - 0.01)
        return {
            "cheio": cheio,
            "promocional": promocional,
            "tem_promocao": bool(tem_promocao),
            "catalogo": bool(body.get("catalog_listing")),
            "status": body.get("status"),
        }

    def aplicar_preco(self, item_id: str, preco: float) -> Dict:
        """Aplica o preço base ao anúncio (PUT /items). Catálogo/fechado são bloqueados pelo ML.

        Verifica relendo o preço, já que mudanças no ML podem não refletir de imediato.
        Retorna também o preço anterior, para registrar histórico no cliente.
        """
        try:
            preco = round(float(preco), 2)
        except (TypeError, ValueError):
            return {"erro": "Preço inválido"}
        if preco <= 0:
            return {"erro": "Preço deve ser maior que zero"}

        body = self._get(f"/items/{item_id}", {"attributes": "id,price,catalog_listing,status"})
        if not body:
            return {"erro": "Anúncio não encontrado"}
        preco_anterior = body.get("price")
        if body.get("catalog_listing"):
            return {"erro": "Este é um anúncio de catálogo: o preço é definido pelo catálogo do Mercado Livre e não pode ser alterado por aqui.", "bloqueado": True}
        if body.get("status") == "closed":
            return {"erro": "Anúncio finalizado: não é possível alterar o preço.", "bloqueado": True}

        resp = self._request_json("PUT", f"/items/{item_id}", {"price": preco})
        if not resp or resp.get("erro"):
            cause = resp.get("erro") if isinstance(resp, dict) else None
            return {"erro": cause or "Falha ao aplicar o preço no Mercado Livre", "preco_anterior": preco_anterior}

        confere = self._get(f"/items/{item_id}", {"attributes": "id,price"}) or {}
        aplicado = confere.get("price") is not None and abs(float(confere["price"]) - preco) <= 0.01
        if not aplicado:
            return {"erro": "O Mercado Livre não aplicou o novo preço.", "aplicado": False, "preco_anterior": preco_anterior}
        self.sync_item(item_id, force=True)
        return {"ok": True, "aplicado": True, "preco_anterior": preco_anterior, "preco_novo": preco}

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
        """Extrai o primeiro número de algo como '28 cm' ou '1880 g'."""
        if texto is None:
            return None
        try:
            return float(str(texto).replace(",", ".").split()[0])
        except (ValueError, IndexError):
            return None

    def atualizar_dimensoes(self, item_id: str, largura_cm: str, altura_cm: str, comprimento_cm: str, peso_g: str, package_type: str) -> Dict:
        """Atualiza dimensões declaradas (SELLER_PACKAGE_*).

        Em itens FULL o Mercado Livre mede o produto no galpão e ignora a alteração
        (a API responde 200 mas não aplica). Por isso detectamos o logistic_type e
        verificamos a persistência relendo os atributos depois da escrita.
        """
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anúncio não encontrado"}

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

        # Reler para confirmar que o ML realmente aplicou (a resposta 200 não garante).
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
        atributos = "id,title,price,original_price,currency_id,available_quantity,sold_quantity,status,listing_type_id,seller_custom_field,attributes,shipping,thumbnail,permalink,category_id,pictures,sale_terms,tags,date_created"
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

    # ---------- overrides cache-first ----------
    def obter_anuncio_completo(self, item_id: str, force_refresh: bool = False) -> Dict:
        return self.sync_item(item_id, force=force_refresh)

    def resumo_preco(self, item_id: str, force_refresh: bool = False) -> Dict:
        detail = self.sync_item(item_id, force=force_refresh)
        if detail.get("erro"):
            return detail
        item = detail.get("item") or {}
        prices = detail.get("prices") or []
        sale_price = detail.get("sale_price") or {}
        cheio = sale_price.get("regular_amount") if isinstance(sale_price, dict) else None
        if cheio is None:
            standard = next((
                p for p in prices
                if isinstance(p, dict) and p.get("type") == "standard" and p.get("amount") is not None
            ), None)
            if isinstance(standard, dict):
                cheio = standard.get("amount")
        if cheio is None:
            cheio = item.get("preco_original") or item.get("preco")

        promocional = sale_price.get("amount") if isinstance(sale_price, dict) and sale_price.get("amount") is not None else None
        if promocional is None:
            promotion = next((
                p for p in prices
                if isinstance(p, dict) and p.get("type") == "promotion" and p.get("amount") is not None
            ), None)
            if isinstance(promotion, dict):
                promocional = promotion.get("amount")
        if promocional is None:
            promocional = item.get("preco") or cheio
        if promocional is None:
            promocional = cheio
        tem_promocao = (cheio is not None and promocional is not None and float(promocional) < float(cheio) - 0.01)
        return {
            "cheio": cheio,
            "promocional": promocional,
            "tem_promocao": bool(tem_promocao),
            "catalogo": False,
            "status": item.get("status"),
            "cache": detail.get("cache"),
        }

    def atualizar_descricao(self, item_id: str, plain_text: str) -> Dict:
        result = self._request_json("PUT", f"/items/{item_id}/description", {"plain_text": plain_text}) or {"erro": "Falha ao atualizar descricao"}
        if not result.get("erro"):
            self.sync_item(item_id, force=True)
        return result

    def atualizar_atributos(self, item_id: str, updates: Dict[str, Dict[str, Any]]) -> Dict:
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anuncio nao encontrado"}
        attrs = self._merge_attribute_values(body.get("attributes") or [], updates)
        result = self._request_json("PUT", f"/items/{item_id}", {"attributes": attrs}) or {"erro": "Falha ao atualizar atributos"}
        if not result.get("erro"):
            self.sync_item(item_id, force=True)
        return result

    def atualizar_dimensoes(self, item_id: str, largura_cm: str, altura_cm: str, comprimento_cm: str, peso_g: str, package_type: str) -> Dict:
        body = self._get(f"/items/{item_id}")
        if not body:
            return {"erro": "Anuncio nao encontrado"}
        logistic = (body.get("shipping") or {}).get("logistic_type")
        if logistic == "fulfillment":
            return {
                "erro": "Dimensoes controladas pelo Mercado Livre (Full). O galpao mede o produto fisicamente e a alteracao nao e aplicada.",
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
            return resp or {"erro": "Falha ao atualizar dimensoes"}
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
                "erro": "O Mercado Livre nao aplicou as dimensoes neste anuncio.",
                "aplicado": False,
                "logistic_type": logistic,
            }
        self.sync_item(item_id, force=True)
        return {"ok": True, "aplicado": True, "logistic_type": logistic}

    def atualizar_imagens(self, item_id: str, pictures: List[Dict[str, str]]) -> Dict:
        payload = []
        for picture in pictures:
            if picture.get("id"):
                payload.append({"id": picture["id"]})
            elif picture.get("source"):
                payload.append({"source": picture["source"]})
        result = self._request_json("PUT", f"/items/{item_id}", {"pictures": payload}) or {"erro": "Falha ao atualizar imagens"}
        if not result.get("erro"):
            self.sync_item(item_id, force=True)
        return result

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

    def aplicar_preco(self, item_id: str, preco: float) -> Dict:
        try:
            preco = round(float(preco), 2)
        except (TypeError, ValueError):
            return {"erro": "Preco invalido"}
        if preco <= 0:
            return {"erro": "Preco deve ser maior que zero"}

        body = self._get(f"/items/{item_id}", {"attributes": "id,price,catalog_listing,status"})
        if not body:
            return {"erro": "Anuncio nao encontrado"}
        preco_anterior = body.get("price")
        if body.get("catalog_listing"):
            return {"erro": "Este e um anuncio de catalogo e nao pode ser alterado por aqui.", "bloqueado": True}
        if body.get("status") == "closed":
            return {"erro": "Anuncio finalizado: nao e possivel alterar o preco.", "bloqueado": True}

        resp = self._request_json("PUT", f"/items/{item_id}", {"price": preco})
        if not resp or resp.get("erro"):
            cause = resp.get("erro") if isinstance(resp, dict) else None
            return {"erro": cause or "Falha ao aplicar o preco no Mercado Livre", "preco_anterior": preco_anterior}

        confere = self._get(f"/items/{item_id}", {"attributes": "id,price"}) or {}
        aplicado = confere.get("price") is not None and abs(float(confere["price"]) - preco) <= 0.01
        if not aplicado:
            return {"erro": "O Mercado Livre nao aplicou o novo preco.", "aplicado": False, "preco_anterior": preco_anterior}
        self.sync_item(item_id, force=True)
        return {"ok": True, "aplicado": True, "preco_anterior": preco_anterior, "preco_novo": preco}

    def atualizar_quantidade(self, item_id: str, quantidade: int) -> Dict:
        """Altera o estoque (available_quantity) do anúncio no ML (PUT /items)."""
        try:
            quantidade = int(quantidade)
        except (TypeError, ValueError):
            return {"erro": "Quantidade inválida"}
        if quantidade < 0:
            return {"erro": "Quantidade não pode ser negativa"}

        body = self._get(f"/items/{item_id}", {"attributes": "id,available_quantity,status,catalog_listing,logistic_type,shipping"})
        if not body:
            return {"erro": "Anúncio não encontrado"}
        if body.get("status") == "closed":
            return {"erro": "Anúncio finalizado: não é possível alterar o estoque.", "bloqueado": True}
        # Anúncio FULL: o estoque é controlado pelo fulfillment do ML, não por aqui.
        if (body.get("shipping") or {}).get("logistic_type") == "fulfillment":
            return {"erro": "Anúncio FULL: o estoque é gerido pelo fulfillment do Mercado Livre e não pode ser alterado por aqui.", "bloqueado": True}
        anterior = body.get("available_quantity")

        resp = self._request_json("PUT", f"/items/{item_id}", {"available_quantity": quantidade})
        if not resp or (isinstance(resp, dict) and resp.get("erro")):
            cause = resp.get("erro") if isinstance(resp, dict) else None
            return {"erro": cause or "Falha ao atualizar o estoque no Mercado Livre", "quantidade_anterior": anterior}
        self.sync_item(item_id, force=True)
        return {"ok": True, "quantidade_anterior": anterior, "quantidade_nova": quantidade}

    def mudar_status(self, item_id: str, status: str) -> Dict:
        """Muda o status do anúncio: 'active' (reativar), 'paused' (pausar) ou
        'closed' (finalizar). Finalizar é irreversível no ML."""
        status = (status or "").strip().lower()
        if status not in {"active", "paused", "closed"}:
            return {"erro": "Status inválido (use active, paused ou closed)"}

        atual = self._get(f"/items/{item_id}", {"attributes": "id,status"})
        if not atual:
            return {"erro": "Anúncio não encontrado"}
        if atual.get("status") == "closed":
            return {"erro": "Anúncio já está finalizado: não é possível mudar o status.", "bloqueado": True}

        resp = self._request_json("PUT", f"/items/{item_id}", {"status": status})
        if not resp or (isinstance(resp, dict) and resp.get("erro")):
            cause = resp.get("erro") if isinstance(resp, dict) else None
            return {"erro": cause or "Falha ao mudar o status no Mercado Livre"}
        self.sync_item(item_id, force=True)
        return {"ok": True, "status": status}

    def excluir_anuncio(self, item_id: str) -> Dict:
        """Exclui o anúncio. O ML não apaga de verdade: fecha (closed) e depois
        marca como deleted. Some dos ativos/pausados; o ML mantém o histórico."""
        atual = self._get(f"/items/{item_id}", {"attributes": "id,status"})
        if not atual:
            return {"erro": "Anúncio não encontrado"}

        # 1) Para excluir, o anúncio precisa estar fechado antes.
        if atual.get("status") != "closed":
            fechar = self._request_json("PUT", f"/items/{item_id}", {"status": "closed"})
            if not fechar or (isinstance(fechar, dict) and fechar.get("erro")):
                cause = fechar.get("erro") if isinstance(fechar, dict) else None
                return {"erro": cause or "Falha ao finalizar o anúncio antes de excluir"}

        # 2) Marca como deleted.
        resp = self._request_json("PUT", f"/items/{item_id}", {"deleted": True})
        if not resp or (isinstance(resp, dict) and resp.get("erro")):
            cause = resp.get("erro") if isinstance(resp, dict) else None
            return {"erro": cause or "Falha ao excluir o anúncio no Mercado Livre"}
        self.sync_item(item_id, force=True)
        return {"ok": True, "excluido": True}

    # Atributos que NÃO devem ser copiados ao duplicar (códigos universais geram
    # conflito "já existe" e campos read-only são rejeitados pelo POST /items).
    _ATTRS_NAO_DUPLICAR = {"GTIN", "EAN", "UPC", "ISBN", "SELLER_SKU"}

    def _attrs_para_duplicar(self, attributes):
        out = []
        for a in (attributes or []):
            aid = a.get("id")
            if not aid or aid in self._ATTRS_NAO_DUPLICAR:
                continue
            if a.get("value_id"):
                out.append({"id": aid, "value_id": a.get("value_id")})
            elif a.get("value_name") is not None:
                out.append({"id": aid, "value_name": a.get("value_name")})
        return out

    def buscar_categorias(self, q: str, limite: int = 8):
        """Busca categorias do ML por palavra-chave (domain_discovery).
        Usado no 'duplicar em outra categoria'."""
        termo = (q or "").strip()
        if not termo:
            return {"categorias": []}
        res = self._get("/sites/MLB/domain_discovery/search", {"q": termo, "limit": limite})
        cats = []
        for c in (res or []):
            if isinstance(c, dict) and c.get("category_id"):
                cats.append({
                    "category_id": c.get("category_id"),
                    "category_name": c.get("category_name"),
                    "domain_name": c.get("domain_name"),
                })
        return {"categorias": cats}

    def duplicar_anuncio(self, item_id: str, category_id: str = None, novo_titulo: str = None) -> Dict:
        """Duplica um anúncio criando um NOVO item no ML, já PAUSADO.
        - category_id: se informado, cria na categoria nova (duplicar em outra categoria).
        - Copia título, preço, atributos (menos códigos universais), fotos (por URL),
          frete, garantia, variações (best-effort) e descrição.
        Recriar anúncio é validado por categoria pelo ML; erros são repassados."""
        src = self._get(f"/items/{item_id}")
        if not src or (isinstance(src, dict) and src.get("erro")):
            return {"erro": "Anúncio de origem não encontrado"}

        # Fotos: re-referencia pela URL (o ML baixa de novo)
        pictures = []
        for p in (src.get("pictures") or []):
            url = (p.get("secure_url") or p.get("url") or "").strip()
            if url:
                pictures.append({"source": url.replace("http://", "https://")})

        body = {
            "title": (novo_titulo or src.get("title") or "").strip(),
            "category_id": category_id or src.get("category_id"),
            "currency_id": src.get("currency_id") or "BRL",
            "buying_mode": src.get("buying_mode") or "buy_it_now",
            "listing_type_id": src.get("listing_type_id") or "gold_special",
            "condition": src.get("condition") or "new",
            "pictures": pictures,
            "attributes": self._attrs_para_duplicar(src.get("attributes")),
        }
        if src.get("price") is not None:
            body["price"] = src.get("price")

        # Frete: copia modo/free_shipping, mas NUNCA logistic_type fulfillment
        # (um anúncio novo não nasce no FULL — daria erro).
        sh = src.get("shipping") or {}
        if sh:
            shipping = {}
            if sh.get("mode"):
                shipping["mode"] = sh.get("mode")
            if sh.get("local_pick_up") is not None:
                shipping["local_pick_up"] = sh.get("local_pick_up")
            if sh.get("free_shipping") is not None:
                shipping["free_shipping"] = sh.get("free_shipping")
            lt = sh.get("logistic_type")
            if lt and lt != "fulfillment":
                shipping["logistic_type"] = lt
            if shipping:
                body["shipping"] = shipping

        # Garantia / sale_terms
        terms = []
        for t in (src.get("sale_terms") or []):
            if t.get("id") and t.get("value_name") is not None:
                terms.append({"id": t.get("id"), "value_name": t.get("value_name")})
        if terms:
            body["sale_terms"] = terms

        # Variações (best-effort): mantém combinações e qtd, descarta ids/picture_ids
        variations = src.get("variations") or []
        if variations:
            novas = []
            for v in variations:
                nv = {
                    "attribute_combinations": v.get("attribute_combinations") or [],
                    "available_quantity": max(0, int(v.get("available_quantity") or 0)),
                }
                if v.get("price") is not None:
                    nv["price"] = v.get("price")
                attrs_v = self._attrs_para_duplicar(v.get("attributes"))
                if attrs_v:
                    nv["attributes"] = attrs_v
                novas.append(nv)
            body["variations"] = novas
            body.pop("price", None)  # com variação o preço vai na variação
        else:
            body["available_quantity"] = max(1, int(src.get("available_quantity") or 1))

        novo = self._request_json("POST", "/items", body)
        if not novo or (isinstance(novo, dict) and novo.get("erro")):
            cause = novo.get("erro") if isinstance(novo, dict) else None
            return {"erro": cause or "Falha ao criar o anúncio duplicado no Mercado Livre"}
        novo_id = novo.get("id")
        if not novo_id:
            return {"erro": "O Mercado Livre não retornou o ID do novo anúncio"}

        # Nasce pausado para revisão antes de ativar
        self._request_json("PUT", f"/items/{novo_id}", {"status": "paused"})

        # Copia a descrição
        try:
            desc = self._get(f"/items/{item_id}/description") or {}
            if desc.get("plain_text"):
                self._request_json("POST", f"/items/{novo_id}/description", {"plain_text": desc.get("plain_text")})
        except Exception:
            pass

        try:
            self.sync_item(novo_id, force=True)
        except Exception:
            pass
        return {
            "ok": True,
            "novo_id": novo_id,
            "permalink": novo.get("permalink"),
            "status": "paused",
            "category_id": body["category_id"],
        }

    def listar_anuncios(self, status: str = "active", offset: int = 0, limit: int = 50, force_refresh: bool = False, q: str = "") -> Dict:
        """Lista anúncios servindo do cache local (SQLite). Abrir a página NÃO bate
        na API — a atualização vem do polling incremental em segundo plano.
        force_refresh dispara uma sincronização incremental na hora.
        """
        termo_busca = q
        if force_refresh:
            self.sync_catalogo(status=status, force_full=False)
        else:
            db = self._db()
            try:
                cache_query = db.query(MercadoLivreItemCache.id)
                if status and status != "todos":
                    cache_query = cache_query.filter(MercadoLivreItemCache.status == status)
                tem_cache = cache_query.first() is not None
            finally:
                db.close()
            # cold start: cache vazio p/ este status -> popula em background e já responde
            if not tem_cache:
                self._sync_catalogo_async(status)
        return self._listar_anuncios_cache(status=status, offset=offset, limit=limit, q=termo_busca)


ml = MLIntegration()
