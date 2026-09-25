"""Sincronização automática da Central (roda no scheduler do estoque, ver jobs.py)."""

import logging
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from app.central import progresso
from app.central.bi import fatura_ml, logistica, mediacao_origem
from app.central.conferencia import servico as conferencia_servico
from app.central.mercado_livre.sincronizar import sincronizar as sincronizar_ml
from app.central.olist import servico as olist_servico
from app.central.db import UPLOADS
from app.central.shopee.sincronizar import atualizar_abertas as atualizar_shopee
from app.central.shopee.sincronizar import sincronizar as sincronizar_shopee

log = logging.getLogger("central.agenda")

# Varredura do dia: 1x por dia, a partir desta hora (Brasília), relê toda reclamação aberta do ML (qualquer data) e os
# últimos 2 dias inteiros de ML e Shopee, para o dia fechar 100% apurado. Fora dela só o incremental leve (3 h).
# Antes era de 6 em 6 h e também a cada deploy (a memória zerava): a primeira rodada depois de subir travava.
VARREDURA_HORA = int(os.getenv("CENTRAL_VARREDURA_HORA", "23"))
VARREDURA_DIAS = 2
RELEITURA_SHOPEE_S = 30 * 60  # rastreio das devoluções abertas da Shopee (postado ou não)
CARGA_INICIAL_DIAS = 30
_varredura = {"agora": False}
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


def _hoje() -> str:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()


def _varredura_pendente() -> bool:
    """Passou da hora e a varredura de hoje ainda não foi feita (marca em disco: sobrevive a deploy)."""
    marca = _marca("varredura_dia")
    feita = marca.read_text(encoding="utf-8") if marca.exists() else ""
    return datetime.now(ZoneInfo("America/Sao_Paulo")).hour >= VARREDURA_HORA and feita != _hoje()


def _com_carga(nome: str, sincronizar):
    dias = _dias(nome)
    if _varredura["agora"] and dias < VARREDURA_DIAS:
        dias = VARREDURA_DIAS
    resultado = sincronizar(dias)
    _concluida(nome, dias)
    return resultado


def _ml_uma_vez():
    return _com_carga("mercado_livre", lambda dias: sincronizar_ml(dias=dias, todas_abertas=_varredura["agora"] or dias > VARREDURA_DIAS))


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
    "logistica_venda": logistica.completar,  # Full x orgânica das devoluções novas (BI)
    "fatura_ml": fatura_ml.sincronizar,  # tarifas de devolução da fatura do ML (BI mensal)
    "mediacao_origem": mediacao_origem.completar,  # quem abriu cada mediação (BI)
}
estado: dict[str, dict] = {}


def rodar() -> None:
    _varredura["agora"] = _varredura_pendente()
    progresso.iniciar(list(TAREFAS), varredura=_varredura["agora"])
    try:
        _rodar()
        if _varredura["agora"] and estado.get("mercado_livre", {}).get("ok") and estado.get("shopee", {}).get("ok"):
            _marca("varredura_dia").write_text(_hoje(), encoding="utf-8")  # falhou? a próxima rodada tenta de novo
    finally:
        _varredura["agora"] = False
        progresso.terminar()


def _rodar() -> None:
    for i, (nome, tarefa) in enumerate(TAREFAS.items()):
        progresso.tarefa(nome, i)
        try:
            estado[nome] = {"ok": True, "resultado": tarefa()}
        except Exception as e:  # noqa: BLE001 — registrar e seguir para a próxima tarefa
            estado[nome] = {"ok": False, "erro": str(e)[:300]}
            log.warning("sincronização %s falhou: %s", nome, e)
