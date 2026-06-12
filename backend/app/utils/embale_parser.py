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


def _extrair_items_shopee_pagina_v2(page) -> List[dict]:
    """
    Parser v2 para Shopee: agrupa linhas consecutivas para montar item completo.
    Lida com nomes de produtos quebrados em múltiplas linhas.

    IMPORTANTE: Se múltiplos SKUs vendor estão na mesma altura Y, trata como
    produtos DIFERENTES (sobrepostos no PDF). Separa por mudança de SKU vendor.

    Padrão esperado:
    - SKU_vendor (coluna 1) | SKU_shopee padrão XXXXX_X (coluna 2) | Nome... | Item without/with | QTD
    - Continuações de nome vêm em linhas seguintes
    - GTIN marca fim do item (fica para a próxima)
    """
    words = page.extract_words(use_text_flow=True)
    rows = {}
    for word in words:
        key = round(word["top"])
        rows.setdefault(key, []).append(word)

    # Primeiro agrupamento: por coluna de vendor (x < 110)
    # Se múltiplos vendors na mesma altura, separa como diferentes
    linhas_brutos_separadas = []

    for key in sorted(rows):
        words_ordenados = sorted(rows[key], key=lambda x: x["x0"])

        # Extrair todos os vendors dessa linha
        vendors_linha = []
        outras_colunas = {"shopee": [], "name": [], "warehouse": [], "qty": []}

        for word in words_ordenados:
            texto = (word.get("text") or "").strip()
            if not texto:
                continue
            x0 = word["x0"]
            if x0 < 110:
                vendors_linha.append((x0, texto))
            elif x0 < 190:
                outras_colunas["shopee"].append((x0, texto))
            elif x0 < 445:
                outras_colunas["name"].append((x0, texto))
            elif x0 < 525:
                outras_colunas["warehouse"].append((x0, texto))
            else:
                outras_colunas["qty"].append((x0, texto))

        # Se tem múltiplos vendors, são produtos diferentes
        if len(vendors_linha) > 1:
            # Criar um "item" por vendor, separando as colunas por posição X
            for idx, (vendor_x, vendor_texto) in enumerate(vendors_linha):
                partes = {"vendor": [vendor_texto], "shopee": [], "name": [], "warehouse": [], "qty": []}

                # Para cada coluna, pegar os textos "mais próximos" deste vendor em X
                for campo, valores in outras_colunas.items():
                    if valores:
                        # Se tem tantos textos quanto vendors, alinha por índice
                        # Senão, pega o primeiro
                        if len(valores) >= len(vendors_linha):
                            partes[campo] = [valores[idx][1]]
                        else:
                            partes[campo] = [valores[0][1]]

                linhas_brutos_separadas.append({k: " ".join(v).strip() for k, v in partes.items()})
        else:
            # Padrão: um vendor por linha
            partes = {"vendor": [], "shopee": [], "name": [], "warehouse": [], "qty": []}
            partes["vendor"] = [v[1] for v in vendors_linha]
            partes["shopee"] = [v[1] for v in outras_colunas["shopee"]]
            partes["name"] = [v[1] for v in outras_colunas["name"]]
            partes["warehouse"] = [v[1] for v in outras_colunas["warehouse"]]
            partes["qty"] = [v[1] for v in outras_colunas["qty"]]

            linhas_brutos_separadas.append({k: " ".join(v).strip() for k, v in partes.items()})

    linhas_brutos = linhas_brutos_separadas

    items = []
    item_atual = None

    for linha in linhas_brutos:
        texto_linha = " ".join(
            parte for parte in [
                linha["vendor"],
                linha["shopee"],
                linha["name"],
                linha["warehouse"],
                linha["qty"],
            ] if parte
        ).strip()

        if not texto_linha or _linha_shopee_ignorada(texto_linha):
            continue

        # Tentar extrair SKU Shopee (padrão: XXXXX_X)
        sku_shopee = _extrair_sku_shopee(linha["shopee"])
        sku_vendor = _extrair_sku_vendor_shopee(linha["vendor"])

        # Se tem SKU Shopee, é um novo item
        if sku_shopee:
            if item_atual:
                items.append(_normalizar_item_shopee(item_atual))

            qty_linha = _extrair_quantidade_coluna_shopee(linha["qty"])
            sku_base = sku_vendor or sku_shopee

            # Nome = tudo que vem após remover o SKU Shopee
            nome_sem_sku = _remover_sku_shopee_do_texto(linha['shopee'], sku_shopee)
            nome_completo = f"{nome_sem_sku} {linha['name']}".strip()
            nome_completo = _limpar_campo_shopee(nome_completo)

            item_atual = {
                "sku": sku_base,
                "codigo_ml": sku_shopee,  # Guardar SKU Shopee como codigo_ml
                "titulo_anuncio": nome_completo,
                "qtd_partes": [str(qty_linha)] if qty_linha is not None else [],
            }
            continue

        # Se não tem SKU Shopee mas tem vendor SKU, pode ser novo item
        if sku_vendor and item_atual is None:
            qty_linha = _extrair_quantidade_coluna_shopee(linha["qty"])
            nome_completo = f"{linha['name']}".strip()
            nome_completo = _limpar_campo_shopee(nome_completo)

            item_atual = {
                "sku": sku_vendor,
                "codigo_ml": None,
                "titulo_anuncio": nome_completo,
                "qtd_partes": [str(qty_linha)] if qty_linha is not None else [],
            }
            continue

        # Senão, é continuação do item atual (linha quebrada)
        if item_atual:
            # Adicionar à descrição
            descricao_extra = _limpar_campo_shopee(
                f"{linha['shopee']} {linha['name']} {linha['qty']}"
            )

            if descricao_extra and not _texto_warehouse_shopee(descricao_extra) and "gtin" not in descricao_extra.lower():
                item_atual["titulo_anuncio"] = f"{item_atual['titulo_anuncio']} {descricao_extra}".strip()

            # Tentar extrair quantidade se vem aqui
            qty_linha = _extrair_quantidade_coluna_shopee(linha["qty"])
            if qty_linha and not item_atual["qtd_partes"]:
                item_atual["qtd_partes"] = [str(qty_linha)]

    if item_atual:
        items.append(_normalizar_item_shopee(item_atual))

    return items


