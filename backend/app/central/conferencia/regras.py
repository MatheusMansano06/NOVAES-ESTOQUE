"""Regra da conferência: o que o operador viu + o que a plataforma diz → classe, estoque e se vale contestar."""

# Evidência exigida para contestar: a Shopee pede descrição + foto + vídeo (tabela oficial de disputa).
EVIDENCIAS = {"shopee": ["foto", "video"], "mercado_livre": ["foto"]}


def classificar(c: dict) -> str:
    """A = volta vendável · B = avaria (nosso produto, sem condição de venda) · C = divergente (não é o que enviamos)."""
    nosso = c["produto_correto"] or c["erro_nosso"]
    if not nosso:
        return "C"
    return "A" if c["revendavel"] else "B"


def lancamentos(classe: str, c: dict) -> list[dict]:
    """Movimentos na Olist. A venda baixou o SKU VENDIDO; é ele que volta ao saldo, mesmo quando enviamos outro
    (o enviado por engano nunca saiu do saldo do sistema — só volta para a prateleira)."""
    if classe == "A":
        return [{"sku": "vendido", "deposito": "vendavel", "tipo": "E"}]
    if classe == "B" and not c["erro_nosso"]:
        return [{"sku": "vendido", "deposito": "avaria", "tipo": "E"}]
    if classe == "B":
        # O vendido está intacto na prateleira; o enviado por engano voltou estragado: sai do vendável, entra na avaria.
        return [{"sku": "vendido", "deposito": "vendavel", "tipo": "E"},
                {"sku": "recebido", "deposito": "vendavel", "tipo": "S"},
                {"sku": "recebido", "deposito": "avaria", "tipo": "E"}]
    # Divergente: o vendido não voltou. Se o que chegou é SKU nosso, entra como sobra na avaria.
    return [{"sku": "recebido", "deposito": "avaria", "tipo": "E"}] if c.get("sku_recebido") else []


def perda_produto(classe: str, c: dict, custo_vendido: float | None, custo_recebido: float | None,
                  quantidade: float) -> float | None:
    """Custo do produto perdido (CMV). A: nada · B: o que voltou estragado · C: o vendido, que não voltou.
    None = sem custo cadastrado (o prejuízo existe, mas não dá para medir)."""
    if classe == "A":
        return 0.0
    custo = custo_recebido if classe == "B" and c["erro_nosso"] else custo_vendido
    return None if custo is None else round(custo * quantidade, 2)


def decidir(dev: dict, c: dict, custo_vendido: float | None = None, custo_recebido: float | None = None,
            quantidade: float = 1) -> dict:
    classe = classificar(c)
    vale = classe in ("B", "C") or dev["responsavel"] == "vendedor"

    chamado_manual = False
    if c["erro_nosso"]:
        contestar, motivo = False, "Erro da Novaes (enviamos o produto errado): assumir, não contestar."
    elif vale and not dev["pode_contestar"]:
        # Acontece de o ML não ter como abrir chamado: o caso fica guardado com o prejuízo para abrir depois.
        contestar, chamado_manual = False, True
        motivo = "Vale contestar, mas a plataforma não deixa agora: fica na lista de chamados manuais com o prejuízo registrado."
    elif classe in ("B", "C"):
        contestar, motivo = True, "Produto voltou avariado ou diferente do enviado: contestar para recuperar o valor."
    elif vale:
        contestar, motivo = True, "O comprador alegou problema, mas o produto voltou perfeito: contestar para não pagar o frete reverso."
    else:
        contestar, motivo = False, "Sem cobrança para a Novaes e produto recuperado: nada a contestar."

    return {
        "classe": classe,
        "lancamentos": lancamentos(classe, c),
        "contestar": contestar,
        "chamado_manual": chamado_manual,
        "motivo": motivo,
        "evidencias_exigidas": EVIDENCIAS.get(dev["plataforma"], ["foto"]) if contestar or chamado_manual else [],
        "prazo": dev.get("prazo_vendedor"),
        "perda_produto": perda_produto(classe, c, custo_vendido, custo_recebido, quantidade),
        "frete_reverso": dev.get("custo_plataforma"),
    }
