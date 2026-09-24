"""Sincronização automática da Central (roda no scheduler do estoque, ver jobs.py)."""

import logging
import time

from app.central.conferencia import servico as conferencia_servico
from app.central.mercado_livre.sincronizar import sincronizar as sincronizar_ml
from app.central.olist import servico as olist_servico
from app.central.shopee.sincronizar import sincronizar as sincronizar_shopee

log = logging.getLogger("central.agenda")

VARREDURA_COMPLETA_S = 6 * 3600  # de 6 em 6 h relê toda reclamação aberta do ML, de qualquer data
_ultima_varredura = {"em": 0.0}


def _ml():
    completa = time.time() - _ultima_varredura["em"] > VARREDURA_COMPLETA_S
    resultado = sincronizar_ml(dias=0.125, todas_abertas=completa)
    if completa:
        _ultima_varredura["em"] = time.time()
    return resultado


# Cada tarefa isolada: falha de uma plataforma (ex.: token Shopee vencido) não impede as outras.
TAREFAS = {
    "mercado_livre": _ml,
    "shopee": lambda: sincronizar_shopee(dias=0.125),
    "olist_notas_devolucao": lambda: olist_servico.sincronizar_notas_devolucao(dias=1),
    "olist_cache_pedidos": conferencia_servico.aquecer_cache,
}
estado: dict[str, dict] = {}


def rodar() -> None:
    for nome, tarefa in TAREFAS.items():
        try:
            estado[nome] = {"ok": True, "resultado": tarefa()}
        except Exception as e:  # noqa: BLE001 — registrar e seguir para a próxima tarefa
            estado[nome] = {"ok": False, "erro": str(e)[:300]}
            log.warning("sincronização %s falhou: %s", nome, e)
