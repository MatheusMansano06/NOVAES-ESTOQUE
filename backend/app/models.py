from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Enum, ForeignKey, UniqueConstraint
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
    valor_frete = Column(Float, default=0)  # Frete pago nesta compra (rateado por item no cálculo de margem)

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


class Operador(Base):
    """
    Operadores que podem iniciar turno na aplicação.
    """
    __tablename__ = "operadores"

    id = Column(Integer, primary_key=True)
    nome = Column(String(120), unique=True, index=True)
    ativo = Column(Integer, default=1)
    criado_em = Column(DateTime, default=datetime.utcnow)


class LogOperacao(Base):
    """
    Auditoria das ações feitas na aplicação por operador/master.
    """
    __tablename__ = "logs_operacao"

    id = Column(Integer, primary_key=True)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True, index=True)
    operador_nome = Column(String(120), index=True)
    operador_role = Column(String(30), default="operador", index=True)
    acao = Column(String(80), index=True)
    entidade_tipo = Column(String(80), nullable=True, index=True)
    entidade_id = Column(String(120), nullable=True, index=True)
    descricao = Column(String(255), nullable=True)
    detalhes_json = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow, index=True)


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
    revisao_salva_em = Column(DateTime, nullable=True)  # Primeira revisao congelada
    status = Column(String(50), default="processando")  # processando, encerrado
    observacoes = Column(Text, nullable=True)
    ultimo_item_separacao = Column(Integer, nullable=True)  # item_id onde a separação parou (retomar de onde parou)

    itens = relationship("ItemEmbaleFU", back_populates="embalde", cascade="all, delete-orphan")
    historico_full = relationship("HistoricoFullEmbale", back_populates="embalde", cascade="all, delete-orphan")


class HistoricoFullEmbale(Base):
    """
    Histórico de mudanças na quantidade que vai pro FULL de um item do inbound.
    Registra TODA alteração do campo "Vai pro FULL" (aumento ou redução), para
    auditoria e para alimentar o filtro de itens alterados na revisão.
    """
    __tablename__ = "historico_full_embale"

    id = Column(Integer, primary_key=True)
    embale_id = Column(Integer, ForeignKey("embaldes_fu.id"), index=True)
    item_id = Column(Integer, ForeignKey("itens_embale_fu.id"), index=True)
    titulo_anuncio = Column(String(255))  # snapshot do título no momento da mudança
    sku_inbound = Column(String(100), nullable=True)
    quantidade_anterior = Column(Float, default=0)
    quantidade_nova = Column(Float, default=0)
    tipo = Column(String(20))  # "aumento" ou "reducao"
    criado_em = Column(DateTime, default=datetime.utcnow, index=True)

    embalde = relationship("EmbaleFU", back_populates="historico_full")


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

    # Balanço de estoque (correção de erros passados)
    foi_balanceado = Column(Integer, default=0)  # 1 = foi feito balanço
    saldo_disponivel = Column(Float, nullable=True)  # Qtd real - FULL (após balanço)
    data_balanceamento = Column(DateTime, nullable=True)

    # Status em espera (produto bloqueado sem mexer por fatores externos)
    em_espera = Column(Integer, default=0)  # 1 = em espera, 0 = normal
    data_em_espera = Column(DateTime, nullable=True)

    # Excluído da separação ("não vai ser enviado") — fica fora da lista de
    # separação mas é mantido no Histórico FULL (reversível).
    nao_enviar = Column(Integer, default=0)  # 1 = não enviar, 0 = normal
    data_nao_enviar = Column(DateTime, nullable=True)

    # Foto do produto puxada da Olist (anexos), cacheada no item.
    olist_imagem = Column(Text, nullable=True)

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


