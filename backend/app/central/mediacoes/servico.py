"""Contestação guiada: escolhe a plataforma, envia texto + evidências da conferência e guarda o histórico."""

from datetime import datetime, timezone

from sqlalchemy import select

from app.central.conferencia.modelo import Conferencia, Evidencia
from app.central.conferencia.servico import PASTA, Travada
from app.central.devolucoes.modelo import Devolucao
from app.central.mercado_livre import acoes as mercado_livre
from app.central.shopee import acoes as shopee
from app.central.db import Sessao

from .modelo import Contestacao

PLATAFORMAS = {"mercado_livre": mercado_livre, "shopee": shopee}


def _agora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _devolucao(s, devolucao_id: int) -> Devolucao:
    d = s.get(Devolucao, devolucao_id)
    if not d:
        raise LookupError(f"Devolução {devolucao_id} não existe")
    return d


def _produto_perfeito(s, devolucao_id: int) -> bool:
    """Classe A com contestação = produto voltou perfeito: a briga é contra a reclamação, não contra o produto."""
    conf = s.scalar(select(Conferencia).filter_by(devolucao_id=devolucao_id))
    return bool(conf and conf.classe == "A")


def motivos(devolucao_id: int) -> list[dict]:
    with Sessao() as s:
        d = _devolucao(s, devolucao_id)
        return PLATAFORMAS[d.plataforma].motivos_contestacao(d.id_externo, _produto_perfeito(s, d.id))


def contestar(devolucao_id: int, motivo: str, texto: str) -> dict:
    """Só por clique do operador, e só quando a conferência concluiu que vale contestar."""
    with Sessao() as s:
        d = _devolucao(s, devolucao_id)
        conf = s.scalar(select(Conferencia).filter_by(devolucao_id=d.id))
        if not conf:
            raise LookupError("Confira o produto antes de contestar.")
        if not conf.contestar:
            raise Travada(f"A conferência concluiu que não vale contestar: {conf.motivo}")
        if s.scalar(select(Contestacao).filter_by(devolucao_id=d.id, ok=True)):
            raise Travada("Esta devolução já foi contestada ou aceita.")
        evidencias = s.scalars(select(Evidencia).filter_by(devolucao_id=d.id)).all()
        fotos = [PASTA / str(d.id) / e.arquivo for e in evidencias if e.tipo == "foto"]
        videos = [PASTA / str(d.id) / e.arquivo for e in evidencias if e.tipo == "video"]
        plataforma, id_externo, perfeito = d.plataforma, d.id_externo, conf.classe == "A"
    if not fotos:
        raise ValueError("Anexe ao menos uma foto do produto e da embalagem antes de contestar.")

    registro = Contestacao(devolucao_id=devolucao_id, motivo=str(motivo), texto=texto, anexos=[], enviada_em=_agora())
    try:
        r = PLATAFORMAS[plataforma].contestar(id_externo, motivo, texto, fotos, videos, perfeito)
        registro.ok, registro.caminho, registro.anexos, registro.aviso = True, r["caminho"], r["anexos"], r.get("aviso")
    except RuntimeError as e:
        registro.ok, registro.erro = False, str(e)
    with Sessao.begin() as s:
        s.add(registro)
        s.flush()
        return {c.name: getattr(registro, c.name) for c in Contestacao.__table__.columns}


def aceitar(devolucao_id: int) -> dict:
    """Aceita a devolução na plataforma (reembolso ao comprador). Fica no mesmo histórico, caminho 'aceite'."""
    with Sessao() as s:
        d = _devolucao(s, devolucao_id)
        if s.scalar(select(Contestacao).filter_by(devolucao_id=d.id, ok=True)):
            raise Travada("Esta devolução já foi contestada ou aceita.")
        plataforma, id_externo = d.plataforma, d.id_externo
    modulo = PLATAFORMAS[plataforma]
    if not hasattr(modulo, "aceitar"):
        raise ValueError("Aceite esta devolução pelo painel da plataforma.")
    registro = Contestacao(devolucao_id=devolucao_id, motivo="aceite", texto="Devolução aceita", anexos=[], enviada_em=_agora())
    try:
        r = modulo.aceitar(id_externo)
        registro.ok, registro.caminho, registro.anexos = True, r["caminho"], r["anexos"]
    except RuntimeError as e:
        registro.ok, registro.erro = False, str(e)
    with Sessao.begin() as s:
        s.add(registro)
        s.flush()
        return {c.name: getattr(registro, c.name) for c in Contestacao.__table__.columns}


def historico(devolucao_id: int) -> list[dict]:
    with Sessao() as s:
        return [{c.name: getattr(x, c.name) for c in Contestacao.__table__.columns}
                for x in s.scalars(select(Contestacao).filter_by(devolucao_id=devolucao_id).order_by(Contestacao.id))]
