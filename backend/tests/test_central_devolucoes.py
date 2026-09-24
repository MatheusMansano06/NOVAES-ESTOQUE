"""Encanamento da Central de Devoluções dentro do estoque: rotas /api/central, banco próprio, conferência e
evidência. Plataformas não são chamadas (Olist fora do ar aparece como erro na tela, não quebra a conferência)."""

import os
import tempfile
from datetime import datetime

_tmp = tempfile.mkdtemp()
os.environ["CENTRAL_DATABASE_URL"] = f"sqlite:///{_tmp}/central.db"
os.environ["CENTRAL_UPLOADS_DIR"] = _tmp
os.environ.update(OLIST_DEPOSITO_VENDAVEL="1", OLIST_DEPOSITO_AVARIA_MERCADO_LIVRE="2", OLIST_DEPOSITO_AVARIA_SHOPEE="3")

import pytest  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.central import routes  # noqa: E402
from app.central.devolucoes import servico as devolucoes  # noqa: E402
from app.central.olist import servico as olist  # noqa: E402

cliente = TestClient(Starlette(routes=routes.rotas))


def _registro(**extra) -> dict:
    agora = datetime(2026, 9, 20, 12)
    return {
        "plataforma": "mercado_livre", "id_externo": "C1", "pedido": "2000001", "pacote": None, "rastreio": "BR123456789BR",
        "etapa": "entregue", "status_plataforma": "delivered", "em_mediacao": False, "pode_contestar": True,
        "motivo": "defeito", "motivo_plataforma": "PDD", "responsavel": "vendedor", "destino": "vendedor",
        "valor_reembolso": 99.9, "custo_plataforma": 20.0, "afeta_reputacao": False, "condicao_produto": None,
        "resultado_mediacao": None, "cobertura_aplicada": None, "prazo_vendedor": agora,
        "itens": [{"sku": "SKU-1", "quantidade": 1}], "aberta_em": agora, "atualizada_em": agora, "bruto": {},
        "codigos": ["BR123456789BR", "2000001"], **extra,
    }


@pytest.fixture(autouse=True)
def sem_olist(monkeypatch):
    def fora(*_a, **_k):
        raise RuntimeError("Olist fora do ar")
    monkeypatch.setattr(olist, "pedidos_do_marketplace", fora)


def test_fluxo_conferencia():
    devolucoes.salvar([_registro()])
    lista = cliente.get("/api/central/devolucoes").json()
    assert [d["id_externo"] for d in lista] == ["C1"]
    dev_id = lista[0]["id"]

    tela = cliente.get("/api/central/conferencia/BR123456789BR").json()
    assert tela[0]["devolucao"]["id"] == dev_id and tela[0]["olist"]["erro"] == "Olist fora do ar"

    # Produto voltou avariado (nosso, não revendável) → classe B, entra na avaria do ML e vale contestar.
    r = cliente.post(f"/api/central/conferencia/{dev_id}", json={
        "produto_correto": True, "completo": True, "sem_uso": False, "revendavel": False})
    assert r.status_code == 200, r.text
    assert r.json()["classe"] == "B" and r.json()["contestar"] is True
    assert r.json()["lancamentos"][0]["deposito_olist"] == 2

    assert cliente.post(f"/api/central/conferencia/{dev_id}", json={"produto_correto": True}).status_code == 422
    assert cliente.post("/api/central/conferencia/999", json={
        "produto_correto": True, "completo": True, "sem_uso": True, "revendavel": True}).status_code == 404

    up = cliente.post(f"/api/central/conferencia/{dev_id}/evidencias",
                      files={"arquivo": ("x.png", b"\x89PNG fake", "image/png")})
    assert up.status_code == 200, up.text
    assert cliente.get(f"/api/central/conferencia/evidencias/{up.json()['id']}").content == b"\x89PNG fake"
    assert cliente.post(f"/api/central/conferencia/{dev_id}/evidencias",
                        files={"arquivo": ("x.exe", b"MZ", "application/x-msdownload")}).status_code == 422

    assert cliente.get("/api/central/operacao?destino=vendedor").status_code == 200
    assert cliente.get("/api/central/operacao/atencao").status_code == 200
    assert cliente.get("/api/central/bi/resumo?dias=30").status_code == 200
    assert cliente.get("/api/central/bi/resumo?dias=0").status_code == 422


def test_envio_a_caminho():
    from app.central.operacao.regras import envio
    ml = lambda st: {"devolucao": {"status": st}}  # noqa: E731
    assert envio("mercado_livre", ml("label_generated")) == "aguardando_postagem"
    assert envio("mercado_livre", ml("shipped")) == "postado"
    sp = lambda st, rl=None: {"devolucao": {"status": st, "rastreio_reverso": rl and {"reverse_logistics_status": rl}}}  # noqa: E731
    assert envio("shopee", sp("PROCESSING")) == "aguardando_postagem"
    assert envio("shopee", sp("ACCEPTED", "LOGISTICS_PICKUP_DONE")) == "postado"
    assert envio("shopee", sp("ACCEPTED", "LOGISTICS_PENDING_ARRANGE")) == "aguardando_postagem"
    assert envio("shopee", sp("ACCEPTED")) == "sem_info"

    devolucoes.salvar([_registro(id_externo="C2", etapa="em_transito", rastreio="BR999999999BR", codigos=[],
                                 bruto={"devolucao": {"status": "shipped"}})])
    r = cliente.get("/api/central/operacao?status=a_caminho&envio=postado").json()
    assert r["a_caminho"]["mercado_livre"]["postado"] == 1 and [l["id_externo"] for l in r["itens"]] == ["C2"]
