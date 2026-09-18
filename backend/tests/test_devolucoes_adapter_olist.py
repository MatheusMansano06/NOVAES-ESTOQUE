from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base


def _sessao_em_memoria():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_vincular_olist_resolve_produto_e_cmv(monkeypatch):
    from app.models import CustoProduto
    from app.devolucoes.models import ReturnCase
    import app.devolucoes.adapters.olist as olist_adapter

    monkeypatch.setattr(olist_adapter.olist, "buscar_produtos",
                         lambda termo, limite_resultados=1: [{"id": "999", "nome": "Produto X"}])
    monkeypatch.setattr(olist_adapter.olist, "obter_estoque",
                         lambda produto_id: {"saldo": 10, "reservado": 2, "disponivel": 8})

    db = _sessao_em_memoria()
    db.add(CustoProduto(produto_chave="SKU-1", custo=42.5))
    caso = ReturnCase(marketplace="mercado_livre", conta="1", order_id="O1", claim_id="C1",
                       status_marketplace="opened", motivo="", correlation_id="mercado_livre:C1")
    db.add(caso)
    db.commit()

    link = olist_adapter.vincular_olist(db, caso.id, "SKU-1")

    assert link.produto_id_olist == "999"
    assert link.produto_nome_olist == "Produto X"
    assert link.cmv == 42.5
    assert link.estoque_disponivel == 8


def test_vincular_olist_sem_produto_encontrado_nao_quebra(monkeypatch):
    from app.devolucoes.models import ReturnCase
    import app.devolucoes.adapters.olist as olist_adapter

    monkeypatch.setattr(olist_adapter.olist, "buscar_produtos", lambda termo, limite_resultados=1: [])

    db = _sessao_em_memoria()
    caso = ReturnCase(marketplace="mercado_livre", conta="1", order_id="O1", claim_id="C1",
                       status_marketplace="opened", motivo="", correlation_id="mercado_livre:C1")
    db.add(caso)
    db.commit()

    link = olist_adapter.vincular_olist(db, caso.id, "SKU-INEXISTENTE")

    assert link.produto_id_olist == ""
    assert link.cmv == 0.0
