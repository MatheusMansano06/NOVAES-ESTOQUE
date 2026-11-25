"""Contestação no ML. Mesma interface da Shopee: motivos_contestacao(id, produto_perfeito) e
contestar(id, motivo, texto, fotos, videos, produto_perfeito)."""

from pathlib import Path

from . import client


def pedido_do_envio(shipment_id: str) -> str | None:
    """Número de envio bipado que ainda não conhecemos → pedido dele (o ML só responde se o envio for nosso)."""
    envio = client.get(f"/shipments/{shipment_id}", headers={"x-format-new": "true"}) or {}
    return str(envio["order_id"]) if envio.get("order_id") else None


def acoes_vendedor(claim_id: str) -> set[str]:
    claim = client.get(f"/post-purchase/v1/claims/{claim_id}") or {}
    return {a["action"] for p in claim.get("players") or [] if p["type"] == "seller"
            for a in p.get("available_actions") or []}


_MEDIACAO = {"open_dispute", "send_message_to_mediator"}
_REVISAO_FALHA = {"return_review_fail", "return_review_unified_fail"}
REVISAO_OK = {"return_review_ok", "return_review_unified_ok"}


def _por_revisao(acoes: set[str], produto_perfeito: bool) -> bool:
    """Revisão com falha ("Reportar um problema") quando o produto tem problema, ou quando é a única porta aberta:
    reclamação em "Já revisei" não libera mediação direta, mas o relato sai pela revisão."""
    return bool(acoes & _REVISAO_FALHA) and (not produto_perfeito or not acoes & _MEDIACAO)


def motivos_contestacao(claim_id: str, produto_perfeito: bool) -> list[dict]:
    """Sempre a lista oficial do ML ("Reportar um problema"): o operador escolhe, também quando vai à mediação."""
    motivos = client.get("/post-purchase/v1/returns/reasons", {"flow": "seller_return_failed", "claim_id": claim_id}) or []
    return [{"id": m["id"], "texto": m["detail"]} for m in motivos]


def _anexar(path: str, arquivo: Path, campo: str) -> str:
    with arquivo.open("rb") as f:
        return client.post(path, files={"file": (arquivo.name, f)})[campo]


def contestar(claim_id: str, motivo: str, texto: str, fotos: list[Path], videos: list[Path],
              produto_perfeito: bool, motivo_texto: str = "") -> dict:
    """Produto com problema → revisão com falha (motivo SRF), quando o ML libera. Produto perfeito com a
    Novaes culpada → mediação, contestando a reclamação. As ações liberadas mudam com o tempo: lidas na hora."""
    acoes = acoes_vendedor(claim_id)
    aviso = "Vídeos não são enviados pela API do ML: anexe pelo painel se precisar." if videos else None

    if _por_revisao(acoes, produto_perfeito):
        devolucao = client.get(f"/post-purchase/v2/claims/{claim_id}/returns")
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/returns/attachments", f, "file_name") for f in fotos]
        client.post(f"/post-purchase/v1/returns/{devolucao['id']}/return-review",
                    json=[{"reason": motivo, "message": texto, "attachments": nomes}])
        return {"caminho": "revisao_com_falha", "anexos": nomes, "aviso": aviso}

    if acoes & _MEDIACAO:
        if "open_dispute" in acoes:
            client.post(f"/post-purchase/v1/claims/{claim_id}/actions/open-dispute")
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/attachments", f, "filename") for f in fotos]
        client.post(f"/post-purchase/v1/claims/{claim_id}/actions/send-message",
                    json={"receiver_role": "mediator", "message": f"[{motivo_texto}] {texto}" if motivo_texto else texto,
                          "attachments": nomes})
        return {"caminho": "mediacao", "anexos": nomes, "aviso": aviso}

    raise RuntimeError(f"O ML não libera contestação nesta reclamação agora (ações: {sorted(acoes) or 'nenhuma'}).")


def aceitar(claim_id: str) -> dict:
    """"Chegou como esperado" no painel: revisão OK (corpo vazio), o ML finaliza e reembolsa o comprador."""
    if not acoes_vendedor(claim_id) & REVISAO_OK:
        raise RuntimeError("O ML não libera o aceite desta reclamação agora: aceite pelo painel.")
    return _revisao_ok(claim_id)


def _revisao_ok(claim_id: str) -> dict:
    devolucao = client.get(f"/post-purchase/v2/claims/{claim_id}/returns")
    caminho = f"/post-purchase/v1/returns/{devolucao['id']}/return-review"
    try:
        client.post(caminho, json={})  # o que a doc manda
    except RuntimeError as e:
        # Em 25/11/2026 o ML passou a recusar o {} ("Required request body is missing or incorrect"):
        # o endpoint unificado quer lista, como na revisão com falha. 400 não grava nada, então repetir é seguro.
        if "HTTP 400" not in str(e) or "request body" not in str(e):
            raise
        client.post(caminho, json=[])
    return {"caminho": "aceite", "anexos": []}


# ---------- Painel 1:1 com o ML: a situação da reclamação e só os botões que o ML libera agora ----------
# Levantado em 450 reclamações reais (25/11/2026). "unified" é a mesma revisão por outro endpoint: vira um botão só.
_CANONICA = {"return_review_unified_ok": "return_review_ok", "return_review_unified_fail": "return_review_fail",
             "allow_return_label": "allow_return"}
