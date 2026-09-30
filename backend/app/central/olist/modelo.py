from sqlalchemy import Column, Date, DateTime, Integer, JSON, String

from app.central.db import Base


class NotaDevolucao(Base):
    """Índice das NF de devolução da Olist pela chave da NF de venda. A Olist não liga a nota de devolução
    ao pedido do marketplace; a única ligação é a chave referenciada escrita nas observações."""

    __tablename__ = "olist_notas_devolucao"

    id = Column(Integer, primary_key=True)  # id da nota na Olist
    numero = Column(String(20), nullable=False)
    serie = Column(String(5))
    situacao = Column(String(40), nullable=False)
    emitida_em = Column(Date)
    chave_venda = Column(String(44), index=True)
    itens = Column(JSON, nullable=False)


class PedidoCache(Base):
    """Pedido/NF/itens da Olist por número do marketplace: a conferência abre na hora em vez de esperar a Olist."""

    __tablename__ = "olist_pedidos_cache"

    numero_marketplace = Column(String(40), primary_key=True)
    pedidos = Column(JSON, nullable=False)
    atualizado_em = Column(DateTime, nullable=False)
