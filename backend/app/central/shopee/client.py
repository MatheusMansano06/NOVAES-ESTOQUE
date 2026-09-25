"""Chamadas à Shopee da Central. Token e shop_id são os do estoque (app.integracoes_shopee), renovados lá sob lock."""

import time

import httpx

from app.integracoes_shopee import assinar, shopee as _shopee

# Sem User-Agent explícito parte da borda da Shopee responde 403 antes da API.
_http = httpx.Client(base_url=_shopee.host, timeout=20, headers={"User-Agent": "NVS-Estoque/1.0"})


def token() -> tuple[str, str]:
    t, shop_id = _shopee.get_access_token(), str(_shopee._ler_token().get("shop_id") or "")
    if not t or not shop_id:
        raise RuntimeError("Shopee não autorizada: conecte a loja no painel Shopee do estoque")
    return t, shop_id


def _assinatura_loja(path: str) -> dict:
    t, shop_id = token()
    ts = int(time.time())
    return {"partner_id": _shopee.partner_id, "timestamp": ts, "access_token": t, "shop_id": shop_id,
            "sign": assinar(_shopee.partner_key, f"{_shopee.partner_id}{path}{ts}{t}{shop_id}")}


def post(path: str, corpo: dict | None = None, files: list | None = None) -> dict:
    """POST assinado em endpoint de loja. Sem retentativa: repetir uma escrita pode duplicá-la.
    `files` manda multipart/form-data (upload de imagem) em vez de JSON."""
    if files:
        resp = _http.post(path, params=_assinatura_loja(path), files=files, timeout=60).json()
    else:
        resp = _http.post(path, params=_assinatura_loja(path), json=corpo).json()
    if resp.get("error"):
        raise RuntimeError(f"Shopee {path}: {resp.get('error')} {resp.get('message')}")
    return resp.get("response", resp)


def get(path: str, params: dict | None = None) -> dict:
    """GET assinado em endpoint de loja. Erro de negócio da Shopee vira exceção com a mensagem dela."""
    r = _http.get(path, params={**_assinatura_loja(path), **(params or {})})
    corpo = r.json()
    if corpo.get("error"):
        raise RuntimeError(f"Shopee {path}: {corpo.get('error')} {corpo.get('message')}")
    return corpo.get("response", corpo)
