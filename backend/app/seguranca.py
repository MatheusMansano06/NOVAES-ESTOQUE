"""
Autenticação da API: operador/master + PIN, sessão assinada em cookie HttpOnly.

Antes a identidade vinha dos headers `x-operator-*`: o cliente dizia "sou master"
e o servidor acreditava, e qualquer pessoa na internet chamava a API sem login.
Agora toda rota /api/* exige uma sessão assinada com SESSION_SECRET (HMAC-SHA256,
só stdlib); a identidade sai dela, nunca de header.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie
from typing import Optional

EM_PRODUCAO = bool(os.getenv("RAILWAY_ENVIRONMENT"))  # PORT existe local também: não serve de sinal

SEGREDO = os.getenv("SESSION_SECRET", "")
if not SEGREDO:
    if EM_PRODUCAO:
        raise RuntimeError("SESSION_SECRET não configurada no ambiente de produção.")
    SEGREDO = secrets.token_urlsafe(48)  # dev: cada restart desloga, aceitável localmente
_SEGREDO = SEGREDO.encode()

COOKIE = "nvs_sessao"
VALIDADE_SEGUNDOS = int(os.getenv("SESSION_TTL_SECONDS", str(12 * 3600)))

# Sem PIN padrão em produção: variável ausente = ninguém entra (falha fechada).
_PIN_DEV = "" if EM_PRODUCAO else "1234"
PIN_MASTER = os.getenv("MASTER_PIN", _PIN_DEV)
PIN_OPERADOR = os.getenv("OPERADOR_PIN", _PIN_DEV)

# Rotas chamadas por fora (marketplaces, OAuth, Olist buscando imagem) ou antes do login.
_PUBLICAS_EXATAS = {
    ("GET", "/api/health"),
    ("GET", "/api/operadores"),  # lista de nomes da tela de login
    ("GET", "/api/sessao"),
    ("POST", "/api/sessao/entrar"),
    ("POST", "/api/sessao/sair"),
    ("POST", "/api/ml/notificacoes"),  # webhook do Mercado Livre
}
_PUBLICAS_PREFIXO = (
    "/api/ml/callback", "/api/olist/callback", "/api/shopee/callback",
    "/api/shopee/webhook", "/api/imagem-quadrada/",
)


def rota_publica(metodo: str, caminho: str) -> bool:
    if metodo == "OPTIONS":
        return True
    caminho = caminho.rstrip("/") or "/"
    return (metodo, caminho) in _PUBLICAS_EXATAS or caminho.startswith(_PUBLICAS_PREFIXO)


# --- Token assinado ----------------------------------------------------------
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(txt: str) -> bytes:
    return base64.urlsafe_b64decode(txt + "=" * (-len(txt) % 4))


def _assinar(dados_b64: str) -> str:
    return _b64e(hmac.new(_SEGREDO, dados_b64.encode(), hashlib.sha256).digest())


def criar_sessao(operador_id: Optional[int], nome: str, papel: str, validade: Optional[int] = None,
                 trocar_pin: bool = False) -> str:
    dados = {"id": operador_id, "nome": nome, "papel": papel, "trocar": trocar_pin,
             "exp": time.time() + (validade if validade is not None else VALIDADE_SEGUNDOS)}
    dados_b64 = _b64e(json.dumps(dados, separators=(",", ":")).encode())
    return f"{dados_b64}.{_assinar(dados_b64)}"


def ler_sessao(token: Optional[str]) -> Optional[dict]:
    """Payload da sessão, ou None se ausente, adulterada ou vencida (falha fechada)."""
    if not token or "." not in token:
        return None
    try:
        dados_b64, assinatura = token.rsplit(".", 1)
        if not hmac.compare_digest(_assinar(dados_b64), assinatura):
            return None
        dados = json.loads(_b64d(dados_b64))
        if float(dados.get("exp", 0)) <= time.time():
            return None
        return dados
    except Exception:
        return None


def pin_confere(pin: str, esperado: str) -> bool:
    return bool(esperado) and hmac.compare_digest(str(pin or "").encode(), esperado.encode())


# --- PIN pessoal do operador (scrypt, RFC 7914 interativo) -------------------------
def hash_pin(pin: str) -> str:
    sal = secrets.token_bytes(16)
    dk = hashlib.scrypt(pin.encode(), salt=sal, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${_b64e(sal)}${_b64e(dk)}"


def pin_confere_hash(pin: str, guardado: Optional[str]) -> bool:
    try:
        algo, sal, dk = (guardado or "").split("$")
        if algo != "scrypt" or not pin:
            return False
        calc = hashlib.scrypt(str(pin).encode(), salt=_b64d(sal), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(calc, _b64d(dk))
    except Exception:
        return False


def problema_no_pin_novo(pin: str) -> Optional[str]:
    """Mensagem do que está errado no PIN escolhido, ou None se serve."""
    if not pin.isdigit() or not 4 <= len(pin) <= 8:
        return "O PIN deve ter de 4 a 8 números."
    if pin == PIN_OPERADOR or len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        return "Escolha um PIN menos óbvio (sem sequência, repetição ou o PIN inicial)."
    return None


def rota_liberada_para_troca(caminho: str) -> bool:
    """Com o PIN inicial, a sessão só serve para definir o PIN pessoal."""
    return caminho.startswith("/api/sessao")


# --- Anti força bruta ----------------------------------------------------------
# ponytail: contador em memória (1 processo); com mais réplicas, mover pro banco.
_TENTATIVAS_IP = 5
_TENTATIVAS_GERAL = 30
_JANELA = 15 * 60
_falhas: dict = {}
_falhas_lock = threading.Lock()


def _recentes(chave: str, agora: float) -> list:
    lista = [t for t in _falhas.get(chave, []) if agora - t < _JANELA]
    _falhas[chave] = lista
    return lista


def login_bloqueado(ip: str) -> bool:
    agora = time.time()
    with _falhas_lock:
        return (len(_recentes(ip, agora)) >= _TENTATIVAS_IP
                or len(_recentes("*", agora)) >= _TENTATIVAS_GERAL)


def registrar_falha(ip: str) -> None:
    agora = time.time()
    with _falhas_lock:
        for chave in (ip, "*"):
            _recentes(chave, agora).append(agora)


def limpar_falhas(ip: str) -> None:
    with _falhas_lock:
        _falhas.pop(ip, None)


def ip_cliente(headers) -> str:
    encaminhado = headers.get("x-forwarded-for", "")
    return encaminhado.split(",")[0].strip() if encaminhado else "local"


# --- Cookie ----------------------------------------------------------------------
def cookie_da_requisicao(headers) -> Optional[str]:
    bruto = headers.get("cookie")
    if not bruto:
        return None
    jar = SimpleCookie()
    try:
        jar.load(bruto)
    except Exception:
        return None
    return jar[COOKIE].value if COOKIE in jar else None


def gravar_cookie(resposta, token: str, https: bool) -> None:
    resposta.set_cookie(COOKIE, token, max_age=VALIDADE_SEGUNDOS, path="/",
                        httponly=True, samesite="lax", secure=https)


def apagar_cookie(resposta) -> None:
    resposta.delete_cookie(COOKIE, path="/")


# --- Middleware ------------------------------------------------------------------
class ProtecaoApi:
    """Toda /api/* não pública sem sessão válida recebe 401. A sessão vai para scope['sessao']."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", [])}
            sessao = ler_sessao(cookie_da_requisicao(headers))
            scope["sessao"] = sessao
            publica = rota_publica(scope["method"], scope["path"])
            if sessao is None and not publica:
                await _responder(send, 401, {"erro": "Sessão expirada ou ausente. Entre novamente."})
                return
            if sessao and sessao.get("trocar") and not publica and not rota_liberada_para_troca(scope["path"]):
                await _responder(send, 403, {"erro": "Defina seu PIN pessoal para continuar.", "trocar_pin": True})
                return
        await self.app(scope, receive, send)


async def _responder(send, status: int, dados: dict) -> None:
    corpo = json.dumps(dados).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(corpo)).encode())]})
    await send({"type": "http.response.body", "body": corpo})
