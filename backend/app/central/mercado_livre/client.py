"""Chamadas ao ML da Central. O token é o do estoque (app.integracoes_ml): refresh de uso único sob um lock só."""

import time

import httpx

from app.integracoes_ml import ml as _ml

API = "https://api.mercadolibre.com"
USER_ID = _ml.user_id

_http = httpx.Client(base_url=API, timeout=20)


def token(invalido: str | None = None) -> str:
    t = _ml.get_access_token(invalidar=invalido)
    if not t:
        raise RuntimeError("Mercado Livre não conectado: conecte a conta na aba Mercado Livre do estoque")
    return t


def post(path: str, json: dict | list | None = None, files: dict | None = None) -> dict:
    """POST autenticado (JSON ou multipart). Sem retentativa automática: repetir uma escrita pode duplicá-la."""
    r = _http.post(path, json=json, files=files, headers={"Authorization": f"Bearer {token()}"})
    if r.is_error:
        raise RuntimeError(f"Mercado Livre {path}: HTTP {r.status_code} {r.text[:300]}")
    return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else {}


def get(path: str, params: dict | None = None, headers: dict | None = None) -> dict | None:
    """GET autenticado. Devolve None em 404 (recurso inexistente é normal aqui)."""
    t = token()
    for tentativa in range(4):
        r = _http.get(path, params=params, headers={"Authorization": f"Bearer {t}", **(headers or {})})
        if r.status_code == 401 and tentativa == 0:
            t = token(invalido=t)
        elif r.status_code == 429 and tentativa < 3:
            time.sleep(2 * (tentativa + 1))  # limite de chamadas do ML: espera e tenta de novo
        else:
            break
    if r.status_code == 404:
        return None
    if r.is_error:
        # O ML explica o motivo no corpo; sem isso o erro fica impossível de diagnosticar.
        raise RuntimeError(f"Mercado Livre {path}: HTTP {r.status_code} {r.text[:300]}")
    return r.json()
