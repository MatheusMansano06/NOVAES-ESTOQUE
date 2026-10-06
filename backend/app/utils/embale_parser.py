"""
Parser para arquivos PDF de Inbound do Mercado Livre FULL
(Lista de produtos e instrucoes de preparacao)

Extrai por produto: SKU, Codigo ML, titulo e quantidade de unidades.
Usa extracao de tabela (pdfplumber) pois o PDF do ML e texto real,
nao imagem escaneada.
"""

import pdfplumber
import re
from typing import List


def extrair_items_embale_pdf(caminho_pdf: str) -> dict:
    """
    Extrai items de um PDF de Inbound do Mercado Livre.

    Retorna:
      {
        "numero_inbound": str,
        "total_unidades": int,
        "items": [
          {"sku", "codigo_ml", "titulo_anuncio", "quantidade_separada"}, ...
        ]
      }
    ou {"erro": True, "mensagem": "..."} em caso de falha.
    """
    try:
        with pdfplumber.open(caminho_pdf) as pdf:
            texto_inicial = ""
            if pdf.pages:
                texto_inicial = pdf.pages[0].extract_text() or ""

            if _eh_pdf_shopee(texto_inicial):
                return _extrair_items_shopee_pdf(pdf)

            items = []
            numero_inbound = None
            total_unidades = 0

            for page in pdf.pages:
                texto = page.extract_text() or ""

                if numero_inbound is None:
                    m = re.search(r'Frete\s*#?\s*(\d+)', texto)
                    if m:
                        numero_inbound = m.group(1)

                m_total = re.search(r'Total de unidades:\s*(\d+)', texto)
                if m_total:
                    total_unidades = int(m_total.group(1))

                for tabela in page.extract_tables():
                    items_tabela = _parsear_tabela_produtos(tabela)
                    items.extend(items_tabela)

        if not items:
            return {
                "erro": True,
                "mensagem": "Nenhum produto encontrado no PDF. Verifique se e um Inbound valido do Mercado Livre."
            }

        return {
            "numero_inbound": numero_inbound,
            "total_unidades": total_unidades,
            "items": items
        }

    except Exception as e:
        return {
            "erro": True,
            "mensagem": f"Erro ao processar PDF: {str(e)}"
        }


def _eh_pdf_shopee(texto_inicial: str) -> bool:
    texto = (texto_inicial or "").lower()
    return (
        "shopee picking list" in texto
        or "shopee fulfillment" in texto
        or "id de envio (asn id)" in texto
    )


def _extrair_items_shopee_pdf(pdf) -> dict:
    numero_inbound = None
    total_unidades = 0
    items = []

    for page in pdf.pages:
        texto = page.extract_text() or ""

        if numero_inbound is None:
            m_asn = re.search(r'ID de Envio \(ASN ID\)\s*([A-Z0-9-]+)', texto, re.IGNORECASE)
            if m_asn:
                numero_inbound = m_asn.group(1).strip()

        m_total = re.search(r'Notas\s+Total\s+(\d+)', texto, re.IGNORECASE)
        if m_total:
            total_unidades = int(m_total.group(1))

        items_pagina = _extrair_items_shopee_pagina_v2(page)
        items.extend(items_pagina)

    items = [item for item in items if item.get("titulo_anuncio") and item.get("quantidade_separada", 0) > 0]

    # Remover duplicatas exatas (mesmo SKU vendor + Shopee + Qtd + Nome)
    items_unicos = []
    vistos = set()
    for item in items:
        chave = (item.get("sku"), item.get("codigo_ml"), int(item.get("quantidade_separada", 0)))
        if chave not in vistos:
            items_unicos.append(item)
            vistos.add(chave)

    items = items_unicos

    if not items:
        return {
            "erro": True,
            "mensagem": "Nenhum produto encontrado no PDF da Shopee. Verifique se o arquivo é um Picking List válido."
        }

    return {
        "numero_inbound": numero_inbound,
        "total_unidades": total_unidades,
        "items": items
    }


_PASSO_LINHA_SHOPEE = 26.2  # distância vertical entre linhas da mesma célula


