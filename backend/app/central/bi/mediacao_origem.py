"""Quem levou a devolução para a mediação: a Novaes (vendedor), o comprador ou a própria plataforma.
No ML vem do histórico de status da reclamação (a primeira entrada na etapa "dispute"); não muda depois, então
é consultado uma vez e guardado aqui. Na Shopee, SELLER_DISPUTE = a Novaes contestou."""

from sqlalchemy import Column, String, select

from app.central.db import Base, Sessao
from app.central.devolucoes.modelo import Devolucao

QUEM_ML = {"respondent": "vendedor", "complainant": "comprador", "mediator": "plataforma"}


class MediacaoOrigem(Base):
    __tablename__ = "mediacao_origem"

    plataforma = Column(String(20), primary_key=True)
    id_externo = Column(String(40), primary_key=True)
    aberta_por = Column(String(20), nullable=False)  # vendedor | comprador | plataforma | desconhecido


def mapa() -> dict[tuple[str, str], str]:
    with Sessao() as s:
        return {(m.plataforma, m.id_externo): m.aberta_por for m in s.scalars(select(MediacaoOrigem))}


def _ml(claim_id: str) -> str:
    from app.central.mercado_livre import client
    entradas = [h for h in client.get(f"/post-purchase/v1/claims/{claim_id}/status-history") or []
                if h.get("stage") == "dispute"]
    return QUEM_ML.get(min(entradas, key=lambda h: h["date"])["change_by"], "desconhecido") if entradas else "desconhecido"


def completar(limite: int = 300) -> dict:
    """Consulta as devoluções que estão ou passaram por mediação e ainda não sabemos quem abriu."""
    with Sessao() as s:
        conhecidas = set(s.execute(select(MediacaoOrigem.plataforma, MediacaoOrigem.id_externo)).all())
        faltam = [(d.plataforma, d.id_externo, d.status_plataforma) for d in
                  s.scalars(select(Devolucao).where(Devolucao.em_mediacao.is_(True)))
                  if (d.plataforma, d.id_externo) not in conhecidas]
    feitas, erro = {}, None
    for plataforma, id_externo, status in faltam[:limite]:
        if plataforma == "shopee":
            # ponytail: só vê o status atual; disputa da Novaes que já virou JUDGING cai como "plataforma"
            quem = "vendedor" if status == "SELLER_DISPUTE" else "plataforma"
        elif erro:
            continue  # ML já falhou nesta rodada: não martela a API
        else:
            try:
                quem = _ml(id_externo)
            except RuntimeError as e:  # ML desconectado: tenta na próxima rodada, a Shopee segue
                erro = str(e)[:200]
                continue
        feitas[(plataforma, id_externo)] = quem
    with Sessao.begin() as s:
        for (plataforma, id_externo), quem in feitas.items():
            s.merge(MediacaoOrigem(plataforma=plataforma, id_externo=id_externo, aberta_por=quem))
    return {"consultadas": len(feitas), "faltam": max(0, len(faltam) - len(feitas)), **({"erro": erro} if erro else {})}
