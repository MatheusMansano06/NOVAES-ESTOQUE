from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base
from app.devolucoes.dto import ReturnCaseDTO, ReturnItemDTO


def _sessao_em_memoria():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


class AdapterFalso:
    def __init__(self, casos):
        self._casos = casos

    def listar_pendentes(self):
        return self._casos

    def buscar(self, id_externo):
        return next((c for c in self._casos if c.claim_id == id_externo), None)


def test_sincronizar_cria_caso_novo_e_lista(monkeypatch):
    from app.devolucoes import service
    monkeypatch.setattr(service, "vincular_olist", lambda *a, **k: None)

    db = _sessao_em_memoria()
    caso = ReturnCaseDTO(
        marketplace="mercado_livre", conta="1", order_id="ORD1", claim_id="CLAIM1",
        status_marketplace="opened", motivo="PDD", prazo_resolucao=None,
        itens=[ReturnItemDTO(sku_esperado="SKU-1", produto_nome="Produto X", quantidade=2)],
    )

    resultado = service.sincronizar({"mercado_livre": AdapterFalso([caso])}, db=db)
    assert resultado == {"novos": 1, "atualizados": 0}

    lista = service.listar(db=db)
    assert len(lista) == 1
    assert lista[0]["claim_id"] == "CLAIM1"


def test_sincronizar_atualiza_caso_existente_sem_duplicar(monkeypatch):
    from app.devolucoes import service
    monkeypatch.setattr(service, "vincular_olist", lambda *a, **k: None)

    db = _sessao_em_memoria()
    caso_v1 = ReturnCaseDTO(marketplace="mercado_livre", conta="1", order_id="ORD1", claim_id="CLAIM1",
                             status_marketplace="opened", motivo="PDD", prazo_resolucao=None)
    service.sincronizar({"mercado_livre": AdapterFalso([caso_v1])}, db=db)

    caso_v2 = ReturnCaseDTO(marketplace="mercado_livre", conta="1", order_id="ORD1", claim_id="CLAIM1",
                             status_marketplace="closed", motivo="PDD", prazo_resolucao=None)
    resultado = service.sincronizar({"mercado_livre": AdapterFalso([caso_v2])}, db=db)

    assert resultado == {"novos": 0, "atualizados": 1}
    lista = service.listar(db=db)
    assert len(lista) == 1
    assert lista[0]["status_marketplace"] == "closed"


def test_detalhe_inclui_itens_eventos_e_olist(monkeypatch):
    from app.devolucoes import service

    chamadas = []

    def vincular_fake(db, return_case_id, sku):
        chamadas.append((return_case_id, sku))

    monkeypatch.setattr(service, "vincular_olist", vincular_fake)

    db = _sessao_em_memoria()
    caso = ReturnCaseDTO(
        marketplace="mercado_livre", conta="1", order_id="ORD1", claim_id="CLAIM1",
        status_marketplace="opened", motivo="PDD", prazo_resolucao=None,
        itens=[ReturnItemDTO(sku_esperado="SKU-1", produto_nome="Produto X", quantidade=2)],
    )
    service.sincronizar({"mercado_livre": AdapterFalso([caso])}, db=db)
    assert chamadas == [(1, "SKU-1")]

    caso_id = service.listar(db=db)[0]["id"]
    detalhe = service.detalhe(caso_id, db=db)
    assert detalhe["itens"][0]["sku_esperado"] == "SKU-1"
    assert detalhe["eventos"] == []


def test_detalhe_inexistente_retorna_none():
    from app.devolucoes import service
    db = _sessao_em_memoria()
    assert service.detalhe(999, db=db) is None
