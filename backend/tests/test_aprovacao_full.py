"""Mudança do "Vai pro FULL" vale na hora para qualquer operador e fica registrada no histórico."""

import uuid

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from app import seguranca
from app.rotas import inbound
from app.models import EmbaleFU, HistoricoFullEmbale, ItemEmbaleFU
from database import SessionLocal

app_teste = Starlette(routes=[
    Route("/api/e/{embale_id}/i/{item_id}/qtd", inbound.ajustar_quantidade_full_embale, methods=["POST"]),
    Route("/api/e/{embale_id}/i/{item_id}/balancear", inbound.balancear_item_embale, methods=["POST"]),
    Route("/api/e/{embale_id}/h/{hist_id}/decidir", inbound.decidir_pedido_full_embale, methods=["POST"]),
])
cliente = TestClient(seguranca.ProtecaoApi(app_teste))
OPERADOR = {"Cookie": f"{seguranca.COOKIE}={seguranca.criar_sessao(7, 'Joao', 'operador')}"}


def test_operador_altera_direto_e_fica_no_historico():
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
        r = cliente.post(f"/api/e/{eid}/i/{iid}/qtd", json={"quantidade_full": 80}, headers=OPERADOR).json()
        assert r["sucesso"] is True and r["quantidade_full"] == 80  # aplicou direto

        db = SessionLocal()
        assert db.get(ItemEmbaleFU, iid).quantidade_baixar == 80
        h = db.query(HistoricoFullEmbale).filter_by(item_id=iid).one()
        assert (h.status, h.quantidade_anterior, h.quantidade_nova, h.solicitante) == ("aprovado", 100, 80, "Joao")
        assert inbound._pedido_full_pendente(db, iid) is None
        db.close()
    finally:
        db = SessionLocal()
        db.query(HistoricoFullEmbale).filter_by(item_id=iid).delete()
        db.query(ItemEmbaleFU).filter_by(id=iid).delete()
        db.query(EmbaleFU).filter_by(id=eid).delete()
        db.commit()
        db.close()
