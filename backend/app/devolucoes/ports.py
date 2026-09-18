from typing import Optional, Protocol, runtime_checkable
from app.devolucoes.dto import ReturnCaseDTO


@runtime_checkable
class ReturnsPort(Protocol):
    """Contrato que cada adapter de marketplace (ML, Shopee) deve cumprir.

    O núcleo (`service.py`) só conhece esta interface — nunca importa um
    adapter concreto diretamente.
    """

    def listar_pendentes(self) -> list[ReturnCaseDTO]:
        ...

    def buscar(self, id_externo: str) -> Optional[ReturnCaseDTO]:
        ...
