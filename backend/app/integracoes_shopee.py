"""
Integração com a Shopee Open Platform (API v2).

Credenciais vêm do .env (SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY). Os tokens
rotativos ficam em shopee_token.json, fora do repositório. Em produção,
SHOPEE_DATA_DIR=/data e SHOPEE_TOKEN_JSON semeia o arquivo no primeiro boot,
igual ao que já é feito para Olist e Mercado Livre.

Sobre o refresh: o refresh_token da Shopee é de uso único — cada renovação
devolve outro. Duas renovações concorrentes queimam a cadeia e derrubam a
integração até alguém reautorizar à mão (foi o que aconteceu com a Olist).
Por isso get_access_token() renova sob lock, com dupla checagem.
"""

import hashlib
import hmac
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()

_BASE_DIR = os.path.abspath(os.path.dirname(__file__))
_DEFAULT_DATA_DIR = os.path.abspath(os.path.join(_BASE_DIR, ".."))
_DATA_DIR = os.path.abspath(os.getenv("SHOPEE_DATA_DIR") or _DEFAULT_DATA_DIR)
os.makedirs(_DATA_DIR, exist_ok=True)
TOKEN_FILE = os.path.abspath(os.path.join(_DATA_DIR, "shopee_token.json"))

_token_seed = os.getenv("SHOPEE_TOKEN_JSON")
if _token_seed and not os.path.exists(TOKEN_FILE):
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as _f:
            _f.write(_token_seed)
        os.chmod(TOKEN_FILE, 0o600)
        print(f"[SHOPEE] Token inicial gravado em {TOKEN_FILE}")
    except Exception as _e:
        print(f"[SHOPEE] Falha ao gravar token inicial: {_e}")

# O access_token dura 4h; renova com folga para não usar um já vencido.
MARGEM_RENOVACAO_S = 600


def assinar(partner_key: str, base: str) -> str:
    """HMAC-SHA256 em hex, o formato que a Shopee espera no campo `sign`."""
    return hmac.new(partner_key.encode(), base.encode(), hashlib.sha256).hexdigest()


