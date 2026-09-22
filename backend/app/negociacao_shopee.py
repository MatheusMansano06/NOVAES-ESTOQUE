"""
Planilha de negociação da Shopee: lê a aba "Pontual - Nível Model" que o gerente
de contas manda todo mês, busca na API o preço da campanha e o estoque do galpão,
e devolve o mesmo arquivo com as colunas AD e AE preenchidas.

Três coisas da API que não estão na doc e que este módulo isola:

1. "Minha Promoção" não é o nome de nenhuma campanha — é a seção do Seller
   Center. Na API são as campanhas de desconto com `source: 0`.
2. Anúncio sem variação não aparece em get_model_list nem traz model_id no
   get_discount: a chave natural vira o item_id. Daí `resolver()`.
3. seller_stock é o galpão do lojista (location BRZ); shopee_stock são os CDs do
   Full (BRF*). A coluna AE quer o primeiro.
"""

import json
import unicodedata
from typing import Any, Dict, List, Optional

import openpyxl

ABA = "Pontual"          # prefixo; o nome completo tem acento e já veio variando
LINHA_CABECALHO = 2
PRIMEIRA_LINHA = 3

COL = {
    "flag": 1, "full": 2, "cluster": 4, "categoria": 5, "sku": 6,
    "preco_referencia": 7, "adgmv_l30d": 8, "ado_l30d": 9, "rebate_medio": 10,
    "score": 11, "item_id": 14, "model_id": 16, "descricao": 17,
    "estoque_d1": 18, "estoque_full_d1": 19, "tipo_negociacao": 20,
    "preco_original": 21, "preco_site_d1": 22, "preco_seller": 23,
    "preco": 30,      # AD — preenchida por nós
    "estoque": 31,    # AE — preenchida por nós
}

# Se a Shopee mexer no layout, os índices acima passam a gravar na coluna errada
# em silêncio. Estas âncoras fazem o arquivo ser recusado antes disso.
ANCORAS = {14: "item id", 16: "model id", 30: "preco (r$)", 31: "estoque negociado"}

EXTRAS = ("flag", "cluster", "categoria", "score", "adgmv_l30d", "ado_l30d",
          "rebate_medio", "tipo_negociacao", "preco_original", "preco_seller")


class PlanilhaInvalida(Exception):
    """Arquivo que não é a planilha de negociação, ou cujo layout mudou."""


class ShopeeIndisponivel(Exception):
    """A API não respondeu — a negociação fica pendente para reprocessar."""


def _norm(valor: Any) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    return "".join(c for c in texto if not unicodedata.combining(c)).strip().lower()


def _num(valor: Any) -> Optional[float]:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _inteiro(valor: Any) -> Optional[int]:
    n = _num(valor)
    return None if n is None else int(n)


def _aba_da_planilha(wb) -> Any:
    for ws in wb.worksheets:
        if _norm(ws.title).startswith(_norm(ABA)):
            return ws
    raise PlanilhaInvalida(
        f"Não achei a aba '{ABA} - Nível Model'. Abas no arquivo: "
        + ", ".join(ws.title for ws in wb.worksheets)
    )


def _conferir_cabecalho(ws) -> None:
    for coluna, esperado in ANCORAS.items():
        encontrado = _norm(ws.cell(LINHA_CABECALHO, coluna).value)
        if encontrado != esperado:
            raise PlanilhaInvalida(
                f"A coluna {coluna} deveria ser '{esperado}' e veio '{encontrado}'. "
                "O layout da planilha mudou — confira antes de preencher."
            )


def ler_planilha(caminho: str) -> List[Dict[str, Any]]:
    """Uma linha por model, já tipada. `linha` é o índice para escrever de volta."""
    wb = openpyxl.load_workbook(caminho, read_only=True)
    try:
        ws = _aba_da_planilha(wb)
        _conferir_cabecalho(ws)

        linhas = []
        for idx in range(PRIMEIRA_LINHA, ws.max_row + 1):
            item_id = ws.cell(idx, COL["item_id"]).value
            if not item_id:
                continue
            ler = lambda campo: ws.cell(idx, COL[campo]).value  # noqa: E731
            linhas.append({
                "linha": idx,
                "item_id": str(item_id),
                "model_id": str(ler("model_id") or ""),
                "sku": str(ler("sku") or ""),
                "descricao": str(ler("descricao") or "")[:255],
                "preco_referencia": _num(ler("preco_referencia")),
                "preco_site_d1": _num(ler("preco_site_d1")),
                "estoque_d1": _inteiro(ler("estoque_d1")),
                "estoque_full_d1": _inteiro(ler("estoque_full_d1")),
                "extras": {campo: ler(campo) for campo in EXTRAS},
            })
    finally:
        wb.close()

    if not linhas:
        raise PlanilhaInvalida("A planilha não tem nenhuma linha de produto.")
    return linhas


