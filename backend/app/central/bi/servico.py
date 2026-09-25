"""Indicadores do período: volume, andamento e quanto as devoluções custaram. Só leitura."""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from app.central.bi import fatura_ml, logistica, mediacao_origem
from app.central.financeiro.custos import custo_do_sku
from app.central.mercado_livre import catalogo
from app.central.operacao.servico import a_caminho_por_plataforma, linhas

DECLARADO_QUEBRADO = {"danificado", "defeito"}  # motivo da devolução que já diz que o produto chegou quebrado
# Cada linha da tabela de mercadoria quebrada: (origem, tipo, nome). Tipo = classe da conferência ou motivo da devolução.
SEGMENTOS = (
    ("bancada", "B", "Conferido na bancada: avariado, sem condição de venda"),
    ("bancada", "C", "Conferido na bancada: voltou produto diferente do vendido"),
    ("motivo", "danificado", "Motivo da devolução: chegou danificado"),
    ("motivo", "defeito", "Motivo da devolução: produto com defeito"),
)
PLATAFORMAS = ("mercado_livre", "shopee")
RESOLVIDAS = {"resolvida", "finalizada"}


def _agora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cmv(linha: dict) -> float | None:
    """Custo do que voltou pelo SKU (custo oficial do estoque). None = algum item sem custo cadastrado."""
    total = 0.0
    for i in linha["itens"]:
        try:
            custo = custo_do_sku(i.get("sku")) if i.get("sku") else None
        except RuntimeError:
            custo = None
        if custo is None:
            return None
        total += custo * (i.get("quantidade") or 1)
    return round(total, 2) if linha["itens"] else None


def perda(linha: dict) -> tuple[str | None, float | None]:
    """De onde vem a mercadoria quebrada desta devolução e quanto custa. Só duas origens:
    bancada = a Novaes conferiu e não dá para vender · motivo = o motivo da devolução já diz que chegou quebrado.
    A conferência manda: se o operador conferiu, vale o que ele viu (voltou bom, classe A, não conta).
    A revisão do ML fica de fora de propósito: ela também reprova por embalagem riscada."""
    conf = linha["conferencia"]
    if conf:
        return ("bancada", conf["perda_produto"]) if conf["classe"] != "A" else (None, 0.0)
    if linha["motivo"] in DECLARADO_QUEBRADO and linha["etapa"] != "cancelada":
        return "motivo", _cmv(linha)
    return None, 0.0


def _recuperado(linha: dict) -> float:
    """Estimado: mediação ganha tira a cobrança do frete; com cobertura, o ML também paga o produto."""
    if linha.get("resultado_mediacao") != "ganha":
        return 0.0
    valor = linha["custo_plataforma"] or 0
    if linha.get("cobertura_aplicada"):
        valor += _cmv(linha) or 0
    return round(valor, 2)


def _dinheiro(ls: list[dict]) -> dict:
    d = defaultdict(float)
    sem_custo = 0
    for l in ls:
        frete = l["custo_plataforma"] or 0
        d["frete_reverso"] += frete
        # em mediação = ainda pode cair; ganha = estornado; o resto já está sendo cobrado
        d[{"em_andamento": "frete_em_mediacao", "ganha": "frete_estornado"}.get(l.get("resultado_mediacao"), "frete_cobrado")] += frete
        origem, valor = perda(l)
        if origem and valor is None:
            sem_custo += 1
        elif origem:
            d[f"perda_{origem}"] += valor
        d["recuperado"] += _recuperado(l)
    # frete de mediação ganha não é pago: fica fora do custo (e fora do recuperado, senão desconta duas vezes)
    bruto = d["frete_reverso"] + d["perda_bancada"] + d["perda_motivo"]
    custo = bruto - d["frete_estornado"]
    return {**{k: round(v, 2) for k, v in d.items()}, "custo_total": round(custo, 2),
            "prejuizo_liquido": round(custo - (d["recuperado"] - d["frete_estornado"]), 2),
            "taxa_recuperacao": round(100 * d["recuperado"] / bruto, 1) if bruto else 0.0, "sem_custo": sem_custo}


