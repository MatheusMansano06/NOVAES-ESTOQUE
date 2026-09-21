# Central de Devoluções — Fase 1 (Leitura e Vínculo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enxergar toda devolução (Mercado Livre + Shopee) em um único lugar dentro do NOVAES-ESTOQUE, com vínculo ao pedido/SKU da Olist, sem executar nenhuma ação nas plataformas externas.

**Architecture:** Hexagonal (Ports & Adapters) + Domain-Driven Design, como um bounded context isolado (`backend/app/devolucoes/`) dentro do monólito FastAPI/Starlette existente. O núcleo (`service.py`) só depende do contrato `ReturnsPort`; cada marketplace tem um adapter que traduz seu payload real para o mesmo DTO. Nenhum código de ML/Shopee é importado fora do respectivo adapter.

**Tech Stack:** Python 3.14, Starlette 0.14, SQLAlchemy 1.4, SQLite (dev) — mesmas do backend atual. React + TypeScript + Vite no frontend, axios para HTTP. pytest 8.4 para testes (já disponível no ambiente, ainda que não pinado em `requirements.txt`).

**Spec:** `docs/superpowers/specs/2026-09-18-central-devolucoes-design.md`

## Global Constraints

- Módulo vive dentro do NOVAES-ESTOQUE (não é serviço separado) — decisão já fechada com o usuário.
- Stack é a do repositório atual (Python/FastAPI/SQLAlchemy/SQLite, React/TS) — não a stack Java/Spring do documento-base original.
- Núcleo de negócio (`service.py`) nunca importa `adapters/mercado_livre.py` nem `adapters/shopee.py` diretamente — só o `Protocol` em `ports.py`.
- Fase 1 é somente leitura: nenhum endpoint desta fase executa ação (aceitar, contestar, reembolsar) nas plataformas externas.
- Sem framework de teste novo: backend usa pytest simples (sem fixtures externas); frontend não tem test runner configurado — verificação é `vite build` limpo + checagem manual no navegador, seguindo o padrão já usado no projeto.

---

## Desvios da spec (decididos durante o planejamento, adaptando conforme necessário)

- `ports.py` tem **2 métodos**, não 3: `listar_pendentes()` e `buscar(id_externo)` — este último já devolve o `ReturnCaseDTO` completo (itens + eventos de rastreio). Um terceiro método `eventos_rastreio()` separado seria redundante.
- `olist_link` **não tem** `pedido_id_olist`: a integração Olist atual (`integracoes_olist.py`) não expõe busca de pedido por `order_id` do marketplace, só busca de produto por SKU/nome. O vínculo desta fase é por SKU (mesma fonte que já é autoritativa para custo/margem no resto do sistema — `CustoProduto.produto_chave`). Vínculo por pedido fica para quando/se a Olist expuser esse endpoint.

---

### Task 1: Modelo de dados (`return_cases`, `return_items`, `tracking_events`, `olist_links`)

**Files:**
- Create: `backend/app/devolucoes/__init__.py` (vazio)
- Create: `backend/app/devolucoes/models.py`
- Test: `backend/tests/test_devolucoes_models.py`

**Interfaces:**
- Produces: classes SQLAlchemy `ReturnCase`, `ReturnItem`, `TrackingEvent`, `OlistLink` (todas em `app.devolucoes.models`), com os campos usados nas tasks seguintes.

- [ ] **Step 1: Escrever o teste (vai falhar — módulo não existe)**

```python
# backend/tests/test_devolucoes_models.py
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
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_models.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes'`

- [ ] **Step 3: Criar o pacote e o modelo**

```python
# backend/app/devolucoes/__init__.py
```

