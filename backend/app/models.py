from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Enum, ForeignKey
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import enum

class StatusEstoque(str, enum.Enum):
    QUARENTENA = "quarentena"
    CONFIRMADO = "confirmado"
    BLOQUEADO = "bloqueado"

class TipoDocumento(str, enum.Enum):
    NFE = "nfe"
    PDF = "pdf"

class NotaFiscal(Base):
    __tablename__ = "notas_fiscais"

    id = Column(Integer, primary_key=True)
    numero_nf = Column(String(20), unique=True, index=True)
    serie = Column(String(10))
    fornecedor = Column(String(255))
    cnpj = Column(String(20), nullable=True)
    endereco = Column(String(255), nullable=True)
    data_emissao = Column(DateTime)
    data_upload = Column(DateTime, default=datetime.utcnow)
    arquivo_original = Column(String(255))
    tipo_documento = Column(Enum(TipoDocumento))
    xml_processado = Column(Text, nullable=True)
    status = Column(String(50), default="processando")
    erros = Column(Text, nullable=True)

    itens = relationship("ItemEstoque", back_populates="nota_fiscal", cascade="all, delete-orphan")

class ItemEstoque(Base):
    __tablename__ = "itens_estoque"

    id = Column(Integer, primary_key=True)
    nf_id = Column(Integer, ForeignKey("notas_fiscais.id"))
    codigo_produto = Column(String(100))
    descricao = Column(String(255))
    quantidade_nf = Column(Float)
    quantidade_confirmada = Column(Float, nullable=True)
    preco_unitario = Column(Float)
    status = Column(Enum(StatusEstoque), default=StatusEstoque.QUARENTENA)
    divergencia = Column(String(100), nullable=True)
    data_criacao = Column(DateTime, default=datetime.utcnow)

    # Campos para integração com Olist
    olist_produto_id = Column(String(100), nullable=True)  # ID do produto na Olist
    olist_sku = Column(String(100), nullable=True)  # SKU do anúncio na Olist
    olist_nome = Column(String(255), nullable=True)  # Nome do anúncio na Olist
    vinculado_em = Column(DateTime, nullable=True)  # Quando foi vinculado
    estoque_olist_atualizado_em = Column(DateTime, nullable=True)  # Última atualização de estoque

    quantidade_olist_enviada = Column(Float, nullable=True)  # Quanto realmente entrou na Olist

    nota_fiscal = relationship("NotaFiscal", back_populates="itens")

class Anuncio(Base):
    __tablename__ = "anuncios"

    id = Column(Integer, primary_key=True)
    codigo_externo = Column(String(100), unique=True)
    titulo = Column(String(255))
    descricao = Column(Text)
    marketplace = Column(String(50))  # olist, mercado_livre, etc
    preco = Column(Float)
    estoque_atual = Column(Integer, default=0)
    data_atualizacao = Column(DateTime, default=datetime.utcnow)

class ConfirmacaoEstoque(Base):
    __tablename__ = "confirmacoes_estoque"

    id = Column(Integer, primary_key=True)
    item_estoque_id = Column(Integer, ForeignKey("itens_estoque.id"))
    quantidade_confirmada = Column(Float)
    divergencia = Column(String(255), nullable=True)
    data_confirmacao = Column(DateTime, default=datetime.utcnow)
    vinculado_olist = Column(String(100), nullable=True)  # SKU do anúncio na Olist
    observacoes = Column(Text, nullable=True)


class VinculoOlist(Base):
    """
    Memória de vínculos: de-para entre a descrição/código de um produto
    na nota fiscal (que varia por fornecedor) e o anúncio na Olist.
    Um mesmo anúncio Olist pode ter vários apelidos (linhas) diferentes.
    """
    __tablename__ = "vinculos_olist"

    id = Column(Integer, primary_key=True)
    # Lado do fornecedor (vem da NF) - usado para casar em notas futuras
    nf_codigo = Column(String(100), index=True, nullable=True)
    nf_descricao = Column(String(255), index=True)
    # Lado da Olist (o anúncio que foi vinculado)
    olist_produto_id = Column(String(100))
    olist_sku = Column(String(100))
    olist_nome = Column(String(255))
    olist_preco = Column(Float, default=0)
    # Metadados
    vezes_usado = Column(Integer, default=1)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow)


class Fornecedor(Base):
    """
    Cadastro centralizado de fornecedores com contatos para notificações
    """
    __tablename__ = "fornecedores"

    id = Column(Integer, primary_key=True)
    nome = Column(String(255), unique=True, index=True)
    cnpj = Column(String(20), nullable=True)
    contato_whatsapp = Column(String(20), nullable=True)  # Formato: 5519978149245
    email = Column(String(255), nullable=True)
    endereco = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    ativo = Column(Integer, default=1)  # 1 = ativo, 0 = inativo

    historico_compras = relationship("HistoricoCompra", back_populates="fornecedor", cascade="all, delete-orphan")
    notificacoes = relationship("NotificacaoFornecedor", back_populates="fornecedor", cascade="all, delete-orphan")


