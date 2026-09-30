"""Converte uma devolução da Shopee (+ extrato do pedido) no contrato da trilha de Devoluções."""

from datetime import datetime, timezone

ETAPA = {
    "REQUESTED": "solicitada", "PROCESSING": "solicitada",
    # ponytail: ACCEPTED = aprovada e voltando; separar trânsito de entregue exige get_reverse_tracking_info.
    "ACCEPTED": "em_transito",
    "COMPLETED": "encerrada", "CLOSED": "encerrada", "CANCELLED": "cancelada",
    # JUDGING / SELLER_DISPUTE não dizem onde o produto está: caem em "solicitada" com em_mediacao=True.
}
DISPUTA = ("JUDGING", "SELLER_DISPUTE")
MOTIVO = {
    "CHANGE_MIND": ("arrependimento", "comprador"),
    "ITEM_NOT_FIT": ("nao_serviu", "comprador"),
    "WRONG_ITEM": ("diferente", "vendedor"),
    "ITEM_MISSING": ("incompleto", "vendedor"),
    "FUNCTIONAL_DMG": ("defeito", "vendedor"),
    # Danificado depende da análise de embalagem da Shopee.
    "DAMAGED_OTHERS": ("danificado", "a_definir"),
    "BROKEN_PRODUCTS": ("danificado", "a_definir"),
    "NOT_RECEIPT": ("nao_recebido", "a_definir"),
    "SUSPICIOUS_PARCEL": ("outro", "a_definir"),
}


def resultado_disputa(dev: dict) -> str | None:
    """A Returns API não diz "houve disputa" depois que ela acaba; o que sobra são as marcas dela:
    - status SELLER_DISPUTE / JUDGING: disputa em andamento;
    - reassessed_request_reason: a Shopee julgou e reclassificou o motivo do comprador;
    - seller_compensation_status: fluxo de compensação ao vendedor, que só existe depois de contestar.
    Resultado: reclassificou para culpa do comprador (ex.: "item errado" → "mudou de ideia") ou a devolução foi
    cancelada/encerrada = ganha; compensação pendente = em andamento; o resto (reembolso com culpa da loja) = perdida.
    ponytail: regra montada pelos campos da Returns API; se o painel da Shopee mostrar outro desfecho, ajustar aqui."""
    reavaliado = dev.get("reassessed_request_reason") or "NONE"
    compensacao = dev.get("seller_compensation_status") or ""
    if dev["status"] not in DISPUTA and reavaliado == "NONE" and not compensacao:
        return None
    if dev["status"] in DISPUTA or dev["status"] in ("REQUESTED", "PROCESSING") or compensacao == "PENDING_REQUEST":
        return "em_andamento"
    if dev["status"] in ("CANCELLED", "CLOSED") or MOTIVO.get(reavaliado, ("", ""))[1] == "comprador":
        return "ganha"
    return "perdida"


def _data(epoch: int | None) -> datetime | None:
    return datetime.fromtimestamp(epoch, timezone.utc) if epoch else None


def _custo(renda: dict, responsavel: str) -> float | None:
    """Taxa fixa de devolução (reverse_shipping_fee) + frete de envio, este só quando a culpa é do vendedor:
    final_shipping_fee negativo existe em toda venda (parte do frete que a loja paga) e não é custo da devolução."""
    if not renda:
        return None
    taxa = renda.get("reverse_shipping_fee") or 0
    # ponytail: em caso do vendedor o frete cobrado inclui a parte normal da loja; separar exige o frete da venda original.
    frete = max(0, -(renda.get("final_shipping_fee") or 0)) if responsavel == "vendedor" or taxa else 0
    return round(taxa + frete, 2)


# Pedido cancelado por falha de entrega da transportadora: não é uma "devolução" na API da Shopee (sem return_sn),
# é o próprio pedido voltando — rastreio reverso vem de logistics/get_tracking_number e get_tracking_info.
_ETAPA_RASTREIO = {"RETURNED": "entregue", "RETURN_STARTED": "em_transito", "RETURN_INITIATED": "em_transito"}


def etapa_rastreio_reverso(eventos: list[dict]) -> str:
    """`eventos` vem mais recente primeiro (get_tracking_info); o primeiro que bater diz onde o pacote está."""
    for e in eventos or []:
        if (s := _ETAPA_RASTREIO.get(e.get("logistics_status"))):
            return s
    return "solicitada"