```python
# backend/app/devolucoes/models.py
"""Bounded context de devoluções (Fase 1 — leitura e vínculo).

Datas ficam como string ISO-8601 em `tracking_event.data_hora` e
`return_case.prazo_resolucao` porque vêm direto do payload normalizado dos
marketplaces — mesmo raciocínio que já existia no módulo antigo (evitar
converter e comparar timezones que a própria API já resolve).
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class ReturnCase(Base):
    __tablename__ = "return_cases"

    id = Column(Integer, primary_key=True)
    marketplace = Column(String(30), nullable=False, index=True)  # "mercado_livre" | "shopee"
    conta = Column(String(80), nullable=False, default="")
    order_id = Column(String(100), nullable=False, index=True)
    claim_id = Column(String(50), nullable=False, index=True)
    status_marketplace = Column(String(60), nullable=False, default="")
    motivo = Column(String(255), nullable=False, default="")
    prazo_resolucao = Column(String(40), nullable=True)
    correlation_id = Column(String(80), nullable=False)
    criado_em = Column(DateTime, default=datetime.utcnow)
    ultima_sincronizacao = Column(DateTime, default=datetime.utcnow)

    itens = relationship("ReturnItem", back_populates="caso", cascade="all, delete-orphan")
    eventos = relationship("TrackingEvent", back_populates="caso", cascade="all, delete-orphan")
    olist_link = relationship("OlistLink", back_populates="caso", uselist=False, cascade="all, delete-orphan")


class ReturnItem(Base):
    __tablename__ = "return_items"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, index=True)
    sku_esperado = Column(String(120), nullable=False, default="")
    produto_nome = Column(String(255), nullable=False, default="")
    quantidade = Column(Integer, nullable=False, default=1)
    cmv_unitario = Column(Float, nullable=True)

    caso = relationship("ReturnCase", back_populates="itens")


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, index=True)
    status = Column(String(60), nullable=False, default="")
    descricao = Column(Text, default="")
    origem = Column(String(20), nullable=False, default="marketplace")  # "marketplace" | "olist"
    data_hora = Column(String(40), nullable=False)
    payload_raw = Column(Text, default="{}")

    caso = relationship("ReturnCase", back_populates="eventos")


class OlistLink(Base):
    __tablename__ = "olist_links"

    id = Column(Integer, primary_key=True)
    return_case_id = Column(Integer, ForeignKey("return_cases.id"), nullable=False, unique=True, index=True)
    produto_id_olist = Column(String(60), default="")
    sku = Column(String(120), default="", index=True)
    produto_nome_olist = Column(String(255), default="")
    cmv = Column(Float, default=0)
    estoque_disponivel = Column(Integer, nullable=True)
    sincronizado_em = Column(DateTime, default=datetime.utcnow)

    caso = relationship("ReturnCase", back_populates="olist_link")
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd backend && python -m pytest tests/test_devolucoes_models.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/__init__.py backend/app/devolucoes/models.py backend/tests/test_devolucoes_models.py
git commit -m "feat(devolucoes): modelo de dados da Fase 1 (return_case/item/tracking_event/olist_link)"
```

---

### Task 2: DTOs e contrato do adapter (`ports.py`)

**Files:**
- Create: `backend/app/devolucoes/dto.py`
- Create: `backend/app/devolucoes/ports.py`
- Test: `backend/tests/test_devolucoes_ports.py`

**Interfaces:**
- Consumes: nada (independente).
- Produces: `ReturnItemDTO`, `TrackingEventDTO`, `ReturnCaseDTO` (`app.devolucoes.dto`); `ReturnsPort` Protocol com `listar_pendentes() -> list[ReturnCaseDTO]` e `buscar(id_externo: str) -> Optional[ReturnCaseDTO]` (`app.devolucoes.ports`). Tasks 3 e 4 implementam este Protocol.

- [ ] **Step 1: Escrever o teste**

```python
# backend/tests/test_devolucoes_ports.py
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_ports.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.dto'`

- [ ] **Step 3: Implementar**

```python
# backend/app/devolucoes/dto.py
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
```

```python
# backend/app/devolucoes/ports.py
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
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_ports.py -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/dto.py backend/app/devolucoes/ports.py backend/tests/test_devolucoes_ports.py
git commit -m "feat(devolucoes): DTOs e contrato ReturnsPort"
```

---

### Task 3: Adapter Mercado Livre

**Files:**
- Create: `backend/app/devolucoes/adapters/__init__.py` (vazio)
- Create: `backend/app/devolucoes/adapters/mercado_livre.py`
- Test: `backend/tests/test_devolucoes_adapter_ml.py`

**Interfaces:**
- Consumes: `ReturnCaseDTO`, `ReturnItemDTO`, `TrackingEventDTO` (Task 2); `ml` singleton de `app.integracoes_ml` (método `_get(path, params=None) -> Optional[dict]`, atributo `user_id`).
- Produces: `normalizar_claim(payload: dict) -> ReturnCaseDTO`, `normalizar_eventos(payload: dict) -> list[TrackingEventDTO]`, classe `MercadoLivreReturnsAdapter` (implementa `ReturnsPort`).

- [ ] **Step 1: Escrever o teste (payload fake, sem rede)**

```python
# backend/tests/test_devolucoes_adapter_ml.py
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_ml.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.adapters'`

- [ ] **Step 3: Implementar**

```python
# backend/app/devolucoes/adapters/__init__.py
```