class ShopeeAPI:
    def __init__(self) -> None:
        self.partner_id = str(os.getenv("SHOPEE_PARTNER_ID", "")).strip()
        self.partner_key = str(os.getenv("SHOPEE_PARTNER_KEY", "")).strip()
        self.redirect_uri = str(os.getenv("SHOPEE_REDIRECT_URI", "")).strip()
        self.host = str(
            os.getenv("SHOPEE_HOST") or "https://openplatform.shopee.com.br"
        ).rstrip("/")
        self._token_lock = threading.Lock()

    # ---------------------------------------------------------------- infra

    @property
    def configurado(self) -> bool:
        return bool(self.partner_id and self.partner_key)

    def _sign_publico(self, path: str, timestamp: int) -> str:
        """Endpoints que ainda não têm loja autorizada (auth, refresh)."""
        return assinar(self.partner_key, f"{self.partner_id}{path}{timestamp}")

    def _sign_loja(self, path: str, timestamp: int, access_token: str, shop_id: str) -> str:
        """Endpoints de loja: o token e o shop_id entram na string base."""
        return assinar(
            self.partner_key,
            f"{self.partner_id}{path}{timestamp}{access_token}{shop_id}",
        )

    def _ler_token(self) -> Dict[str, Any]:
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        except Exception as e:
            print(f"[SHOPEE] Falha ao ler token: {e}")
            return {}

    def _gravar_token(self, dados: Dict[str, Any]) -> None:
        try:
            with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=2)
            os.chmod(TOKEN_FILE, 0o600)
        except Exception as e:
            print(f"[SHOPEE] Falha ao gravar token: {e}")

    def _post(self, path: str, corpo: Dict[str, Any], query: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.host}{path}?{urllib.parse.urlencode(query)}"
        req = urllib.request.Request(
            url,
            data=json.dumps(corpo).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ----------------------------------------------------------- autorização

    def url_autorizacao(self) -> str:
        """Link que o lojista abre para autorizar o app na conta dele."""
        path = "/api/v2/shop/auth_partner"
        ts = int(time.time())
        query = {
            "partner_id": self.partner_id,
            "timestamp": ts,
            "sign": self._sign_publico(path, ts),
            "redirect": self.redirect_uri,
        }
        return f"{self.host}{path}?{urllib.parse.urlencode(query)}"

    def trocar_code(self, code: str, shop_id: str) -> Dict[str, Any]:
        """Troca o code do callback pelo par de tokens. O code vale uma vez só."""
        path = "/api/v2/auth/token/get"
        ts = int(time.time())
        resposta = self._post(
            path,
            {"code": code, "shop_id": int(shop_id), "partner_id": int(self.partner_id)},
            {"partner_id": self.partner_id, "timestamp": ts, "sign": self._sign_publico(path, ts)},
        )

        if resposta.get("error"):
            print(f"[SHOPEE] Erro ao trocar code: {resposta.get('error')} {resposta.get('message')}")
            return resposta

        self._gravar_token({
            "access_token": resposta.get("access_token"),
            "refresh_token": resposta.get("refresh_token"),
            "shop_id": str(shop_id),
            "expires_at": int(time.time()) + int(resposta.get("expire_in") or 14400),
        })
        print(f"[SHOPEE] Loja {shop_id} autorizada")
        return resposta

    def _renovar(self, dados: Dict[str, Any]) -> Optional[str]:
        path = "/api/v2/auth/access_token/get"
        ts = int(time.time())
        try:
            resposta = self._post(
                path,
                {
                    "refresh_token": dados.get("refresh_token"),
                    "shop_id": int(dados.get("shop_id")),
                    "partner_id": int(self.partner_id),
                },
                {"partner_id": self.partner_id, "timestamp": ts, "sign": self._sign_publico(path, ts)},
            )
        except Exception as e:
            print(f"[SHOPEE] Falha na renovação: {e}")
            return None

        if resposta.get("error") or not resposta.get("access_token"):
            print(f"[SHOPEE] Renovação recusada: {resposta.get('error')} {resposta.get('message')}")
            return None

        self._gravar_token({
            "access_token": resposta.get("access_token"),
            # A resposta traz um refresh_token novo; o anterior morre aqui.
            "refresh_token": resposta.get("refresh_token") or dados.get("refresh_token"),
            "shop_id": str(dados.get("shop_id")),
            "expires_at": int(time.time()) + int(resposta.get("expire_in") or 14400),
        })
        print("[SHOPEE] Token renovado")
        return resposta.get("access_token")

    def get_access_token(self) -> Optional[str]:
        dados = self._ler_token()
        if not dados.get("access_token") or not dados.get("refresh_token"):
            return None

        agora = int(time.time())
        if agora < int(dados.get("expires_at") or 0) - MARGEM_RENOVACAO_S:
            return dados["access_token"]

        # Uma renovação por vez: o refresh_token é de uso único e duas chamadas
        # concorrentes invalidam a cadeia inteira.
        with self._token_lock:
            dados = self._ler_token()
            agora = int(time.time())
            if agora < int(dados.get("expires_at") or 0) - MARGEM_RENOVACAO_S:
                return dados.get("access_token")
            return self._renovar(dados)

    # ----------------------------------------------------------- uso da API

    def chamar(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """GET assinado em endpoint de loja. Devolve o corpo já em dict."""
        token = self.get_access_token()
        dados = self._ler_token()
        shop_id = str(dados.get("shop_id") or "")
        if not token or not shop_id:
            return {"error": "nao_autorizado", "message": "Loja Shopee não autorizada"}

        ts = int(time.time())
        query = {
            "partner_id": self.partner_id,
            "timestamp": ts,
            "access_token": token,
            "shop_id": shop_id,
            "sign": self._sign_loja(path, ts, token, shop_id),
            **(params or {}),
        }
        url = f"{self.host}{path}?{urllib.parse.urlencode(query)}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": "falha_requisicao", "message": str(e)}

    def info_loja(self) -> Dict[str, Any]:
        """Dados da loja autorizada. Primeira chamada assinada com token."""
        dados = self.chamar("/api/v2/shop/get_shop_info")
        # get_shop_info não repete o shop_id no corpo: ele vai na query.
        if not dados.get("error"):
            dados.setdefault("shop_id", self._ler_token().get("shop_id"))
        return dados

    def status(self) -> Dict[str, Any]:
        """Campos em português, no mesmo formato de /api/ml|olist/status."""
        if not self.configurado:
            return {
                "autorizado": False,
                "configurado": False,
                "mensagem": "Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no .env",
            }

        dados = self._ler_token()
        autorizado = bool(dados.get("access_token") and dados.get("shop_id"))
        return {
            "autorizado": autorizado,
            "configurado": True,
            "shop_id": dados.get("shop_id"),
            "expira_em": dados.get("expires_at"),
            "url_autorizacao": self.url_autorizacao(),
        }


shopee = ShopeeAPI()


if __name__ == "__main__":
    # Self-check da assinatura, que é o ponto onde um erro silencioso faria
    # toda chamada voltar 403 sem explicação.
    chave = "chave_de_teste"
    esperado = hmac.new(
        chave.encode(), b"123/api/v2/shop/get_shop_info1700000000", hashlib.sha256
    ).hexdigest()
    assert assinar(chave, "123/api/v2/shop/get_shop_info1700000000") == esperado

    api = ShopeeAPI()
    api.partner_id, api.partner_key = "123", chave
    assert api._sign_publico("/api/v2/shop/get_shop_info", 1700000000) == esperado

    com_loja = api._sign_loja("/api/v2/shop/get_shop_info", 1700000000, "tok", "999")
    assert com_loja == hmac.new(
        chave.encode(), b"123/api/v2/shop/get_shop_info1700000000tok999", hashlib.sha256
    ).hexdigest()
    assert com_loja != esperado, "sign de loja tem que diferir do público"

    print("ok: assinatura pública e de loja conferem")
