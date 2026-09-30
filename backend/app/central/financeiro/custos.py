"""Custo do produto (CMV) = custo oficial por SKU do estoque (tabela custos_produto), o mesmo da margem dos anúncios.
Mudanças têm vigência (custos_produto_historico): o prejuízo de uma quebra usa o custo do dia em que aconteceu."""

from datetime import datetime
from functools import lru_cache

from database import SessionLocal
from app.models import CustoProduto, CustoProdutoHistorico

# Antes da primeira mudança registrada no histórico, o custo que já existia vale "desde sempre".
DESDE_SEMPRE = datetime(2000, 1, 1)


@lru_cache(maxsize=4000)
def custo_do_sku(sku: str | None) -> float | None:
    """Custo atual. None = sem custo cadastrado (o operador precisa ver isso, não um zero silencioso).
    Cacheado: chamado por item em loops do BI e da conferência. limpar_cache() ao gravar custo."""
    chave = (sku or "").strip()
    if not chave:
        return None
    db = SessionLocal()
    try:
        linha = db.query(CustoProduto).filter(CustoProduto.produto_chave == chave).first()
    finally:
        db.close()
    return linha.custo if linha and linha.custo else None


@lru_cache(maxsize=1)
def _historico() -> dict[str, list[tuple[datetime, float]]]:
    """Histórico inteiro numa consulta (poucas linhas): SKU -> [(vigente_desde, custo)] em ordem de vigência."""
    db = SessionLocal()
    try:
        linhas = db.query(CustoProdutoHistorico).order_by(CustoProdutoHistorico.vigente_desde, CustoProdutoHistorico.id).all()
        saida: dict[str, list[tuple[datetime, float]]] = {}
        for h in linhas:
            saida.setdefault(h.produto_chave, []).append((h.vigente_desde, h.custo))
        return saida
    finally:
        db.close()


def custo_na_data(sku: str | None, quando: datetime | None) -> float | None:
    """Custo vigente em `quando` (UTC). SKU que nunca mudou de custo: vale o atual."""
    chave = (sku or "").strip()
    linhas = _historico().get(chave)
    if not linhas or quando is None:
        return custo_do_sku(chave)
    custo = linhas[0][1]
    for desde, valor in linhas:
        if desde > quando:
            break
        custo = valor
    return custo or None


def limpar_cache() -> None:
    custo_do_sku.cache_clear()
    _historico.cache_clear()


def historico_do_sku(sku: str) -> list[dict]:
    db = SessionLocal()
    try:
        linhas = (db.query(CustoProdutoHistorico).filter(CustoProdutoHistorico.produto_chave == sku.strip())
                  .order_by(CustoProdutoHistorico.vigente_desde.desc(), CustoProdutoHistorico.id.desc()).all())
        return [{"custo": h.custo, "vigente_desde": h.vigente_desde, "registrado_em": h.registrado_em,
                 "registrado_por": h.registrado_por} for h in linhas]
    finally:
        db.close()


def registrar_custo(db, sku: str, custo: float, desde: datetime, quem: str | None = None) -> float:
    """Grava a mudança com vigência na sessão `db` (quem chamou faz o commit e depois limpar_cache()).
    Primeira mudança de um SKU guarda antes o custo antigo "desde sempre", pra o passado continuar valendo o que valia.
    custos_produto (margem do ML) fica com o custo da vigência mais recente. Devolve esse custo atual."""
    sku = sku.strip()
    agora = datetime.utcnow()
    atual = db.query(CustoProduto).filter(CustoProduto.produto_chave == sku).first()
    ja_tem = db.query(CustoProdutoHistorico.id).filter(CustoProdutoHistorico.produto_chave == sku).first()
    if not ja_tem and atual and atual.custo:
        db.add(CustoProdutoHistorico(produto_chave=sku, custo=atual.custo, vigente_desde=DESDE_SEMPRE,
                                     registrado_em=agora, registrado_por="custo anterior"))
    db.add(CustoProdutoHistorico(produto_chave=sku, custo=custo, vigente_desde=desde, registrado_em=agora, registrado_por=quem))
    db.flush()
    ultimo = (db.query(CustoProdutoHistorico).filter(CustoProdutoHistorico.produto_chave == sku)
              .order_by(CustoProdutoHistorico.vigente_desde.desc(), CustoProdutoHistorico.id.desc()).first())
    if atual:
        atual.custo, atual.atualizado_em = ultimo.custo, agora
    else:
        db.add(CustoProduto(produto_chave=sku, custo=ultimo.custo, imposto_pct=9, atualizado_em=agora))
    return ultimo.custo