class HistoricoCompra(Base):
    """
    Rastreamento de quais fornecedores forneceram cada produto.
    Criado quando um item de estoque é confirmado (não no upload da NF).
    """
    __tablename__ = "historico_compras"

    id = Column(Integer, primary_key=True)
    fornecedor_id = Column(Integer, ForeignKey("fornecedores.id"), index=True)
    nf_id = Column(Integer, ForeignKey("notas_fiscais.id"), nullable=True)
    produto_codigo = Column(String(100), index=True)
    produto_descricao = Column(String(255))
    quantidade = Column(Float)  # Quantidade confirmada
    data_compra = Column(DateTime, default=datetime.utcnow)
    nf_numero = Column(String(20), nullable=True)

    fornecedor = relationship("Fornecedor", back_populates="historico_compras")


class ConfiguracaoEstoqueMinimo(Base):
    """
    Define o estoque mínimo para cada produto e se deve notificar fornecedores
    """
    __tablename__ = "configuracoes_estoque_minimo"

    id = Column(Integer, primary_key=True)
    produto_codigo = Column(String(100), unique=True, index=True)
    estoque_minimo = Column(Float, default=10)
    notificar_fornecedores = Column(Integer, default=1)  # 1 = ativo, 0 = desativo
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow)


class NotificacaoFornecedor(Base):
    """
    Histórico de notificações enviadas aos fornecedores
    Usado para auditoria e evitar envios duplicados
    """
    __tablename__ = "notificacoes_fornecedores"

    id = Column(Integer, primary_key=True)
    fornecedor_id = Column(Integer, ForeignKey("fornecedores.id"))
    produto_codigo = Column(String(100), index=True)
    produto_descricao = Column(String(255))
    quantidade_atual = Column(Float)
    estoque_minimo = Column(Float)
    mensagem = Column(Text)
    telefone_usado = Column(String(20))
    enviado_em = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default="enviado")  # enviado, falha, pendente
    erro_mensagem = Column(Text, nullable=True)

    fornecedor = relationship("Fornecedor", back_populates="notificacoes")


class EmbaleFU(Base):
    """
    Inbound do Mercado Livre FULL (lista de separação)
    PDF com produtos já separados fisicamente para envio ao Fulfillment
    """
    __tablename__ = "embaldes_fu"

    id = Column(Integer, primary_key=True)
    nome_embalde = Column(String(255), index=True)
    numero_inbound = Column(String(50), nullable=True, index=True)  # Frete #XXXXX do ML
    total_unidades = Column(Float, nullable=True)  # Total declarado no PDF
    arquivo_original = Column(String(255))
    arquivo_uuid = Column(String(255), unique=True)  # Nome único no sistema
    data_upload = Column(DateTime, default=datetime.utcnow)
    data_limite = Column(DateTime, nullable=True)  # Quando o FULL será enviado (deadline)
    data_encerramento = Column(DateTime, nullable=True)  # Quando foi efetivamente encerrado
    status = Column(String(50), default="processando")  # processando, encerrado
    observacoes = Column(Text, nullable=True)

    itens = relationship("ItemEmbaleFU", back_populates="embalde", cascade="all, delete-orphan")


class ItemEmbaleFU(Base):
    """
    Item dentro de um inbound (lista de separação)
    Vincula-se automaticamente a um anúncio Olist via SKU se existir vínculo
    """
    __tablename__ = "itens_embale_fu"

    id = Column(Integer, primary_key=True)
    embalde_id = Column(Integer, ForeignKey("embaldes_fu.id"))
    titulo_anuncio = Column(String(255), index=True)  # Título do produto (como vem do PDF)
    quantidade_separada = Column(Float)

    # Dados extraídos do PDF do Inbound
    sku_inbound = Column(String(100), nullable=True, index=True)  # SKU declarado no PDF
    codigo_ml = Column(String(100), nullable=True)  # Código ML (ex: GJRN27301)

    # Vinculação automática com Olist
    olist_produto_id = Column(String(100), nullable=True)  # ID do produto Olist
    olist_sku = Column(String(100), nullable=True)  # SKU do anúncio
    olist_nome = Column(String(255), nullable=True)  # Nome exato do anúncio

    # Status da validação
    validado = Column(Integer, default=0)  # 1 = validado, 0 = não validado
    validacao_mensagem = Column(Text, nullable=True)  # Motivo se não validado
    data_validacao = Column(DateTime, nullable=True)

    # Baixa de estoque na Olist (envio pro FULL)
    olist_estoque_antes = Column(Float, nullable=True)  # Saldo na Olist no momento da baixa
    quantidade_baixar = Column(Float, nullable=True)  # Qtd a dar baixa (declarada se houver falta)
    quantidade_baixada = Column(Float, nullable=True)  # Qtd efetivamente baixada na Olist
    falta = Column(Float, nullable=True)  # Quanto faltou (inbound - estoque), se positivo
    baixa_aplicada = Column(Integer, default=0)  # 1 = baixa já aplicada na Olist
    data_baixa = Column(DateTime, nullable=True)

    criado_em = Column(DateTime, default=datetime.utcnow)

    embalde = relationship("EmbaleFU", back_populates="itens")


class ApelidoFornecedor(Base):
    """
    Apelido/nome customizado de um fornecedor, compartilhado entre todos os
    usuários (persistido no banco). Mapeia o nome oficial (vindo da NF) para um
    nome curto que o time prefere ver.
    """
    __tablename__ = "apelidos_fornecedores"

    id = Column(Integer, primary_key=True)
    nome_fornecedor = Column(String(255), index=True)
    apelido = Column(String(100))
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow)
