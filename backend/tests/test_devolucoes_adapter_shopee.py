RETURN_FAKE = {
    "return_id": 998877,
    "order_sn": "SHOP-ORD-1",
    "return_status": "REQUESTED",
    "reason": "ARRIVED_DAMAGED",
    "return_creation_time": 1758196800,  # 2026-09-18T12:00:00Z
    "shop_id": "555",
    "item_list": [
        {"item_sku": "SKU-2", "item_name": "Produto Y", "amount": 1},
    ],
}


def test_normalizar_return_produz_dto_com_itens():
    from app.devolucoes.adapters.shopee import normalizar_return

    dto = normalizar_return(RETURN_FAKE)

    assert dto.marketplace == "shopee"
    assert dto.order_id == "SHOP-ORD-1"
    assert dto.claim_id == "998877"
    assert dto.status_marketplace == "REQUESTED"
    assert dto.motivo == "ARRIVED_DAMAGED"
    assert dto.prazo_resolucao is None  # sem return_expiry_time no fake
    assert len(dto.itens) == 1
    assert dto.itens[0].sku_esperado == "SKU-2"
    assert dto.itens[0].quantidade == 1


def test_adapter_satisfaz_returns_port():
    from app.devolucoes.ports import ReturnsPort
    from app.devolucoes.adapters.shopee import ShopeeReturnsAdapter

    assert isinstance(ShopeeReturnsAdapter(), ReturnsPort)