def _linhas_shopee(page) -> List[dict]:
    words = page.extract_words(use_text_flow=True)
    rows = {}
    for word in words:
        key = round(word["top"])
        rows.setdefault(key, []).append(word)

    linhas = []
    for key in sorted(rows):
        partes = {"vendor": [], "shopee": [], "name": [], "warehouse": [], "qty": []}
        for word in sorted(rows[key], key=lambda x: x["x0"]):
            texto = (word.get("text") or "").strip()
            if not texto:
                continue
            x0 = word["x0"]
            if x0 < 110:
                partes["vendor"].append(texto)
            elif x0 < 190:
                partes["shopee"].append(texto)
            elif x0 < 445:
                partes["name"].append(texto)
            elif x0 < 525:
                partes["warehouse"].append(texto)
            else:
                partes["qty"].append(texto)

        linhas.append({k: " ".join(v).strip() for k, v in partes.items()})
    return linhas


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
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9+\-_/]{2,}', valor):
        return valor
    return None


def _remover_sku_shopee_do_texto(texto: str, sku_shopee: str) -> str:
    return (texto or "").replace(sku_shopee, "", 1).strip()


def _extrair_digitos_qtd(texto: str) -> List[str]:
    if not texto:
        return []
    texto_limpo = texto.lower()
    if "gtin" in texto_limpo:
        return []
    return re.findall(r'\d+', texto)


def _extrair_quantidade_coluna_shopee(texto: str) -> int | None:
    numeros = _extrair_digitos_qtd(texto)
    if not numeros:
        return None
    try:
        return int(numeros[-1])
    except Exception:
        return None


def _linha_indica_novo_item_shopee(linha: dict, sku_vendor: str | None, qty_linha: int | None) -> bool:
    if not sku_vendor or not qty_linha or qty_linha <= 0:
        return False
    texto_name = (linha.get("name") or "").strip()
    texto_qty = (linha.get("qty") or "").lower()
    return bool(texto_name) and ("item" in texto_qty or "without" in texto_qty or qty_linha > 0)


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
    quantidade = 0
    if item.get("qtd_partes"):
        try:
            quantidade = float(item["qtd_partes"][0])
        except Exception:
            quantidade = 0

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
