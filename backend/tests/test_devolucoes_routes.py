# backend/tests/test_devolucoes_routes.py
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient
from app.devolucoes.routes import listar_devolucoes, detalhe_devolucao, sincronizar_devolucoes
import app.devolucoes.service as service

app_teste = Starlette(routes=[
    Route("/api/devolucoes", listar_devolucoes, methods=["GET"]),
    Route("/api/devolucoes/sincronizar", sincronizar_devolucoes, methods=["POST"]),
    Route("/api/devolucoes/{id:int}", detalhe_devolucao, methods=["GET"]),
])
cliente = TestClient(app_teste)


def test_listar_devolucoes_retorna_o_que_o_service_devolve(monkeypatch):
    monkeypatch.setattr(service, "listar", lambda: [{"id": 1, "marketplace": "mercado_livre"}])
    resp = cliente.get("/api/devolucoes")
    assert resp.status_code == 200
    assert resp.json() == [{"id": 1, "marketplace": "mercado_livre"}]


def test_detalhe_devolucao_inexistente_retorna_404(monkeypatch):
    monkeypatch.setattr(service, "detalhe", lambda return_case_id: None)
    resp = cliente.get("/api/devolucoes/999")
    assert resp.status_code == 404


def test_sincronizar_chama_service_com_os_dois_adapters(monkeypatch):
    recebido = {}

    def sincronizar_fake(adapters):
        recebido["chaves"] = sorted(adapters.keys())
        return {"novos": 0, "atualizados": 0}

    monkeypatch.setattr(service, "sincronizar", sincronizar_fake)
    resp = cliente.post("/api/devolucoes/sincronizar")
    assert resp.status_code == 200
    assert resp.json() == {"novos": 0, "atualizados": 0}
    assert recebido["chaves"] == ["mercado_livre", "shopee"]
