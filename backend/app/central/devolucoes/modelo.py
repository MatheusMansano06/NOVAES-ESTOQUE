from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, UniqueConstraint

from app.central.db import Base

Dinheiro = Numeric(12, 2, asdecimal=False)


class Devolucao(Base):
    """Foto normalizada do que a plataforma diz sobre a devolução. Dados da conferência da Novaes
    ficam em outra tabela, para a sincronização nunca sobrescrever o trabalho do operador."""

    __tablename__ = "devolucoes"
    __table_args__ = (UniqueConstraint("plataforma", "id_externo"),)

    id = Column(Integer, primary_key=True)
    plataforma = Column(String(20), nullable=False)
    id_externo = Column(String(40), nullable=False)
    pedido = Column(String(40), index=True, nullable=False)
    # Carrinho do ML: a Olist registra a venda pelo número do pacote, não do pedido.
    pacote = Column(String(40), index=True)
    rastreio = Column(String(60), index=True)
    etapa = Column(String(20), nullable=False)
    status_plataforma = Column(String(40), nullable=False)
    em_mediacao = Column(Boolean, nullable=False)
    # A plataforma deixa a Novaes contestar agora (revisão com falha / abrir disputa)?
    pode_contestar = Column(Boolean, default=False, nullable=False)
    motivo = Column(String(20), nullable=False)
    motivo_plataforma = Column(String(60), nullable=False)
    responsavel = Column(String(20), nullable=False)
    destino = Column(String(20), nullable=False)
    valor_reembolso = Column(Dinheiro)
    custo_plataforma = Column(Dinheiro)
    afeta_reputacao = Column(Boolean)
    # Condição do produto segundo a revisão da plataforma (ML no CD: saleable/unsaleable/discard/missing).
    condicao_produto = Column(String(20))
    # Mediação na plataforma: em_andamento | ganha | perdida | parcial (None = não houve mediação).
    resultado_mediacao = Column(String(20))
    cobertura_aplicada = Column(Boolean)  # a plataforma cobriu o prejuízo do vendedor
    prazo_vendedor = Column(DateTime)
    itens = Column(JSON, nullable=False)
    aberta_em = Column(DateTime, nullable=False)
    atualizada_em = Column(DateTime, nullable=False)
    bruto = Column(JSON, nullable=False)


class CodigoDevolucao(Base):
    """Todo código que pode estar numa etiqueta, nota ou QR e que leva a esta devolução. O bipe procura aqui."""

    __tablename__ = "devolucoes_codigos"

    codigo = Column(String(80), primary_key=True)
    devolucao_id = Column(ForeignKey("devolucoes.id"), primary_key=True)
    origem = Column(String(20), nullable=False)  # plataforma que informou (mercado_livre, shopee, olist)
