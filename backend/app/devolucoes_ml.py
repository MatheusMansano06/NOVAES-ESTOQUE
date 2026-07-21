"""
Devoluções ML — camada de API e classificação de claims (Post-Purchase).

Portado de DEVOLUCOES-ML-main/app.py (Flask) em 15/07/2026.

O que mudou em relação ao original, e por quê:

- O OAuth próprio dele (`ml_access_token`, `set_env_values`, tokens no .env) foi
  descartado. Aqui usamos o `ml` (MLIntegration) que já existe no sistema: ele
  guarda o token em arquivo/volume e serializa o refresh sob lock — o
  refresh_token do ML é uso único, e renovação concorrente mata a cadeia.

- O header `x-format-new: true` foi MANTIDO. A Post-Purchase API muda o formato
  do payload com ele, e a classificação abaixo lê campos desse formato
  (`players[].available_actions`, `resolution.benefited`). Sem o header, ela
  silenciosamente para de classificar direito. Por isso este módulo tem o seu
  próprio `_ml_get` em vez de usar o `ml._get_json` genérico.

⚠️ REGRAS CONGELADAS ⚠️
`classify_ml_live_queue_claim()` e seus auxiliares são CONGELADOS pela
BIBLIA_POS_VENDA_ML.md (ver docs/devolucoes/). Estão portados VERBATIM do
original — mesma ordem de testes, mesmas strings de regra. Qualquer alteração
exige aprovação e atualização da bíblia. Não "melhore" nem reordene: a ordem
dos ifs É a regra.
"""

import json
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Optional

import urllib.error
import urllib.parse
import urllib.request

from app.integracoes_ml import ml

API_BASE = "https://api.mercadolibre.com"

# --- Versões das regras (batem com o original; servem de carimbo no cache) ---
ML_CLASSIFIER_VERSION = "actions-v27"
ML_CLOSED_TOUCH_GAP_HOURS = 24
# v3: passou a capturar shipment_id + tracking_number (a etiqueta que o operador
# BIPA no barracão). O bump força o sync a re-inspecionar os claims cacheados e
# preencher esses campos — sem ele, a bipagem por shipment_id não acha nada.
ML_ENRICHMENT_VERSION = "enrich-v3"

MOTIVO_LABELS = {
    "PDD9939": "O comprador se arrependeu",
    "PDD9949": "O produto nao funciona",
    "PDD9967": "Para retirar no correio",
    "PDD9968": "Produto diferente",
    "PDD9941": "Acessorio faltando",
    "PDD9942": "Produto incompleto",
    "PDD9944": "Produto danificado",
    "PDD9946": "A embalagem chegou danificada",
    "PDD9952": "Afetou a reputacao",
}


class MLDevolucoesError(RuntimeError):
    """Falha ao falar com a Post-Purchase API."""


# ---------------------------------------------------------------- API do ML

def _ml_request(method: str, path: str, params: Optional[dict] = None,
                body: Optional[dict] = None, timeout: int = 20) -> tuple[int, str]:
    """
    Chamada crua à API do ML com o token do MLIntegration.

    Em 401 renova o token UMA vez e repete, passando o token que falhou para o
    get_access_token — assim, se outra thread já renovou, aproveitamos o token
    dela em vez de queimar o refresh_token de novo.
    """
    token = ml.get_access_token()
    if not token:
        raise MLDevolucoesError("Mercado Livre não conectado (sem access_token). "
                                "Reconecte em /api/ml/conectar.")

    def _send(tok: str) -> tuple[int, str]:
        url = f"{API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {tok}",
            # Obrigatório na Post-Purchase: define o formato que a classificação lê.
            "x-format-new": "true",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data else {}),
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    status, texto = _send(token)
    if status == 401:
        token = ml.get_access_token(invalidar=token)
        if not token:
            raise MLDevolucoesError("Mercado Livre respondeu 401 e o refresh falhou. "
                                    "Reconecte em /api/ml/conectar.")
        status, texto = _send(token)
    if status >= 400:
        raise MLDevolucoesError(f"Mercado Livre respondeu {status} em {path}: {texto[:300]}")
    return status, texto


