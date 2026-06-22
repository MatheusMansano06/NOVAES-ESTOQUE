"""
Lista de Compra inteligente.

Cruza a CURVA ABC (por unidades vendidas no ML) com o ESTOQUE (FULL + orgânico,
lido do cache do ML) e a VELOCIDADE de venda para priorizar a compra.

Modelo (definido com o usuário):
- Meta de estoque (100%) = velocidade_diária × meta_dias (ex.: 75 dias).
- % de segurança = estoque_total / meta. Abaixo de 20% = prioridade máxima.
- Estoque_total = FULL (anúncios fulfillment) + orgânico (anúncios próprios).
- Velocidade: começa por vendidos/idade do anúncio (usa date_created) e é
  refinada pelo diff dos snapshots diários de vendas conforme eles acumulam.
"""

from datetime import datetime, timedelta
from typing import Dict, List

from app.models import MercadoLivreItemCache, SkuVendasSnapshot


# Limiares da curva ABC (participação acumulada das unidades vendidas).
ABC_A = 0.80
ABC_B = 0.95  # A: até 80%, B: 80–95%, C: o resto

# Faixas de prioridade pela % de segurança (estoque / meta).
PRIO_MAXIMA = 0.20
PRIO_MEDIA = 0.50


def registrar_snapshot_vendas(db) -> int:
    """Grava uma foto do total vendido de cada anúncio ativo — no máximo 1x/dia.
    Retorna quantos registros gravou (0 se já tinha foto hoje)."""
    hoje = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    ja_tem = db.query(SkuVendasSnapshot).filter(SkuVendasSnapshot.criado_em >= hoje).first()
    if ja_tem:
        return 0
    rows = db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.status == "active").all()
    n = 0
    for r in rows:
        if not r.item_id:
            continue
        db.add(SkuVendasSnapshot(
            item_id=r.item_id,
            sku=(r.sku or "").strip().upper() or None,
            vendidos=int(r.vendidos or 0),
        ))
        n += 1
    if n:
        db.commit()
    return n


def _snapshots_por_item(db, dias: int = 90) -> Dict[str, list]:
    limite = datetime.utcnow() - timedelta(days=dias)
    out: Dict[str, list] = {}
    for s in db.query(SkuVendasSnapshot).filter(SkuVendasSnapshot.criado_em >= limite).all():
        out.setdefault(s.item_id, []).append(s)
    return out


def _velocidade_anuncio(item_id, vendidos, date_created, snaps_por_item, agora) -> float:
    """Velocidade diária do anúncio: recente (diff de snapshots) se houver janela
    confiável; senão, a média histórica (vendidos / idade)."""
    vendidos = int(vendidos or 0)
    snaps = snaps_por_item.get(item_id) or []
    if snaps:
        mais_antigo = min(snaps, key=lambda s: s.criado_em)
        dias = (agora - mais_antigo.criado_em).total_seconds() / 86400.0
        if dias >= 5:
            delta = vendidos - int(mais_antigo.vendidos or 0)
            if delta >= 0:
                return max(0.0, delta / dias)
    # bootstrap: média histórica desde a criação do anúncio
    if date_created and vendidos > 0:
        idade = (agora - date_created).total_seconds() / 86400.0
        if idade >= 1:
            return max(0.0, vendidos / idade)
    return 0.0


def _classe_abc(participacao_acumulada: float) -> str:
    if participacao_acumulada <= ABC_A:
        return "A"
    if participacao_acumulada <= ABC_B:
        return "B"
    return "C"


def _prioridade(pct: float, velocidade: float) -> str:
    if velocidade <= 0:
        return "sem_giro"
    if pct <= PRIO_MAXIMA:
        return "maxima"
    if pct <= PRIO_MEDIA:
        return "media"
    return "ok"