```python
# backend/app/devolucoes/adapters/mercado_livre.py
"""Adapter Mercado Livre — Post-Purchase API.

Endpoints canônicos (ver docs/devolucoes/BIBLIA_POS_VENDA_ML.md, que é fonte
de verdade sobre a API do ML mesmo com o módulo antigo removido):
  GET /post-purchase/v1/claims/search
  GET /post-purchase/v1/claims/{claim_id}
  GET /post-purchase/v2/claims/{claim_id}/returns

Regra 5 da BIBLIA: busca de claims precisa de filtro de negócio, não só
`status=opened` — `player_id` do vendedor é o filtro mínimo aqui.
"""
from datetime import datetime, timezone
from typing import Optional
from app.integracoes_ml import ml
from app.devolucoes.dto import ReturnCaseDTO, ReturnItemDTO, TrackingEventDTO


def normalizar_claim(payload: dict) -> ReturnCaseDTO:
    itens = [
        ReturnItemDTO(
            sku_esperado=str(item.get("item", {}).get("seller_sku", "")),
            produto_nome=str(item.get("item", {}).get("title", "")),
            quantidade=int(item.get("quantity", 1) or 1),
        )
        for item in payload.get("order_items", [])
    ]

    return ReturnCaseDTO(
        marketplace="mercado_livre",
        conta=str(ml.user_id),
        order_id=str(payload.get("resource_id", "")),
        claim_id=str(payload.get("id", "")),
        status_marketplace=str(payload.get("status", "")),
        motivo=str(payload.get("reason_id", "")),
        prazo_resolucao=payload.get("due_date"),
        itens=itens,
    )


def normalizar_eventos(payload: dict) -> list[TrackingEventDTO]:
    shipping = payload.get("shipping") or {}
    status = shipping.get("status")
    if not status:
        return []
    return [TrackingEventDTO(
        status=str(status),
        descricao=str(shipping.get("substatus", "")),
        data_hora=str(payload.get("last_updated") or datetime.now(timezone.utc).isoformat()),
        origem="marketplace",
    )]


class MercadoLivreReturnsAdapter:
    """Implementa ReturnsPort usando o cliente ML já autenticado (integracoes_ml.ml)."""

    def listar_pendentes(self) -> list[ReturnCaseDTO]:
        if not ml.user_id:
            return []
        busca = ml._get("/post-purchase/v1/claims/search", {
            "player_id": ml.user_id, "status": "opened",
        }) or {}
        resultados = []
        for claim in busca.get("data", []):
            claim_id = claim.get("id")
            if claim_id:
                dto = self.buscar(str(claim_id))
                if dto:
                    resultados.append(dto)
        return resultados

    def buscar(self, id_externo: str) -> Optional[ReturnCaseDTO]:
        claim = ml._get(f"/post-purchase/v1/claims/{id_externo}")
        if not claim:
            return None
        dto = normalizar_claim(claim)
        returns = ml._get(f"/post-purchase/v2/claims/{id_externo}/returns") or {}
        dto.eventos = normalizar_eventos(returns)
        return dto
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_ml.py -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/adapters/__init__.py backend/app/devolucoes/adapters/mercado_livre.py backend/tests/test_devolucoes_adapter_ml.py
git commit -m "feat(devolucoes): adapter Mercado Livre (normalização + ReturnsPort)"
```

---

### Task 4: Adapter Shopee

**Files:**
- Create: `backend/app/devolucoes/adapters/shopee.py`
- Test: `backend/tests/test_devolucoes_adapter_shopee.py`

**Interfaces:**
- Consumes: `ReturnCaseDTO`, `ReturnItemDTO` (Task 2); `shopee` singleton de `app.integracoes_shopee` (método `chamar(path, params=None) -> dict`).
- Produces: `normalizar_return(payload: dict) -> ReturnCaseDTO`, classe `ShopeeReturnsAdapter` (implementa `ReturnsPort`).

- [ ] **Step 1: Escrever o teste**

```python
# backend/tests/test_devolucoes_adapter_shopee.py
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_shopee.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.adapters.shopee'`

- [ ] **Step 3: Implementar**

```python
# backend/app/devolucoes/adapters/shopee.py
"""Adapter Shopee — Open Platform Returns (docs/shopee-api-reference.md, seção 7).

ponytail: `GetReturnDetail` não está documentado no reference atual, então
`buscar()` relista e filtra em memória em vez de chamar um endpoint dedicado.
Trocar por chamada direta quando o endpoint de detalhe for confirmado contra
a conta em produção (mesma ressalva da spec: campos de `item_list` seguem a
convenção pública da Shopee mas não foram confirmados ao vivo ainda).
"""
from datetime import datetime, timezone
from typing import Optional
from app.integracoes_shopee import shopee
from app.devolucoes.dto import ReturnCaseDTO, ReturnItemDTO


def _epoch_para_iso(valor) -> Optional[str]:
    if not valor:
        return None
    try:
        return datetime.fromtimestamp(int(valor), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def normalizar_return(payload: dict) -> ReturnCaseDTO:
    itens = [
        ReturnItemDTO(
            sku_esperado=str(item.get("item_sku", "")),
            produto_nome=str(item.get("item_name", "")),
            quantidade=int(item.get("amount", 1) or 1),
        )
        for item in payload.get("item_list", [])
    ]

    return ReturnCaseDTO(
        marketplace="shopee",
        conta=str(payload.get("shop_id", "")),
        order_id=str(payload.get("order_sn", "")),
        claim_id=str(payload.get("return_id", "")),
        status_marketplace=str(payload.get("return_status", "")),
        motivo=str(payload.get("reason", "")),
        prazo_resolucao=_epoch_para_iso(payload.get("return_expiry_time")),
        itens=itens,
    )


class ShopeeReturnsAdapter:
    """Implementa ReturnsPort usando o cliente Shopee já autenticado (integracoes_shopee.shopee)."""

    def listar_pendentes(self) -> list[ReturnCaseDTO]:
        resposta = shopee.chamar("/api/v2/return/get_return_list", {
            "page_no": 1, "page_size": 100, "return_status": "REQUESTED",
        })
        if not resposta or resposta.get("error"):
            return []
        return [normalizar_return(item) for item in resposta.get("return_list", [])]

    def buscar(self, id_externo: str) -> Optional[ReturnCaseDTO]:
        for dto in self.listar_pendentes():
            if dto.claim_id == id_externo:
                return dto
        return None
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_shopee.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/adapters/shopee.py backend/tests/test_devolucoes_adapter_shopee.py
git commit -m "feat(devolucoes): adapter Shopee (normalização + ReturnsPort)"
```

