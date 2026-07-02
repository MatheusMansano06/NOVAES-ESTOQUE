"""
Estoque de Embalagens — auto-match por dimensão, custo médio e baixa por venda.

- A caixa certa de um produto = a MENOR caixa cadastrada que comporta as dimensões
  do produto (declaradas no ML, em ml_item_cache.dimensoes_json). Comparação por
  dimensões ordenadas (permite girar a peça).
- Inserts (criterio='toda_venda', ex.: folheto/brinde) entram em TODA venda.
- Baixa: roda junto do sync; usa o crescimento de `vendidos` de cada anúncio como
  gatilho (checkpoint em ml_item_cache.embalagem_baixa_vendidos). Idempotente.
"""

import json
from datetime import datetime
from typing import Dict, List, Optional

from app.models import (
    Embalagem, EmbalagemMovimento, EmbalagemVinculo, MercadoLivreItemCache,
)


def dims_do_produto(dimensoes_json: Optional[str]) -> Optional[List[float]]:
    """Extrai [altura, largura, comprimento] (cm) do produto; None se incompleto."""
    if not dimensoes_json:
        return None
    try:
        d = json.loads(dimensoes_json)
    except (ValueError, TypeError):
        return None
    if not isinstance(d, dict):
        return None
    vals = [d.get("altura_cm"), d.get("largura_cm"), d.get("comprimento_cm")]
    try:
        nums = [float(v) for v in vals if v is not None]
    except (ValueError, TypeError):
        return None
    if len(nums) != 3 or any(n <= 0 for n in nums):
        return None
    return nums


def _cabe(caixa_dims: List[float], prod_dims: List[float]) -> bool:
    """A caixa comporta o produto? Compara dimensões ordenadas (permite girar)."""
    c = sorted(caixa_dims, reverse=True)
    p = sorted(prod_dims, reverse=True)
    return all(c[i] >= p[i] for i in range(3))


def caixa_para_produto(prod_dims: Optional[List[float]], caixas: List[Embalagem]) -> Optional[Embalagem]:
    """Menor caixa (por volume) que comporta o produto. None se não houver dims/caixa."""
    if not prod_dims:
        return None
    candidatas = []
    for c in caixas:
        cd = [c.altura_cm, c.largura_cm, c.comprimento_cm]
        if any(v is None or v <= 0 for v in cd):
            continue
        cd = [float(v) for v in cd]
        if _cabe(cd, prod_dims):
            candidatas.append((cd[0] * cd[1] * cd[2], c))
    if not candidatas:
        return None
    candidatas.sort(key=lambda x: x[0])
    return candidatas[0][1]


def custo_medio_ponderado(compras) -> float:
    """sum(valor_total) / sum(quantidade) sobre as compras (0 se sem quantidade)."""
    total_qtd = sum(int(c.quantidade or 0) for c in compras)
    total_val = sum(float(c.valor_total or 0) for c in compras)
    return round(total_val / total_qtd, 4) if total_qtd > 0 else 0.0


def _caixas_e_inserts(db):
    ativas = db.query(Embalagem).filter(Embalagem.ativo == 1).all()
    caixas = [e for e in ativas if e.criterio == "dimensao"]
    inserts = [e for e in ativas if e.criterio == "toda_venda"]
    return ativas, caixas, inserts


def _vinculos(db) -> Dict[str, int]:
    return {v.sku.strip().upper(): v.embalagem_id
            for v in db.query(EmbalagemVinculo).all() if v.sku}


def resolver_caixa(sku: Optional[str], prod_dims: Optional[List[float]],
                   caixas: List[Embalagem], vinculos: Dict[str, int],
                   por_id: Dict[int, Embalagem]) -> Optional[Embalagem]:
    """Override manual (por SKU) vence; senão, auto-match por dimensão."""
    if sku:
        emb_id = vinculos.get(sku.strip().upper())
        if emb_id and emb_id in por_id and por_id[emb_id].ativo == 1:
            return por_id[emb_id]
    return caixa_para_produto(prod_dims, caixas)


def processar_baixas_embalagem(db) -> Dict:
    """Desconta embalagens conforme o crescimento de vendas de cada anúncio.
    Na 1ª vez inicializa o checkpoint sem descontar histórico. Idempotente."""
    ativas, caixas, inserts = _caixas_e_inserts(db)
    por_id = {e.id: e for e in ativas}
    vinculos = _vinculos(db)

    rows = (db.query(MercadoLivreItemCache)
            .filter(MercadoLivreItemCache.status == "active")
            .all())

    resumo = {"processados": 0, "vendas_novas": 0, "baixas_caixa": 0,
              "baixas_insert": 0, "sem_embalagem": 0, "sem_embalagem_skus": []}
    houve_mudanca = False

    for r in rows:
        v = int(r.vendidos or 0)
        cp = r.embalagem_baixa_vendidos
        if cp is None:
            r.embalagem_baixa_vendidos = v  # init: sem baixa retroativa
            houve_mudanca = True
            continue
        delta = v - int(cp)
        if delta <= 0:
            if delta < 0:
                r.embalagem_baixa_vendidos = v  # reset do anúncio
                houve_mudanca = True
            continue

        # delta > 0: houve venda nova
        resumo["processados"] += 1
        resumo["vendas_novas"] += delta
        prod_dims = dims_do_produto(r.dimensoes_json)
        caixa = resolver_caixa(r.sku, prod_dims, caixas, vinculos, por_id)

        if caixa:
            caixa.estoque_atual = max(0, int(caixa.estoque_atual or 0) - delta)
            caixa.atualizado_em = datetime.utcnow()
            db.add(EmbalagemMovimento(embalagem_id=caixa.id, item_id=r.item_id,
                                      sku=r.sku, quantidade=-delta, motivo="venda",
                                      descricao=f"Venda de {r.sku or r.item_id}"))
            resumo["baixas_caixa"] += delta
        else:
            resumo["sem_embalagem"] += delta
            if r.sku and r.sku not in resumo["sem_embalagem_skus"]:
                resumo["sem_embalagem_skus"].append(r.sku)

        for ins in inserts:
            ins.estoque_atual = max(0, int(ins.estoque_atual or 0) - delta)
            ins.atualizado_em = datetime.utcnow()
            db.add(EmbalagemMovimento(embalagem_id=ins.id, item_id=r.item_id,
                                      sku=r.sku, quantidade=-delta, motivo="venda",
                                      descricao=f"Venda de {r.sku or r.item_id}"))
            resumo["baixas_insert"] += delta

        r.embalagem_baixa_vendidos = v
        houve_mudanca = True

    if houve_mudanca:
        db.commit()
    resumo["sem_embalagem_skus"] = resumo["sem_embalagem_skus"][:50]
    return resumo
