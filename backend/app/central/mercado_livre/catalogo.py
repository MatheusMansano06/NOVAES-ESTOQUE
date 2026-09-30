"""Fotos dos anúncios do ML. O pedido traz título e SKU, não a imagem: busca uma vez e guarda."""

from sqlalchemy import Column, String

from app.central.db import Base, Sessao

from . import client


class ImagemAnuncio(Base):
    __tablename__ = "ml_imagens_anuncio"

    item_id = Column(String(30), primary_key=True)
    url = Column(String(300))  # None = anúncio sem foto (não tenta de novo)


def _buscar(item_ids: list[str]) -> dict[str, str]:
    saida = {}
    for i in range(0, len(item_ids), 20):  # o multiget do ML aceita até 20 itens por chamada
        lote = item_ids[i:i + 20]
        for r in client.get("/items", {"ids": ",".join(lote), "attributes": "id,secure_thumbnail,thumbnail"}) or []:
            corpo = r.get("body") or {}
            url = corpo.get("secure_thumbnail") or corpo.get("thumbnail")
            if r.get("code") == 200 and url:
                saida[corpo["id"]] = url.replace("-I.jpg", "-O.jpg")  # -O = versão maior da mesma foto
    return saida


def imagens(item_ids) -> dict[str, str]:
    """item_id → URL da foto. Falha do ML não quebra a tela: sem foto, a lista mostra o espaço vazio."""
    ids = {i for i in item_ids if i}
    if not ids:
        return {}
    with Sessao() as s:
        cache = {c.item_id: c.url for c in s.query(ImagemAnuncio).filter(ImagemAnuncio.item_id.in_(ids))}
    novos = sorted(ids - cache.keys())
    if novos:
        try:
            achadas = _buscar(novos)
        except RuntimeError:
            return {k: v for k, v in cache.items() if v}
        with Sessao.begin() as s:
            for i in novos:
                s.merge(ImagemAnuncio(item_id=i, url=achadas.get(i)))
        cache |= {i: achadas.get(i) for i in novos}
    return {k: v for k, v in cache.items() if v}
