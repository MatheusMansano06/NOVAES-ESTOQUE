"""Em que pé está cada devolução, do ponto de vista de quem opera a bancada da Novaes."""

# Dentro de "a caminho": o comprador ainda não postou x já postou e está vindo.
ENVIOS = ("aguardando_postagem", "postado", "sem_info")
# ponytail: mapeamento por palavra-chave do status da Shopee; trocar por tabela fechada quando os valores reais estiverem mapeados.
_POSTADO = ("PICKUP_DONE", "TRANSIT", "SHIPPED", "DELIVER", "HANDOVER", "DROP_OFF_DONE")
_AGUARDANDO = ("PENDING", "READY", "REQUEST", "NOT_START", "CREATED", "NEW", "INIT", "ARRANGE")

STATUS = ("a_caminho", "aguardando_conferencia", "precisa_acao", "em_mediacao", "com_a_plataforma", "resolvida", "finalizada")
FINAIS = ("encerrada", "cancelada")
SHOPEE_PERDIDA = {"ACCEPTED", "REFUND_PAID"}  # a Shopee decidiu pelo reembolso ao comprador
SHOPEE_GANHA = {"CANCELLED", "CLOSED"}  # devolução encerrada sem reembolso


def resultado_mediacao(l: dict) -> str | None:
    """em_andamento | ganha | perdida | parcial. ML: vem da reclamação. Shopee: vem das marcas da disputa
    (shopee.normalizar.resultado_disputa); devolução contestada pela Central sem marca ainda conta, pelo status."""
    if l.get("resultado_mediacao") or l["plataforma"] != "shopee":
        return l.get("resultado_mediacao")
    if not l.get("contestada"):
        return None
    st = l.get("status_plataforma")
    return "perdida" if st in SHOPEE_PERDIDA else "ganha" if st in SHOPEE_GANHA else "em_andamento"


def pendencias(conf: dict | None, contestada: bool) -> list[str]:
    if not conf:
        return []
    faltam = []
    if conf["lancamentos"] and not conf["estoque_lancado_em"]:
        faltam.append("lancar_estoque")
    if conf["contestar"] and not contestada:
        faltam.append("contestar")
    if conf["chamado_manual"] and not conf["chamado_aberto_em"]:
        faltam.append("chamado_manual")
    return faltam


def status(dev: dict, conf: dict | None, contestada: bool, aceita: bool = False) -> str:
    """Ordem importa: o que depende da mão do operador aparece antes do que depende da plataforma."""
    if pendencias(conf, contestada):
        return "precisa_acao"
    if not conf:
        if dev["destino"] != "vendedor":
            return "finalizada" if dev["etapa"] in FINAIS else "com_a_plataforma"
        if dev["etapa"] == "entregue":
            return "aguardando_conferencia"
        if dev["etapa"] not in FINAIS:
            return "a_caminho"
    if dev["etapa"] in FINAIS:
        return "finalizada"
    # Aceitar resolve a pendência de contestar, mas não abre mediação: vai para resolvida.
    if dev["em_mediacao"] or (contestada and not aceita):
        return "em_mediacao"
    return "resolvida"


def envio_plataforma(plataforma: str, bruto: dict | None) -> str | None:
    """Status de envio como a plataforma escreve (aparece na tela e serve para conferir o mapeamento)."""
    dev = (bruto or {}).get("devolucao") or {}
    if plataforma == "mercado_livre":
        return dev.get("status")
    rastreio = dev.get("rastreio_reverso")
    # dict de verdade (get_reverse_tracking_info) só às vezes; já veio lista, erro de sync antigo etc — nunca confiar no formato.
    rastreio = rastreio if isinstance(rastreio, dict) else {}
    return rastreio.get("reverse_logistics_status") or rastreio.get("logistics_status") or dev.get("status")


def envio(plataforma: str, bruto: dict | None) -> str:
    bruto_status = (envio_plataforma(plataforma, bruto) or "").upper()
    if plataforma == "mercado_livre":
        if bruto_status == "SHIPPED":
            return "postado"
        return "aguardando_postagem" if bruto_status in ("LABEL_GENERATED", "PENDING", "OPENED") else "sem_info"
    if bruto_status in ("REQUESTED", "PROCESSING"):
        return "aguardando_postagem"  # a Shopee ainda nem aprovou: o comprador não tem como postar
    if any(k in bruto_status for k in _POSTADO):
        return "postado"
    if any(k in bruto_status for k in _AGUARDANDO):
        return "aguardando_postagem"
    return "sem_info"
