"""Custo do produto (CMV) = custo oficial por SKU do estoque (tabela custos_produto), o mesmo da margem dos anúncios."""

from functools import lru_cache

from database import SessionLocal
from app.models import CustoProduto


@lru_cache(maxsize=4000)
def custo_do_sku(sku: str | None) -> float | None:
    """None = sem custo cadastrado (o operador precisa ver isso, não um zero silencioso).
    Cacheado: essa função é chamada por item em loops do BI e da conferência (uma sessão nova por
    chamada era o maior custo de latência do dashboard). custo_do_sku.cache_clear() ao gravar em /api/custos."""
    chave = (sku or "").strip()
    if not chave:
        return None
    db = SessionLocal()
    try:
        linha = db.query(CustoProduto).filter(CustoProduto.produto_chave == chave).first()
    finally:
        db.close()
    return linha.custo if linha and linha.custo else None
