"""
Envio de alertas - provider-agnóstico (Telegram, WhatsApp, webhook)

Uso:
    from app.notificacoes import enviar_alerta
    enviar_alerta("Estoque do SKU X abaixo do mínimo")

Descobrir o chat id do Telegram (depois de mandar qualquer mensagem pro bot):
    python -m app.notificacoes

Providers (env ALERTA_PROVIDER):
- telegram  -> TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
- twilio    -> TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (+ WHATSAPP_NUMBER)
- evolution -> EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_APIKEY (+ WHATSAPP_NUMBER)
- cloud     -> WA_CLOUD_PHONE_ID, WA_CLOUD_TOKEN (+ WHATSAPP_NUMBER)
- webhook   -> WA_WEBHOOK_URL (+ WA_WEBHOOK_TOKEN opcional)
- log       -> só imprime no stdout (default quando nada está configurado)

Regras:
- NUNCA levanta exceção pra fora: é alerta, não pode derrubar o job. Retorna bool.
- Anti-spam: a mesma mensagem não é reenviada dentro de ALERTA_DEDUP_MIN minutos
  (default 60). O estado fica em alertas_dedup.json no ML_DATA_DIR.
"""

import os
import json
import time
import base64
import hashlib
import threading
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional, Dict
from dotenv import load_dotenv

load_dotenv()

_BASE_DIR = os.path.abspath(os.path.dirname(__file__))
_DEFAULT_DATA_DIR = os.path.abspath(os.path.join(_BASE_DIR, ".."))
_DATA_DIR = os.path.abspath(os.getenv("ML_DATA_DIR") or _DEFAULT_DATA_DIR)
os.makedirs(_DATA_DIR, exist_ok=True)
DEDUP_FILE = os.path.abspath(os.path.join(_DATA_DIR, "alertas_dedup.json"))

# Limite prático de corpo de mensagem (Telegram corta em 4096; Cloud API idem)
MAX_CHARS = 3500
TRUNC_SUFIXO = "… (truncado)"
TIMEOUT = 20

_dedup_lock = threading.Lock()


# ---------------------------------------------------------------- utilidades

def _env(nome: str) -> str:
    """Lê env já sem espaços nas pontas (retorna string vazia se ausente)."""
    return (os.getenv(nome) or "").strip()


def _truncar(mensagem: str) -> str:
    if len(mensagem) <= MAX_CHARS:
        return mensagem
    return mensagem[: MAX_CHARS - len(TRUNC_SUFIXO)] + TRUNC_SUFIXO


def _normalizar_numero(numero: str) -> str:
    """Só dígitos — usado nos providers de WhatsApp (o provider recoloca o formato).
    NÃO serve pro Telegram: chat id de grupo é negativo e perderia o sinal."""
    return "".join(c for c in (numero or "") if c.isdigit())


def _detectar_provider() -> str:
    """Provider explícito por env; senão infere pelas credenciais presentes; senão 'log'."""
    escolhido = _env("ALERTA_PROVIDER").lower()
    if escolhido:
        return escolhido
    if _env("TELEGRAM_BOT_TOKEN"):
        return "telegram"
    if _env("TWILIO_ACCOUNT_SID") and _env("TWILIO_AUTH_TOKEN"):
        return "twilio"
    if _env("EVOLUTION_URL") and _env("EVOLUTION_INSTANCE"):
        return "evolution"
    if _env("WA_CLOUD_PHONE_ID") and _env("WA_CLOUD_TOKEN"):
        return "cloud"
    if _env("WA_WEBHOOK_URL"):
        return "webhook"
    return "log"


def _destino_padrao(provider: str) -> str:
    """Cada canal tem o seu endereço: chat id no Telegram, telefone no WhatsApp."""
    if provider == "telegram":
        return _env("TELEGRAM_CHAT_ID")
    return _normalizar_numero(_env("WHATSAPP_NUMBER"))


def _http(url: str, data: Optional[bytes], headers: Dict[str, str], metodo: str = "POST") -> bool:
    """POST simples via urllib. True se 2xx. Nunca levanta."""
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=metodo)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            corpo = r.read().decode("utf-8", errors="replace")
            ok = 200 <= r.status < 300
            if not ok:
                print(f"[ALERTA] HTTP {r.status}: {corpo[:300]}")
            return ok
    except urllib.error.HTTPError as e:
        try:
            corpo = e.read().decode("utf-8", errors="replace")
        except Exception:
            corpo = ""
        print(f"[ALERTA] HTTP {e.code}: {corpo[:300]}")
        return False
    except Exception as e:
        print(f"[ALERTA] erro de rede: {e}")
        return False


