from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text

from app.central.db import Base


class Conferencia(Base):
    """O que o operador constatou. Tabela separada: a sincronização das plataformas nunca a sobrescreve."""

    __tablename__ = "conferencias"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(ForeignKey("devolucoes.id"), unique=True, nullable=False)
    sku_recebido = Column(String(100))
    produto_correto = Column(Boolean, nullable=False)
    completo = Column(Boolean, nullable=False)
    sem_uso = Column(Boolean, nullable=False)
    revendavel = Column(Boolean, nullable=False)
    erro_nosso = Column(Boolean, nullable=False)
    observacao = Column(Text)
    classe = Column(String(1), nullable=False)
    lancamentos = Column(JSON, nullable=False)
    contestar = Column(Boolean, nullable=False)
    motivo = Column(Text, nullable=False)
    conferida_em = Column(DateTime, nullable=False)
    # Prejuízo registrado na conferência: CMV perdido (None = sem custo cadastrado) + frete reverso cobrado.
    perda_produto = Column(Float)
    frete_reverso = Column(Float)
    # Chamado manual: vale contestar mas a plataforma não deixa abrir pela API; o operador abre depois.
    chamado_manual = Column(Boolean, default=False, nullable=False)
    chamado_aberto_em = Column(DateTime)
    chamado_protocolo = Column(String(60))
    # Preenchido quando o operador clica em lançar: trava o segundo clique (estoque em dobro).
    estoque_lancado_em = Column(DateTime)
    estoque_resultado = Column(JSON)


class Evidencia(Base):
    __tablename__ = "evidencias"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(ForeignKey("devolucoes.id"), index=True, nullable=False)
    tipo = Column(String(10), nullable=False)  # foto | video
    arquivo = Column(String(80), nullable=False)
    tamanho = Column(Integer, nullable=False)
    enviada_em = Column(DateTime, nullable=False)
