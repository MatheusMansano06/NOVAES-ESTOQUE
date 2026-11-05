"""A porta dos agentes só lê, abre com a chave certa e nunca entrega dados do comprador."""
from datetime import datetime, timedelta, timezone

import pytest
from starlette.testclient import TestClient

from app import agentes, seguranca
from app.main import app
from app.models import MercadoLivreItemCache
from database import SessionLocal
from app.models import MercadoLivreVendaCache
from database import SessionLocal

ROTA = "/api/agentes/envios-pendentes"
CHAVE = "chave-de-teste-dos-agentes"
CAMPOS_PERMITIDOS = {"plataforma", "pacote_id", "data_venda", "limite_envio", "logistica", "situacao"}


@pytest.fixture
def chave(monkeypatch):
    monkeypatch.setattr(seguranca, "CHAVE_AGENTES", CHAVE)
    monkeypatch.setattr(agentes, "listar_envios_pendentes", lambda: {"pacotes": [], "erros": []})


def _get(caminho, valor=None):
    cabecalhos = {"x-chave-agentes": valor} if valor is not None else {}
    return TestClient(app).get(caminho, headers=cabecalhos)


def test_sem_chave_nao_entra(chave):
    assert _get(ROTA).status_code == 401


def test_chave_errada_nao_entra(chave):
    assert _get(ROTA, "errada").status_code == 401


def test_chave_certa_le_os_envios(chave):
    resposta = _get(ROTA, CHAVE)
    assert resposta.status_code == 200
    assert resposta.json() == {"pacotes": [], "erros": []}


def test_chave_nao_abre_o_resto_do_sistema(chave):
    assert _get("/api/embaldes?limit=1", CHAVE).status_code == 401


def test_chave_nao_permite_alterar(chave):
    assert TestClient(app).post(ROTA, headers={"x-chave-agentes": CHAVE}).status_code == 401


def test_sem_chave_configurada_ninguem_entra(monkeypatch):
    monkeypatch.setattr(seguranca, "CHAVE_AGENTES", "")
    assert _get(ROTA, "").status_code == 401


# --- Mercado Livre -----------------------------------------------------------------
def _envio(status="ready_to_ship", logistica="cross_docking", substatus="printed", **extra):
    base = {"status": status, "substatus": substatus, "logistic_type": logistica,
            "date_created": "2026-11-03T08:00:00.000-04:00",
            "status_history": {"date_handling": "2026-11-03T09:00:00.000-04:00"},
            "lead_time": {"estimated_handling_limit": {"date": "2026-11-05T22:59:00.000-04:00"}},
            "receiver_address": {"receiver_name": "Comprador Secreto", "city": {"name": "Campinas"}}}
    return {**base, **extra}


def test_ml_pacote_pronto_para_enviar_entra():
    pacotes, erros = agentes.pacotes_ml(["1"], {"1": _envio("ready_to_ship")})
    assert [p["pacote_id"] for p in pacotes] == ["1"]
    assert erros == []


def test_ml_pacote_em_preparacao_entra():
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": _envio("handling")})
    assert len(pacotes) == 1


@pytest.mark.parametrize("status", ["shipped", "delivered", "cancelled", "not_delivered", "pending"])
def test_ml_pacote_que_nao_esta_esperando_envio_fica_fora(status):
    pacotes, erros = agentes.pacotes_ml(["1"], {"1": _envio(status)})
    assert pacotes == [] and erros == []


@pytest.mark.parametrize("substatus", ["picked_up", "authorized_by_carrier", "in_hub", "dropped_off"])
def test_ml_pacote_que_ja_saiu_do_vendedor_fica_fora(substatus):
    """O Mercado Livre mantém esses pacotes como ready_to_ship, mas eles já foram entregues à transportadora."""
    pacotes, erros = agentes.pacotes_ml(["1"], {"1": _envio(substatus=substatus)})
    assert pacotes == [] and erros == []


@pytest.mark.parametrize("substatus", ["printed", "ready_to_print", None])
def test_ml_pacote_ainda_com_o_vendedor_entra_com_a_situacao(substatus):
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": _envio(substatus=substatus)})
    assert [p["situacao"] for p in pacotes] == [substatus or "ready_to_ship"]


def test_ml_limite_de_envio_vem_do_prazo_do_envio():
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": _envio()})
    assert pacotes[0]["limite_envio"] == "2026-11-05T23:59:00-03:00"