def _linhas_shopee_por_char(page) -> List[tuple]:
    """
    Agrupa CARACTERES pela altura exata (não palavras arredondadas).

    O Picking List da Shopee desenha o produto que vem quebrado da página
    anterior 1,5pt acima do produto seguinte; agrupando por palavra os dois se
    intercalam ("LVaisnedirear" = Lander + Viseira). Pelo char, cada linha
    fica com a sua altura e as duas camadas se separam.
    Retorna [(top, {coluna: [palavras]})] ordenado por top.
    """
    por_top: dict = {}
    for ch in page.chars:
        por_top.setdefault(round(ch["top"], 1), []).append(ch)

    linhas = []
    for top in sorted(por_top):
        palavras = []  # [x0, texto]
        ultimo_x1 = None
        for ch in sorted(por_top[top], key=lambda c: c["x0"]):
            texto = ch.get("text") or ""
            if not texto.strip():
                ultimo_x1 = None
                continue
            if ultimo_x1 is None or ch["x0"] - ultimo_x1 > 2:
                palavras.append([ch["x0"], texto])
            else:
                palavras[-1][1] += texto
            ultimo_x1 = ch["x1"]

        colunas = {"vendor": [], "shopee": [], "name": [], "warehouse": [], "qty": []}
        for x0, texto in palavras:
            if x0 < 110:
                colunas["vendor"].append(texto)
            elif x0 < 190:
                colunas["shopee"].append(texto)
            elif x0 < 445:
                colunas["name"].append(texto)
            elif x0 < 525:
                colunas["warehouse"].append(texto)
            else:
                colunas["qty"].append(texto)
        linhas.append((top, colunas))
    return linhas


def _extrair_items_shopee_pagina_v2(page) -> List[dict]:
    """
    Monta os itens do Picking List da Shopee a partir das linhas por char.

    Uma linha com SKU Shopee (XXXXX_X) abre um item; as demais são
    continuação (nome quebrado, SKU vendedor quebrado, dígitos da qtd).
    Como dois itens podem estar abertos ao mesmo tempo (camadas sobrepostas),
    a continuação vai para o item cuja última linha está a um passo de linha
    de distância. A qtd é a junção dos números puros da coluna Qnt: no
    layout normal vem inteira na 1ª linha; no layout quebrado vem um dígito
    por linha ("2", "0", "0" = 200).
    """
    abertos: List[dict] = []
    fechados: List[dict] = []

    def fechar(cond) -> None:
        for item in [i for i in abertos if cond(i)]:
            abertos.remove(item)
            fechados.append(item)

    for top, col in _linhas_shopee_por_char(page):
        texto_linha = " ".join(" ".join(v) for v in col.values()).strip()
        # Rodapé "Notas / Total N" (em duas alturas) encerra a tabela da página
        if texto_linha.lower().startswith(("notas", "total")):
            break
        if not texto_linha or _linha_shopee_ignorada(texto_linha):
            continue

        # Item cuja última linha ficou longe demais já terminou
        fechar(lambda i: top - i["ultimo_top"] > _PASSO_LINHA_SHOPEE * 1.6)

        shopee = " ".join(col["shopee"])
        sku_shopee = _extrair_sku_shopee(shopee)
        vendor = " ".join(col["vendor"])
        digitos_qtd = [t for t in col["qty"] if t.isdigit()]

        if sku_shopee or (not abertos and _extrair_sku_vendor_shopee(vendor)):
            # Novo item fecha o que estava na mesma camada (linha logo acima)
            fechar(lambda i: top - i["ultimo_top"] > _PASSO_LINHA_SHOPEE / 2)
            nome = _remover_sku_shopee_do_texto(shopee, sku_shopee) if sku_shopee else ""
            abertos.append({
                "top": top,
                "ultimo_top": top,
                "sku": _extrair_sku_vendor_shopee(vendor) or "",
                "codigo_ml": sku_shopee,
                "titulo_anuncio": _limpar_campo_shopee(f"{nome} {' '.join(col['name'])}"),
                "qtd_partes": digitos_qtd,
            })
            continue

        if not abertos:
            continue
        item = min(abertos, key=lambda i: abs(top - i["ultimo_top"] - _PASSO_LINHA_SHOPEE))
        item["ultimo_top"] = top
        extra = _limpar_campo_shopee(" ".join(col["name"]))
        if extra and not _texto_warehouse_shopee(extra):
            item["titulo_anuncio"] = f"{item['titulo_anuncio']} {extra}".strip()
        # SKU do vendedor longo quebra na linha de baixo (VISMX5FOKKE + R)
        if item["sku"] and re.fullmatch(r'[\w+\-/]+', vendor):
            item["sku"] += vendor
        item["qtd_partes"].extend(digitos_qtd)

    fechar(lambda i: True)
    fechados.sort(key=lambda i: i["top"])
    for item in fechados:
        if not item["sku"]:
            item["sku"] = item["codigo_ml"] or ""
    return [_normalizar_item_shopee(i) for i in fechados]


def _linha_shopee_ignorada(texto_linha: str) -> bool:
    texto = texto_linha.strip().lower()
    if not texto:
        return True
    return any(
        marcador in texto for marcador in [
            "shopee picking list", "informação de inbound", "data de inbound",
            "método de entrega", "instruções:", "informações de sku", "no. sku do",
            "vendedor", "qnt.", "aprovada", "notas total", "usuário poderá inserir",
        ]
    )