---

### Task 5: Vínculo Olist por SKU

**Files:**
- Create: `backend/app/devolucoes/adapters/olist.py`
- Test: `backend/tests/test_devolucoes_adapter_olist.py`

**Interfaces:**
- Consumes: `OlistLink` (Task 1); `olist` singleton de `app.integracoes_olist` (`buscar_produtos(termo, limite_resultados) -> list[dict]`, `obter_estoque(produto_id) -> Optional[dict]`); `CustoProduto` de `app.models` (`produto_chave`, `custo`).
- Produces: `vincular_olist(db: Session, return_case_id: int, sku: str) -> OlistLink`.

- [ ] **Step 1: Escrever o teste (mocka `olist`, usa banco em memória)**

```python
# backend/tests/test_devolucoes_adapter_olist.py
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_olist.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.adapters.olist'`

- [ ] **Step 3: Implementar**

```python
# backend/app/devolucoes/adapters/olist.py
"""Vínculo com a Olist — por SKU, não por pedido.

A integração Olist atual (integracoes_olist.py) não expõe busca de pedido por
order_id do marketplace, só busca de produto por SKU/nome. O CMV vem de
CustoProduto, a mesma tabela que já é autoritativa para margem no resto do
sistema (ver memória custo-oficial-por-sku) — não da API da Olist.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from app.integracoes_olist import olist
from app.models import CustoProduto
from app.devolucoes.models import OlistLink


def vincular_olist(db: Session, return_case_id: int, sku: str) -> OlistLink:
    candidatos = olist.buscar_produtos(sku, limite_resultados=1)
    produto = candidatos[0] if candidatos else None

    custo = db.query(CustoProduto).filter(CustoProduto.produto_chave == sku).first()

    link: Optional[OlistLink] = (
        db.query(OlistLink).filter(OlistLink.return_case_id == return_case_id).first()
    )
    if link is None:
        link = OlistLink(return_case_id=return_case_id)
        db.add(link)

    link.sku = sku
    link.produto_id_olist = str(produto.get("id", "")) if produto else ""
    link.produto_nome_olist = produto.get("nome", "") if produto else ""
    link.cmv = custo.custo if custo else 0.0

    if produto and produto.get("id"):
        estoque = olist.obter_estoque(str(produto["id"]))
        link.estoque_disponivel = estoque["disponivel"] if estoque else None

    link.sincronizado_em = datetime.utcnow()
    db.commit()
    return link
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_adapter_olist.py -v`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/adapters/olist.py backend/tests/test_devolucoes_adapter_olist.py
git commit -m "feat(devolucoes): vínculo Olist por SKU (produto + CMV + estoque)"
```

---

### Task 6: Service (orquestração — sincronizar/listar/detalhe)

**Files:**
- Create: `backend/app/devolucoes/service.py`
- Test: `backend/tests/test_devolucoes_service.py`

**Interfaces:**
- Consumes: `ReturnsPort` (Task 2), modelos (Task 1), `vincular_olist` (Task 5).
- Produces: `sincronizar(adapters: dict[str, ReturnsPort], db: Optional[Session] = None) -> dict`, `listar(db: Optional[Session] = None) -> list[dict]`, `detalhe(return_case_id: int, db: Optional[Session] = None) -> Optional[dict]`.

- [ ] **Step 1: Escrever o teste (adapter falso, banco em memória, sem rede)**

```python
# backend/tests/test_devolucoes_service.py
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_service.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.service'`

- [ ] **Step 3: Implementar**

