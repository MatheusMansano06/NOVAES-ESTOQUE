"""
Radar de Envio Full — "o momento certo de enviar cada produto pro Full".

Cruza o estoque REAL do Full ao vivo (liberado + o que está chegando, via
endpoints confirmados na sondagem) com a VELOCIDADE de venda (mesma lógica da
Lista de Compra) para responder, por SKU:
- daqui a quantos dias rompe;
- até que dia dá pra enviar reposição a tempo (descontando o lead time);
- quanto enviar para bater a meta de cobertura no Full.

A API do ML NÃO expõe as datas de agendamento (coleta/envio próprio) — isso
continua no Seller Center. O radar resolve a dor de verdade: prever a ruptura e
avisar o dia-limite de envio. Ver memória ml-inbound-full-endpoints.
"""

from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List

from app.models import MercadoLivreItemCache
from app.utils.lista_compra import _velocidade_anuncio, _snapshots_por_item

_POOL = 8  # pequeno para respeitar o limite do ML (mesmo do MVP)


def _stock_de_inventory(ml, token, inv: str):
    """Leitura paralela (sem throttle) de um inventory: (available, chegando)."""
    s = ml._get_raw(f"/inventories/{inv}/stock/fulfillment", None, token) or {}
    chegando = sum(int(d.get("quantity") or 0)
                   for d in (s.get("not_available_detail") or [])
                   if d.get("status") in ml.CHEGANDO_STATUS)
    return inv, (int(s.get("available_quantity") or 0), chegando)


def _momento(dias_ruptura, dias_p_agendar, horizonte) -> str:
    if dias_ruptura is None:
        return "tranquilo"
    if dias_p_agendar <= 0:
        return "hoje"
    if dias_p_agendar <= 7:
        return "esta_semana"
    if dias_ruptura <= horizonte:
        return "programe"
    return "tranquilo"


def _semaforo(vel, dias_ruptura, dias_p_agendar, chegando, lead_time) -> str:
    if vel <= 0:
        return "sem_giro"
    if dias_ruptura is not None and dias_ruptura <= lead_time and chegando == 0:
        return "urgente"
    if chegando > 0:
        return "tem_reposicao"
    if dias_p_agendar is not None and dias_p_agendar <= 7:
        return "atencao"
    return "ok"