# acao -> (nome igual ao do painel do ML, o que o operador precisa informar). Fora daqui: só pelo painel do ML.
ACOES = {
    "return_review_ok": ("Chegou como esperado", ["confirmar"]),
    "return_review_fail": ("Reportar um problema", ["motivo", "texto", "fotos"]),
    "refund": ("Devolver o dinheiro", ["confirmar"]),
    "open_dispute": ("Abrir mediação", ["texto", "fotos"]),
    "send_message_to_mediator": ("Mensagem ao mediador", ["texto"]),
    "send_message_to_complainant": ("Mensagem ao comprador", ["texto"]),
}
_SO_NO_PAINEL = {"recontact": "Recontato", "allow_partial_refund": "Oferecer reembolso parcial",
                 "allow_return": "Gerar etiqueta de devolução"}

# id -> (número que identifica o painel, título, o que está acontecendo)
SITUACOES = {
    "a_caminho": (1, "Produto voltando", "O comprador está devolvendo. Dá para devolver o dinheiro já, abrir mediação ou "
                  "falar com o comprador. O \"Chegou como esperado\" só aparece quando o produto chegar."),
    "revisar": (2, "Chegou: revise o produto", "O produto voltou. Diga ao ML se chegou como esperado ou reporte um problema."),
    "so_reportar": (3, "Só dá para reportar problema", "O ML já encerrou e reembolsou o comprador, mas ainda aceita o "
                    "relato de problema no produto para tentar recuperar o valor."),
    "mediacao": (4, "Mediação com o ML", "O mediador do ML está com o caso. Sem botão liberado, é só aguardar a decisão."),
    "encerrada": (5, "Encerrada no ML", "O ML não deixa mais nenhuma ação nesta reclamação."),
    "outra": (0, "Situação não mapeada", "O ML liberou ações que a Central ainda não conhece: use o painel do ML."),
}


def _classificar(claim: dict, acoes: set[str]) -> str:
    if "return_review_ok" in acoes:
        return "revisar"
    if "return_review_fail" in acoes:
        return "so_reportar"
    if claim.get("stage") == "dispute" and claim.get("status") == "opened":
        return "mediacao"
    if acoes & {"open_dispute", "refund", "send_message_to_complainant"}:
        return "a_caminho"
    return "encerrada" if not acoes else "outra"


def situacao(claim_id: str) -> dict:
    """Lida na hora: as ações do ML mudam com o tempo e um botão velho na tela é o que gerava erro."""
    claim = client.get(f"/post-purchase/v1/claims/{claim_id}") or {}
    vendedor = next((p for p in claim.get("players") or [] if p.get("type") == "seller"), {})
    botoes: dict[str, dict] = {}
    for a in vendedor.get("available_actions") or []:
        acao = _CANONICA.get(a["action"], a["action"])
        nome, pede = ACOES.get(acao, (_SO_NO_PAINEL.get(acao, acao), []))
        b = botoes.setdefault(acao, {"acao": acao, "nome": nome, "pede": pede, "executavel": acao in ACOES,
                                     "obrigatoria": False, "prazo": None})
        b["obrigatoria"] = b["obrigatoria"] or bool(a.get("mandatory"))
        b["prazo"] = b["prazo"] or a.get("due_date")
    chave = _classificar(claim, set(botoes))
    numero, titulo, explica = SITUACOES[chave]
    return {"situacao": chave, "numero": numero, "titulo": titulo, "explica": explica,
            "em_mediacao": claim.get("stage") == "dispute", "status_ml": claim.get("status"),
            "acoes": sorted(botoes.values(), key=lambda b: list(ACOES).index(b["acao"]) if b["executavel"] else 99)}


def executar(claim_id: str, acao: str, motivo: str, texto: str, fotos: list[Path]) -> dict:
    """Um botão do painel = uma chamada do ML. Confere na hora se o ML ainda libera a ação."""
    liberadas = {_CANONICA.get(a, a) for a in acoes_vendedor(claim_id)}
    if acao not in ACOES:
        raise RuntimeError(f"A ação {acao} só pode ser feita pelo painel do ML.")
    if acao not in liberadas:
        raise RuntimeError(f"O ML não libera mais \"{ACOES[acao][0]}\" nesta reclamação. Atualize a tela.")

    if acao == "return_review_ok":
        return _revisao_ok(claim_id)
    if acao == "refund":
        client.post(f"/post-purchase/v1/claims/{claim_id}/expected-resolutions/refund")
        return {"caminho": "reembolso", "anexos": []}
    if acao == "return_review_fail":
        devolucao = client.get(f"/post-purchase/v2/claims/{claim_id}/returns")
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/returns/attachments", f, "file_name") for f in fotos]
        client.post(f"/post-purchase/v1/returns/{devolucao['id']}/return-review",
                    json=[{"reason": motivo, "message": texto, "attachments": nomes}])
        return {"caminho": "revisao_com_falha", "anexos": nomes}
    if acao == "send_message_to_complainant":
        client.post(f"/post-purchase/v1/claims/{claim_id}/actions/send-message",
                    json={"receiver_role": "complainant", "message": texto, "attachments": []})
        return {"caminho": "mensagem_comprador", "anexos": []}

    def ao_mediador() -> list[str]:
        nomes = [_anexar(f"/post-purchase/v1/claims/{claim_id}/attachments", f, "filename") for f in fotos]
        client.post(f"/post-purchase/v1/claims/{claim_id}/actions/send-message",
                    json={"receiver_role": "mediator", "message": texto, "attachments": nomes})
        return nomes

    if acao == "send_message_to_mediator":
        return {"caminho": "mensagem_mediador", "anexos": ao_mediador()}
    client.post(f"/post-purchase/v1/claims/{claim_id}/actions/open-dispute")
    try:  # a mediação já abriu: falhar a mensagem não pode virar "não passou"
        return {"caminho": "mediacao", "anexos": ao_mediador()}
    except RuntimeError as e:
        return {"caminho": "mediacao", "anexos": [],
                "aviso": f"Mediação aberta, mas a mensagem ao mediador falhou ({e}). Mande pelo botão \"Mensagem ao mediador\"."}
