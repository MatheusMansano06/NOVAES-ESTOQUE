"""Fechamento de mês: o ciclo da fatura (13 ao 12) que já fechou não muda mais. O B.I calcula uma vez, grava aqui
e passa a ler daqui. Só a "releitura pesada" (botão na tela) apaga e refaz — ver agenda.refazer_mes."""

from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, String

from app.central.db import Base, Sessao


class FechamentoMes(Base):
    __tablename__ = "fechamento_mes"

    fatura = Column(String(10), primary_key=True)  # chave da fatura do ML, ex.: 2026-09-01
    dados = Column(JSON, nullable=False)
    fechado_em = Column(DateTime, nullable=False)


def ler(chave: str) -> dict | None:
    with Sessao() as s:
        f = s.get(FechamentoMes, chave)
        return {**f.dados, "fechado_em": f.fechado_em.isoformat()} if f else None


def gravar(chave: str, dados: dict) -> None:
    with Sessao.begin() as s:
        s.merge(FechamentoMes(fatura=chave, dados=dados, fechado_em=datetime.now(timezone.utc).replace(tzinfo=None)))


def apagar(chave: str) -> None:
    with Sessao.begin() as s:
        if f := s.get(FechamentoMes, chave):
            s.delete(f)
