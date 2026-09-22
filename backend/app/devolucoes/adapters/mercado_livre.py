"""Adapter Mercado Livre — Post-Purchase API.

Endpoints canônicos (ver docs/devolucoes/BIBLIA_POS_VENDA_ML.md, que é fonte
de verdade sobre a API do ML mesmo com o módulo antigo removido):
  GET /post-purchase/v1/claims/search
  GET /post-purchase/v1/claims/{claim_id}
  GET /post-purchase/v2/claims/{claim_id}/returns

Regra 5 da BIBLIA: busca de claims precisa de filtro de negócio, não só
`status=opened` — `player_id` do vendedor é o filtro mínimo aqui.
"""
from typing import Optional
from app.integracoes_ml import ml
from app.devolucoes.dto import ReturnCaseDTO, ReturnItemDTO, TrackingEventDTO


def normalizar_claim(payload: dict) -> ReturnCaseDTO:
    itens = [
        ReturnItemDTO(
            sku_esperado=str(item.get("item", {}).get("seller_sku", "")),
            produto_nome=str(item.get("item", {}).get("title", "")),
            quantidade=int(item.get("quantity", 1) or 1),
        )
        for item in payload.get("order_items", [])
    ]

    return ReturnCaseDTO(
        marketplace="mercado_livre",
        conta=str(ml.user_id),
        order_id=str(payload.get("resource_id", "")),
        claim_id=str(payload.get("id", "")),
        status_marketplace=str(payload.get("status", "")),
        motivo=str(payload.get("reason_id", "")),
        prazo_resolucao=payload.get("due_date"),
        itens=itens,
    )


def normalizar_eventos(payload: dict) -> list[TrackingEventDTO]:
    shipping = payload.get("shipping") or {}
    status = shipping.get("status")
    if not status:
        return []
    return [TrackingEventDTO(
        status=str(status),
        descricao=str(shipping.get("substatus", "")),
        data_hora=str(payload.get("last_updated") or ""),
        origem="marketplace",
    )]


class MercadoLivreReturnsAdapter:
    """Implementa ReturnsPort usando o cliente ML já autenticado (integracoes_ml.ml)."""

    def listar_pendentes(self) -> list[ReturnCaseDTO]:
        if not ml.user_id:
            return []
        busca = ml._get("/post-purchase/v1/claims/search", {
            "player_id": ml.user_id, "status": "opened",
        }) or {}
        resultados = []
        for claim in busca.get("data", []):
            claim_id = claim.get("id")
            if claim_id:
                dto = self.buscar(str(claim_id))
                if dto:
                    resultados.append(dto)
        return resultados

    def buscar(self, id_externo: str) -> Optional[ReturnCaseDTO]:
        claim = ml._get(f"/post-purchase/v1/claims/{id_externo}")
        if not claim:
            return None
        dto = normalizar_claim(claim)
        returns = ml._get(f"/post-purchase/v2/claims/{id_externo}/returns") or {}
        dto.eventos = normalizar_eventos(returns)
        return dto
