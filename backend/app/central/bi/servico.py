"""Indicadores do período: volume, andamento e quanto as devoluções custaram. Só leitura."""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from app.central.financeiro.custos import custo_do_sku
from app.central.mercado_livre import catalogo
from app.central.operacao.servico import linhas

PERDIDO_NA_PLATAFORMA = {"unsaleable", "discard", "missing"}  # revisão do ML: sem condição, descarte, faltou
DECLARADO_QUEBRADO = {"danificado", "defeito"}
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
    """De onde vem a perda do produto desta devolução e quanto é.
    bancada = conferido pela Novaes · plataforma = revisão do ML · risco = comprador disse que chegou quebrado."""
    conf = linha["conferencia"]
    if conf:
        return ("bancada", conf["perda_produto"]) if conf["classe"] != "A" else (None, 0.0)
    if linha.get("condicao_produto") in PERDIDO_NA_PLATAFORMA:
        return "plataforma", _cmv(linha)
    if linha["motivo"] in DECLARADO_QUEBRADO and linha["status"] not in ("finalizada",):
        return "risco", _cmv(linha)
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
        d["frete_reverso"] += l["custo_plataforma"] or 0
        origem, valor = perda(l)
        if origem and valor is None:
            sem_custo += 1
        elif origem == "risco":
            d["em_risco"] += valor
        elif origem:
            d[f"perda_{origem}"] += valor
        d["recuperado"] += _recuperado(l)
    custo = d["frete_reverso"] + d["perda_bancada"] + d["perda_plataforma"]
    return {**{k: round(v, 2) for k, v in d.items()}, "custo_total": round(custo, 2),
            "prejuizo_liquido": round(custo - d["recuperado"], 2),
            "taxa_recuperacao": round(100 * d["recuperado"] / custo, 1) if custo else 0.0, "sem_custo": sem_custo}


def _imagens(skus: list[dict]) -> None:
    """Completa a foto dos produtos do ML (a Shopee já manda no próprio item)."""
    fotos = catalogo.imagens(p["item_id"] for p in skus if not p["imagem"] and p["plataforma"] == "mercado_livre")
    for p in skus:
        p["imagem"] = p["imagem"] or fotos.get(p["item_id"])


def resumo(dias: int = 30) -> dict:
    fim = _agora()
    atual = linhas(fim - timedelta(days=dias))
    anterior = [l for l in linhas(fim - timedelta(days=2 * dias)) if l["atualizada_em"] < fim - timedelta(days=dias)]

    serie = {(fim.date() - timedelta(days=n)): dict.fromkeys(("total", "resolvidas", "em_aberto", "custo", "recuperado"), 0.0)
             for n in range(dias - 1, -1, -1)}
    por_plataforma = defaultdict(list)
    motivos, produtos, mediacoes = Counter(), {}, Counter()
    for l in atual:
        por_plataforma[l["plataforma"]].append(l)
        motivos[l["motivo"]] += 1
        if l.get("resultado_mediacao"):
            mediacoes[l["resultado_mediacao"]] += 1
        dia = l["aberta_em"].date()
        if dia in serie:
            p = serie[dia]
            p["total"] += 1
            p["resolvidas" if l["status"] in RESOLVIDAS else "em_aberto"] += 1
            origem, valor = perda(l)
            p["custo"] += (l["custo_plataforma"] or 0) + (valor or 0 if origem in ("bancada", "plataforma") else 0)
            p["recuperado"] += _recuperado(l)
        for i in l["itens"]:
            chave = i.get("sku") or i.get("item_id")
            if not chave:
                continue
            item = produtos.setdefault(chave, {"sku": i.get("sku"), "nome": i.get("nome"), "imagem": i.get("imagem"),
                                               "item_id": i.get("item_id"), "plataforma": l["plataforma"],
                                               "quantidade": 0, "prejuizo": 0.0})
            item["quantidade"] += 1
            origem, valor = perda(l)
            item["prejuizo"] = round(item["prejuizo"] + (l["custo_plataforma"] or 0) + (valor or 0 if origem != "risco" else 0), 2)
            item["nome"] = item["nome"] or i.get("nome")
            item["imagem"] = item["imagem"] or i.get("imagem")

    total = len(atual) or 1
    top = sorted(produtos.values(), key=lambda p: (-p["quantidade"], -p["prejuizo"]))[:5]
    _imagens(top)
    return {
        "dias": dias,
        "total": len(atual),
        "total_anterior": len(anterior),
        "dinheiro": _dinheiro(atual),
        "dinheiro_anterior": _dinheiro(anterior),
        "serie": [{"dia": d.isoformat(), **{k: round(v, 2) for k, v in p.items()}} for d, p in serie.items()],
        "por_plataforma": {k: {"devolucoes": len(v), **_dinheiro(v)} for k, v in por_plataforma.items()},
        "status": dict(Counter(l["status"] for l in atual)),
        "motivos": [{"motivo": m, "quantidade": q, "pct": round(100 * q / total, 1)} for m, q in motivos.most_common()],
        "produtos": [{**p, "pct": round(100 * p["quantidade"] / total, 1)} for p in top],
        "mediacoes": {**{k: mediacoes.get(k, 0) for k in ("ganha", "perdida", "parcial", "em_andamento")},
                      "recuperado": _dinheiro(atual)["recuperado"]},
    }