def quebrados(ls: list[dict]) -> dict:
    """Mercadoria quebrada segmentada: de onde veio (bancada x motivo), de que tipo e em qual marketplace.
    Quantidade = devoluções. Valor = custo do produto; devolução sem custo cadastrado conta em `sem_custo`."""
    celulas: dict = defaultdict(lambda: defaultdict(lambda: {"quantidade": 0, "valor": 0.0, "sem_custo": 0}))
    for l in ls:
        origem, valor = perda(l)
        if not origem:
            continue
        tipo = l["conferencia"]["classe"] if origem == "bancada" else l["motivo"]
        c = celulas[(origem, tipo)][l["plataforma"]]
        c["quantidade"] += 1
        if valor is None:
            c["sem_custo"] += 1
        else:
            c["valor"] += valor

    def soma(cs) -> dict:
        cs = list(cs)
        return {"quantidade": sum(c["quantidade"] for c in cs), "valor": round(sum(c["valor"] for c in cs), 2),
                "sem_custo": sum(c["sem_custo"] for c in cs)}

    segmentos = []
    for origem, tipo, nome in SEGMENTOS:
        por = {p: celulas[(origem, tipo)].get(p, {"quantidade": 0, "valor": 0.0, "sem_custo": 0}) for p in PLATAFORMAS}
        segmentos.append({"origem": origem, "tipo": tipo, "nome": nome,
                          "por_plataforma": {p: {**c, "valor": round(c["valor"], 2)} for p, c in por.items()}, **soma(por.values())})
    return {
        "segmentos": segmentos,
        "por_origem": {o: soma(c for (og, _), ps in celulas.items() if og == o for c in ps.values()) for o in ("bancada", "motivo")},
        "total": soma(c for ps in celulas.values() for c in ps.values()),
    }


MOTIVOS_LOGISTICA = ("diferente", "defeito", "nao_serviu")


def por_logistica(ls: list[dict], full: dict[tuple[str, str], bool]) -> list[dict]:
    """Motivos que apontam o produto: quantos por marketplace vieram de venda Full x orgânica.
    sem_info = pedido ainda não consultado na plataforma (a agenda completa em segundo plano)."""
    total = len(ls) or 1
    saida = []
    for m in MOTIVOS_LOGISTICA:
        do_motivo = [l for l in ls if l["motivo"] == m]
        saida.append({"motivo": m, "quantidade": len(do_motivo), "pct": round(100 * len(do_motivo) / total, 1),
                      "por_plataforma": contar_logistica(do_motivo, full)})
    return saida


def contar_logistica(ls: list[dict], full: dict[tuple[str, str], bool]) -> dict:
    por = {p: dict.fromkeys(("full", "organica", "sem_info"), 0) for p in PLATAFORMAS}
    for l in ls:
        chave = (l["plataforma"], l["pedido"])
        por[l["plataforma"]]["sem_info" if chave not in full else "full" if full[chave] else "organica"] += 1
    return por


SHOPEE_DISPUTA = {"SELLER_DISPUTE", "JUDGING"}
SHOPEE_PERDIDA = {"ACCEPTED", "REFUND_PAID"}  # a Shopee decidiu pelo reembolso ao comprador
SHOPEE_GANHA = {"CANCELLED", "CLOSED"}  # devolução encerrada sem reembolso


def resultado_mediacao(l: dict, quem_abriu: dict) -> str | None:
    """ML: vem da reclamação. Shopee: o status só diz "em disputa" enquanto ela dura; depois disso o resultado sai
    do status final, para as devoluções que sabemos que foram disputadas (mediacao_origem ou contestadas pela Central)."""
    if l["plataforma"] != "shopee":
        return l.get("resultado_mediacao")
    status = l.get("status_plataforma")
    if status in SHOPEE_DISPUTA:
        return "em_andamento"
    if ("shopee", l["id_externo"]) not in quem_abriu and not l.get("contestada"):
        return None
    return "perdida" if status in SHOPEE_PERDIDA else "ganha" if status in SHOPEE_GANHA else "em_andamento"