class PrecoVendaProduto(Base):
    """
    Preço de venda definido manualmente pelo usuário para um produto, usado no
    cálculo de margem. Chave = olist_sku quando vinculado, senão codigo_produto.
    """
    __tablename__ = "precos_venda_produto"

    id = Column(Integer, primary_key=True)
    produto_chave = Column(String(150), unique=True, index=True)  # olist_sku ou codigo_produto
    preco_venda = Column(Float, default=0)
    atualizado_em = Column(DateTime, default=datetime.utcnow)


class CustoProduto(Base):
    """
    Custo unitário oficial de um produto, definido pelo usuário (ex.: importado da
    planilha financeira). É a fonte de verdade do custo na margem dos anúncios do
    Mercado Livre (tem prioridade sobre o custo médio das NFs).
    Chave = SKU do anúncio (ml_item_cache.sku / olist_sku).
    """
    __tablename__ = "custos_produto"

    id = Column(Integer, primary_key=True)
    produto_chave = Column(String(150), unique=True, index=True)  # SKU
    custo = Column(Float, default=0)
    imposto_pct = Column(Float, default=9)
    atualizado_em = Column(DateTime, default=datetime.utcnow)


class MercadoLivreItemCache(Base):
    """
    Espelho local do anúncio do Mercado Livre.
    Mantém snapshot normalizado + payloads brutos para a tela responder rápido
    e para a aplicação conseguir detectar/sincronizar mudanças futuras.
    """
    __tablename__ = "ml_item_cache"

    id = Column(Integer, primary_key=True)
    item_id = Column(String(50), unique=True, index=True)
    status = Column(String(50), index=True)
    titulo = Column(String(255))
    sku = Column(String(120), index=True, nullable=True)
    categoria_id = Column(String(80), nullable=True)
    listing_type_id = Column(String(80), nullable=True)
    tipo_anuncio = Column(String(80), nullable=True)
    moeda = Column(String(10), nullable=True)
    preco = Column(Float, nullable=True)
    preco_original = Column(Float, nullable=True)
    preco_promocional = Column(Float, nullable=True)
    # Tarifa de venda do ML guardada no sync (margem sem depender de chamada ao vivo)
    tarifa_valor = Column(Float, nullable=True)
    tarifa_pct = Column(Float, nullable=True)
    tarifa_fixo = Column(Float, nullable=True)
    estoque_disponivel = Column(Integer, nullable=True)
    vendidos = Column(Integer, nullable=True)
    frete_gratis = Column(Integer, default=0)
    frete_custo = Column(Float, nullable=True)
    frete_moeda = Column(String(10), nullable=True)
    logistic_type = Column(String(80), nullable=True)
    flex = Column(Integer, default=0)
    full = Column(Integer, default=0)
    catalog_listing = Column(Integer, nullable=True)  # 1 = anúncio de catálogo
    imagens_total = Column(Integer, default=0)
    imagem_principal = Column(Text, nullable=True)
    thumbnail = Column(Text, nullable=True)
    permalink = Column(Text, nullable=True)
    dimensoes_texto = Column(String(255), nullable=True)
    dimensoes_json = Column(Text, nullable=True)
    sale_terms_json = Column(Text, nullable=True)
    tags_json = Column(Text, nullable=True)
    attributes_json = Column(Text, nullable=True)
    pictures_json = Column(Text, nullable=True)
    description_json = Column(Text, nullable=True)
    prices_json = Column(Text, nullable=True)
    sale_price_json = Column(Text, nullable=True)
    shipping_fee_json = Column(Text, nullable=True)
    shipping_preview_json = Column(Text, nullable=True)
    shipping_tags_json = Column(Text, nullable=True)
    raw_item_json = Column(Text, nullable=True)
    inventory_ids_json = Column(Text, nullable=True)  # inventory_ids do Full (item ou variações)
    embalagem_baixa_vendidos = Column(Integer, nullable=True)  # último vendidos já baixado das embalagens
    ml_last_updated = Column(DateTime, nullable=True)
    ml_last_changed_at = Column(DateTime, nullable=True)
    date_created = Column(DateTime, nullable=True)  # quando o anúncio foi criado no ML
    cache_version = Column(Integer, default=1)
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)
    cache_expires_at = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)