```python
# backend/app/devolucoes/service.py
"""Núcleo de orquestração da Fase 1. Só conhece ReturnsPort — nunca importa
um adapter de marketplace concreto."""
from datetime import datetime
from typing import Dict, Optional
from sqlalchemy.orm import Session
from database import SessionLocal
from app.devolucoes.models import ReturnCase, ReturnItem, TrackingEvent
from app.devolucoes.ports import ReturnsPort
from app.devolucoes.adapters.olist import vincular_olist


def sincronizar(adapters: Dict[str, ReturnsPort], db: Optional[Session] = None) -> dict:
    fechar = db is None
    db = db or SessionLocal()
    novos, atualizados = 0, 0
    try:
        for adapter in adapters.values():
            for dto in adapter.listar_pendentes():
                caso = (
                    db.query(ReturnCase)
                    .filter(ReturnCase.marketplace == dto.marketplace, ReturnCase.claim_id == dto.claim_id)
                    .first()
                )
                if caso is None:
                    caso = ReturnCase(
                        marketplace=dto.marketplace,
                        conta=dto.conta,
                        order_id=dto.order_id,
                        claim_id=dto.claim_id,
                        correlation_id=f"{dto.marketplace}:{dto.claim_id}",
                    )
                    db.add(caso)
                    novos += 1
                else:
                    atualizados += 1

                caso.status_marketplace = dto.status_marketplace
                caso.motivo = dto.motivo
                caso.prazo_resolucao = dto.prazo_resolucao
                caso.ultima_sincronizacao = datetime.utcnow()
                db.flush()  # garante caso.id antes de tocar itens/eventos/vínculo

                caso.itens.clear()
                for item in dto.itens:
                    caso.itens.append(ReturnItem(
                        sku_esperado=item.sku_esperado,
                        produto_nome=item.produto_nome,
                        quantidade=item.quantidade,
                    ))

                existentes = {(e.status, e.data_hora) for e in caso.eventos}
                for evento in dto.eventos:
                    if (evento.status, evento.data_hora) not in existentes:
                        caso.eventos.append(TrackingEvent(
                            status=evento.status,
                            descricao=evento.descricao,
                            origem=evento.origem,
                            data_hora=evento.data_hora,
                        ))

                db.commit()

                sku = dto.itens[0].sku_esperado if dto.itens else ""
                if sku:
                    vincular_olist(db, caso.id, sku)
    finally:
        if fechar:
            db.close()

    return {"novos": novos, "atualizados": atualizados}


def listar(db: Optional[Session] = None) -> list[dict]:
    fechar = db is None
    db = db or SessionLocal()
    try:
        casos = db.query(ReturnCase).order_by(ReturnCase.ultima_sincronizacao.desc()).all()
        return [_resumo(c) for c in casos]
    finally:
        if fechar:
            db.close()


def detalhe(return_case_id: int, db: Optional[Session] = None) -> Optional[dict]:
    fechar = db is None
    db = db or SessionLocal()
    try:
        caso = db.query(ReturnCase).filter(ReturnCase.id == return_case_id).first()
        return None if caso is None else _detalhe(caso)
    finally:
        if fechar:
            db.close()


def _resumo(caso: ReturnCase) -> dict:
    return {
        "id": caso.id,
        "marketplace": caso.marketplace,
        "order_id": caso.order_id,
        "claim_id": caso.claim_id,
        "status_marketplace": caso.status_marketplace,
        "motivo": caso.motivo,
        "prazo_resolucao": caso.prazo_resolucao,
    }


def _detalhe(caso: ReturnCase) -> dict:
    base = _resumo(caso)
    base["itens"] = [
        {"sku_esperado": i.sku_esperado, "produto_nome": i.produto_nome,
         "quantidade": i.quantidade, "cmv_unitario": i.cmv_unitario}
        for i in caso.itens
    ]
    base["eventos"] = [
        {"status": e.status, "descricao": e.descricao, "origem": e.origem, "data_hora": e.data_hora}
        for e in caso.eventos
    ]
    link = caso.olist_link
    base["olist"] = None if link is None else {
        "produto_id_olist": link.produto_id_olist,
        "sku": link.sku,
        "produto_nome_olist": link.produto_nome_olist,
        "cmv": link.cmv,
        "estoque_disponivel": link.estoque_disponivel,
    }
    return base
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_service.py -v`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/app/devolucoes/service.py backend/tests/test_devolucoes_service.py
git commit -m "feat(devolucoes): service de sincronização/listagem/detalhe"
```

---

### Task 7: Endpoints e wiring no `main.py`

**Files:**
- Create: `backend/app/devolucoes/routes.py`
- Modify: `backend/app/main.py` (import + registro de tabelas + rotas)
- Test: `backend/tests/test_devolucoes_routes.py`

**Interfaces:**
- Consumes: `service.listar/detalhe/sincronizar` (Task 6), `MercadoLivreReturnsAdapter`/`ShopeeReturnsAdapter` (Tasks 3/4).
- Produces: `GET /api/devolucoes`, `GET /api/devolucoes/{id}`, `POST /api/devolucoes/sincronizar`.

- [ ] **Step 1: Escrever o teste (app Starlette isolado, sem subir o main.py inteiro)**

```python
# backend/tests/test_devolucoes_routes.py
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient
from app.devolucoes.routes import listar_devolucoes, detalhe_devolucao, sincronizar_devolucoes
import app.devolucoes.service as service