def ml_get(path: str, params: Optional[dict] = None) -> dict:
    """GET na API do ML devolvendo dict ({} quando o corpo vem vazio)."""
    _, texto = _ml_request("GET", path, params=params)
    if not texto:
        return {}
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        return {}


def ml_post(path: str, body: Optional[dict] = None, params: Optional[dict] = None) -> dict:
    _, texto = _ml_request("POST", path, params=params, body=body)
    if not texto:
        return {}
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        return {}


# --------------------------------------------------- Ações sobre o ML (mutação)
# Endpoints da BIBLIA_POS_VENDA_ML.md. Todos exigem que a ação exista em
# available_actions do claim — o handler valida antes de chamar. São operações
# de EFEITO: reembolso mexe em dinheiro, review/allow-return encerram etapa.
# Por isso ficam separadas e o handler só as dispara com confirmação do operador.
#
# ⚠️ Os corpos exatos (schema do body) não puderam ser verificados na doc oficial
# (portal responde 403 a acesso automatizado). Os campos abaixo seguem o padrão
# observado; se o ML recusar (4xx), o texto do erro volta cru para diagnóstico.

def enviar_return_review(return_id: str, aprovado: bool) -> dict:
    """
    Revisão unificada da devolução: 'chegou como esperado' (ok) ou 'com problema'
    (fail). POST /post-purchase/v1/returns/{return_id}/return-review.
    """
    status = "success" if aprovado else "failed"
    return ml_post(f"/post-purchase/v1/returns/{return_id}/return-review",
                   body={"status": status})


def oferecer_reembolso_total(claim_id: str) -> dict:
    """Reembolso TOTAL ao comprador (endpoint próprio, != partial)."""
    return ml_post(f"/post-purchase/v1/claims/{claim_id}/expected-resolutions/refund")


def oferecer_reembolso_parcial(claim_id: str, valor: float) -> dict:
    """Reembolso PARCIAL — nunca equivale a 100% (esse usa /refund)."""
    return ml_post(f"/post-purchase/v1/claims/{claim_id}/expected-resolutions/partial-refund",
                   body={"amount": round(float(valor or 0), 2)})


def permitir_devolucao(claim_id: str) -> dict:
    """Aceita a devolução (allow-return) — libera o retorno do produto."""
    return ml_post(f"/post-purchase/v1/claims/{claim_id}/expected-resolutions/allow-return")


# --------------------------------------------------- Auxiliares (VERBATIM)

def normalized_ml_text(value: Optional[str]) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def motivo_label(reason_id: Optional[str]) -> str:
    """Rótulo legível do motivo. Reason_id desconhecido volta cru (e '-' se vazio)."""
    return MOTIVO_LABELS.get(str(reason_id or ""), str(reason_id or "") or "-")


def claim_available_actions(claim: dict) -> list[dict]:
    return [
        action
        for player in claim.get("players") or []
        for action in player.get("available_actions") or []
    ]


def action_names(claim: dict) -> list[str]:
    return sorted({str(action.get("action") or "") for action in claim_available_actions(claim) if action.get("action")})


def parse_ml_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def claim_benefited_complainant_only(claim: dict) -> bool:
    resolution = claim.get("resolution") or {}
    benefited = resolution.get("benefited") or []
    return list(benefited) == ["complainant"]


def claim_touched_after_resolution(claim: dict) -> bool:
    resolution = claim.get("resolution") or {}
    res_date = parse_ml_datetime(resolution.get("date_created"))
    last_updated = parse_ml_datetime(claim.get("last_updated"))
    if not res_date or not last_updated:
        return False
    gap = last_updated - res_date
    return gap >= timedelta(hours=ML_CLOSED_TOUCH_GAP_HOURS)


