"""Vínculo com a Olist — por SKU, não por pedido.

A integração Olist atual (integracoes_olist.py) não expõe busca de pedido por
order_id do marketplace, só busca de produto por SKU/nome. O CMV vem de
CustoProduto, a mesma tabela que já é autoritativa para margem no resto do
sistema (ver memória custo-oficial-por-sku) — não da API da Olist.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from app.integracoes_olist import olist
from app.models import CustoProduto
from app.devolucoes.models import OlistLink


def vincular_olist(db: Session, return_case_id: int, sku: str) -> OlistLink:
    candidatos = olist.buscar_produtos(sku, limite_resultados=1)
    produto = candidatos[0] if candidatos else None

    custo = db.query(CustoProduto).filter(CustoProduto.produto_chave == sku).first()

    link: Optional[OlistLink] = (
        db.query(OlistLink).filter(OlistLink.return_case_id == return_case_id).first()
    )
    if link is None:
        link = OlistLink(return_case_id=return_case_id)
        db.add(link)

    link.sku = sku
    link.produto_id_olist = str(produto.get("id", "")) if produto else ""
    link.produto_nome_olist = produto.get("nome", "") if produto else ""
    link.cmv = custo.custo if custo else 0.0

    if produto and produto.get("id"):
        estoque = olist.obter_estoque(str(produto["id"]))
        link.estoque_disponivel = estoque["disponivel"] if estoque else None

    link.sincronizado_em = datetime.utcnow()
    db.commit()
    return link
