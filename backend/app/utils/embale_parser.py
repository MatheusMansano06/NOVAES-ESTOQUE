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
        items = []
        numero_inbound = None
        total_unidades = 0

        with pdfplumber.open(caminho_pdf) as pdf:
            for page in pdf.pages:
                texto = page.extract_text() or ""

                # Numero do inbound (Frete #XXXXX)
                if numero_inbound is None:
                    m = re.search(r'Frete\s*#?\s*(\d+)', texto)
                    if m:
                        numero_inbound = m.group(1)

                # Total de unidades
                m_total = re.search(r'Total de unidades:\s*(\d+)', texto)
                if m_total:
                    total_unidades = int(m_total.group(1))

                # Extrair tabelas de produtos
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
