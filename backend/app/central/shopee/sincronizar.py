import time

from sqlalchemy import select

from app.central.db import Sessao
from app.central.devolucoes import servico as devolucoes
from app.central.devolucoes.modelo import Devolucao

from . import client
from .normalizar import normalizar

JANELA = 15 * 86400  # a Shopee limita o intervalo de datas por consulta


def sincronizar(dias: float = 15):
    """Traz devoluções atualizadas nos últimos `dias` (com o extrato do pedido) e grava no formato único."""
    fim = int(time.time())
    inicio = fim - int(dias * 86400)
    registros = []
    for ate in range(fim, inicio, -JANELA):
        de = max(ate - JANELA, inicio)
        pagina, mais = 0, True
        while mais:
            lista = client.get("/api/v2/returns/get_return_list", {
                "page_no": pagina, "page_size": 100, "update_time_from": de, "update_time_to": ate,
            })
            for dev in lista.get("return", []):
                registros.append(normalizar(
                    {**dev, "rastreio_reverso": rastreio_reverso(dev)},
                    client.get("/api/v2/payment/get_escrow_detail", {"order_sn": dev["order_sn"]}),
                ))
            mais, pagina = lista.get("more"), pagina + 1
    return {"devolucoes_salvas": devolucoes.salvar(registros)}


ABERTAS = ("REQUESTED", "PROCESSING", "ACCEPTED", "JUDGING", "SELLER_DISPUTE")


def rastreio_reverso(dev: dict) -> dict | None:
    """Onde está o pacote da devolução (postado ou não). Só existe depois que a Shopee aprova e gera a logística;
    falha aqui não impede de gravar a devolução."""
    if dev.get("status") not in ABERTAS or not dev.get("needs_logistics", True):
        return None
    try:
        return client.get("/api/v2/returns/get_reverse_tracking_info", {"return_sn": dev["return_sn"]})
    except RuntimeError as e:
        return {"erro": str(e)[:200]}


def atualizar_abertas() -> dict:
    """A Shopee não mexe no update_time da devolução quando o comprador posta: a sincronização por data não vê.
    Relê o rastreio de toda devolução aberta que volta para a Novaes."""
    with Sessao() as s:
        abertas = [(d.bruto or {}) for d in s.scalars(select(Devolucao).where(
            Devolucao.plataforma == "shopee", Devolucao.destino == "vendedor",
            Devolucao.status_plataforma.in_(ABERTAS)))]
    registros = [normalizar({**b["devolucao"], "rastreio_reverso": rastreio_reverso(b["devolucao"])}, b.get("financeiro"))
                 for b in abertas if b.get("devolucao")]
    return {"relidas": devolucoes.salvar(registros)}


def reprocessar_salvas() -> dict:
    """Recalcula o formato único das devoluções já salvas a partir do bruto guardado (sem chamar a Shopee).
    Usado uma vez quando a regra de normalização muda (ex.: marcas de disputa)."""
    with Sessao() as s:
        brutos = [d.bruto for d in s.scalars(select(Devolucao).where(Devolucao.plataforma == "shopee")) if (d.bruto or {}).get("devolucao")]
    return {"reprocessadas": devolucoes.salvar([normalizar(b["devolucao"], b.get("financeiro")) for b in brutos])}
