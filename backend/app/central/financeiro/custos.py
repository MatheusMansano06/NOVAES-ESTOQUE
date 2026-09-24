"""Custo do produto (CMV) = custo oficial por SKU do estoque (tabela custos_produto), o mesmo da margem dos anúncios."""

from database import SessionLocal
from app.models import CustoProduto


def custo_do_sku(sku: str | None) -> float | None:
    """None = sem custo cadastrado (o operador precisa ver isso, não um zero silencioso)."""
    chave = (sku or "").strip()
    if not chave:
        return None
    db = SessionLocal()
    try:
        linha = db.query(CustoProduto).filter(CustoProduto.produto_chave == chave).first()
    finally:
        db.close()
    return linha.custo if linha and linha.custo else None
