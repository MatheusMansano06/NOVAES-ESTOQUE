"""Bounded context de devoluções (Fase 1 — leitura e vínculo).

Datas ficam como string ISO-8601 em `tracking_event.data_hora` e
`return_case.prazo_resolucao` porque vêm direto do payload normalizado dos
marketplaces — mesmo raciocínio que já existia no módulo antigo (evitar
converter e comparar timezones que a própria API já resolve).
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class ReturnCase(Base):
    __tablename__ = "return_cases"

    id = Column(Integer, primary_key=True)
    marketplace = Column(String(30), nullable=False, index=True)  # "mercado_livre" | "shopee"
    conta = Column(String(80), nullable=False, default="")
    order_id = Column(String(100), nullable=False, index=True)
    claim_id = Column(String(50), nullable=False, index=True)
    status_marketplace = Column(String(60), nullable=False, default="")
    motivo = Column(String(255), nullable=False, default="")
    prazo_resolucao = Column(String(40), nullable=True)
    correlation_id = Column(String(80), nullable=False)
    criado_em = Column(DateTime, default=datetime.utcnow)
    ultima_sincronizacao = Column(DateTime, default=datetime.utcnow)

    itens = relationship("ReturnItem", back_populates="caso", cascade="all, delete-orphan")
    eventos = relationship("TrackingEvent", back_populates="caso", cascade="all, delete-orphan")
    olist_link = relationship("OlistLink", back_populates="caso", uselist=False, cascade="all, delete-orphan")


class ReturnItem(Base):
    __tablename__ = "return_items"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, index=True)
    sku_esperado = Column(String(120), nullable=False, default="")
    produto_nome = Column(String(255), nullable=False, default="")
    quantidade = Column(Integer, nullable=False, default=1)
    cmv_unitario = Column(Float, nullable=True)

    caso = relationship("ReturnCase", back_populates="itens")


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, index=True)
    status = Column(String(60), nullable=False, default="")
    descricao = Column(Text, default="")
    origem = Column(String(20), nullable=False, default="marketplace")  # "marketplace" | "olist"
    data_hora = Column(String(40), nullable=False)
    payload_raw = Column(Text, default="{}")

    caso = relationship("ReturnCase", back_populates="eventos")


class OlistLink(Base):
    __tablename__ = "olist_links"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, unique=True, index=True)
    produto_id_olist = Column(String(60), default="")
    sku = Column(String(120), default="", index=True)
    produto_nome_olist = Column(String(255), default="")
    cmv = Column(Float, default=0)
    estoque_disponivel = Column(Integer, nullable=True)
    sincronizado_em = Column(DateTime, default=datetime.utcnow)

    caso = relationship("ReturnCase", back_populates="olist_link")
