"""Quem levou a devolução para a mediação: a Novaes (vendedor), o comprador ou a própria plataforma.
No ML vem do histórico de status da reclamação (a primeira entrada na etapa "dispute"); não muda depois, então
é consultado uma vez e guardado aqui. Na Shopee só o vendedor abre disputa; guardar aqui também é o que lembra
que houve disputa depois que ela termina (a devolução sai de SELLER_DISPUTE/JUDGING e o status volta ao normal)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, Column, DateTime, String, select

from app.central import progresso
from app.central.db import Base, Sessao
from app.central.devolucoes.modelo import Devolucao

# O que conta como "a Novaes atuou na mediação": levar ao mediador, mandar prova/mensagem a ele, ou contestar a revisão.
ATUACAO_ML = {"open_dispute", "send_message_to_mediator", "return_review_fail"}
RECONSULTA_ABERTA = timedelta(hours=6)  # disputa aberta: a Novaes ainda pode agir; encerrada não muda mais
QUEM_ML = {"respondent": "vendedor", "complainant": "comprador", "mediator": "plataforma"}


class MediacaoOrigem(Base):
    __tablename__ = "mediacao_origem"

    plataforma = Column(String(20), primary_key=True)
    id_externo = Column(String(40), primary_key=True)
    aberta_por = Column(String(20), nullable=False)  # vendedor | comprador | plataforma | desconhecido


class MediacaoAtuacao(Base):
    """Ações da Novaes (respondent) no histórico da reclamação do ML. Tabela à parte: a de origem já existe em produção."""
    __tablename__ = "mediacao_atuacao"

    plataforma = Column(String(20), primary_key=True)
    id_externo = Column(String(40), primary_key=True)
    acoes = Column(String(200), nullable=False)  # ações da Novaes separadas por vírgula ("" = nenhuma)
    encerrada = Column(Boolean, nullable=False)
    consultada_em = Column(DateTime, nullable=False)


def atuou() -> dict[tuple[str, str], bool]:
    """(plataforma, id_externo) → a Novaes atuou na mediação. Shopee: toda disputa é da Novaes (só o vendedor abre)."""
    with Sessao() as s:
        return {(a.plataforma, a.id_externo): bool(set(a.acoes.split(",")) & ATUACAO_ML)
                for a in s.scalars(select(MediacaoAtuacao))}


def mapa() -> dict[tuple[str, str], str]:
    with Sessao() as s:
        return {(m.plataforma, m.id_externo): m.aberta_por for m in s.scalars(select(MediacaoOrigem))}


def _sem_acesso(e: Exception) -> bool:
    """O ML nega alguns itens: 403 "User does not have access to claim" ou 401 "invalid_caller_id" (envio de outro
    vendedor). É daquele item, não da conexão: marca e segue. 401 de token vencido não tem esse código e para a rodada."""
    return "HTTP 403" in str(e) or "invalid_caller_id" in str(e)


def _ml(claim_id: str) -> str:
    from app.central.mercado_livre import client
    entradas = [h for h in client.get(f"/post-purchase/v1/claims/{claim_id}/status-history") or []
                if h.get("stage") == "dispute"]
    return QUEM_ML.get(min(entradas, key=lambda h: h["date"])["change_by"], "desconhecido") if entradas else "desconhecido"


PARALELO = 8  # consultas ao ML ao mesmo tempo (~0,3 s cada): o backlog inteiro sai em uma rodada


def em_paralelo(fn, itens: list) -> list[tuple]:
    """[(item, resultado ou RuntimeError)] consultando o ML em paralelo e alimentando a barra de progresso.
    Reclamação com 403 volta como erro e quem chamou decide; conexão caída também (e aí para)."""
    from concurrent.futures import ThreadPoolExecutor

    def seguro(item):
        try:
            return item, fn(item)
        except RuntimeError as e:
            return item, e

    saida = []
    with ThreadPoolExecutor(PARALELO) as ex:
        for n, r in enumerate(ex.map(seguro, itens), 1):
            progresso.parcial(n / len(itens))
            saida.append(r)
    return saida


def _erro_de_conexao(resultados: list[tuple]) -> str | None:
    return next((str(r)[:200] for _, r in resultados if isinstance(r, RuntimeError) and not _sem_acesso(r)), None)


def completar(limite: int | None = None) -> dict:
    """Consulta as devoluções que estão ou passaram por mediação e ainda não sabemos quem abriu."""
    with Sessao() as s:
        conhecidas = set(s.execute(select(MediacaoOrigem.plataforma, MediacaoOrigem.id_externo)).all())
        faltam = [(d.plataforma, d.id_externo) for d in s.scalars(select(Devolucao).where(Devolucao.em_mediacao.is_(True)))
                  if (d.plataforma, d.id_externo) not in conhecidas][:limite]
    # Shopee: só o vendedor abre disputa (dispute_return → SELLER_DISPUTE → JUDGING), não precisa consultar.
    feitas = {(p, i): "vendedor" for p, i in faltam if p == "shopee"}
    resultados = em_paralelo(_ml, [i for p, i in faltam if p == "mercado_livre"])
    for claim_id, r in resultados:
        if not isinstance(r, RuntimeError):
            feitas[("mercado_livre", claim_id)] = r
        elif _sem_acesso(r):
            feitas[("mercado_livre", claim_id)] = "desconhecido"  # 403 nessa reclamação: marca e não consulta de novo
    with Sessao.begin() as s:
        for (plataforma, id_externo), quem in feitas.items():
            s.merge(MediacaoOrigem(plataforma=plataforma, id_externo=id_externo, aberta_por=quem))
    erro = _erro_de_conexao(resultados)
    return {"consultadas": len(feitas), "faltam": len(faltam) - len(feitas), **({"erro": erro} if erro else {})}


def completar_atuacao(limite: int | None = None) -> dict:
    """Lê o histórico de ações das disputas do ML: as que nunca foram lidas e as abertas lidas há mais de 6 h."""
    from app.central.mercado_livre import client
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    with Sessao() as s:
        lidas = {(a.plataforma, a.id_externo): a for a in s.scalars(select(MediacaoAtuacao))}
        encerrada = {}
        for d in s.scalars(select(Devolucao).where(Devolucao.plataforma == "mercado_livre", Devolucao.em_mediacao.is_(True))):
            a = lidas.get((d.plataforma, d.id_externo))
            if a is None or (not a.encerrada and agora - a.consultada_em > RECONSULTA_ABERTA):
                encerrada[d.id_externo] = d.resultado_mediacao != "em_andamento"
    faltam = list(encerrada)[:limite]
    resultados = em_paralelo(lambda c: client.get(f"/post-purchase/v1/claims/{c}/actions-history") or [], faltam)
    feitas = []
    for claim_id, r in resultados:
        if isinstance(r, RuntimeError) and not _sem_acesso(r):
            continue  # conexão: fica para a próxima rodada
        historico = [] if isinstance(r, RuntimeError) else r  # 403: grava sem ações e encerrada, para não travar a fila
        acoes = sorted({h["action_name"] for h in historico if h.get("player_role") == "respondent"})
        feitas.append(MediacaoAtuacao(plataforma="mercado_livre", id_externo=claim_id, acoes=",".join(acoes)[:200],
                                      encerrada=encerrada[claim_id] or isinstance(r, RuntimeError), consultada_em=agora))
    with Sessao.begin() as s:
        for a in feitas:
            s.merge(a)
    erro = _erro_de_conexao(resultados)
    return {"consultadas": len(feitas), "faltam": len(faltam) - len(feitas), **({"erro": erro} if erro else {})}