def calcular_radar_full(ml, db, meta_dias: int = 30, lead_time_dias: int = 5,
                        horizonte: int = 21) -> Dict:
    """Monta o radar. Estoque vem ao vivo do Full; velocidade do motor da Lista
    de Compra (snapshots diários + bootstrap histórico)."""
    token = ml.get_access_token()
    if not token:
        return {"erro": "sem_token", "parametros": {}, "resumo": {}, "itens": []}

    agora = datetime.utcnow()
    snaps = _snapshots_por_item(db)
    rows = (db.query(MercadoLivreItemCache)
            .filter(MercadoLivreItemCache.full == True,  # noqa: E712
                    MercadoLivreItemCache.status == "active")
            .all())

    # 1) inventory_ids: do cache; o que faltar, resolve ao vivo e persiste.
    inv_por_item: Dict[str, List[str]] = {}
    faltando: List[str] = []
    for r in rows:
        ids = ml._json_load(r.inventory_ids_json, []) if r.inventory_ids_json else []
        if ids:
            inv_por_item[r.item_id] = [str(i) for i in ids]
        else:
            faltando.append(r.item_id)

    if faltando:
        def _resolve(iid):
            body = ml._get_raw(f"/items/{iid}", None, token) or {}
            return iid, ml._inventory_ids_do_body(body)
        with ThreadPoolExecutor(max_workers=_POOL) as ex:
            for iid, ids in ex.map(_resolve, faltando):
                inv_por_item[iid] = ids
                if ids:
                    row = ml._cache_query(db, iid)
                    if row is not None:
                        row.inventory_ids_json = ml._json_dump(ids)
        try:
            db.commit()
        except Exception:
            db.rollback()

    # 2) estoque por inventory (paralelo)
    invs = sorted({i for lst in inv_por_item.values() for i in lst})
    stock: Dict[str, tuple] = {}
    if invs:
        with ThreadPoolExecutor(max_workers=_POOL) as ex:
            for inv, val in ex.map(lambda i: _stock_de_inventory(ml, token, i), invs):
                stock[inv] = val

    # 3) agrupa por SKU (anúncios do mesmo SKU somam estoque e velocidade)
    grupos: Dict[str, Dict] = {}
    for r in rows:
        sku = (r.sku or "").strip().upper() or f"(sem-sku:{r.item_id})"
        g = grupos.get(sku)
        if not g:
            g = {"sku": sku, "titulo": r.titulo or "", "imagem": r.imagem_principal or r.thumbnail,
                 "preco": r.preco, "permalink": r.permalink, "itens": [],
                 "velocidade": 0.0, "vendidos": 0, "available": 0, "chegando": 0, "_vrep": -1}
            grupos[sku] = g
        g["itens"].append(r.item_id)
        g["velocidade"] += _velocidade_anuncio(r.item_id, r.vendidos, r.date_created, snaps, agora)
        vend = int(r.vendidos or 0)
        g["vendidos"] += vend
        if vend > g["_vrep"]:
            g["_vrep"] = vend
            g["titulo"] = r.titulo or g["titulo"]
            g["imagem"] = r.imagem_principal or r.thumbnail or g["imagem"]
            g["preco"] = r.preco
            g["permalink"] = r.permalink or g["permalink"]
        for inv in inv_por_item.get(r.item_id, []):
            a, c = stock.get(inv, (0, 0))
            g["available"] += a
            g["chegando"] += c

    # 4) métricas de risco por SKU
    itens: List[Dict] = []
    for g in grupos.values():
        vel = round(g["velocidade"], 2)
        available = g["available"]
        chegando = g["chegando"]
        if vel > 0:
            dias_ruptura = round(available / vel, 1)
            dias_com_chegando = round((available + chegando) / vel, 1)
            dias_p_agendar = round(dias_ruptura - lead_time_dias, 1)
            envie_ate = (agora + timedelta(days=max(0.0, dias_p_agendar))).date().isoformat()
            quanto_enviar = max(0, int(round(vel * meta_dias - (available + chegando))))
        else:
            dias_ruptura = None
            dias_com_chegando = None
            dias_p_agendar = None
            envie_ate = None
            quanto_enviar = 0
        momento = _momento(dias_ruptura, dias_p_agendar, horizonte)
        semaforo = _semaforo(vel, dias_ruptura, dias_p_agendar, chegando, lead_time_dias)
        itens.append({
            "sku": g["sku"], "titulo": g["titulo"], "imagem": g["imagem"],
            "preco": g["preco"], "permalink": g["permalink"], "anuncios": g["itens"],
            "vendidos": g["vendidos"], "velocidade_dia": vel, "velocidade_mes": round(vel * 30, 1),
            "available": available, "chegando": chegando, "estoque_total": available + chegando,
            "dias_ruptura": dias_ruptura, "dias_com_chegando": dias_com_chegando,
            "dias_p_agendar": dias_p_agendar, "envie_ate": envie_ate,
            "quanto_enviar": quanto_enviar, "meta_100": int(round(vel * meta_dias)),
            "momento": momento, "semaforo": semaforo,
        })

    ordem = {"hoje": 0, "esta_semana": 1, "programe": 2, "tranquilo": 3}
    itens.sort(key=lambda x: (ordem.get(x["momento"], 9),
                              x["dias_ruptura"] if x["dias_ruptura"] is not None else 1e9))

    def _conta(chave, valor):
        return sum(1 for x in itens if x[chave] == valor)

    resumo = {
        "total_skus": len(itens),
        "hoje": _conta("momento", "hoje"),
        "esta_semana": _conta("momento", "esta_semana"),
        "programe": _conta("momento", "programe"),
        "tranquilo": _conta("momento", "tranquilo"),
        "urgentes": _conta("semaforo", "urgente"),
        "com_reposicao": _conta("semaforo", "tem_reposicao"),
        "sem_giro": _conta("semaforo", "sem_giro"),
        "inventories_consultados": len(invs),
        "snapshots_dias": snaps and max(
            (int((agora - min(s.criado_em for s in lst)).total_seconds() / 86400)
             for lst in snaps.values() if lst), default=0) or 0,
        "atualizado_em": agora.isoformat(),
    }
    return {
        "parametros": {"meta_dias": meta_dias, "lead_time_dias": lead_time_dias, "horizonte": horizonte},
        "resumo": resumo,
        "itens": itens,
    }