def calcular_lista_compra(db, meta_dias: int = 75) -> Dict:
    """Monta a lista de compra priorizada a partir do cache do ML."""
    agora = datetime.utcnow()
    snaps = _snapshots_por_item(db)

    rows = db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.status == "active").all()

    # Agrupa por SKU (anúncios FULL + orgânico do mesmo SKU somam estoque/venda)
    grupos: Dict[str, Dict] = {}
    for r in rows:
        sku = (r.sku or "").strip().upper()
        if not sku:
            continue
        g = grupos.get(sku)
        if not g:
            g = {
                "sku": sku,
                "titulo": r.titulo or "",
                "imagem": r.imagem_principal or r.thumbnail,
                "preco": r.preco,
                "vendidos": 0,
                "velocidade": 0.0,
                "estoque_full": 0,
                "estoque_organico": 0,
                "anuncios": [],
            }
            grupos[sku] = g
        vendidos = int(r.vendidos or 0)
        disponivel = int(r.estoque_disponivel or 0)
        eh_full = bool(r.full)
        g["vendidos"] += vendidos
        g["velocidade"] += _velocidade_anuncio(r.item_id, vendidos, r.date_created, snaps, agora)
        if eh_full:
            g["estoque_full"] += disponivel
        else:
            g["estoque_organico"] += disponivel
        g["anuncios"].append(r.item_id)
        # mantém o título/preço de quem mais vendeu como representativo
        if vendidos > g.get("_v_rep", -1):
            g["_v_rep"] = vendidos
            g["titulo"] = r.titulo or g["titulo"]
            g["preco"] = r.preco
            g["imagem"] = r.imagem_principal or r.thumbnail or g["imagem"]

    lista = list(grupos.values())

    # Curva ABC por participação acumulada das unidades vendidas
    total_vendidos = sum(g["vendidos"] for g in lista) or 1
    lista.sort(key=lambda g: g["vendidos"], reverse=True)
    acumulado = 0
    for g in lista:
        acumulado += g["vendidos"]
        g["curva"] = _classe_abc(acumulado / total_vendidos)

    # Métricas de compra
    for g in lista:
        vel = round(g["velocidade"], 3)
        estoque_total = g["estoque_full"] + g["estoque_organico"]
        meta = vel * meta_dias
        pct = (estoque_total / meta) if meta > 0 else None
        comprar = int(round(meta - estoque_total)) if meta > 0 else 0
        dias_cobertura = (estoque_total / vel) if vel > 0 else None
        g["velocidade_dia"] = vel
        g["velocidade_mes"] = round(vel * 30, 1)
        g["estoque_total"] = estoque_total
        g["meta_100"] = int(round(meta)) if meta > 0 else 0
        g["pct_seguranca"] = round(pct * 100, 1) if pct is not None else None
        g["comprar"] = max(0, comprar)
        g["dias_cobertura"] = round(dias_cobertura, 1) if dias_cobertura is not None else None
        g["prioridade"] = _prioridade(pct if pct is not None else 999, vel)
        g.pop("_v_rep", None)
        g["velocidade"] = vel

    # Ordena: prioridade (máxima -> média -> ok -> sem_giro), depois menor %
    ordem = {"maxima": 0, "media": 1, "ok": 2, "sem_giro": 3}
    lista.sort(key=lambda g: (ordem.get(g["prioridade"], 9), g["pct_seguranca"] if g["pct_seguranca"] is not None else 1e9))

    resumo = {
        "total_skus": len(lista),
        "maxima": sum(1 for g in lista if g["prioridade"] == "maxima"),
        "media": sum(1 for g in lista if g["prioridade"] == "media"),
        "ok": sum(1 for g in lista if g["prioridade"] == "ok"),
        "sem_giro": sum(1 for g in lista if g["prioridade"] == "sem_giro"),
        "curva_a": sum(1 for g in lista if g["curva"] == "A"),
        "curva_b": sum(1 for g in lista if g["curva"] == "B"),
        "curva_c": sum(1 for g in lista if g["curva"] == "C"),
        "snapshots_dias": _dias_de_snapshot(db),
    }
    return {"meta_dias": meta_dias, "resumo": resumo, "itens": lista}


def _dias_de_snapshot(db) -> int:
    """Há quantos dias começamos a coletar snapshots (p/ saber se a velocidade já
    está 'recente' ou ainda no bootstrap histórico)."""
    mais_antigo = db.query(SkuVendasSnapshot).order_by(SkuVendasSnapshot.criado_em.asc()).first()
    if not mais_antigo or not mais_antigo.criado_em:
        return 0
    return int((datetime.utcnow() - mais_antigo.criado_em).total_seconds() / 86400.0)