@lru_cache(maxsize=4096)
def claim_attention_detail(claim_id: str, claim_last_updated: str = "") -> dict:
    """
    Detalhe do claim (título/responsável), que decide vários buckets.

    Cacheado por (claim_id, last_updated): o last_updated no argumento é o que
    invalida a entrada quando o claim muda — não removê-lo. É chamado só quando
    realmente decide o bucket, porque é 1 request por claim.
    """
    cid = str(claim_id or "").strip()
    if not cid:
        return {"title": "", "action_responsible": "", "due_date": "", "problem": ""}
    try:
        detail = ml_get(f"/post-purchase/v1/claims/{cid}/detail")
    except Exception:
        return {"title": "", "action_responsible": "", "due_date": "", "problem": ""}
    return {
        "title": normalized_ml_text(detail.get("title")),
        "action_responsible": normalized_ml_text(detail.get("action_responsible")),
        "due_date": str(detail.get("due_date") or ""),
        "problem": normalized_ml_text(detail.get("problem")),
    }


# ==========================================================================
# REGRAS CANÔNICAS — CONGELADAS (BIBLIA_POS_VENDA_ML.md)
# --------------------------------------------------------------------------
# Portado VERBATIM de DEVOLUCOES-ML-main/app.py:1671.
# A ORDEM DOS TESTES É A REGRA. Não reordenar, não simplificar, não "limpar"
# os comentários: eles mapeiam para as linhas da bíblia. Alterar exige
# aprovação + atualização de docs/devolucoes/BIBLIA_POS_VENDA_ML.md.
#
# Buckets de saída: para_revisao | para_retirar | outros_problemas | fora_da_fila
# O 2º item da tupla é a "regra" — é o que permite auditar depois por que um
# claim caiu numa fila. Gravado em ml_claim_classifications.regra.
# ==========================================================================