# ------------------------------------------------------------------ anti-spam

def _carregar_dedup() -> Dict[str, float]:
    try:
        with open(DEDUP_FILE, "r", encoding="utf-8") as f:
            dados = json.load(f)
        return {k: float(v) for k, v in dados.items()} if isinstance(dados, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f"[ALERTA] dedup ilegível ({e}), recomeçando")
        return {}


def _janela_dedup_seg() -> float:
    try:
        minutos = float(_env("ALERTA_DEDUP_MIN") or 60)
    except ValueError:
        minutos = 60.0
    return max(0.0, minutos) * 60.0


def _ja_enviado_recentemente(chave: str) -> bool:
    """True se a mesma mensagem/destino já saiu dentro da janela. Registra quando libera."""
    janela = _janela_dedup_seg()
    if janela <= 0:
        return False
    agora = time.time()
    with _dedup_lock:
        registros = _carregar_dedup()
        # limpa o que já venceu (evita o arquivo crescer pra sempre)
        registros = {k: t for k, t in registros.items() if agora - t < janela}
        if chave in registros:
            return True
        registros[chave] = agora
        try:
            with open(DEDUP_FILE, "w", encoding="utf-8") as f:
                json.dump(registros, f)
        except Exception as e:
            print(f"[ALERTA] falha ao gravar dedup: {e}")
        return False


def _liberar_dedup(chave: str) -> None:
    """Desfaz o registro quando o envio falhou, pra próxima rodada tentar de novo."""
    with _dedup_lock:
        registros = _carregar_dedup()
        if registros.pop(chave, None) is None:
            return
        try:
            with open(DEDUP_FILE, "w", encoding="utf-8") as f:
                json.dump(registros, f)
        except Exception as e:
            print(f"[ALERTA] falha ao limpar dedup: {e}")


# ------------------------------------------------------------------ providers

def _enviar_telegram(destino: str, mensagem: str) -> bool:
    token = _env("TELEGRAM_BOT_TOKEN")
    if not token:
        print("[ALERTA] telegram sem TELEGRAM_BOT_TOKEN")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    # Sem parse_mode de propósito: SKU com _ ou * quebraria a formatação Markdown
    # e o Telegram recusaria a mensagem inteira.
    corpo = json.dumps({
        "chat_id": destino,
        "text": mensagem,
        "disable_web_page_preview": True,
    }).encode("utf-8")
    return _http(url, corpo, {"Content-Type": "application/json", "Accept": "application/json"})


def _enviar_twilio(destino: str, mensagem: str) -> bool:
    sid = _env("TWILIO_ACCOUNT_SID")
    token = _env("TWILIO_AUTH_TOKEN")
    origem = _env("TWILIO_WHATSAPP_FROM")
    if not (sid and token and origem):
        print("[ALERTA] twilio sem TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM")
        return False
    if not origem.startswith("whatsapp:"):
        origem = f"whatsapp:{origem}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{urllib.parse.quote(sid)}/Messages.json"
    corpo = urllib.parse.urlencode({
        "To": f"whatsapp:+{destino}",
        "From": origem,
        "Body": mensagem,
    }).encode("utf-8")
    basic = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
    return _http(url, corpo, {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    })


