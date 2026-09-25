"""Converte uma reclamação do ML com devolução no contrato da trilha de Devoluções."""

from datetime import datetime

ETAPA = {
    "pending": "solicitada", "label_generated": "solicitada", "scheduled": "solicitada",
    "shipped": "em_transito", "pending_delivered": "em_transito", "not_delivered": "em_transito",
    "delivered": "entregue", "return_to_buyer": "encerrada",
    "cancelled": "cancelada", "pending_cancel": "cancelada", "expired": "cancelada",
    "pending_expiration": "cancelada", "failed": "cancelada", "pending_failure": "cancelada",
}
# rules_engine_triage do /claims/reasons/{id} → (motivo, responsável)
TRIAGEM = {
    "repentant": ("arrependimento", "comprador"),
    "different": ("diferente", "vendedor"),
    "defective": ("defeito", "vendedor"),
    "not_working": ("defeito", "vendedor"),
    "incomplete": ("incompleto", "vendedor"),
}
DESTINO = {"seller_address": "vendedor", "warehouse": "cd_plataforma"}
# Já em mediação o ML não oferece open_dispute, mas deixa mandar prova ao mediador: também é contestar.
CONTESTAR = {"return_review_fail", "open_dispute", "send_message_to_mediator"}


def _data(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso) if iso else None


def _condicao(revisao: dict | None) -> str | None:
    """Resultado da revisão do ML (triagem no CD ou do vendedor): saleable, unsaleable, discard, missing."""
    for r in (revisao or {}).get("reviews") or []:
        for rr in r.get("resource_reviews") or []:
            if rr.get("product_condition"):
                return rr["product_condition"]
    return None


def _mediacao(claim: dict) -> str | None:
    if claim["stage"] != "dispute":
        return None
    if claim["status"] == "opened":
        return "em_andamento"
    beneficiados = set((claim.get("resolution") or {}).get("benefited") or [])
    if beneficiados == {"respondent"}:
        return "ganha"  # respondent = a Novaes (vendedor)
    return "parcial" if "respondent" in beneficiados else "perdida"


def normalizar_nao_entregue(pedido: dict) -> dict:
    """Pacote que não chegou ao comprador e voltou para a Novaes: não tem reclamação, só o pedido cancelado."""
    envio = str(pedido["shipping"]["id"])
    return {
        "plataforma": "mercado_livre",
        "id_externo": f"envio-{envio}",
        "pedido": str(pedido["id"]),
        "pacote": str(pedido.get("pack_id") or "") or None,
        "rastreio": None,
        "etapa": "entregue",
        "status_plataforma": "not_delivered/returned",
        "em_mediacao": False,
        "pode_contestar": False,
        "motivo": "nao_recebido",
        "motivo_plataforma": "pacote_nao_entregue",
        "responsavel": "a_definir",
        "destino": "vendedor",
        "valor_reembolso": None,
        "custo_plataforma": None,
        "afeta_reputacao": False,
        "prazo_vendedor": None,
        "condicao_produto": None,
        "resultado_mediacao": None,
        "cobertura_aplicada": None,
        "itens": [{"item_id": i["item"]["id"], "variation_id": i["item"].get("variation_id"),
                   "sku": i["item"].get("seller_sku"), "nome": i["item"].get("title"),
                   "quantidade": float(i["quantity"])} for i in pedido.get("order_items") or []],
        "aberta_em": _data(pedido["date_created"]),
        "atualizada_em": _data(pedido["last_updated"]),
        "codigos": [pedido["id"], pedido.get("pack_id"), envio],
        "bruto": {"pedido": pedido},
    }


def normalizar(claim: dict, dev: dict, custo: dict | None, reputacao: dict | None, triagem: str | None,
               pedido: dict | None, revisao: dict | None = None) -> dict:
    envio = (dev.get("shipments") or [{}])[0]
    itens_pedido = {i["item"]["id"]: i["item"] for i in (pedido or {}).get("order_items") or []}
    sku_do_item = {k: v.get("seller_sku") for k, v in itens_pedido.items()}
    motivo, responsavel = TRIAGEM.get(triagem, ("outro", "a_definir"))
    valor_custo = custo["amount"] if custo else None
    if valor_custo:
        responsavel = "vendedor"  # a plataforma já está cobrando: não há o que discutir
    acoes = [a for p in claim.get("players") or [] if p["type"] == "seller" for a in p.get("available_actions") or []]
    prazos = [_data(a["due_date"]) for a in acoes if a.get("due_date")]
    afeta = (reputacao or {}).get("affects_reputation")
    return {
        "plataforma": "mercado_livre",
        "id_externo": str(claim["id"]),
        "pedido": str(claim["resource_id"]),
        "pacote": str((pedido or {}).get("pack_id") or "") or None,
        "rastreio": envio.get("tracking_number"),
        # ponytail: status novo do ML cai em "solicitada"; o bruto fica em status_plataforma para revisar o mapa.
        "etapa": ETAPA.get(dev.get("status"), "solicitada"),
        "status_plataforma": dev.get("status") or claim["status"],
        "em_mediacao": claim["stage"] == "dispute",
        "pode_contestar": any(a["action"] in CONTESTAR for a in acoes),
        "motivo": motivo,
        "motivo_plataforma": claim["reason_id"],
        "responsavel": responsavel,
        "destino": "sem_retorno" if dev.get("subtype") == "low_cost" or not envio
                   else DESTINO.get((envio.get("destination") or {}).get("name"), "vendedor"),
        "valor_reembolso": None,
        "custo_plataforma": valor_custo,
        "afeta_reputacao": {"affected": True, "not_affected": False}.get(afeta),
        "prazo_vendedor": min(prazos) if prazos else None,
        "condicao_produto": _condicao(revisao),
        "resultado_mediacao": _mediacao(claim),
        "cobertura_aplicada": (claim.get("resolution") or {}).get("applied_coverage"),
        "itens": [{"item_id": o["item_id"], "variation_id": o.get("variation_id"), "sku": sku_do_item.get(o["item_id"]),
                   "nome": (itens_pedido.get(o["item_id"]) or {}).get("title"),
                   "quantidade": float(o["return_quantity"])} for o in dev.get("orders") or []],
        "aberta_em": _data(claim["date_created"]),
        "atualizada_em": max(_data(claim["last_updated"]), _data(dev.get("last_updated") or claim["last_updated"])),
        # Tudo que pode estar na etiqueta que chega na bancada. O envio original entra porque o comprador
        # às vezes devolve na mesma caixa, com a etiqueta de ida ainda colada.
        "codigos": [claim["id"], claim["resource_id"], (pedido or {}).get("pack_id"), dev.get("id"),
                    ((pedido or {}).get("shipping") or {}).get("id"),
                    *[v for e in dev.get("shipments") or [] for v in (e.get("shipment_id"), e.get("tracking_number"))]],
        "bruto": {"claim": claim, "devolucao": dev, "custo": custo, "reputacao": reputacao, "pedido": pedido,
                  "triagem": triagem, "revisao": revisao},
    }
