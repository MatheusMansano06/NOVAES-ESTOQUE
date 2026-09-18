from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ReturnItemDTO:
    sku_esperado: str
    produto_nome: str
    quantidade: int


@dataclass
class TrackingEventDTO:
    status: str
    origem: str  # "marketplace" | "olist"
    data_hora: str
    descricao: str = ""


@dataclass
class ReturnCaseDTO:
    marketplace: str  # "mercado_livre" | "shopee"
    conta: str
    order_id: str
    claim_id: str
    status_marketplace: str
    motivo: str
    prazo_resolucao: Optional[str]
    itens: list[ReturnItemDTO] = field(default_factory=list)
    eventos: list[TrackingEventDTO] = field(default_factory=list)