def _imagens(skus: list[dict]) -> None:
    """Completa a foto dos produtos do ML (a Shopee já manda no próprio item)."""
    fotos = catalogo.imagens(p["item_id"] for p in skus if not p["imagem"] and p["plataforma"] == "mercado_livre")
    for p in skus:
        p["imagem"] = p["imagem"] or fotos.get(p["item_id"])


def _periodo(dias: int, fatura: str | None) -> tuple[date, date, date, date]:
    """(início, fim, início anterior, fim anterior) em datas. Fatura = ciclo do ML (13 ao 12)."""
    if fatura:
        ini, fim = fatura_ml.ciclo(fatura)
        ini_ant, fim_ant = fatura_ml.ciclo(fatura_ml.chave_do_dia(ini - timedelta(days=1)))
        return ini, fim, ini_ant, fim_ant
    fim = _agora().date()
    ini = fim - timedelta(days=dias - 1)
    return ini, fim, ini - timedelta(days=dias), ini - timedelta(days=1)


def resumo(dias: int = 30, fatura: str | None = None) -> dict:
    """Devoluções ABERTAS no período (antes era por atualização: a varredura de 6 em 6 h atualiza toda reclamação
    aberta, e reclamação antiga entrava de novo na conta)."""
    ini, fim_dia, ini_ant, fim_ant = _periodo(dias, fatura)
    todas = linhas()
    atual = [l for l in todas if ini <= l["aberta_em"].date() <= fim_dia]
    anterior = [l for l in todas if ini_ant <= l["aberta_em"].date() <= fim_ant]
    dias = (fim_dia - ini).days + 1
    fim = datetime.combine(min(fim_dia, _agora().date()), datetime.min.time())
    dias_serie = (fim.date() - ini).days + 1

    serie = {(fim.date() - timedelta(days=n)): dict.fromkeys(("total", "resolvidas", "em_aberto", "custo", "recuperado"), 0.0)
             for n in range(dias_serie - 1, -1, -1)}
    por_plataforma = defaultdict(list)
    motivos, produtos, mediacoes, origens = Counter(), {}, Counter(), Counter()
    mediacoes_plataforma = {p: Counter() for p in PLATAFORMAS}
    quem_abriu = mediacao_origem.mapa()
    for l in atual:
        por_plataforma[l["plataforma"]].append(l)
        motivos[l["motivo"]] += 1
        resultado = resultado_mediacao(l, quem_abriu)
        if resultado:
            quem = "vendedor" if l["plataforma"] == "shopee" else quem_abriu.get((l["plataforma"], l["id_externo"]), "sem_info")
            origens[quem] += 1
            if quem == "vendedor":  # o gráfico é só das disputas que a Novaes abriu
                mediacoes[resultado] += 1
                mediacoes_plataforma[l["plataforma"]][resultado] += 1
        dia = l["aberta_em"].date()
        if dia in serie:
            p = serie[dia]
            p["total"] += 1
            p["resolvidas" if l["status"] in RESOLVIDAS else "em_aberto"] += 1
            origem, valor = perda(l)
            p["custo"] += (l["custo_plataforma"] or 0) + (valor or 0)
            p["recuperado"] += _recuperado(l)
        for i in l["itens"]:
            chave = i.get("sku") or i.get("item_id")
            if not chave:
                continue
            item = produtos.setdefault((l["plataforma"], chave), {"sku": i.get("sku"), "nome": i.get("nome"), "imagem": i.get("imagem"),
                                               "item_id": i.get("item_id"), "plataforma": l["plataforma"],
                                               "quantidade": 0, "prejuizo": 0.0})
            item["quantidade"] += 1
            origem, valor = perda(l)
            item["prejuizo"] = round(item["prejuizo"] + (l["custo_plataforma"] or 0) + (valor or 0), 2)
            item["nome"] = item["nome"] or i.get("nome")
            item["imagem"] = item["imagem"] or i.get("imagem")

    total = len(atual) or 1
    top = {p: sorted((x for x in produtos.values() if x["plataforma"] == p), key=lambda x: (-x["quantidade"], -x["prejuizo"]))[:5]
           for p in PLATAFORMAS}
    _imagens([x for t in top.values() for x in t])
    return {
        "dias": dias, "inicio": ini.isoformat(), "fim": fim_dia.isoformat(),
        "total": len(atual),
        "total_anterior": len(anterior),
        "dinheiro": _dinheiro(atual),
        "dinheiro_anterior": _dinheiro(anterior),
        "quebrados": quebrados(atual),
        "por_logistica": por_logistica(atual, full := logistica.mapa()),
        "logistica_total": contar_logistica(atual, full),
        "a_caminho": a_caminho_por_plataforma(atual),
        "serie": [{"dia": d.isoformat(), **{k: round(v, 2) for k, v in p.items()}} for d, p in serie.items()],
        "por_plataforma": {k: {"devolucoes": len(v), **_dinheiro(v)} for k, v in por_plataforma.items()},
        "status": dict(Counter(l["status"] for l in atual)),
        "motivos": [{"motivo": m, "quantidade": q, "pct": round(100 * q / total, 1)} for m, q in motivos.most_common()],
        "produtos": {p: [{**x, "pct": round(100 * x["quantidade"] / (len(por_plataforma[p]) or 1), 1)} for x in t] for p, t in top.items()},
        "mediacoes": {**{k: mediacoes.get(k, 0) for k in ("ganha", "perdida", "parcial", "em_andamento")},
                      "recuperado": _dinheiro(atual)["recuperado"],
                      "abertas_por": {k: origens.get(k, 0) for k in ("vendedor", "comprador", "plataforma", "desconhecido", "sem_info")},
                      "por_plataforma": {p: {k: n.get(k, 0) for k in ("ganha", "perdida", "parcial", "em_andamento")}
                                         for p, n in mediacoes_plataforma.items()}},
    }




