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
_ultima_varredura = {"em": 0.0}
_ultima_releitura_shopee = {"em": 0.0}


def _marca(nome: str):
    return UPLOADS.parent / f"central_carga_{nome}.ok"


def _dias(nome: str) -> float:
    """Banco novo (ou recriado) começa vazio: a primeira rodada BEM-SUCEDIDA de cada plataforma traz o histórico,
    depois só o incremental. Marca por plataforma: uma que falha não faz as outras repetirem a carga pesada."""
    return CARGA_INICIAL_DIAS if not _marca(nome).exists() else 0.125


def _concluida(nome: str, dias: float) -> None:
    if dias == CARGA_INICIAL_DIAS:
        _marca(nome).parent.mkdir(parents=True, exist_ok=True)
        _marca(nome).write_text("ok", encoding="utf-8")


def _com_carga(nome: str, sincronizar):
    dias = _dias(nome)
    resultado = sincronizar(dias)
    _concluida(nome, dias)
    return resultado


def _ml_uma_vez():
    completa = time.time() - _ultima_varredura["em"] > VARREDURA_COMPLETA_S
    resultado = _com_carga("mercado_livre", lambda dias: sincronizar_ml(dias=dias, todas_abertas=completa or dias > 1))
    if completa:
        _ultima_varredura["em"] = time.time()
    return resultado


def _ml():
    try:
        return _ml_uma_vez()
    except RuntimeError as e:
        if "não conectado" not in str(e):
            raise
        time.sleep(90)  # logo depois do boot o token do ML já falhou uma vez sem motivo aparente; uma nova tentativa resolve
        return _ml_uma_vez()


def _shopee_rastreio():
    if time.time() - _ultima_releitura_shopee["em"] < RELEITURA_SHOPEE_S:
        return estado.get("shopee_rastreio", {}).get("resultado")
    resultado = atualizar_shopee()
    _ultima_releitura_shopee["em"] = time.time()
    return resultado


# Cada tarefa isolada: falha de uma plataforma (ex.: token Shopee vencido) não impede as outras.
TAREFAS = {
    "mercado_livre": _ml,
    "shopee": lambda: _com_carga("shopee", lambda dias: sincronizar_shopee(dias=dias)),
    "shopee_rastreio": _shopee_rastreio,
    "olist_notas_devolucao": lambda: _com_carga("olist", lambda dias: olist_servico.sincronizar_notas_devolucao(dias=CARGA_INICIAL_DIAS if dias > 1 else 1)),
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
