"""Contestação na Shopee. Mesma interface do ML. Na Shopee toda disputa tem motivo da lista oficial,
com ou sem problema no produto, então produto_perfeito não muda o caminho."""

import base64
import os
from pathlib import Path

from . import client

EMAIL = os.environ.get("SHOPEE_EMAIL_DISPUTA", "")


def motivos_contestacao(return_sn: str, produto_perfeito: bool) -> list[dict]:
    r = client.get("/api/v2/returns/get_return_dispute_reason", {"return_sn": return_sn})
    lista = r.get("dispute_reason") or r.get("dispute_reason_list") or r.get("reason_list") or []
    if not lista:
        # Na Shopee lista vazia nunca significa "sem motivo": a disputa sempre exige um. Mostra a resposta crua para diagnóstico.
        raise RuntimeError(f"A Shopee não devolveu motivos de disputa para esta devolução. Resposta: {str(r)[:300]}")
    return [_motivo(m) for m in lista]


def _motivo(m: dict) -> dict:
    """Formato real da Shopee: {'dispute_reason': 46, 'dispute_requirement': '', ...}. Só o código vem; o texto é a exigência, se houver."""
    id_ = m.get("dispute_reason")
    if id_ is None or not str(id_).isdigit():
        raise RuntimeError(f"Formato inesperado do motivo de disputa da Shopee: {str(m)[:300]}")
    exigencia = (m.get("dispute_requirement") or "").strip()
    # A exigência é longa e vai fora do <select>; o menu mostra só o código.
    return {"id": int(id_), "texto": f"Motivo {id_}", "exigencia": exigencia}


def _urls(fotos: list[Path]) -> list[str]:
    if not fotos:
        return []
    r = client.post("/api/v2/returns/convert_image",
                    {"images": [{"image": base64.b64encode(f.read_bytes()).decode()} for f in fotos]})
    return [i["url"] for i in r.get("images") or []]


def contestar(return_sn: str, motivo: str, texto: str, fotos: list[Path], videos: list[Path],
              produto_perfeito: bool) -> dict:
    if not motivo:
        raise RuntimeError("A Shopee exige um motivo da lista oficial para abrir a disputa.")
    if not EMAIL:
        raise RuntimeError("Defina SHOPEE_EMAIL_DISPUTA no .env da trilha shopee (e-mail de contato exigido na disputa).")
    urls = _urls(fotos)
    client.post("/api/v2/returns/dispute", {
        "return_sn": return_sn, "email": EMAIL, "dispute_reason": int(motivo),
        "dispute_text_reason": texto, "images": urls,
    })
    # ponytail: vídeo pela API exige o upload de mídia da Shopee (não documentado de forma confiável); por ora vai pelo painel.
    aviso = "A Shopee exige vídeo nesta disputa: anexe pela Central do Vendedor." if videos else \
            "A Shopee costuma exigir vídeo: grave e anexe pela Central do Vendedor."
    return {"caminho": "disputa", "anexos": urls, "aviso": aviso}