def test_ml_full_fica_fora():
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": _envio(logistica="fulfillment")})
    assert pacotes == []


def test_ml_dois_itens_no_mesmo_envio_contam_um_pacote():
    pacotes, _ = agentes.pacotes_ml(["1", "1"], {"1": _envio()})
    assert len(pacotes) == 1


def test_ml_converte_o_pagamento_para_brasilia():
    """11:00 no fuso do Mercado Livre são 12:00 em Brasília: o corte da Luisa depende disso."""
    envio = _envio(status_history={"date_handling": "2026-11-03T11:00:00.000-04:00"})
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": envio})
    assert pacotes[0]["data_venda"] == "2026-11-03T12:00:00-03:00"


def test_ml_sem_data_de_pagamento_usa_a_criacao():
    pacotes, _ = agentes.pacotes_ml(["1"], {"1": _envio(status_history={})})
    assert pacotes[0]["data_venda"] == "2026-11-03T09:00:00-03:00"


def test_ml_envio_que_nao_respondeu_vira_erro_e_nao_some():
    pacotes, erros = agentes.pacotes_ml(["1"], {"1": None})
    assert pacotes == []
    assert erros == ["mercado_livre: envio 1 sem resposta"]


# --- Shopee ------------------------------------------------------------------------
def _pedido(**extra):
    base = {"order_sn": "ABC", "create_time": int(datetime(2026, 11, 3, 13, 0, tzinfo=timezone.utc).timestamp()),
            "pay_time": int(datetime(2026, 11, 3, 14, 0, tzinfo=timezone.utc).timestamp()),
            "ship_by_date": int(datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc).timestamp()),
            "fulfillment_flag": "fulfilled_by_local_seller", "shipping_carrier": "Shopee Xpress",
            "buyer_username": "comprador_secreto", "recipient_address": {"name": "Comprador Secreto"},
            "package_list": [{"package_number": "P1"}]}
    return {**base, **extra}


def test_shopee_um_registro_por_pacote():
    pacotes = agentes.pacotes_shopee([_pedido(package_list=[{"package_number": "P1"}, {"package_number": "P2"}])])
    assert [p["pacote_id"] for p in pacotes] == ["P1", "P2"]


def test_shopee_pedido_sem_lista_de_pacotes_conta_um():
    pacotes = agentes.pacotes_shopee([_pedido(package_list=[])])
    assert [p["pacote_id"] for p in pacotes] == ["ABC"]


def test_shopee_enviado_pela_propria_shopee_fica_fora():
    assert agentes.pacotes_shopee([_pedido(fulfillment_flag="fulfilled_by_shopee")]) == []


def test_shopee_usa_o_pagamento_em_horario_de_brasilia():
    assert agentes.pacotes_shopee([_pedido()])[0]["data_venda"] == "2026-11-03T11:00:00-03:00"


def test_shopee_informa_a_situacao_do_pedido():
    assert agentes.pacotes_shopee([_pedido(order_status="PROCESSED")])[0]["situacao"] == "PROCESSED"


def test_shopee_sem_pagamento_usa_a_criacao():
    assert agentes.pacotes_shopee([_pedido(pay_time=0)])[0]["data_venda"] == "2026-11-03T10:00:00-03:00"


def test_shopee_so_filtra_por_status_que_a_lista_aceita(monkeypatch):
    """A consulta real recusou RETRY_SHIP como filtro e derrubou a leitura inteira da Shopee."""
    pedidos = []
    monkeypatch.setattr(agentes.shopee_client, "get",
                        lambda caminho, params: pedidos.append(params["order_status"]) or {"order_list": [], "more": False})
    agentes._coletar_shopee()
    assert pedidos == ["READY_TO_SHIP", "PROCESSED"]


# --- Coleta do Mercado Livre -----------------------------------------------------------
@pytest.fixture
def venda_paga():
    db = SessionLocal()
    venda = MercadoLivreVendaCache(order_id="ordem-teste-agentes", item_id="item", status="paid", shipment_id="envio-teste",
                                   date_created=datetime.utcnow() - timedelta(hours=2))
    db.add(venda)
    db.commit()
    yield
    db.delete(venda)
    db.commit()
    db.close()


