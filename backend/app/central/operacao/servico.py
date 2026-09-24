"""Visão da operação: junta devolução + conferência + contestação para listar, filtrar e contar."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.central.conferencia.modelo import Conferencia
from app.central.devolucoes.modelo import Devolucao
from app.central.devolucoes.servico import publico
from app.central.mediacoes.modelo import Contestacao
from app.central.mercado_livre import catalogo
from app.central.olist import servico as olist
from app.central.db import Sessao

from .regras import ENVIOS, STATUS, envio, envio_plataforma, pendencias, status

COLUNAS_CONF = ("classe", "lancamentos", "estoque_lancado_em", "contestar", "chamado_manual", "chamado_aberto_em",
                "chamado_protocolo", "perda_produto", "frete_reverso", "conferida_em")


def linhas(desde: datetime | None = None) -> list[dict]:
    """Todas as devoluções com o status de operação calculado. ~1 mil linhas: cabe em memória."""
    with Sessao() as s:
        q = select(Devolucao)
        if desde:
            q = q.where(Devolucao.atualizada_em >= desde)
        devs = s.scalars(q).all()
        confs = {c.devolucao_id: {k: getattr(c, k) for k in COLUNAS_CONF} for c in s.scalars(select(Conferencia))}
        contestadas = set(s.scalars(select(Contestacao.devolucao_id).where(Contestacao.ok.is_(True))))
        aceitas = set(s.scalars(select(Contestacao.devolucao_id).where(Contestacao.ok.is_(True), Contestacao.caminho == "aceite")))
        linhas = []
        for d in devs:
            dev, conf = publico(d), confs.get(d.id)
            contestada = d.id in contestadas
            st = status(dev, conf, contestada, d.id in aceitas)
            linhas.append({**dev, "conferencia": conf, "contestada": contestada,
                           "status": st, "pendencias": pendencias(conf, contestada),
                           "envio": envio(d.plataforma, d.bruto) if st == "a_caminho" else None,
                           "envio_plataforma": envio_plataforma(d.plataforma, d.bruto) if st == "a_caminho" else None})
    return linhas


def _prejuizo(linha: dict) -> float | None:
    c = linha["conferencia"]
    if c:
        return round((c["frete_reverso"] or 0) + (c["perda_produto"] or 0), 2)
    return linha["custo_plataforma"]


def a_caminho_por_plataforma(ls: list[dict]) -> dict:
    """A caminho por plataforma e situação do envio: sempre as duas plataformas, para comparar."""
    saida = {p: {e: 0 for e in ENVIOS} for p in ("mercado_livre", "shopee")}
    for l in ls:
        if l["status"] == "a_caminho" and l["plataforma"] in saida:
            saida[l["plataforma"]][l["envio"]] += 1
    return saida


def listar(status_filtro: str | None, plataforma: str | None, motivo: str | None, destino: str | None,
           pagina: int, por_pagina: int, envio_filtro: str | None = None) -> dict:
    base = [l for l in linhas() if (not motivo or l["motivo"] == motivo) and (not destino or l["destino"] == destino)]
    a_caminho = a_caminho_por_plataforma(base)
    filtradas = [l for l in base if not plataforma or l["plataforma"] == plataforma]
    contagens = {s: 0 for s in STATUS}
    for l in filtradas:
        contagens[l["status"]] += 1
    if status_filtro:  # aceita vários separados por vírgula (ex.: histórico = resolvida,finalizada)
        filtradas = [l for l in filtradas if l["status"] in status_filtro.split(",")]
    if envio_filtro:
        filtradas = [l for l in filtradas if l["envio"] == envio_filtro]
    # Prazo que ainda dá para cumprir, o mais apertado primeiro; o resto (vencido ou sem prazo), mais recente primeiro.
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    filtradas.sort(key=lambda l: (0, l["prazo_vendedor"].timestamp()) if l["prazo_vendedor"] and l["prazo_vendedor"] > agora
                   else (1, -l["atualizada_em"].timestamp()))
    pagina_itens = filtradas[(pagina - 1) * por_pagina: pagina * por_pagina]
    fotos = catalogo.imagens(i.get("item_id") for l in pagina_itens if l["plataforma"] == "mercado_livre" for i in l["itens"][:1])
    for l in pagina_itens:
        item = (l["itens"] or [{}])[0]
        l["produto"] = item.get("nome") or olist.descricao_em_cache(l["pacote"] or l["pedido"])
        l["imagem"] = item.get("imagem") or fotos.get(item.get("item_id"))
        l["prejuizo"] = _prejuizo(l)
    return {"total": len(filtradas), "contagens": contagens, "a_caminho": a_caminho, "itens": pagina_itens}


def atencao() -> dict:
    """O que precisa de mão agora — alimenta o quadro de alertas do resumo."""
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    abertas = [l for l in linhas() if l["status"] not in ("finalizada", "com_a_plataforma")]
    return {
        "contestar": sum("contestar" in l["pendencias"] for l in abertas),
        "chamados_manuais": sum("chamado_manual" in l["pendencias"] for l in abertas),
        "lancar_estoque": sum("lancar_estoque" in l["pendencias"] for l in abertas),
        "aguardando_conferencia": sum(l["status"] == "aguardando_conferencia" for l in abertas),
        "prazo_em_24h": sum(1 for l in abertas if l["prazo_vendedor"] and agora <= l["prazo_vendedor"] <= agora + timedelta(hours=24)),
    }


def ultimas(limite: int = 6) -> list[dict]:
    recentes = sorted(linhas(), key=lambda l: l["atualizada_em"], reverse=True)[:limite]
    return [{k: l[k] for k in ("id", "plataforma", "pedido", "pacote", "rastreio", "id_externo", "status", "itens",
                               "atualizada_em", "motivo")} for l in recentes]