class MercadoLivreSyncState(Base):
    """
    Estado do último sync de uma visão/listagem do ML.
    Permite servir total/metadata sem bater na API a cada paginação.
    """
    __tablename__ = "ml_sync_state"

    id = Column(Integer, primary_key=True)
    scope = Column(String(80), unique=True, index=True)
    resource = Column(String(80), index=True)
    status = Column(String(50), index=True, nullable=True)
    remote_total = Column(Integer, nullable=True)
    offset = Column(Integer, default=0)
    limit = Column(Integer, default=0)
    synced_at = Column(DateTime, default=datetime.utcnow)
    cache_expires_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)


class MercadoLivreVendaCache(Base):
    """
    Espelho local de cada VENDA (order_item) do Mercado Livre.
    Um registro por (order_id, item_id). Alimenta a tela de "Detalhe de Vendas"
    (lupa ao lado de Vendidos) sem bater na Orders API toda vez, já que a API
    não filtra pedidos por anúncio — o histórico completo fica espelhado aqui e
    é atualizado por sync incremental (por data).
    """
    __tablename__ = "ml_venda_cache"

    id = Column(Integer, primary_key=True)
    order_id = Column(String(40), index=True)
    item_id = Column(String(50), index=True)
    variation_id = Column(String(50), nullable=True)
    pack_id = Column(String(40), nullable=True)          # "carrinho"
    # Comprador
    buyer_id = Column(String(40), nullable=True)
    buyer_nickname = Column(String(120), nullable=True)
    buyer_nome = Column(String(180), nullable=True)
    # Venda
    status = Column(String(40), index=True, nullable=True)  # paid, cancelled...
    date_created = Column(DateTime, index=True, nullable=True)
    date_closed = Column(DateTime, nullable=True)
    quantity = Column(Integer, default=0)
    unit_price = Column(Float, nullable=True)
    item_title = Column(String(255), nullable=True)
    sku = Column(String(120), index=True, nullable=True)
    sale_fee = Column(Float, nullable=True)               # tarifa por unidade (order_item.sale_fee)
    currency = Column(String(10), nullable=True)
    total_paid = Column(Float, nullable=True)             # total pago pelo comprador no pedido
    # Pagamento
    payment_type = Column(String(40), nullable=True)      # credit_card/debit_card/account_money/ticket/bank_transfer
    payment_method_id = Column(String(60), nullable=True) # visa/master/pix/...
    installments = Column(Integer, nullable=True)
    payments_json = Column(Text, nullable=True)
    # Envio (enriquecido via /shipments/{id})
    shipment_id = Column(String(40), nullable=True)
    logistic_type = Column(String(60), nullable=True)     # fulfillment/self_service/cross_docking/drop_off...
    shipping_mode = Column(String(40), nullable=True)
    free_shipping = Column(Integer, default=0)
    shipping_cost = Column(Float, nullable=True)          # custo do frete pro vendedor
    receiver_zip = Column(String(20), nullable=True)
    receiver_city = Column(String(120), nullable=True)
    receiver_state = Column(String(20), nullable=True)
    receiver_name = Column(String(180), nullable=True)
    lead_time_date = Column(DateTime, nullable=True)      # estimativa de entrega
    shipment_synced = Column(Integer, default=0)          # 1 quando shipment já foi enriquecido
    tags_json = Column(Text, nullable=True)
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)


class SkuVendasSnapshot(Base):
    """
    Foto diária do total de vendas (sold_quantity) de cada anúncio do ML.
    Serve para calcular a VELOCIDADE de venda recente (diff entre snapshots),
    que alimenta a Lista de Compra. Um registro por anúncio por dia.
    """
    __tablename__ = "sku_vendas_snapshot"

    id = Column(Integer, primary_key=True)
    item_id = Column(String(50), index=True)
    sku = Column(String(120), index=True)
    vendidos = Column(Integer, default=0)
    criado_em = Column(DateTime, default=datetime.utcnow, index=True)


