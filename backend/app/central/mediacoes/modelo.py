from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text

from app.central.db import Base


class Contestacao(Base):
    """Cada tentativa de contestar enviada à plataforma (com sucesso ou erro)."""

    __tablename__ = "contestacoes"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(ForeignKey("devolucoes.id"), index=True, nullable=False)
    motivo = Column(String(20), nullable=False)
    texto = Column(Text, nullable=False)
    ok = Column(Boolean, nullable=False)
    caminho = Column(String(30))  # revisao_com_falha | mediacao | disputa
    anexos = Column(JSON, nullable=False)
    aviso = Column(Text)
    erro = Column(Text)
    enviada_em = Column(DateTime, nullable=False)
