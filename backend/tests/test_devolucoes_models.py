from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base


def _sessao_em_memoria():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_return_case_com_item_evento_e_olist_link_round_trip():
    from app.devolucoes.models import ReturnCase, ReturnItem, TrackingEvent, OlistLink

    db = _sessao_em_memoria()
    caso = ReturnCase(
        marketplace="mercado_livre",
        conta="123456",
        order_id="ORD-1",
        claim_id="CLAIM-1",
        status_marketplace="opened",
        motivo="PDD",
        correlation_id="mercado_livre:CLAIM-1",
    )
    caso.itens.append(ReturnItem(sku_esperado="SKU-1", produto_nome="Produto X", quantidade=2))
    caso.eventos.append(TrackingEvent(status="shipped", origem="marketplace", data_hora="2026-09-18T10:00:00Z"))
    db.add(caso)
    db.commit()

    link = OlistLink(return_case_id=caso.id, sku="SKU-1", cmv=42.5)
    db.add(link)
    db.commit()

    recarregado = db.query(ReturnCase).filter(ReturnCase.claim_id == "CLAIM-1").one()
    assert recarregado.itens[0].sku_esperado == "SKU-1"
    assert recarregado.eventos[0].status == "shipped"
    assert recarregado.olist_link.cmv == 42.5


def test_correlation_id_e_obrigatorio():
    from app.devolucoes.models import ReturnCase
    db = _sessao_em_memoria()
    db.add(ReturnCase(marketplace="shopee", conta="1", order_id="O1", claim_id="C1",
                       status_marketplace="", motivo="", correlation_id="shopee:C1"))
    db.commit()
    assert db.query(ReturnCase).count() == 1