def test_ml_busca_o_prazo_do_pacote_pendente(monkeypatch, venda_paga):
    respostas = {
        "/shipments/envio-teste": _envio(lead_time=None),
        "/shipments/envio-teste/lead_time": {"estimated_handling_limit": {"date": "2026-11-06T22:59:00.000-04:00"}},
    }
    monkeypatch.setattr(agentes.ml, "sync_vendas", lambda incremental: {})
    monkeypatch.setattr(agentes.ml, "get_access_token", lambda: "token")
    monkeypatch.setattr(agentes.ml, "_get_raw", lambda caminho, params, token: respostas.get(caminho))
    pacotes, erros = agentes._coletar_ml()
    assert erros == []
    assert [p["limite_envio"] for p in pacotes if p["pacote_id"] == "envio-teste"] == ["2026-11-06T23:59:00-03:00"]


def test_ml_sem_prazo_ainda_conta_o_pacote(monkeypatch, venda_paga):
    respostas = {"/shipments/envio-teste": _envio(lead_time=None)}
    monkeypatch.setattr(agentes.ml, "sync_vendas", lambda incremental: {})
    monkeypatch.setattr(agentes.ml, "get_access_token", lambda: "token")
    monkeypatch.setattr(agentes.ml, "_get_raw", lambda caminho, params, token: respostas.get(caminho))
    pacotes, _ = agentes._coletar_ml()
    assert [p["limite_envio"] for p in pacotes if p["pacote_id"] == "envio-teste"] == [None]


# --- Resposta completa --------------------------------------------------------------
def test_falha_em_uma_plataforma_aparece_e_nao_esconde_a_outra(monkeypatch):
    def quebra():
        raise RuntimeError("Shopee /api/v2/order/get_order_list: error_param invalid cursor")

    pacote = {"plataforma": "mercado_livre", "pacote_id": "1", "data_venda": "2026-11-03T10:00:00-03:00"}
    monkeypatch.setattr(agentes, "_coletar_ml", lambda: ([pacote], []))
    monkeypatch.setattr(agentes, "_coletar_shopee", quebra)
    resultado = agentes.listar_envios_pendentes()
    assert resultado["pacotes"] == [pacote]
    assert resultado["erros"] == ["shopee: Shopee /api/v2/order/get_order_list: error_param invalid cursor"]


def test_erro_nunca_expoe_token(monkeypatch):
    def quebra():
        raise RuntimeError("falhou https://api?access_token=SEGREDO&sign=ASSINATURA&shop_id=1")

    monkeypatch.setattr(agentes, "_coletar_ml", lambda: ([], []))
    monkeypatch.setattr(agentes, "_coletar_shopee", quebra)
    erro = agentes.listar_envios_pendentes()["erros"][0]
    assert "SEGREDO" not in erro and "ASSINATURA" not in erro


def test_erro_de_outro_tipo_mostra_so_o_tipo(monkeypatch):
    def quebra():
        raise ValueError("detalhe interno")

    monkeypatch.setattr(agentes, "_coletar_ml", lambda: ([], []))
    monkeypatch.setattr(agentes, "_coletar_shopee", quebra)
    assert agentes.listar_envios_pendentes()["erros"] == ["shopee: falha na consulta (ValueError)"]


def test_pacotes_vem_do_mais_antigo_para_o_mais_novo(monkeypatch):
    novo = {"plataforma": "shopee", "pacote_id": "2", "data_venda": "2026-11-03T10:00:00-03:00"}
    velho = {"plataforma": "mercado_livre", "pacote_id": "1", "data_venda": "2026-11-01T10:00:00-03:00"}
    monkeypatch.setattr(agentes, "_coletar_ml", lambda: ([novo], []))
    monkeypatch.setattr(agentes, "_coletar_shopee", lambda: ([velho], []))
    assert [p["pacote_id"] for p in agentes.listar_envios_pendentes()["pacotes"]] == ["1", "2"]


def test_nenhum_dado_do_comprador_sai():
    ml, _ = agentes.pacotes_ml(["1"], {"1": _envio()})
    shopee = agentes.pacotes_shopee([_pedido()])
    for pacote in ml + shopee:
        assert set(pacote) == CAMPOS_PERMITIDOS
        assert "Secreto" not in str(pacote) and "secreto" not in str(pacote)


# --- Anúncios sem promoção (Rafael) ---------------------------------------------------
ROTA_PROMOCOES = "/api/agentes/anuncios-sem-promocao"


