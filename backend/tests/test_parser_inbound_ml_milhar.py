"""Caso real (frete #82413159): o ML escreve 3000 un como "3,000" e o leitor pegava 3
(leu 10.830 de 16.824 un). No mesmo PDF o SKU vinha na linha de baixo e entrava no título."""

from app.utils.inbound_parser import _parsear_tabela_produtos


def _tabela(*linhas):
    return [["PRODUTO", "UNIDADES"], *linhas]


def test_quantidade_com_separador_de_milhar():
    itens = _parsear_tabela_produtos(_tabela(
        ["Código ML: AAA1 Código universal:\n789 SKU: X1\nProduto A", "3,000"],
        ["Código ML: AAA2 Código universal:\n789 SKU: X2\nProduto B", "1.200"],
        ["Código ML: AAA3 Código universal:\n789 SKU: X3\nProduto C", "48"],
    ))
    assert [i["quantidade_separada"] for i in itens] == [3000, 1200, 48]


def test_sku_na_linha_de_baixo_nao_entra_no_titulo():
    [item] = _parsear_tabela_produtos(_tabela(
        ["Código ML: CMPF38034 Código universal: N/A SKU:\nRVEOX\nViseira Capacete\nE17 Cristal", "50"],
    ))
    assert item["sku"] == "RVEOX"
    assert item["codigo_ml"] == "CMPF38034"
    assert item["titulo_anuncio"] == "Viseira Capacete E17 Cristal"