def _extrair_sku_shopee(texto: str) -> str | None:
    m = re.search(r'(\d{8,}_\d+)', texto or "")
    return m.group(1) if m else None


def _extrair_sku_vendor_shopee(texto: str) -> str | None:
    valor = (texto or "").strip()
    if not valor or " " in valor:
        return None
    if re.search(r'\d{8,}_\d+', valor):
        return valor
    if re.fullmatch(r'[^\W_][\w+\-/]{2,}', valor):  # \w aceita acento (CAVLETÃO)
        return valor
    return None


def _remover_sku_shopee_do_texto(texto: str, sku_shopee: str) -> str:
    return (texto or "").replace(sku_shopee, "", 1).strip()





def _texto_warehouse_shopee(texto: str) -> bool:
    texto_norm = (texto or "").lower()
    return "gtin" in texto_norm or texto_norm in {"item", "without", "item without"}



def _limpar_campo_shopee(texto: str) -> str:
    texto_limpo = re.sub(r'\s+', ' ', (texto or '')).strip()
    # Remove marcadores de item
    texto_limpo = re.sub(r'\b(Item\s+without|Item\s+with|without|with)\b', '', texto_limpo, flags=re.IGNORECASE).strip()
    # Remove "GTIN," e tudo que vem depois (é continuação de outro item)
    texto_limpo = re.sub(r'GTIN[,\s].*$', '', texto_limpo, flags=re.IGNORECASE).strip()
    # Remove SKU patterns (XXXXX_X) que podem ter ficado
    texto_limpo = re.sub(r'\b\d{8,}_\d+\b', '', texto_limpo).strip()
    # Remove números grandes isolados (8+ dígitos = GTIN)
    texto_limpo = re.sub(r'\s\d{8,}\s', ' ', texto_limpo).strip()
    texto_limpo = re.sub(r'\s\d{8,}$', '', texto_limpo).strip()
    return texto_limpo


def _normalizar_item_shopee(item: dict) -> dict:
    partes = "".join(item.get("qtd_partes") or [])
    quantidade = float(partes) if partes.isdigit() else 0

    titulo = _limpar_campo_shopee(item.get("titulo_anuncio", ""))
    sku = _limpar_campo_shopee(item.get("sku", ""))

    return {
        "sku": sku,
        "codigo_ml": item.get("codigo_ml"),
        "titulo_anuncio": titulo or sku or "Produto sem titulo",
        "quantidade_separada": quantidade,
    }


def _parsear_tabela_produtos(tabela: List[list]) -> List[dict]:
    """
    Parseia uma tabela extraida do PDF.
    A tabela do ML tem colunas: PRODUTO | UNIDADES | IDENTIFICACAO | INSTRUCOES
    A coluna PRODUTO contem (multiline):
      Codigo ML: XXXXX Codigo universal:
      EAN SKU: YYYYY
      Titulo do produto...
    """
    items = []

    if not tabela or len(tabela) < 2:
        return items

    # Confirmar que e a tabela de produtos (cabecalho com PRODUTO)
    header = tabela[0]
    if not header or "PRODUTO" not in str(header[0] or "").upper():
        return items

    for row in tabela[1:]:
        if not row or len(row) < 2:
            continue

        celula_produto = row[0] or ""
        celula_unidades = row[1] or ""

        if not celula_produto.strip():
            continue

        # SKU
        sku_m = re.search(r'SKU:\s*(\S+)', celula_produto)
        sku = sku_m.group(1).strip() if sku_m else None

        # Codigo ML
        ml_m = re.search(r'C[oó]digo ML:\s*(\S+)', celula_produto)
        codigo_ml = ml_m.group(1).strip() if ml_m else None

        # Quantidade (primeiro numero da coluna UNIDADES)
        uni_m = re.search(r'\d+', celula_unidades)
        quantidade = float(uni_m.group(0)) if uni_m else 0

        # Titulo: linhas que NAO sao de codigo/SKU
        linhas = celula_produto.split("\n")
        titulo_linhas = []
        for linha in linhas:
            ls = linha.strip()
            if not ls:
                continue
            if "SKU:" in ls or "Código" in ls or "Codigo" in ls:
                continue
            titulo_linhas.append(ls)
        titulo = " ".join(titulo_linhas).strip()

        # So adiciona se tiver pelo menos SKU ou titulo
        if sku or titulo:
            items.append({
                "sku": sku,
                "codigo_ml": codigo_ml,
                "titulo_anuncio": titulo or (sku or "Produto sem titulo"),
                "quantidade_separada": quantidade
            })

    return items
