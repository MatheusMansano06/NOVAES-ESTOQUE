"""Caso real (FBSINBR2026060900467): o produto que quebra de página é desenhado 1,5pt
acima do seguinte e com a qtd um dígito por linha. Antes lia 42 itens / 4522 de 5496."""

from pathlib import Path

from app.utils.inbound_parser import extrair_items_embale_pdf

PDF = Path(__file__).parent / "fixtures" / "shopee_picking_sobreposto.pdf"


def test_shopee_sobreposto_bate_total_declarado():
    r = extrair_items_embale_pdf(str(PDF))
    itens = {i["sku"]: i for i in r["items"]}
    assert len(r["items"]) == 44
    assert sum(i["quantidade_separada"] for i in r["items"]) == r["total_unidades"] == 5496
    assert itens["PAINEL150S"]["quantidade_separada"] == 200  # "2","0","0" empilhados
    assert itens["514"]["quantidade_separada"] == 150
    assert "VISMX5FOKKER" in itens  # SKU vendedor quebrado em 2 linhas
    assert "Disco Freio" in itens["DISCCG"]["titulo_anuncio"]
    assert "Retrovisor" not in itens["DISCCG"]["titulo_anuncio"]  # sem nome do vizinho


def test_shopee_coleta_todos_com_sku_e_total():
    # INBRFRC12610020033: antes lia 5020 de 5754; SKU com acento (CAVLETÃO) saía vazio
    r = extrair_items_embale_pdf(str(PDF.with_name("shopee_picking_coleta.pdf")))
    assert len(r["items"]) == 117
    assert sum(i["quantidade_separada"] for i in r["items"]) == r["total_unidades"] == 5754
    assert all(i["sku"] for i in r["items"])
    assert "CAVLETÃO" in {i["sku"] for i in r["items"]}