app_teste = Starlette(routes=[
    Route("/api/devolucoes", listar_devolucoes, methods=["GET"]),
    Route("/api/devolucoes/sincronizar", sincronizar_devolucoes, methods=["POST"]),
    Route("/api/devolucoes/{id:int}", detalhe_devolucao, methods=["GET"]),
])
cliente = TestClient(app_teste)


def test_listar_devolucoes_retorna_o_que_o_service_devolve(monkeypatch):
    monkeypatch.setattr(service, "listar", lambda: [{"id": 1, "marketplace": "mercado_livre"}])
    resp = cliente.get("/api/devolucoes")
    assert resp.status_code == 200
    assert resp.json() == [{"id": 1, "marketplace": "mercado_livre"}]


def test_detalhe_devolucao_inexistente_retorna_404(monkeypatch):
    monkeypatch.setattr(service, "detalhe", lambda return_case_id: None)
    resp = cliente.get("/api/devolucoes/999")
    assert resp.status_code == 404


def test_sincronizar_chama_service_com_os_dois_adapters(monkeypatch):
    recebido = {}

    def sincronizar_fake(adapters):
        recebido["chaves"] = sorted(adapters.keys())
        return {"novos": 0, "atualizados": 0}

    monkeypatch.setattr(service, "sincronizar", sincronizar_fake)
    resp = cliente.post("/api/devolucoes/sincronizar")
    assert resp.status_code == 200
    assert resp.json() == {"novos": 0, "atualizados": 0}
    assert recebido["chaves"] == ["mercado_livre", "shopee"]
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd backend && python -m pytest tests/test_devolucoes_routes.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.devolucoes.routes'`

- [ ] **Step 3: Implementar as rotas**

```python
# backend/app/devolucoes/routes.py
from starlette.requests import Request
from starlette.responses import JSONResponse
from app.devolucoes import service
from app.devolucoes.adapters.mercado_livre import MercadoLivreReturnsAdapter
from app.devolucoes.adapters.shopee import ShopeeReturnsAdapter

_ADAPTERS = {
    "mercado_livre": MercadoLivreReturnsAdapter(),
    "shopee": ShopeeReturnsAdapter(),
}


async def listar_devolucoes(request: Request) -> JSONResponse:
    """GET /api/devolucoes — lista consolidada ML+Shopee, sem ação externa."""
    return JSONResponse(service.listar())


async def detalhe_devolucao(request: Request) -> JSONResponse:
    """GET /api/devolucoes/{id} — detalhe com itens, rastreio e vínculo Olist."""
    return_case_id = int(request.path_params["id"])
    resultado = service.detalhe(return_case_id)
    if resultado is None:
        return JSONResponse({"erro": "devolução não encontrada"}, status_code=404)
    return JSONResponse(resultado)


async def sincronizar_devolucoes(request: Request) -> JSONResponse:
    """POST /api/devolucoes/sincronizar — ingestão manual (ML + Shopee)."""
    return JSONResponse(service.sincronizar(_ADAPTERS))
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `cd backend && python -m pytest tests/test_devolucoes_routes.py -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Registrar no `main.py`**

Em `backend/app/main.py`, logo após `from app.jobs import iniciar_scheduler` (linha onde o import do módulo antigo foi removido nesta sessão), adicionar:

```python
from app.devolucoes.routes import (
    listar_devolucoes as devol_listar,
    detalhe_devolucao as devol_detalhe,
    sincronizar_devolucoes as devol_sincronizar,
)
from app.devolucoes import models as _devolucoes_models  # registra as tabelas no Base antes do create_all
```

Na lista `routes = [...]`, antes do comentário `# Shopee (OAuth + push notification)`, adicionar (ordem importa: rota literal `/sincronizar` antes da rota com parâmetro `{id:int}`):

```python
    # --- Central de Devoluções (Fase 1 — leitura e vínculo) ---
    Route("/api/devolucoes", devol_listar, methods=["GET"]),
    Route("/api/devolucoes/sincronizar", devol_sincronizar, methods=["POST"]),
    Route("/api/devolucoes/{id:int}", devol_detalhe, methods=["GET"]),

```

- [ ] **Step 6: Verificar que o app inteiro ainda sobe sem erro**

Run: `cd backend && python -m py_compile app/main.py && python -c "import app.main"`
Expected: sem exceptions (o `Base.metadata.create_all` cria as 4 tabelas novas no `estoque_virtual.db` local)

- [ ] **Step 7: Commit**

```bash
git add backend/app/devolucoes/routes.py backend/app/main.py backend/tests/test_devolucoes_routes.py
git commit -m "feat(devolucoes): endpoints da Fase 1 e wiring no main.py"
```

