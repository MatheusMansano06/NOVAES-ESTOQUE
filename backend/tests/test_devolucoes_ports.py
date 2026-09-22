def test_dataclasses_tem_defaults_de_lista_vazia():
    from app.devolucoes.dto import ReturnCaseDTO

    dto = ReturnCaseDTO(
        marketplace="mercado_livre", conta="1", order_id="O1", claim_id="C1",
        status_marketplace="opened", motivo="PDD", prazo_resolucao=None,
    )
    assert dto.itens == []
    assert dto.eventos == []


def test_adapter_completo_satisfaz_o_protocolo():
    from app.devolucoes.ports import ReturnsPort
    from app.devolucoes.dto import ReturnCaseDTO

    class AdapterCompleto:
        def listar_pendentes(self) -> list[ReturnCaseDTO]:
            return []

        def buscar(self, id_externo: str):
            return None

    assert isinstance(AdapterCompleto(), ReturnsPort)


def test_adapter_incompleto_nao_satisfaz_o_protocolo():
    from app.devolucoes.ports import ReturnsPort

    class AdapterIncompleto:
        def listar_pendentes(self):
            return []

    assert not isinstance(AdapterIncompleto(), ReturnsPort)
