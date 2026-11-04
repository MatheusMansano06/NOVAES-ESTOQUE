"""A porta dos agentes só lê, abre com a chave certa e nunca entrega dados do comprador."""
from datetime import datetime, timezone

import pytest
from starlette.testclient import TestClient

from app import agentes, seguranca
from app.main import app

ROTA = "/api/agentes/envios-pendentes"
CHAVE = "chave-de-teste-dos-agentes"
CAMPOS_PERMITIDOS = {"plataforma", "pacote_id", "data_venda", "limite_envio", "logistica"}


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
def _envio(status="ready_to_ship", logistica="cross_docking", **extra):
    base = {"status": status, "logistic_type": logistica,
            "date_created": "2026-11-03T08:00:00.000-04:00",
            "status_history": {"date_handling": "2026-11-03T09:00:00.000-04:00"},
            "shipping_option": {"estimated_handling_limit": {"date": "2026-11-05T22:59:00.000-04:00"}},
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


def test_shopee_sem_pagamento_usa_a_criacao():
    assert agentes.pacotes_shopee([_pedido(pay_time=0)])[0]["data_venda"] == "2026-11-03T10:00:00-03:00"


# --- Resposta completa --------------------------------------------------------------
def test_falha_em_uma_plataforma_aparece_e_nao_esconde_a_outra(monkeypatch):
    def quebra():
        raise RuntimeError("https://api?access_token=SEGREDO")

    pacote = {"plataforma": "mercado_livre", "pacote_id": "1", "data_venda": "2026-11-03T10:00:00-03:00"}
    monkeypatch.setattr(agentes, "_coletar_ml", lambda: ([pacote], []))
    monkeypatch.setattr(agentes, "_coletar_shopee", quebra)
    resultado = agentes.listar_envios_pendentes()
    assert resultado["pacotes"] == [pacote]
    assert resultado["erros"] == ["shopee: falha na consulta (RuntimeError)"]


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
