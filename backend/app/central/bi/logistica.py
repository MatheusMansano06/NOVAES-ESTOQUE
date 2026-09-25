"""Venda Full x orgânica de cada devolução. A plataforma só diz isso no envio/pedido de ida: consulta uma vez e
guarda aqui (o tipo de envio de uma venda não muda). Preenchido em segundo plano pela agenda."""

from sqlalchemy import Column, String, select

from app.central import progresso
from app.central.db import Base, Sessao
from app.central.devolucoes.modelo import Devolucao

# ML: logistic.type do envio de ida · Shopee: fulfillment_flag do pedido (a doc lista FBS; a API costuma dar o nome longo)
FULL = {"fulfillment", "FBS", "fulfilled_by_shopee"}


class LogisticaVenda(Base):
    __tablename__ = "logistica_venda"

    plataforma = Column(String(20), primary_key=True)
    pedido = Column(String(40), primary_key=True)
    tipo = Column(String(40), nullable=False)  # valor bruto da plataforma, para conferir o mapa FULL


def mapa() -> dict[tuple[str, str], bool]:
    """(plataforma, pedido) → é Full. Pedido ainda não consultado fica de fora."""
    with Sessao() as s:
        return {(l.plataforma, l.pedido): l.tipo in FULL for l in s.scalars(select(LogisticaVenda))}


def _ml(devs: list[Devolucao]) -> dict[str, str]:
    from app.central.mercado_livre import client
    tipos = {}
    for n, d in enumerate(devs):
        progresso.parcial(n / len(devs) / 2)  # ML é a primeira metade da tarefa; a Shopee é um lote só
        envio = (((d.bruto or {}).get("pedido") or {}).get("shipping") or {}).get("id")
        if envio:
            e = client.get(f"/shipments/{envio}", headers={"x-format-new": "true"}) or {}
            tipos[d.pedido] = (e.get("logistic") or {}).get("type") or "desconhecido"
    return tipos


def _shopee(devs: list[Devolucao]) -> dict[str, str]:
    from app.central.shopee import client
    tipos, sns = {}, sorted({d.pedido for d in devs})
    for i in range(0, len(sns), 50):  # get_order_detail aceita até 50 pedidos por chamada
        r = client.get("/api/v2/order/get_order_detail", {"order_sn_list": ",".join(sns[i:i + 50]),
                                                          "response_optional_fields": "fulfillment_flag"})
        tipos.update({o["order_sn"]: o.get("fulfillment_flag") or "desconhecido" for o in r.get("order_list") or []})
    return tipos


def completar(limite: int = 300) -> dict:
    """Consulta os pedidos de devolução que ainda não sabemos se são Full. `limite` por plataforma e rodada:
    a primeira carga do ML é uma chamada por pedido."""
    with Sessao() as s:
        conhecidos = set(s.execute(select(LogisticaVenda.plataforma, LogisticaVenda.pedido)).all())
        faltam = [d for d in s.scalars(select(Devolucao)) if (d.plataforma, d.pedido) not in conhecidos]
    feitos = {}
    for plataforma, buscar in (("mercado_livre", _ml), ("shopee", _shopee)):
        devs = list({d.pedido: d for d in faltam if d.plataforma == plataforma}.values())[:limite]
        try:
            tipos = buscar(devs) if devs else {}
        except RuntimeError as e:  # uma plataforma desconectada não segura a outra
            feitos[plataforma] = f"erro: {e}"[:200]
            continue
        with Sessao.begin() as s:
            for pedido, tipo in tipos.items():
                s.merge(LogisticaVenda(plataforma=plataforma, pedido=pedido, tipo=tipo[:40]))
        feitos[plataforma] = len(tipos)
    return feitos
