"""Em que pé está cada devolução, do ponto de vista de quem opera a bancada da Novaes."""

STATUS = ("a_caminho", "aguardando_conferencia", "precisa_acao", "em_mediacao", "com_a_plataforma", "resolvida", "finalizada")
FINAIS = ("encerrada", "cancelada")


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


def status(dev: dict, conf: dict | None, contestada: bool) -> str:
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
    if dev["em_mediacao"] or contestada:
        return "em_mediacao"
    return "resolvida"
