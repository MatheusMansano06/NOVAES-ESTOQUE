"""Contestação no ML. Mesma interface da Shopee: motivos_contestacao(id, produto_perfeito) e
contestar(id, motivo, texto, fotos, videos, produto_perfeito)."""

from pathlib import Path

from . import client


def pedido_do_envio(shipment_id: str) -> str | None:
    """Número de envio bipado que ainda não conhecemos → pedido dele (o ML só responde se o envio for nosso)."""
    envio = client.get(f"/shipments/{shipment_id}", headers={"x-format-new": "true"}) or {}
    return str(envio["order_id"]) if envio.get("order_id") else None


def _acoes_do_vendedor(claim_id: str) -> set[str]:
    claim = client.get(f"/post-purchase/v1/claims/{claim_id}") or {}
    return {a["action"] for p in claim.get("players") or [] if p["type"] == "seller"
            for a in p.get("available_actions") or []}


def motivos_contestacao(claim_id: str, produto_perfeito: bool) -> list[dict]:
    if produto_perfeito:
        return []  # a queixa é contra a reclamação, não contra o produto: vai para a mediação só com relato e fotos
    motivos = client.get("/post-purchase/v1/returns/reasons", {"flow": "seller_return_failed", "claim_id": claim_id}) or []
    return [{"id": m["id"], "texto": m["detail"]} for m in motivos]


def _anexar(path: str, arquivo: Path, campo: str) -> str:
    with arquivo.open("rb") as f:
        return client.post(path, files={"file": (arquivo.name, f)})[campo]


def contestar(claim_id: str, motivo: str, texto: str, fotos: list[Path], videos: list[Path],
              produto_perfeito: bool) -> dict:
    """Produto com problema → revisão com falha (motivo SRF), quando o ML libera. Produto perfeito com a
    Novaes culpada → mediação, contestando a reclamação. As ações liberadas mudam com o tempo: lidas na hora."""
    acoes = _acoes_do_vendedor(claim_id)
    aviso = "Vídeos não são enviados pela API do ML: anexe pelo painel se precisar." if videos else None

    if "return_review_fail" in acoes and not produto_perfeito:
        devolucao = client.get(f"/post-purchase/v2/claims/{claim_id}/returns")
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/returns/attachments", f, "file_name") for f in fotos]
        client.post(f"/post-purchase/v1/returns/{devolucao['id']}/return-review",
                    json=[{"reason": motivo, "message": texto, "attachments": nomes}])
        return {"caminho": "revisao_com_falha", "anexos": nomes, "aviso": aviso}

    if "open_dispute" in acoes or "send_message_to_mediator" in acoes:
        if "open_dispute" in acoes:
            client.post(f"/post-purchase/v1/claims/{claim_id}/actions/open-dispute")
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/attachments", f, "filename") for f in fotos]
        client.post(f"/post-purchase/v1/claims/{claim_id}/actions/send-message",
                    json={"receiver_role": "mediator", "message": f"[{motivo}] {texto}" if motivo else texto,
                          "attachments": nomes})
        return {"caminho": "mediacao", "anexos": nomes, "aviso": aviso}

    raise RuntimeError(f"O ML não libera contestação nesta reclamação agora (ações: {sorted(acoes) or 'nenhuma'}).")
