"""Adapter Shopee — Open Platform Returns (docs/shopee-api-reference.md, seção 7).

ponytail: `GetReturnDetail` não está documentado no reference atual, então
`buscar()` relista e filtra em memória em vez de chamar um endpoint dedicado.
Trocar por chamada direta quando o endpoint de detalhe for confirmado contra
a conta em produção (mesma ressalva da spec: campos de `item_list` seguem a
convenção pública da Shopee mas não foram confirmados ao vivo ainda).
"""
from datetime import datetime, timezone
from typing import Optional
from app.integracoes_shopee import shopee
from app.devolucoes.dto import ReturnCaseDTO, ReturnItemDTO


def _epoch_para_iso(valor) -> Optional[str]:
    if not valor:
        return None
    try:
        return datetime.fromtimestamp(int(valor), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def normalizar_return(payload: dict) -> ReturnCaseDTO:
    itens = [
        ReturnItemDTO(
            sku_esperado=str(item.get("item_sku", "")),
            produto_nome=str(item.get("item_name", "")),
            quantidade=int(item.get("amount", 1) or 1),
        )
        for item in payload.get("item_list", [])
    ]

    return ReturnCaseDTO(
        marketplace="shopee",
        conta=str(payload.get("shop_id", "")),
        order_id=str(payload.get("order_sn", "")),
        claim_id=str(payload.get("return_id", "")),
        status_marketplace=str(payload.get("return_status", "")),
        motivo=str(payload.get("reason", "")),
        prazo_resolucao=_epoch_para_iso(payload.get("return_expiry_time")),
        itens=itens,
    )


class ShopeeReturnsAdapter:
    """Implementa ReturnsPort usando o cliente Shopee já autenticado (integracoes_shopee.shopee)."""

    def listar_pendentes(self) -> list[ReturnCaseDTO]:
        resposta = shopee.chamar("/api/v2/return/get_return_list", {
            "page_no": 1, "page_size": 100, "return_status": "REQUESTED",
        })
        if not resposta or resposta.get("error"):
            return []
        corpo = resposta.get("response") or {}
        return [normalizar_return(item) for item in corpo.get("return_list", [])]

    def buscar(self, id_externo: str) -> Optional[ReturnCaseDTO]:
        for dto in self.listar_pendentes():
            if dto.claim_id == id_externo:
                return dto
        return None
