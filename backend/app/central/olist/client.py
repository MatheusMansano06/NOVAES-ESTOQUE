"""Chamadas à Olist da Central. O token OAuth é o do estoque (app.integracoes_olist), renovado lá sob lock."""

import os
import threading
import time
from collections import deque

import httpx

from app.integracoes_olist import olist as _olist

API = "https://api.tiny.com.br/public-api/v3"
LIMITE_POR_MINUTO = 100  # a Olist libera 120 req/min; fica abaixo com folga
# ponytail: ritmo contado só nas chamadas da Central; o estoque tem o próprio. Somar os dois se a Olist devolver 429 com frequência.

_http = httpx.Client(timeout=20)
_lock_ritmo = threading.Lock()
_chamadas: deque[float] = deque()


def token() -> str:
    t = _olist.get_access_token()
    if not t:
        raise RuntimeError("Olist não conectada: conecte a conta na aba Olist do estoque")
    return t


def _ritmo() -> None:
    """Janela deslizante de 60 s: rajada curta (uma conferência) passa sem espera; só segura quando a
    sincronização em lote chega no limite."""
    with _lock_ritmo:
        agora = time.monotonic()
        while _chamadas and agora - _chamadas[0] > 60:
            _chamadas.popleft()
        if len(_chamadas) >= LIMITE_POR_MINUTO:
            time.sleep(60 - (agora - _chamadas[0]))
            _chamadas.popleft()
        _chamadas.append(time.monotonic())


def _chamar(metodo: str, path: str, **kw) -> httpx.Response:
    for tentativa in range(4):
        _ritmo()
        r = _http.request(metodo, f"{API}{path}", headers={"Authorization": f"Bearer {token()}"}, **kw)
        if r.status_code == 429 and tentativa < 3:
            time.sleep(min(float(r.headers.get("Retry-After") or 2 * (tentativa + 1)), 15))
            continue
        return r
    return r


def get(path: str, params: dict | None = None) -> dict | None:
    """GET autenticado. Devolve None em 404."""
    r = _chamar("GET", path, params=params)
    if r.status_code == 404:
        return None
    if r.is_error:
        raise RuntimeError(f"Olist {path}: HTTP {r.status_code} {r.text[:300]}")
    return r.json()


def v2(metodo: str, **campos) -> dict:
    """API 2.0 da Olist (token fixo, sem renovação): usada para o que a v3 não faz, como incluir nota fiscal.
    Sem retentativa: repetir uma inclusão pode criar a nota duas vezes."""
    token_v2 = os.environ.get("OLIST_API_TOKEN_SIMPLE", "")
    if not token_v2:
        raise RuntimeError("Defina OLIST_API_TOKEN_SIMPLE no .env da trilha olist")
    _ritmo()
    r = _http.post(f"https://api.tiny.com.br/api2/{metodo}.php", data={"token": token_v2, "formato": "json", **campos})
    retorno = (r.json() if r.content else {}).get("retorno") or {}
    registro = ((retorno.get("registros") or [{}])[0] or {}).get("registro") or {}
    erros = retorno.get("erros") or registro.get("erros")
    if retorno.get("status") != "OK" or registro.get("status") == "Erro":
        raise RuntimeError(f"Olist {metodo}: {erros or retorno.get('status') or r.text[:300]}")
    return retorno


def post(path: str, corpo: dict) -> dict:
    r = _chamar("POST", path, json=corpo)
    if r.is_error:
        raise RuntimeError(f"Olist {path}: HTTP {r.status_code} {r.text[:300]}")
    return r.json() if r.content else {}