def classify_ml_live_queue_claim(claim: dict, return_info: dict) -> tuple[str, str]:
    actions = set(action_names(claim))
    return_status = str(return_info.get("status") or "").lower()
    shipment_status = str(return_info.get("shipment_status") or "").lower()
    destination = str(return_info.get("shipment_destination") or "").lower()
    claim_type = str(claim.get("type") or "").lower()
    claim_status = str(claim.get("status") or "").lower()
    claim_stage = str(claim.get("stage") or "").lower()
    claim_id = str(claim.get("id") or "")
    review_actions = {"return_review_unified_ok", "return_review_unified_fail", "return_review_ok", "return_review_fail"}
    # Evita chamadas caras de detail para todo o universo de claims:
    # busca detail apenas quando ele realmente decide o bucket.
    needs_attention_detail = (
        bool(actions.intersection(review_actions))
        or ("send_message_to_mediator" in actions)
        or (destination == "warehouse" and return_status == "delivered" and shipment_status == "delivered")
    )
    attention = claim_attention_detail(claim_id, str(claim.get("last_updated") or "")) if needs_attention_detail else {}
    attention_title = str(attention.get("title") or "")
    attention_responsible = str(attention.get("action_responsible") or "")

    # "Retirar no correio": prioriza sinal explicito do proprio detalhe do ML.
    # Ex.: "Devolucao para retirar na Correios ate ...".
    if (
        "retirar na correios" in attention_title
        and attention_responsible in {"respondent", "seller"}
        and destination == "seller_address"
        and return_status in {"label_generated", "shipped", "delivered"}
        and shipment_status in {"ready_to_ship", "shipped", "delivered"}
    ):
        return "para_retirar", f"detail_pickup_correios:{return_status}:{shipment_status}:{destination}"

    # Fallback para "retirar no correio" via acao de revisao com prazo.
    # Mantemos estrito: so entra se o titulo do ML indicar retirada na Correios.
    pickup_action = next(
        (
            action
            for action in claim_available_actions(claim)
            if action.get("action") == "return_review_ok" and action.get("due_date")
        ),
        None,
    )
    if pickup_action:
        due = parse_ml_datetime(str(pickup_action.get("due_date") or ""))
        if (
            due
            and bool(pickup_action.get("mandatory"))
            and "retirar na correios" in attention_title
            and destination == "seller_address"
            and return_status in {"label_generated", "shipped", "delivered"}
            and shipment_status in {"ready_to_ship", "shipped", "delivered"}
        ):
            return "para_retirar", "seller_pickup_review_due:return_review_ok"

    has_review = bool(actions.intersection(review_actions))
    return_related = return_info.get("related_entities") or []
    already_reviewed = "reviews" in return_related
    if has_review and not already_reviewed:
        # Em FULL/warehouse com devolucao ainda em transito ("devolucao com data atualizada"),
        # o ML ainda esta conduzindo a revisao e nao deve entrar em "para sua revisao".
        if destination == "warehouse" and return_status == "shipped" and shipment_status in {"shipped", "ready_to_ship"}:
            return "fora_da_fila", f"return_updated_date_in_transit:{return_status}:{shipment_status}:{destination}"
        if "devolucao com data atualizada" in attention_title:
            return "fora_da_fila", f"return_updated_date_title:{attention_responsible}:{return_status}:{shipment_status}"
        return "para_revisao", "seller_available_action:return_review"

    if "send_message_to_mediator" in actions:
        mediation_like = claim_type == "mediations" or claim_stage == "dispute"
        if mediation_like:
            # Casos equivalentes aos que o ML mostra em "Outros problemas":
            # devolucao em revisao conduzida pelo mediador.
            if (
                destination == "warehouse"
                and return_status == "delivered"
                and shipment_status == "delivered"
                and "devolucao em revisao" in attention_title
                and attention_responsible == "mediator"
            ):
                return "outros_problemas", f"ml_internal_review_waiting_mediator:{return_status}:{shipment_status}:{destination}"
            # Casos de "devolucao em revisao / data atualizada" no ML nao entram em "Proximas a serem atendidas".
            # Ex.: retorno entregue no warehouse, revisao interna da plataforma.
            if (
                destination == "warehouse"
                and return_status in {"delivered", "expired"}
                and shipment_status in {"delivered", "cancelled"}
            ):
                return "fora_da_fila", f"ml_internal_review_or_updated_date:{return_status}:{shipment_status}:{destination}"
            if destination == "seller_address" and return_status == "expired" and shipment_status == "cancelled":
                return "fora_da_fila", f"mediation_waiting_ml_resolution:{return_status}:{shipment_status}:{destination}"
            if attention_responsible in {"complainant", "mediator"} and "mediacao em espera de resposta do mercado livre" in attention_title:
                return "fora_da_fila", f"ml_waiting_platform_response:{attention_responsible}:{return_status}:{shipment_status}"
            if return_status in {"", "label_generated", "failed"}:
                return "fora_da_fila", f"mediation_message_to_mediator_not_next_attention:{return_status}:{shipment_status}:{destination}"
            return "outros_problemas", "seller_available_action:send_message_to_mediator"
        return "fora_da_fila", f"message_to_mediator_non_mediation:{return_status}:{shipment_status}:{destination}"

    if (
        str(claim.get("status") or "") == "closed"
        and claim_benefited_complainant_only(claim)
        and claim_touched_after_resolution(claim)
        and return_status == "delivered"
    ):
        if (
            destination == "warehouse"
            and shipment_status == "delivered"
            and "devolucao em revisao" in attention_title
            and attention_responsible == "mediator"
        ):
            return "outros_problemas", f"ml_internal_review_waiting_mediator:{return_status}:{shipment_status}:{destination}"
        return "fora_da_fila", "closed_resolved_not_next_attention"

    if return_status == "label_generated":
        return "fora_da_fila", f"return_label_generated_not_target_filter:{shipment_status}:{destination}"

    if claim_type == "returns" and return_status in {"failed", "cancelled"}:
        return "fora_da_fila", f"return_problem_status_not_target_filter:{return_status}:{shipment_status}:{destination}"
    if claim_type == "returns" and return_status in {"label_generated", "shipped", "in_return", "processing"}:
        return "fora_da_fila", f"return_in_progress_not_next_attention:{return_status}:{shipment_status}:{destination}"
    if (
        destination == "warehouse"
        and return_status == "delivered"
        and shipment_status == "delivered"
        and "devolucao em revisao" in attention_title
        and attention_responsible == "mediator"
    ):
        return "outros_problemas", f"ml_internal_review_waiting_mediator:{return_status}:{shipment_status}:{destination}"
    return "fora_da_fila", f"no_matching_queue_rule:{return_status}:{shipment_status}"