def resolver(mapa: Dict[str, Any], item_id: str, model_id: str) -> Any:
    """Anúncio com variação é chaveado por model_id; sem variação, por item_id."""
    return mapa.get(str(model_id)) or mapa.get(str(item_id))


def coletar_precos(cliente) -> Dict[str, Dict[str, Any]]:
    """Preço de cada model nas campanhas do próprio seller (as "Minha Promoção").

    Um model pode estar em mais de uma campanha ativa; vale o menor preço, que é
    o que o comprador enxerga. `campanhas` registra quantas disputaram.
    """
    promos = cliente.listar_promocoes("ongoing")
    if promos.get("erro"):
        raise ShopeeIndisponivel(promos.get("mensagem") or promos["erro"])

    proprias = [p for p in promos.get("promocoes") or [] if p.get("origem") == 0]
    if not proprias:
        raise ShopeeIndisponivel("Nenhuma campanha própria ativa na Shopee.")

    candidatos: Dict[str, List[Dict[str, Any]]] = {}
    for promo in proprias:
        resposta = cliente.precos_da_promocao(promo["discount_id"])
        if resposta.get("erro"):
            raise ShopeeIndisponivel(resposta.get("mensagem") or resposta["erro"])
        for chave, preco in (resposta.get("precos") or {}).items():
            candidatos.setdefault(chave, []).append({
                "preco": preco,
                "campanha_id": str(promo["discount_id"]),
                "campanha_nome": (promo.get("nome") or "").strip(),
            })

    precos = {}
    for chave, lista in candidatos.items():
        melhor = min(lista, key=lambda c: c["preco"])
        precos[chave] = {**melhor, "campanhas": len(lista)}
    return precos


def coletar_estoques(cliente, item_ids: List[str]) -> Dict[str, Dict[str, int]]:
    resposta = cliente.estoque_vendedor([int(i) for i in item_ids])
    if resposta.get("falhas"):
        raise ShopeeIndisponivel(f"Falha ao ler estoque: {resposta['falhas'][:3]}")
    return resposta.get("estoques") or {}


def montar(linhas: List[Dict[str, Any]], precos: Dict, estoques: Dict) -> Dict[str, Any]:
    """Junta planilha + API. Nada é escrito aqui — só o que vai ser escrito."""
    itens, sem_preco, sem_estoque, zerados, multi = [], [], [], 0, 0

    for linha in linhas:
        preco = resolver(precos, linha["item_id"], linha["model_id"])
        estoque = resolver(estoques, linha["item_id"], linha["model_id"])

        if preco is None:
            sem_preco.append(linha["item_id"])
        elif preco["campanhas"] > 1:
            multi += 1
        if estoque is None:
            sem_estoque.append(linha["item_id"])
        elif estoque["seller"] == 0:
            zerados += 1

        itens.append({
            **linha,
            "preco_preenchido": preco["preco"] if preco else None,
            "campanha_id": preco["campanha_id"] if preco else "",
            "campanha_nome": preco["campanha_nome"] if preco else "",
            "estoque_preenchido": estoque["seller"] if estoque else None,
            "estoque_full": estoque["shopee"] if estoque else None,
        })

    return {
        "itens": itens,
        "total_linhas": len(itens),
        "total_zerados": zerados,
        "total_multi_campanha": multi,
        "sem_preco": sem_preco,
        "sem_estoque": sem_estoque,
    }


def escrever(origem: str, destino: str, itens: List[Dict[str, Any]]) -> int:
    """Grava AD/AE no arquivo. As fórmulas de matriz e os HYPERLINK sobrevivem
    porque o openpyxl só toca nas células que recebem valor."""
    wb = openpyxl.load_workbook(origem)
    try:
        ws = _aba_da_planilha(wb)
        gravadas = 0
        for item in itens:
            if item["preco_preenchido"] is None or item["estoque_preenchido"] is None:
                continue
            ws.cell(item["linha"], COL["preco"]).value = item["preco_preenchido"]
            ws.cell(item["linha"], COL["estoque"]).value = item["estoque_preenchido"]
            gravadas += 1
        wb.save(destino)
    finally:
        wb.close()
    return gravadas


def dados_extras(item: Dict[str, Any]) -> str:
    return json.dumps(item.get("extras") or {}, ensure_ascii=False, default=str)