def mensal(meses: int = 3) -> dict:
    """Quanto as devoluções custaram por ciclo da fatura do ML (dia 13 ao 12). Frete do ML = o que está na fatura;
    frete da Shopee = o que a plataforma informa na devolução; quebrado = conferência da bancada quando houve,
    senão estimado pelo motivo (custo do produto). Devolução entra no ciclo pela data de abertura."""
    chaves, d = [], _agora().date()
    for _ in range(meses):
        chaves.append(fatura_ml.chave_do_dia(d))
        d = fatura_ml.ciclo(chaves[-1])[0].replace(day=1)
    faturas = fatura_ml.por_fatura()
    todas = linhas()
    saida = []
    for chave in reversed(chaves):
        ini, fim = fatura_ml.ciclo(chave)
        do_ciclo = [l for l in todas if ini <= l["aberta_em"].date() <= fim]
        valores = defaultdict(float)
        sem_custo = 0
        for l in do_ciclo:
            if l["plataforma"] == "shopee":
                valores["frete_shopee"] += l["custo_plataforma"] or 0
            origem, valor = perda(l)
            if origem and valor is None:
                sem_custo += 1
            elif origem:
                valores[f"quebrado_{origem}"] += valor
        ml = faturas.get(chave, {"cobrado": 0.0, "estornado": 0.0, "liquido": 0.0, "por_tipo": []})
        total = ml["liquido"] + valores["frete_shopee"] + valores["quebrado_bancada"] + valores["quebrado_motivo"]
        saida.append({
            "fatura": chave, "inicio": ini.isoformat(), "fim": fim.isoformat(), "aberto": fim >= _agora().date(),
            "frete_ml": ml, "fatura_lida": chave in faturas,
            **{k: round(valores[k], 2) for k in ("frete_shopee", "quebrado_bancada", "quebrado_motivo")},
            "sem_custo": sem_custo, "total": round(total, 2),
            "devolucoes": {p: sum(1 for l in do_ciclo if l["plataforma"] == p) for p in PLATAFORMAS},
        })
    return {"meses": saida}
