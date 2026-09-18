CLAIM_FAKE = {
    "id": "5000012345",
    "resource_id": "2000012345",
    "resource": "order",
    "status": "opened",
    "reason_id": "PDD7059",
    "due_date": "2026-09-25T00:00:00.000-04:00",
    "order_items": [
        {"item": {"seller_sku": "SKU-1", "title": "Produto X"}, "quantity": 2},
    ],
}

RETURN_FAKE = {
    "id": "return-1",
    "last_updated": "2026-09-18T10:00:00.000-04:00",
    "shipping": {"status": "shipped", "substatus": "in_transit"},
}


def test_normalizar_claim_produz_dto_com_itens():
    from app.devolucoes.adapters.mercado_livre import normalizar_claim
    from app.devolucoes.dto import ReturnItemDTO

    dto = normalizar_claim(CLAIM_FAKE)

    assert dto.marketplace == "mercado_livre"
    assert dto.order_id == "2000012345"
    assert dto.claim_id == "5000012345"
    assert dto.status_marketplace == "opened"
    assert dto.motivo == "PDD7059"
    assert dto.itens == [ReturnItemDTO(sku_esperado="SKU-1", produto_nome="Produto X", quantidade=2)]


def test_normalizar_eventos_le_shipping():
    from app.devolucoes.adapters.mercado_livre import normalizar_eventos

    eventos = normalizar_eventos(RETURN_FAKE)

    assert len(eventos) == 1
    assert eventos[0].status == "shipped"
    assert eventos[0].origem == "marketplace"


def test_adapter_satisfaz_returns_port():
    from app.devolucoes.ports import ReturnsPort
    from app.devolucoes.adapters.mercado_livre import MercadoLivreReturnsAdapter

    assert isinstance(MercadoLivreReturnsAdapter(), ReturnsPort)
