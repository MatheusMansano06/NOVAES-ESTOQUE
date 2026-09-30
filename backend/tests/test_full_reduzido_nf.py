"""Caso real (Motor Fazer): FULL original 40 foi zerado por falta de estoque; chega NF de 300.
Sem marcar, segura 0 (respeita o FULL atual). Marcando "segurar o original", volta a 40 e segura 40."""

import uuid
from types import SimpleNamespace

from app import main
from app.models import EmbaleFU, HistoricoFullEmbale, ItemEmbaleFU
from database import SessionLocal

REQ = SimpleNamespace(headers={"x-operator-name": "Conferente"})


def test_full_reduzido_so_segura_original_se_marcado():
    db = SessionLocal()
    pid = f"teste-{uuid.uuid4().hex[:8]}"
    e = EmbaleFU(nome_embalde="teste", arquivo_original="t.pdf", arquivo_uuid=f"t-{uuid.uuid4()}")
    db.add(e)
    db.flush()
    it = ItemEmbaleFU(embalde_id=e.id, titulo_anuncio="Motor", sku_inbound="MOTORX", quantidade_separada=40,
                      quantidade_baixar=0, olist_produto_id=pid)
    db.add(it)
    db.commit()
    eid, iid = e.id, it.id
    try:
        assert main._calcular_reserva_inbound(db, pid, "", disponivel=300)[0] == 0
        red = main._itens_full_reduzidos(db, pid, "")
        assert [(r["item_id"], r["original"], r["atual"]) for r in red] == [(iid, 40, 0)]

        main._restaurar_full_original(db, REQ, [iid], pid, "")
        db.flush()
        reserva, _ = main._calcular_reserva_inbound(db, pid, "", disponivel=300, aplicar=True)
        assert reserva == 40
        db.commit()
        assert db.get(ItemEmbaleFU, iid).baixa_aplicada == 1
        assert main._itens_full_reduzidos(db, pid, "") == []
    finally:
        db.rollback()
        db.query(HistoricoFullEmbale).filter_by(item_id=iid).delete()
        db.query(ItemEmbaleFU).filter_by(id=iid).delete()
        db.query(EmbaleFU).filter_by(id=eid).delete()
        db.commit()
        db.close()