def _promo(tipo="DEAL", status="started"):
    return {"id": "P1", "type": tipo, "status": status}


def _sem_promocao(promocoes):
    anuncios, erros = agentes.anuncios_sem_promocao([("MLB1", "SKU-1")], {"MLB1": promocoes})
    return anuncios, erros


def test_anuncio_sem_nenhuma_promocao_entra_na_lista():
    assert _sem_promocao([]) == ([{"sku": "SKU-1", "mlb": "MLB1"}], [])


def test_anuncio_so_com_desconto_proprio_entra_na_lista():
    assert _sem_promocao([_promo("PRICE_DISCOUNT")])[0] == [{"sku": "SKU-1", "mlb": "MLB1"}]


def test_anuncio_com_desconto_e_campanha_nao_entra():
    assert _sem_promocao([_promo("PRICE_DISCOUNT"), _promo("DEAL")])[0] == []


@pytest.mark.parametrize("tipo", ["DEAL", "SMART", "MARKETPLACE_CAMPAIGN", "SELLER_CAMPAIGN", "LIGHTNING", "DOD"])
def test_campanha_ativa_conta_como_promocao(tipo):
    assert _sem_promocao([_promo(tipo)])[0] == []


def test_campanha_agendada_conta_como_promocao():
    assert _sem_promocao([_promo(status="pending")])[0] == []


@pytest.mark.parametrize("status", ["candidate", "finished"])
def test_campanha_so_elegivel_ou_encerrada_nao_conta(status):
    assert len(_sem_promocao([_promo(status=status)])[0]) == 1


def test_resposta_no_formato_results_tambem_vale():
    assert _sem_promocao({"results": [_promo()]})[0] == []


def test_anuncio_que_nao_respondeu_vira_aviso_e_nao_entra_na_lista():
    anuncios, erros = _sem_promocao(None)
    assert anuncios == []
    assert erros == ["mercado_livre: 1 anúncio(s) sem resposta"]


def test_lista_vem_ordenada_por_sku():
    itens = [("MLB2", "B"), ("MLB1", "A"), ("MLB3", None)]
    anuncios, _ = agentes.anuncios_sem_promocao(itens, {"MLB1": [], "MLB2": [], "MLB3": []})
    assert [a["mlb"] for a in anuncios] == ["MLB3", "MLB1", "MLB2"]


@pytest.fixture
def anuncios_no_cache():
    db = SessionLocal()
    linhas = [MercadoLivreItemCache(item_id="MLBAGENTE1", status="active", sku="ATIVO"),
              MercadoLivreItemCache(item_id="MLBAGENTE2", status="paused", sku="PAUSADO")]
    db.add_all(linhas)
    db.commit()
    yield
    for linha in linhas:
        db.delete(linha)
    db.commit()
    db.close()


def test_so_consulta_anuncios_ativos(monkeypatch, anuncios_no_cache):
    consultados = []

    def responde(caminho, params, token):
        consultados.append(caminho)
        return []

    monkeypatch.setattr(agentes.ml, "get_access_token", lambda: "token")
    monkeypatch.setattr(agentes.ml, "_get_raw", responde)
    resultado = agentes.listar_anuncios_sem_promocao()
    assert "/seller-promotions/items/MLBAGENTE1" in consultados
    assert "/seller-promotions/items/MLBAGENTE2" not in consultados
    assert {"sku": "ATIVO", "mlb": "MLBAGENTE1"} in resultado["anuncios"]
    assert resultado["total_ativos"] >= 1


def test_sem_autorizacao_avisa_em_vez_de_dizer_que_esta_tudo_certo(monkeypatch):
    monkeypatch.setattr(agentes.ml, "get_access_token", lambda: None)
    resultado = agentes.listar_anuncios_sem_promocao()
    assert resultado["anuncios"] == []
    assert resultado["erros"] == ["mercado_livre: sem autorização"]


def test_chave_de_agente_le_a_lista_de_promocoes(monkeypatch):
    monkeypatch.setattr(seguranca, "CHAVE_AGENTES", CHAVE)
    monkeypatch.setattr(agentes, "listar_anuncios_sem_promocao", lambda: {"anuncios": [], "erros": []})
    assert _get(ROTA_PROMOCOES).status_code == 401
    assert _get(ROTA_PROMOCOES, CHAVE).json() == {"anuncios": [], "erros": []}
