"""Respostas prontas para o campo "O que você viu" da conferência. Lista única, compartilhada entre operadores."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, delete, select

from app.central.db import Base, Sessao


class RespostaPronta(Base):
    __tablename__ = "respostas_prontas"

    id = Column(Integer, primary_key=True)
    texto = Column(String(500), nullable=False)
    criada_em = Column(DateTime, nullable=False)


def _agora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def listar() -> list[dict]:
    with Sessao() as s:
        linhas = s.scalars(select(RespostaPronta).order_by(RespostaPronta.criada_em)).all()
        return [{"id": r.id, "texto": r.texto} for r in linhas]


def criar(texto: str) -> dict:
    texto = (texto or "").strip()
    if not texto:
        raise ValueError("texto não pode ser vazio")
    with Sessao.begin() as s:
        r = RespostaPronta(texto=texto, criada_em=_agora())
        s.add(r)
        s.flush()
        return {"id": r.id, "texto": r.texto}


def editar(resposta_id: int, texto: str) -> dict:
    texto = (texto or "").strip()
    if not texto:
        raise ValueError("texto não pode ser vazio")
    with Sessao.begin() as s:
        r = s.get(RespostaPronta, resposta_id)
        if not r:
            raise LookupError(f"Resposta pronta {resposta_id} não existe")
        r.texto = texto
        return {"id": r.id, "texto": r.texto}


def excluir(resposta_id: int) -> None:
    with Sessao.begin() as s:
        s.execute(delete(RespostaPronta).where(RespostaPronta.id == resposta_id))