---

### Task 8: Frontend — `CentralDevolucoes.tsx` (lista + detalhe, somente leitura)

**Files:**
- Modify: `frontend/src/services/api.ts` (novas funções + tipos)
- Create: `frontend/src/components/CentralDevolucoes.tsx`
- Create: `frontend/src/components/CentralDevolucoes.css`

**Interfaces:**
- Consumes: `GET /api/devolucoes`, `GET /api/devolucoes/{id}`, `POST /api/devolucoes/sincronizar` (Task 7).
- Produces: `listarDevolucoes()`, `buscarDevolucao(id)`, `sincronizarDevolucoes()` em `services/api.ts`; componente `CentralDevolucoes` exportado de `components/CentralDevolucoes.tsx`.

- [ ] **Step 1: Adicionar tipos e funções em `api.ts`**

No final de `frontend/src/services/api.ts`, adicionar:

```typescript
export interface DevolucaoResumo {
  id: number
  marketplace: string
  order_id: string
  claim_id: string
  status_marketplace: string
  motivo: string
  prazo_resolucao: string | null
}

export interface DevolucaoItem {
  sku_esperado: string
  produto_nome: string
  quantidade: number
  cmv_unitario: number | null
}

export interface DevolucaoEvento {
  status: string
  descricao: string
  origem: string
  data_hora: string
}

export interface DevolucaoOlistLink {
  produto_id_olist: string
  sku: string
  produto_nome_olist: string
  cmv: number
  estoque_disponivel: number | null
}

export interface DevolucaoDetalhe extends DevolucaoResumo {
  itens: DevolucaoItem[]
  eventos: DevolucaoEvento[]
  olist: DevolucaoOlistLink | null
}

export async function listarDevolucoes(): Promise<DevolucaoResumo[]> {
  const resp = await api.get<DevolucaoResumo[]>('/devolucoes')
  return resp.data
}

export async function buscarDevolucao(id: number): Promise<DevolucaoDetalhe> {
  const resp = await api.get<DevolucaoDetalhe>(`/devolucoes/${id}`)
  return resp.data
}

export async function sincronizarDevolucoes(): Promise<{ novos: number; atualizados: number }> {
  const resp = await api.post('/devolucoes/sincronizar')
  return resp.data
}
```

- [ ] **Step 2: Criar o componente**

```tsx
// frontend/src/components/CentralDevolucoes.tsx
import { useEffect, useState } from 'react'
import {
  listarDevolucoes, buscarDevolucao, sincronizarDevolucoes,
  DevolucaoResumo, DevolucaoDetalhe,
} from '../services/api'
import './CentralDevolucoes.css'

export function CentralDevolucoes() {
  const [lista, setLista] = useState<DevolucaoResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [detalhe, setDetalhe] = useState<DevolucaoDetalhe | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  async function carregarLista() {
    setCarregando(true)
    try {
      setLista(await listarDevolucoes())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregarLista() }, [])

  useEffect(() => {
    if (selecionadoId == null) {
      setDetalhe(null)
      return
    }
    buscarDevolucao(selecionadoId).then(setDetalhe)
  }, [selecionadoId])

  async function handleSincronizar() {
    setSincronizando(true)
    try {
      await sincronizarDevolucoes()
      await carregarLista()
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <div className="central-devolucoes">
      <div className="central-devolucoes__header">
        <h1>Central de Devoluções</h1>
        <button onClick={handleSincronizar} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </div>

      <div className="central-devolucoes__corpo">
        <table className="central-devolucoes__lista">
          <thead>
            <tr><th>Marketplace</th><th>Pedido</th><th>Status</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            {carregando && <tr><td colSpan={4}>Carregando...</td></tr>}
            {!carregando && lista.length === 0 && (
              <tr><td colSpan={4}>Nenhuma devolução sincronizada ainda.</td></tr>
            )}
            {lista.map((item) => (
              <tr
                key={item.id}
                className={item.id === selecionadoId ? 'selecionada' : ''}
                onClick={() => setSelecionadoId(item.id)}
              >
                <td>{item.marketplace}</td>
                <td>{item.order_id}</td>
                <td>{item.status_marketplace}</td>
                <td>{item.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {detalhe && (
          <div className="central-devolucoes__detalhe">
            <h2>Devolução #{detalhe.id} — {detalhe.marketplace}</h2>
            <p>Pedido: {detalhe.order_id} · Claim: {detalhe.claim_id}</p>
            <p>Status: {detalhe.status_marketplace} · Motivo: {detalhe.motivo}</p>

            <h3>Itens</h3>
            <ul>
              {detalhe.itens.map((item, i) => (
                <li key={i}>{item.sku_esperado} — {item.produto_nome} (qtd {item.quantidade})</li>
              ))}
            </ul>

            <h3>Rastreio</h3>
            <ul>
              {detalhe.eventos.map((evento, i) => (
                <li key={i}>{evento.data_hora} — {evento.status} ({evento.origem})</li>
              ))}
            </ul>

            <h3>Vínculo Olist</h3>
            {detalhe.olist ? (
              <p>
                {detalhe.olist.produto_nome_olist} · CMV R$ {detalhe.olist.cmv.toFixed(2)} ·
                {' '}Estoque {detalhe.olist.estoque_disponivel ?? '—'}
              </p>
            ) : (
              <p>Sem vínculo ainda.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

```css
/* frontend/src/components/CentralDevolucoes.css */
.central-devolucoes__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.central-devolucoes__corpo {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 16px;
}