def normalizar_falha_entrega(pedido: dict, pacote: dict, tracking_number: str | None, eventos: list[dict]) -> dict:
    return {
        "plataforma": "shopee",
        # prefixo pra nunca colidir com um return_sn de verdade: esse pedido nunca teve devolução formal na Shopee.
        "id_externo": f"RTS-{pedido['order_sn']}",
        "pedido": pedido["order_sn"],
        "pacote": pacote.get("package_number"),
        "rastreio": tracking_number,
        "etapa": etapa_rastreio_reverso(eventos),
        "status_plataforma": pacote.get("logistics_status") or "LOGISTICS_DELIVERY_FAILED",
        "em_mediacao": False,
        "pode_contestar": False,  # cancelado pelo sistema da Shopee: não existe fluxo de disputa aqui
        "motivo": "falha_entrega",
        "motivo_plataforma": pacote.get("logistics_status") or "LOGISTICS_DELIVERY_FAILED",
        "responsavel": "a_definir",  # não é culpa da Novaes nem do comprador — da transportadora
        "destino": "vendedor",
        "valor_reembolso": None,
        "custo_plataforma": pedido.get("reverse_shipping_fee") or 0,
        "afeta_reputacao": None,
        "prazo_vendedor": None,
        "condicao_produto": None,
        "resultado_mediacao": None,
        "cobertura_aplicada": None,
        "itens": [{"item_id": i.get("item_id"), "model_id": i.get("model_id"), "sku": i.get("model_sku"),
                   "quantidade": i.get("model_quantity"), "nome": i.get("item_name"), "imagem": None}
                  for i in pedido.get("item_list") or []],
        "aberta_em": _data(pedido.get("create_time")),
        "atualizada_em": _data(eventos[0]["update_time"]) if eventos else _data(pedido.get("update_time")),
        "codigos": [pedido["order_sn"], pacote.get("package_number"), tracking_number],
        # "rastreio_eventos" (não "rastreio_reverso"): essa chave no fluxo normal da Returns API é um dict
        # (get_reverse_tracking_info); aqui é uma lista (get_tracking_info) — nome diferente evita que
        # envio_plataforma() em operacao/regras.py chame .get() numa lista e quebre com AttributeError.
        "bruto": {"devolucao": {"pedido": pedido, "pacote": pacote, "rastreio_eventos": eventos}, "financeiro": None},
    }


def normalizar(dev: dict, financeiro: dict | None) -> dict:
    reavaliado = dev.get("reassessed_request_reason")
    motivo_efetivo = reavaliado if reavaliado and reavaliado != "NONE" else dev["reason"]
    motivo, responsavel = MOTIVO.get(motivo_efetivo, ("outro", "a_definir"))
    renda = (financeiro or {}).get("order_income") or {}
    custo = _custo(renda, responsavel)
    if renda.get("reverse_shipping_fee"):
        responsavel = "vendedor"  # a Shopee aplicou a taxa de devolução: ela responsabilizou a loja
    return {
        "plataforma": "shopee",
        "id_externo": str(dev["return_sn"]),
        "pedido": dev["order_sn"],
        "pacote": None,
        "rastreio": dev.get("tracking_number") or None,
        "etapa": ETAPA.get(dev["status"], "solicitada"),
        "status_plataforma": dev["status"],
        "em_mediacao": dev["status"] in DISPUTA,
        # ponytail: aproximação pelo status; a regra exata (3 dias após receber) vem com a trilha de Mediações.
        "pode_contestar": dev["status"] in ("REQUESTED", "PROCESSING", "ACCEPTED"),
        "motivo": motivo,
        "motivo_plataforma": motivo_efetivo if motivo_efetivo == dev["reason"] else f"{dev['reason']}→{motivo_efetivo}",
        "responsavel": responsavel,
        "destino": "vendedor" if dev.get("needs_logistics", True) else "sem_retorno",
        "valor_reembolso": dev.get("refund_amount"),
        "custo_plataforma": custo,
        "afeta_reputacao": None,
        "prazo_vendedor": _data(dev.get("return_seller_due_date")),
        "condicao_produto": None,  # a Shopee não devolve revisão de condição pela API
        "resultado_mediacao": resultado_disputa(dev),
        "cobertura_aplicada": None,
        "itens": [{"item_id": i.get("item_id"), "model_id": i.get("model_id"),
                   "sku": i.get("variation_sku") or i.get("item_sku"), "quantidade": i.get("amount"),
                   "nome": i.get("name"), "imagem": (i.get("images") or [None])[0]}
                  for i in dev.get("item") or []],
        "aberta_em": _data(dev["create_time"]),
        "atualizada_em": _data(dev["update_time"]),
        "codigos": [dev["return_sn"], dev["order_sn"], dev.get("tracking_number")],
        "bruto": {"devolucao": dev, "financeiro": financeiro},
    }