class OlistEstoqueSnapshot(Base):
    """
    Saldo atual de cada SKU na Olist (o estoque "orgânico" real do vendedor).
    Atualizado em segundo plano (1 chamada por SKU). A Lista de Compra soma este
    saldo ao estoque FULL do ML para o total real do produto.
    """
    __tablename__ = "olist_estoque_snapshot"

    id = Column(Integer, primary_key=True)
    sku = Column(String(120), unique=True, index=True)
    produto_id = Column(String(100), nullable=True)
    saldo = Column(Float, default=0)
    atualizado_em = Column(DateTime, default=datetime.utcnow, index=True)


class Embalagem(Base):
    """
    Um tipo de embalagem em estoque (caixa, envelope, folheto/brinde).
    - criterio='dimensao': caixa casada automaticamente pela dimensão do produto.
    - criterio='toda_venda': item que entra em toda venda (folheto/brinde), 1 por unidade.
    estoque_atual e custo_medio são mantidos pelas compras/movimentos.
    """
    __tablename__ = "embalagens"

    id = Column(Integer, primary_key=True)
    nome = Column(String(150), index=True)
    criterio = Column(String(20), default="dimensao", index=True)  # dimensao | toda_venda
    altura_cm = Column(Float, nullable=True)
    largura_cm = Column(Float, nullable=True)
    comprimento_cm = Column(Float, nullable=True)
    estoque_atual = Column(Integer, default=0)
    estoque_minimo = Column(Integer, default=0)  # alerta de baixa
    custo_medio = Column(Float, default=0)
    url_compra = Column(Text, nullable=True)
    ativo = Column(Integer, default=1)
    observacao = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    atualizado_em = Column(DateTime, default=datetime.utcnow)

    compras = relationship("EmbalagemCompra", back_populates="embalagem", cascade="all, delete-orphan")
    movimentos = relationship("EmbalagemMovimento", back_populates="embalagem", cascade="all, delete-orphan")


class EmbalagemCompra(Base):
    """Entrada de estoque (kit): quantidade de unidades + valor total pago."""
    __tablename__ = "embalagem_compras"

    id = Column(Integer, primary_key=True)
    embalagem_id = Column(Integer, ForeignKey("embalagens.id"), index=True)
    quantidade = Column(Integer, default=0)
    valor_total = Column(Float, default=0)
    custo_unitario = Column(Float, default=0)  # valor_total / quantidade
    url = Column(Text, nullable=True)
    observacao = Column(Text, nullable=True)
    data = Column(DateTime, default=datetime.utcnow, index=True)

    embalagem = relationship("Embalagem", back_populates="compras")


class EmbalagemMovimento(Base):
    """Histórico de movimentação: baixa por venda, ajuste manual ou compra."""
    __tablename__ = "embalagem_movimentos"

    id = Column(Integer, primary_key=True)
    embalagem_id = Column(Integer, ForeignKey("embalagens.id"), index=True)
    item_id = Column(String(50), nullable=True, index=True)
    sku = Column(String(120), nullable=True, index=True)
    quantidade = Column(Integer, default=0)  # negativo = consumo
    motivo = Column(String(20), default="venda", index=True)  # venda | ajuste | compra
    descricao = Column(String(255), nullable=True)
    data = Column(DateTime, default=datetime.utcnow, index=True)

    embalagem = relationship("Embalagem", back_populates="movimentos")


