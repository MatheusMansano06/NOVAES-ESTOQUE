"""Visão da operação: junta devolução + conferência + contestação para listar, filtrar e contar."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.central.conferencia.modelo import Conferencia, Evidencia
from app.central.devolucoes.modelo import Devolucao
from app.central.devolucoes.servico import publico
from app.central.mediacoes.modelo import DECISIVA, Contestacao
from app.central.mercado_livre import catalogo
from app.central.olist import servico as olist
from app.central.db import Sessao

from .regras import ENVIOS, STATUS, envio, envio_plataforma, pendencias, resultado_mediacao, status

COLUNAS_CONF = ("classe", "lancamentos", "estoque_lancado_em", "contestar", "chamado_manual", "chamado_aberto_em",
                "chamado_protocolo", "chamado_resultado", "chamado_valor_recuperado", "chamado_resultado_em",
                "perda_produto", "frete_reverso", "conferida_em", "erro_nosso", "sku_recebido")


def linhas(desde: datetime | None = None) -> list[dict]:
    """Todas as devoluções com o status de operação calculado. ~1 mil linhas: cabe em memória."""
    with Sessao() as s:
        q = select(Devolucao)
        if desde:
            q = q.where(Devolucao.atualizada_em >= desde)
        devs = s.scalars(q).all()
        confs = {c.devolucao_id: {k: getattr(c, k) for k in COLUNAS_CONF} for c in s.scalars(select(Conferencia))}
        contestadas = set(s.scalars(select(Contestacao.devolucao_id).where(Contestacao.ok.is_(True), DECISIVA)))
        aceitas = set(s.scalars(select(Contestacao.devolucao_id).where(Contestacao.ok.is_(True), Contestacao.caminho.in_(("aceite", "reembolso")))))
        linhas = []
        for d in devs:
            dev, conf = publico(d), confs.get(d.id)
            contestada = d.id in contestadas
            st = status(dev, conf, contestada, d.id in aceitas)
            linha = {**dev, "conferencia": conf, "contestada": contestada,
                     "status": st, "pendencias": pendencias(conf, contestada),
                     "envio": envio(d.plataforma, d.bruto) if st == "a_caminho" else None,
                     "envio_plataforma": envio_plataforma(d.plataforma, d.bruto) if st == "a_caminho" else None}
            linha["mediacao"] = resultado_mediacao(linha)
            linhas.append(linha)
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
           pagina: int, por_pagina: int, envio_filtro: str | None = None, mediacao_filtro: str | None = None,
           busca: str | None = None) -> dict:
    por_motivo = [l for l in linhas() if not motivo or l["motivo"] == motivo]
    todas = [l for l in por_motivo if not plataforma or l["plataforma"] == plataforma]
    # Mediação encerrada conta qualquer destino: perdida com o produto que nem voltou também vira chamado manual.
    mediacoes = {r: sum(l["mediacao"] == r for l in todas) for r in ("ganha", "perdida", "parcial")}
    base = [l for l in por_motivo if not destino or l["destino"] == destino]
    a_caminho = a_caminho_por_plataforma(base)
    filtradas = [l for l in base if not plataforma or l["plataforma"] == plataforma]
    contagens = {s: 0 for s in STATUS}
    for l in filtradas:
        contagens[l["status"]] += 1
    if mediacao_filtro:  # registro de mediações: ignora destino, como a contagem acima
        filtradas = [l for l in todas if l["mediacao"] in mediacao_filtro.split(",")]
    if status_filtro:  # aceita vários separados por vírgula (ex.: histórico = resolvida,finalizada)
        filtradas = [l for l in filtradas if l["status"] in status_filtro.split(",")]
    if envio_filtro:
        filtradas = [l for l in filtradas if l["envio"] == envio_filtro]
    if busca and (termo := busca.strip().lower()):
        # Pedido, carrinho, id da reclamação/mediação ou rastreio: pedaço do número basta (ex.: os últimos dígitos).
        filtradas = [l for l in filtradas
                     if any(termo in str(l.get(c) or "").lower() for c in ("pedido", "pacote", "id_externo", "rastreio"))]
    # Prazo que ainda dá para cumprir, o mais apertado primeiro; o resto (vencido ou sem prazo), mais recente primeiro.
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    filtradas.sort(key=lambda l: (0, l["prazo_vendedor"].timestamp()) if l["prazo_vendedor"] and l["prazo_vendedor"] > agora
                   else (1, -l["atualizada_em"].timestamp()))
    pagina_itens = _completar(filtradas[(pagina - 1) * por_pagina: pagina * por_pagina])
    return {"total": len(filtradas), "contagens": contagens, "mediacoes": mediacoes, "a_caminho": a_caminho, "itens": pagina_itens,
            "armazenamento": armazenamento_videos()}


def _completar(itens: list[dict]) -> list[dict]:
    """Produto, foto, provas e prejuízo: só para as linhas que vão para a tela."""
    fotos = catalogo.imagens(i.get("item_id") for l in itens if l["plataforma"] == "mercado_livre" for i in l["itens"][:1])
    with Sessao() as s:
        evidencias = s.scalars(select(Evidencia).where(Evidencia.devolucao_id.in_([l["id"] for l in itens]))).all()
        provas = [(e.devolucao_id, {"id": e.id, "tipo": e.tipo, "arquivo": e.arquivo}) for e in evidencias]
    for l in itens:
        l["evidencias"] = [p for dono, p in provas if dono == l["id"]]
        item = (l["itens"] or [{}])[0]
        l["produto"] = item.get("nome") or olist.descricao_em_cache(l["pacote"] or l["pedido"])
        l["imagem"] = item.get("imagem") or fotos.get(item.get("item_id"))
        l["prejuizo"] = _prejuizo(l)
    return itens


def _perdida_em(bruto: dict, atualizada_em: datetime) -> datetime:
    """Quando a plataforma decidiu contra a Novaes. ML: data da resolução; sem ela, a última mudança na plataforma."""
    data = (((bruto or {}).get("claim") or {}).get("resolution") or {}).get("date_created")
    if not data:
        return atualizada_em
    d = datetime.fromisoformat(data)
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d


def chamados_pendentes() -> list[dict]:
    """Mediação perdida de produto que a conferência viu quebrado (B) ou diferente do enviado (C), sem ser erro
    nosso: o valor só volta com chamado manual no suporte. Sai da lista quando o protocolo é registrado.
    Mais antiga primeiro: é a que está mais perto de perder o prazo do suporte."""
    todas = linhas()
    abrir = [l for l in todas
             if l["mediacao"] in ("perdida", "parcial") and (c := l["conferencia"])
             and c["classe"] in ("B", "C") and not c["erro_nosso"] and not c["chamado_aberto_em"]]
    # Protocolo aberto, sem resposta do suporte ainda: falta dizer se o valor voltou.
    aguardando = [l for l in todas if (c := l["conferencia"]) and c["chamado_aberto_em"] and not c["chamado_resultado"]]
    with Sessao() as s:
        ids = [l["id"] for l in abrir + aguardando]
        brutos = dict(s.execute(select(Devolucao.id, Devolucao.bruto).where(Devolucao.id.in_(ids))).all())
    for l in abrir + aguardando:
        l["perdida_em"] = _perdida_em(brutos.get(l["id"]), l["atualizada_em"])
    abrir.sort(key=lambda l: l["perdida_em"])
    aguardando.sort(key=lambda l: l["conferencia"]["chamado_aberto_em"])
    return {"abrir": _completar(abrir), "aguardando": _completar(aguardando)}


def armazenamento_videos() -> dict:
    """Quanto vídeo de conferência está no disco agora (o volume do Railway é pago por GB)."""
    with Sessao() as s:
        n, total = s.execute(select(func.count(), func.coalesce(func.sum(Evidencia.tamanho), 0))
                             .where(Evidencia.tipo == "video")).one()
    return {"videos": n, "bytes": int(total)}


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