def _enviar_evolution(destino: str, mensagem: str) -> bool:
    base = _env("EVOLUTION_URL").rstrip("/")
    instancia = _env("EVOLUTION_INSTANCE")
    apikey = _env("EVOLUTION_APIKEY")
    if not (base and instancia):
        print("[ALERTA] evolution sem EVOLUTION_URL/EVOLUTION_INSTANCE")
        return False
    url = f"{base}/message/sendText/{urllib.parse.quote(instancia)}"
    corpo = json.dumps({"number": destino, "text": mensagem}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if apikey:
        headers["apikey"] = apikey
    return _http(url, corpo, headers)


def _enviar_cloud(destino: str, mensagem: str) -> bool:
    phone_id = _env("WA_CLOUD_PHONE_ID")
    token = _env("WA_CLOUD_TOKEN")
    if not (phone_id and token):
        print("[ALERTA] cloud sem WA_CLOUD_PHONE_ID/WA_CLOUD_TOKEN")
        return False
    versao = _env("WA_CLOUD_API_VERSION") or "v20.0"
    url = f"https://graph.facebook.com/{versao}/{urllib.parse.quote(phone_id)}/messages"
    corpo = json.dumps({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": destino,
        "type": "text",
        "text": {"preview_url": False, "body": mensagem},
    }).encode("utf-8")
    return _http(url, corpo, {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })


def _enviar_webhook(destino: str, mensagem: str) -> bool:
    url = _env("WA_WEBHOOK_URL")
    if not url:
        print("[ALERTA] webhook sem WA_WEBHOOK_URL")
        return False
    corpo = json.dumps({"phone": destino, "message": mensagem}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = _env("WA_WEBHOOK_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return _http(url, corpo, headers)


def _enviar_log(destino: str, mensagem: str) -> bool:
    """Modo sem credencial: não envia nada, só registra (deixa o sistema testável)."""
    print(f"[ALERTA] (log) para {destino or '(sem destino)'}: {mensagem}")
    return True


_PROVIDERS = {
    "telegram": _enviar_telegram,
    "twilio": _enviar_twilio,
    "evolution": _enviar_evolution,
    "cloud": _enviar_cloud,
    "webhook": _enviar_webhook,
    "log": _enviar_log,
}


# -------------------------------------------------------------------- público

def enviar_alerta(mensagem: str, destino: Optional[str] = None) -> str:
    """
    Envia um alerta pelo canal configurado. Nunca levanta exceção.

    Devolve "enviado", "dedup" (suprimido por ser repetição recente) ou "erro".
    Quem chama precisa distinguir os dois primeiros: se um teto de mensagens
    contasse o dedup como envio, as vagas seriam gastas com alertas que ninguém
    recebeu e o resto da fila nunca sairia.
    """
    try:
        texto = _truncar((mensagem or "").strip())
        if not texto:
            print("[ALERTA] mensagem vazia, ignorando")
            return "erro"

        provider = _detectar_provider()
        envio = _PROVIDERS.get(provider)
        if envio is None:
            print(f"[ALERTA] provider desconhecido: {provider}")
            return "erro"

        alvo = (destino or "").strip() or _destino_padrao(provider)
        if not alvo and provider != "log":
            faltando = "TELEGRAM_CHAT_ID" if provider == "telegram" else "WHATSAPP_NUMBER"
            print(f"[ALERTA] sem destino (defina {faltando}) - provider {provider}")
            return "erro"

        # anti-spam: mesmo texto + mesmo destino + mesmo provider dentro da janela
        chave = hashlib.sha256(f"{provider}|{alvo}|{texto}".encode("utf-8")).hexdigest()
        if _ja_enviado_recentemente(chave):
            print("[ALERTA] duplicado dentro da janela de dedup, não reenviado")
            return "dedup"

        if envio(alvo, texto):
            print(f"[ALERTA] enviado via {provider}")
            return "enviado"
        # falhou: solta o dedup pra próxima rodada poder tentar de novo
        _liberar_dedup(chave)
        print(f"[ALERTA] falha no envio via {provider}")
        return "erro"
    except Exception as e:
        # alerta nunca derruba o job que o chamou
        print(f"[ALERTA] erro inesperado: {e}")
        return "erro"


def descobrir_chat_id_telegram() -> None:
    """Imprime os chat ids que já falaram com o bot (getUpdates).

    Passo chato do setup: o Telegram não diz o seu chat id em lugar nenhum da
    interface. Mande qualquer mensagem pro bot e rode `python -m app.notificacoes`.
    """
    token = _env("TELEGRAM_BOT_TOKEN")
    if not token:
        print("Defina TELEGRAM_BOT_TOKEN no .env antes (o token vem do @BotFather).")
        return
    try:
        url = f"https://api.telegram.org/bot{token}/getUpdates"
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            dados = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"Falha ao consultar o Telegram: {e}")
        return

    if not dados.get("ok"):
        print(f"Telegram recusou: {dados}")
        return

    achados = {}
    for upd in dados.get("result") or []:
        msg = upd.get("message") or upd.get("channel_post") or {}
        chat = msg.get("chat") or {}
        if chat.get("id") is not None:
            nome = chat.get("title") or chat.get("first_name") or chat.get("username") or ""
            achados[str(chat["id"])] = f"{nome} ({chat.get('type')})"

    if not achados:
        print("Nenhuma conversa encontrada. Abra o Telegram, mande uma mensagem")
        print("qualquer pro seu bot e rode este comando de novo.")
        return

    print("Chat ids encontrados — copie o seu pro TELEGRAM_CHAT_ID no .env:")
    for chat_id, desc in achados.items():
        print(f"  TELEGRAM_CHAT_ID={chat_id}    # {desc}")


if __name__ == "__main__":
    descobrir_chat_id_telegram()
