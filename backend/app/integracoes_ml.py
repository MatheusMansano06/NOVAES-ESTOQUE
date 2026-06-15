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
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from dotenv import load_dotenv

load_dotenv()

_DATA_DIR = os.getenv("ML_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..")
os.makedirs(_DATA_DIR, exist_ok=True)
TOKEN_FILE = os.path.join(_DATA_DIR, "ml_token.json")

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
        try:
            if os.path.exists(TOKEN_FILE):
                with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[ML] Erro ao carregar token: {e}")
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
        attrs = {a.get("id"): a.get("value_name") for a in (body.get("attributes") or [])}
        sku = body.get("seller_custom_field") or attrs.get("SELLER_SKU") or ""
        shipping = body.get("shipping") or {}
        lt = body.get("listing_type_id", "")
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
            "logistica": shipping.get("logistic_type"),
            "thumbnail": (body.get("thumbnail") or "").replace("http://", "https://"),
            "permalink": body.get("permalink"),
            "categoria_id": body.get("category_id"),
        }

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
        atributos = "id,title,price,original_price,currency_id,available_quantity,sold_quantity,status,listing_type_id,seller_custom_field,attributes,shipping,thumbnail,permalink,category_id"
        for i in range(0, len(ids), 20):
            lote = ids[i:i + 20]
            res = self._get("/items", {"ids": ",".join(lote), "attributes": atributos})
            if not res:
                continue
            for entry in res:
                if entry.get("code") == 200 and entry.get("body"):
                    anuncios.append(self._simplificar_item(entry["body"]))

        return {"total": total, "offset": offset, "limit": limit, "anuncios": anuncios}


ml = MLIntegration()
