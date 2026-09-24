"""Mudança do "Vai pro FULL" por operador vira pedido pendente: bloqueia baixa/balanço até o master decidir."""

import uuid

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from app import main
from app.models import EmbaleFU, HistoricoFullEmbale, ItemEmbaleFU
from database import SessionLocal

app_teste = Starlette(routes=[
    Route("/e/{embale_id}/i/{item_id}/qtd", main.ajustar_quantidade_full_embale, methods=["POST"]),
    Route("/e/{embale_id}/i/{item_id}/balancear", main.balancear_item_embale, methods=["POST"]),
    Route("/e/{embale_id}/h/{hist_id}/decidir", main.decidir_pedido_full_embale, methods=["POST"]),
])
cliente = TestClient(app_teste)
OPERADOR = {"x-operator-role": "operador", "x-operator-name": "Joao"}
MASTER = {"x-operator-role": "master"}


def test_operador_pede_master_aprova():
    db = SessionLocal()
    e = EmbaleFU(nome_embalde="teste", arquivo_original="t.pdf", arquivo_uuid=f"t-{uuid.uuid4()}")
    db.add(e)
    db.flush()
    it = ItemEmbaleFU(embalde_id=e.id, titulo_anuncio="Viseira", quantidade_separada=100, olist_produto_id="1")
    db.add(it)
    db.commit()
    eid, iid = e.id, it.id
    db.close()
    try:
        r = cliente.post(f"/e/{eid}/i/{iid}/qtd", json={"quantidade_full": 80}, headers=OPERADOR).json()
        assert r["pendente"] is True and r["quantidade_full"] == 100  # não aplicou

        # bloqueado até decidir (antes de chamar a Olist)
        b = cliente.post(f"/e/{eid}/i/{iid}/balancear", json={"quantidade_real": 50}, headers=OPERADOR)
        assert b.status_code == 409

        db = SessionLocal()
        h = db.query(HistoricoFullEmbale).filter_by(item_id=iid, status="pendente").one()
        hid = h.id
        db.close()

        assert cliente.post(f"/e/{eid}/h/{hid}/decidir", json={"aprovar": True}, headers=OPERADOR).status_code == 403
        assert cliente.post(f"/e/{eid}/h/{hid}/decidir", json={"aprovar": True}, headers=MASTER).json()["status"] == "aprovado"

        db = SessionLocal()
        assert db.get(ItemEmbaleFU, iid).quantidade_baixar == 80
        assert main._pedido_full_pendente(db, iid) is None
        db.close()
    finally:
        db = SessionLocal()
        db.query(HistoricoFullEmbale).filter_by(item_id=iid).delete()
        db.query(ItemEmbaleFU).filter_by(id=iid).delete()
        db.query(EmbaleFU).filter_by(id=eid).delete()
        db.commit()
        db.close()