class EmbalagemVinculo(Base):
    """Override manual: força uma embalagem (caixa) para um SKU, vencendo o auto-match."""
    __tablename__ = "embalagem_vinculos"

    id = Column(Integer, primary_key=True)
    sku = Column(String(120), unique=True, index=True)
    embalagem_id = Column(Integer, ForeignKey("embalagens.id"), index=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


# ============================================================================
# DEVOLUÇÕES ML (Post-Purchase API)
# ----------------------------------------------------------------------------
# Portado de DEVOLUCOES-ML-main (Flask + sqlite3 cru) em 15/07/2026.
#
# Datas ficam como String (ISO-8601), não DateTime, de propósito: a lógica de
# classificação portada é CONGELADA (ver BIBLIA_POS_VENDA_ML.md) e compara datas
# como string vinda da API do ML. Converter para DateTime exigiria tocar nessa
# lógica, que é justamente o que não se pode fazer sem aprovação.
# ============================================================================


class Devolucao(Base):
    """Devolução/reclamação do ML. Espelho local do claim da Post-Purchase API."""
    __tablename__ = "devolucoes"

    id = Column(Integer, primary_key=True)
    # "Mercado Livre" exatamente assim (com espaço e maiúsculas): o sync grava e
    # consulta por esse literal. Mudar aqui faz o upsert deixar de casar com as
    # linhas existentes e passar a duplicar devolução.
    marketplace = Column(String(50), nullable=False, default="Mercado Livre", index=True)
    pedido_id = Column(String(100), nullable=False, index=True)
    cliente_nome = Column(String(255), nullable=False, default="")
    produto_nome = Column(String(255), nullable=False, default="")
    motivo_devolucao = Column(String(255), nullable=False, default="")
    valor_produto = Column(Float, nullable=False, default=0)
    status = Column(String(50), nullable=False, default="")
    data_solicitacao = Column(String(40), nullable=True)
    codigo_rastreio = Column(String(120), nullable=True)
    valor_recuperado = Column(Float, default=0)
    valor_perdido = Column(Float, default=0)
    observacao_final = Column(Text, default="")

    # --- Espelho do claim no ML ---
    ml_claim_id = Column(String(50), nullable=True, index=True)
    ml_status = Column(String(50), default="")
    ml_stage = Column(String(50), default="")
    ml_return_status = Column(String(50), default="")
    ultima_sincronizacao_ml = Column(String(40), nullable=True)
    ml_destino_devolucao = Column(String(50), default="")
    ml_tipo_logistica = Column(String(50), default="")
    ml_ativo = Column(Integer, default=1, index=True)

    # --- Prazo / priorização ---
    prazo_resolucao = Column(String(40), nullable=True)
    prioridade_prazo = Column(String(20), default="")
    requer_acao = Column(Integer, default=1)
    acao_recomendada = Column(Text, default="")

    # --- Conferência física da chegada ---
    produto_imagem = Column(Text, default="")
    chegada_status = Column(String(50), default="")
    mediacao_mensagem = Column(Text, default="")
    etapa_checklist_atual = Column(Integer, default=0)
    conteudo_progresso_checklist = Column(Text, default="{}")

    # --- Financeiro ---
    ml_valor_pago = Column(Float, default=0)
    ml_valor_reembolsado = Column(Float, default=0)
    ml_taxa_venda = Column(Float, default=0)
    ml_custo_envio = Column(Float, default=0)
    ml_tarifa_devolucao = Column(Float, default=0)
    ml_status_pagamento = Column(String(50), default="")
    ml_status_money = Column(String(50), default="")
    ml_refund_at = Column(String(40), default="")

    # --- Return (v2) ---
    ml_return_id = Column(String(50), default="")
    ml_return_subtype = Column(String(50), default="")
    ml_seller_status = Column(String(50), default="")
    ml_seller_reason = Column(String(255), default="")
    ml_product_condition = Column(String(50), default="")
    ml_return_reviews = Column(Text, default="[]")
    # SKU do produto devolvido — chave para buscar o custo em custos_produto
    # (CustoProduto.produto_chave) e lançar o prejuízo de dano no ledger de custos.
    ml_sku = Column(String(120), default="", index=True)

    historico = relationship("DevolucaoHistoricoStatus", back_populates="devolucao",
                             cascade="all, delete-orphan")
    checklist = relationship("DevolucaoChecklist", back_populates="devolucao",
                            uselist=False, cascade="all, delete-orphan")
    evidencias = relationship("DevolucaoEvidencia", back_populates="devolucao",
                              cascade="all, delete-orphan")
    contestacoes = relationship("DevolucaoContestacao", back_populates="devolucao",
                                cascade="all, delete-orphan")


class DevolucaoHistoricoStatus(Base):
    __tablename__ = "historico_status"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(Integer, ForeignKey("devolucoes.id"), nullable=False, index=True)
    status_anterior = Column(String(50), nullable=False, default="")
    status_novo = Column(String(50), nullable=False, default="")
    data_alteracao = Column(String(40), nullable=False)

    devolucao = relationship("Devolucao", back_populates="historico")


class DevolucaoChecklist(Base):
    """Conferência física do produto devolvido. 1:1 com a devolução."""
    __tablename__ = "checklists"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(Integer, ForeignKey("devolucoes.id"), nullable=False, unique=True)
    produto_confere = Column(Integer, nullable=True)
    embalagem_integra = Column(Integer, nullable=True)
    possui_sinais_de_uso = Column(Integer, nullable=True)
    item_quebrado = Column(Integer, nullable=True)
    faltando_pecas = Column(Integer, nullable=True)
    motivo_confere = Column(Integer, nullable=True)
    observacoes = Column(Text, default="")
    data_checklist = Column(String(40), nullable=False)

    # --- Avarias específicas ---
    embalagem_rasgada = Column(Integer, default=0)
    produto_amassado = Column(Integer, default=0)
    produto_riscado = Column(Integer, default=0)
    produto_quebrado = Column(Integer, default=0)
    produto_sujo = Column(Integer, default=0)
    faltando_acessorios = Column(Integer, default=0)
    produto_errado = Column(Integer, default=0)
    sem_embalagem_original = Column(Integer, default=0)

    devolucao = relationship("Devolucao", back_populates="checklist")


class DevolucaoEvidencia(Base):
    """Foto/arquivo anexado à devolução. `arquivo` guarda o nome no volume /data."""
    __tablename__ = "evidencias"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(Integer, ForeignKey("devolucoes.id"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False, default="")
    arquivo = Column(String(255), nullable=False)
    descricao = Column(Text, default="")
    data_upload = Column(String(40), nullable=False)

    devolucao = relationship("Devolucao", back_populates="evidencias")


class DevolucaoContestacao(Base):
    __tablename__ = "contestacoes"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(Integer, ForeignKey("devolucoes.id"), nullable=False, index=True)
    tipo_divergencia = Column(String(100), nullable=False, default="")
    descricao = Column(Text, nullable=False, default="")
    valor_contestado = Column(Float, nullable=False, default=0)
    evidencia_ids = Column(Text, default="[]")
    texto_contestacao = Column(Text, default="")
    status = Column(String(50), nullable=False, default="")
    data_abertura = Column(String(40), nullable=False)
    data_resultado = Column(String(40), nullable=True)

    devolucao = relationship("Devolucao", back_populates="contestacoes")


# --- Rastreio do sync com o ML (diagnóstico) -------------------------------

class MLSyncRun(Base):
    """Uma execução do sync de devoluções. Alimenta /api/devolucoes/sync-diagnostico."""
    __tablename__ = "ml_sync_runs"

    id = Column(Integer, primary_key=True)
    tipo = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False)
    iniciado_em = Column(String(40), nullable=False)
    finalizado_em = Column(String(40), nullable=True)
    total_declarado = Column(Integer, default=0)
    total_encontrado = Column(Integer, default=0)
    total_processado = Column(Integer, default=0)
    total_erros = Column(Integer, default=0)
    detalhes = Column(Text, default="{}")


class MLRawPayload(Base):
    """Payload cru da API do ML, para auditar o que veio quando algo diverge."""
    __tablename__ = "ml_raw_payloads"
    __table_args__ = (UniqueConstraint("resource_type", "resource_id",
                                       name="uq_ml_raw_payloads_resource"),)

    id = Column(Integer, primary_key=True)
    sync_run_id = Column(Integer, ForeignKey("ml_sync_runs.id"), nullable=True, index=True)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(String(100), nullable=False)
    claim_id = Column(String(50), default="", index=True)
    payload = Column(Text, nullable=False)
    captured_at = Column(String(40), nullable=False)


class MLReconciliationDiff(Base):
    """Divergência detectada entre o que o ML declara e o que conseguimos processar."""
    __tablename__ = "ml_reconciliation_diffs"

    id = Column(Integer, primary_key=True)
    sync_run_id = Column(Integer, ForeignKey("ml_sync_runs.id"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False)
    severidade = Column(String(20), nullable=False)
    referencia = Column(String(120), default="")
    detalhe = Column(Text, nullable=False)
    created_at = Column(String(40), nullable=False)


class MLTraceEvent(Base):
    """Passo a passo de um sync, por trace_id. Alimenta /api/devolucoes/sync-trace."""
    __tablename__ = "ml_trace_events"

    id = Column(Integer, primary_key=True)
    trace_id = Column(String(60), nullable=False, index=True)
    sync_run_id = Column(Integer, ForeignKey("ml_sync_runs.id"), nullable=True, index=True)
    step = Column(String(80), nullable=False)
    status = Column(String(30), nullable=False)
    duration_ms = Column(Integer, default=0)
    claim_id = Column(String(50), default="")
    details = Column(Text, default="{}")
    created_at = Column(String(40), nullable=False)


class MLClaimClassification(Base):
    """
    Cache do resultado da classificação de um claim em bucket.

    `bucket` e `regra` são a saída de classify_ml_live_queue_claim(), cujas regras
    são CONGELADAS pela BIBLIA_POS_VENDA_ML.md. Guardar o `regra` junto é o que
    permite auditar por que um claim caiu em determinada fila.
    Chave é o claim_id (string), não um id sintético.
    """
    __tablename__ = "ml_claim_classifications"

    claim_id = Column(String(50), primary_key=True)
    pedido_id = Column(String(100), default="", index=True)
    order_ids = Column(Text, default="[]")
    status = Column(String(50), default="")
    stage = Column(String(50), default="")
    claim_type = Column(String(50), default="")
    reason_id = Column(String(50), default="")
    return_id = Column(String(50), default="")
    return_status = Column(String(50), default="")
    shipment_status = Column(String(50), default="")
    shipment_destination = Column(String(50), default="")
    # ID/etiqueta do envio de devolução — é o número que o operador BIPA no
    # barracão (a etiqueta do ML). tracking_number costuma ser MEL<shipment_id>...
    shipment_id = Column(String(40), default="", index=True)
    tracking_number = Column(String(60), default="")
    # Previsão de chegada do envio de devolução (lead_time.estimated_delivery_time.date).
    # É o que alimenta a esteira "Chegando hoje".
    previsao_chegada = Column(String(40), default="")
    # Marcado pela bipagem no barracão. Preenchido = recebido/em espera de resolução.
    # O upsert do sync NÃO mexe nesta coluna, então sobrevive a re-sincronizações.
    recebido_em = Column(String(40), default="")
    seller_actions = Column(Text, default="[]")
    bucket = Column(String(40), nullable=False, index=True)
    regra = Column(String(160), default="")
    last_updated = Column(String(40), default="")
    payload = Column(Text, default="{}")
    active = Column(Integer, default=1, index=True)
    updated_at = Column(String(40), nullable=False)

    # --- Denormalizado do pedido/item, p/ montar o card sem novo GET ---
    produto_nome = Column(String(255), default="")
    produto_imagem = Column(Text, default="")
    valor_pago = Column(Float, default=0)
    taxa_venda = Column(Float, default=0)
    ml_tipo_logistica = Column(String(50), default="")
    motivo_label = Column(String(255), default="")
    pack_id = Column(String(50), default="")
    mandatory = Column(Integer, default=0)
    due_date = Column(String(40), default="")
    date_created = Column(String(40), default="")


class RecebimentoAvulso(Base):
    """
    Bipagem que NÃO casou com nenhuma classificação no momento (devolução muito
    nova, ainda não sincronizada). Registrada aqui para o bipe NUNCA travar a
    operação: o item físico é logado e vinculado à devolução no próximo sync
    (reconciliar_avulsos). `codigo` é o que foi bipado, só dígitos.
    """
    __tablename__ = "recebimentos_avulsos"

    id = Column(Integer, primary_key=True)
    codigo = Column(String(60), nullable=False, index=True)
    order_id = Column(String(40), default="")       # best-effort do /shipments ao vivo
    shipment_status = Column(String(50), default="")
    recebido_em = Column(String(40), nullable=False)
    vinculado_claim_id = Column(String(50), default="")  # preenchido na reconciliação
    vinculado_em = Column(String(40), default="")
    info = Column(Text, default="{}")               # dump do shipment ao vivo (auditoria)


class ConfiguracaoApp(Base):
    """
    Config chave/valor genérica do app. Usada para parâmetros editáveis que não
    justificam tabela própria — ex.: `devolucao_custo_embalagem` (default 0.50),
    o valor de embalagem somado ao prejuízo de cada devolução.
    """
    __tablename__ = "configuracoes_app"

    chave = Column(String(80), primary_key=True)
    valor = Column(Text, default="")
    atualizado_em = Column(String(40), default="")


class CustoDevolucao(Base):
    """
    Ledger de custo/prejuízo de UMA devolução, lançado quando o operador finaliza
    a avaliação. Alimenta o dashboard de custos por mês. Uma linha por devolução
    (idempotente por devolucao_id): re-finalizar atualiza a mesma linha.

    Composição do prejuízo (editável no que precisa):
      frete_reverso  — cobrança do ML pelo retorno (/charges/return-cost)
      custo_produto  — custo do SKU quando o produto voltou danificado (custos_produto)
      custo_embalagem— valor fixo de reembalagem (config devolucao_custo_embalagem)
    """
    __tablename__ = "custos_devolucao"

    id = Column(Integer, primary_key=True)
    devolucao_id = Column(Integer, ForeignKey("devolucoes.id"), nullable=False, unique=True, index=True)
    ml_claim_id = Column(String(50), default="", index=True)
    mes = Column(String(7), default="", index=True)   # "YYYY-MM" (fuso de Brasília)
    sku = Column(String(120), default="")
    danificado = Column(Integer, default=0)
    frete_reverso = Column(Float, default=0)
    custo_produto = Column(Float, default=0)
    custo_embalagem = Column(Float, default=0)
    total = Column(Float, default=0)
    resultado = Column(String(30), default="")        # concluido | ocorrencia
    observacao = Column(Text, default="")
    created_at = Column(String(40), default="")
    updated_at = Column(String(40), default="")


class MLNotificacao(Base):
    """
    Auditoria das notificações (webhooks) do Mercado Livre. Guardar aqui permite
    dedup (mesma notificação reenviada), diagnóstico e reprocessamento. O corpo
    cru fica em `payload`. `processado_em` marca quando a integração agiu sobre ela.
    """
    __tablename__ = "ml_notificacoes"

    id = Column(Integer, primary_key=True)
    topic = Column(String(60), default="", index=True)
    resource = Column(String(255), default="")
    resource_id = Column(String(80), default="", index=True)
    user_id = Column(String(40), default="")
    application_id = Column(String(60), default="")
    attempts = Column(Integer, default=0)
    recebido_em = Column(String(40), default="", index=True)
    processado_em = Column(String(40), default="")
    status = Column(String(30), default="recebido")   # recebido | processado | ignorado | erro
    detalhe = Column(Text, default="")
    payload = Column(Text, default="{}")