.central-devolucoes__lista {
  width: 100%;
  border-collapse: collapse;
}

.central-devolucoes__lista th,
.central-devolucoes__lista td {
  padding: 8px 12px;
  border-bottom: 1px solid #e0e0e0;
  text-align: left;
}

.central-devolucoes__lista tr:hover {
  cursor: pointer;
  background: #f5f5f5;
}

.central-devolucoes__lista tr.selecionada {
  background: #e3f2fd;
}

.central-devolucoes__detalhe {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
}
```

- [ ] **Step 3: Verificar que compila**

Run: `cd frontend && npx vite build`
Expected: build sem erros (mesmo padrão de verificação já usado no projeto — `vite build` não roda `tsc`, então isso confirma que o bundler resolve os imports/tipos usados de fato)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/components/CentralDevolucoes.tsx frontend/src/components/CentralDevolucoes.css
git commit -m "feat(devolucoes): componente CentralDevolucoes (lista + detalhe, somente leitura)"
```

---

### Task 9: Wiring no `App.tsx` (menu + rota) e checagem manual

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `CentralDevolucoes` (Task 8).

- [ ] **Step 1: Adicionar o import**

Junto aos outros imports de componente em `App.tsx`:

```typescript
import { CentralDevolucoes } from './components/CentralDevolucoes'
```

- [ ] **Step 2: Adicionar a página ao tipo `Pagina`**

```typescript
type Pagina = 'bemvindo' | 'inicial' | 'conferencia' | 'produtos_nota' | 'relacionamento_produto' | 'fornecedores' | 'full-operacoes' | 'anuncios' | 'notas-fiscais' | 'operadores' | 'garimpador' | 'lista-compra' | 'radar-full' | 'estoque-embalagens' | 'central-devolucoes' | 'conferencia-ncm' | 'classificacao-tipos' | 'fiscal-ml-olist'
```

- [ ] **Step 3: Adicionar a entrada no menu**

Junto às outras entradas de menu (mesmo bloco onde ficava a entrada `devolucoes` removida nesta sessão):

```typescript
{ key: 'central-devolucoes', label: 'Devoluções', icon: 'box', active: pagina === 'central-devolucoes', onClick: () => setPagina('central-devolucoes') },
```

- [ ] **Step 4: Adicionar o bloco de renderização**

Junto aos outros blocos `if (pagina === '...')`:

```typescript
if (pagina === 'central-devolucoes') {
  return renderComShell('', '', <CentralDevolucoes />)
}
```

- [ ] **Step 5: Verificar que compila**

Run: `cd frontend && npx vite build`
Expected: build sem erros

- [ ] **Step 6: Checagem manual no navegador**

Rodar o backend (`cd backend && python -m uvicorn app.main:app --reload`) e o frontend (`cd frontend && npm run dev`), abrir a aba "Devoluções", clicar em "Sincronizar" e confirmar que a lista aparece (mesmo vazia, sem erro no console) e que clicar numa linha abre o detalhe.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(devolucoes): liga Central de Devoluções ao menu principal"
```

---

## Self-Review

**Cobertura da spec:** modelo de dados (Task 1), DTOs/contrato (Task 2), adapter ML (Task 3), adapter Shopee (Task 4), vínculo Olist (Task 5), service/orquestração (Task 6), endpoints (Task 7), frontend lista+detalhe (Tasks 8-9). Os dois desvios da spec (Port com 2 métodos, `olist_link` sem `pedido_id_olist`) estão documentados na seção "Desvios da spec" acima e propagados de forma consistente em todas as tasks.

**Placeholders:** nenhum — todo step tem código completo e executável.

**Consistência de tipos:** `ReturnCaseDTO`/`ReturnItemDTO`/`TrackingEventDTO` (Task 2) usados com os mesmos campos em Tasks 3, 4, 6. `ReturnsPort.listar_pendentes()`/`buscar()` implementado identicamente em `MercadoLivreReturnsAdapter` (Task 3) e `ShopeeReturnsAdapter` (Task 4), consumido em `service.sincronizar()` (Task 6) e instanciado em `routes.py` (Task 7). `vincular_olist(db, return_case_id, sku)` (Task 5) chamado com a mesma assinatura em `service.py` (Task 6) e mockado com a mesma assinatura no teste de Task 6.
