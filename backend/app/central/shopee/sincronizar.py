import time

from app.central.devolucoes import servico as devolucoes

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
                    dev, client.get("/api/v2/payment/get_escrow_detail", {"order_sn": dev["order_sn"]}),
                ))
            mais, pagina = lista.get("more"), pagina + 1
    return {"devolucoes_salvas": devolucoes.salvar(registros)}
