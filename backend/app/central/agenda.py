"""Sincronização automática da Central (roda no scheduler do estoque, ver jobs.py)."""

import logging
import time

from app.central.conferencia import servico as conferencia_servico
from app.central.mercado_livre.sincronizar import sincronizar as sincronizar_ml
from app.central.olist import servico as olist_servico
from app.central.db import UPLOADS
from app.central.shopee.sincronizar import atualizar_abertas as atualizar_shopee
from app.central.shopee.sincronizar import sincronizar as sincronizar_shopee

log = logging.getLogger("central.agenda")

VARREDURA_COMPLETA_S = 6 * 3600  # de 6 em 6 h relê toda reclamação aberta do ML, de qualquer data
RELEITURA_SHOPEE_S = 30 * 60  # rastreio das devoluções abertas da Shopee (postado ou não)
CARGA_INICIAL_DIAS = 30
# Banco novo (ou recriado) começa vazio: a primeira rodada traz o histórico, depois só o incremental.
MARCA_CARGA_INICIAL = UPLOADS.parent / "central_carga_inicial.ok"
_ultima_varredura = {"em": 0.0}
_ultima_releitura_shopee = {"em": 0.0}


def _carga_inicial() -> bool:
    return not MARCA_CARGA_INICIAL.exists()


def _ml():
    completa = time.time() - _ultima_varredura["em"] > VARREDURA_COMPLETA_S
    resultado = sincronizar_ml(dias=CARGA_INICIAL_DIAS if _carga_inicial() else 0.125, todas_abertas=completa)
    if completa:
        _ultima_varredura["em"] = time.time()
    return resultado


def _shopee_rastreio():
    if time.time() - _ultima_releitura_shopee["em"] < RELEITURA_SHOPEE_S:
        return estado.get("shopee_rastreio", {}).get("resultado")
    resultado = atualizar_shopee()
    _ultima_releitura_shopee["em"] = time.time()
    return resultado


# Cada tarefa isolada: falha de uma plataforma (ex.: token Shopee vencido) não impede as outras.
TAREFAS = {
    "mercado_livre": _ml,
    "shopee": lambda: sincronizar_shopee(dias=CARGA_INICIAL_DIAS if _carga_inicial() else 0.125),
    "shopee_rastreio": _shopee_rastreio,
    "olist_notas_devolucao": lambda: olist_servico.sincronizar_notas_devolucao(dias=CARGA_INICIAL_DIAS if _carga_inicial() else 1),
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
    if _carga_inicial() and all(estado.get(n, {}).get("ok") for n in ("mercado_livre", "shopee", "olist_notas_devolucao")):
        MARCA_CARGA_INICIAL.parent.mkdir(parents=True, exist_ok=True)
        MARCA_CARGA_INICIAL.write_text("ok", encoding="utf-8")
