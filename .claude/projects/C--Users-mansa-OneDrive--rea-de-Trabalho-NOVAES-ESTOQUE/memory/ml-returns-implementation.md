# Mercado Livre Returns & Claims - Guia de Implementação

Exemplos práticos de integração de devoluções e reclamações do Mercado Livre.

---

## 1. Sincronização de Devoluções (Polling)

### Padrão Recomendado

```python
# backend/app/utils/ml_returns_sync.py

import json
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from app.models import MercadoLivreReturn, MercadoLivreSyncState

class MercadoLivreReturnsManager:
    """
    Sincroniza devoluções do ML com polling incremental.
    Usa último timestamp para evitar refetch.
    """
    
    API_BASE = "https://api.mercadolivre.com.br"
    POLLING_INTERVAL = 300  # 5 minutos
    
    def __init__(self, access_token_getter, user_id: str, throttle_func=None):
        self.get_token = access_token_getter
        self.user_id = user_id
        self.throttle = throttle_func or (lambda: time.sleep(0.1))
    
    def _get(self, path: str, params: Dict = None) -> Optional[Dict]:
        """Requisição GET com Bearer token."""
        token = self.get_token()
        if not token:
            print("[ML Returns] Sem token disponível")
            return None
        
        url = f"{self.API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        try:
            self.throttle()
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"[ML Returns] Erro GET {path}: {e}")
            return None
    
    def sync_returns(self, db: Session) -> int:
        """
        Sincroniza devoluções do último checkpoint.
        Retorna quantidade de novas devoluções.
        """
        
        # Obter último sync
        last_sync_state = db.query(MercadoLivreSyncState).filter_by(
            scope="returns"
        ).first()
        
        last_sync = None
        if last_sync_state and last_sync_state.last_updated:
            try:
                last_sync = datetime.fromisoformat(last_sync_state.last_updated)
            except:
                pass
        
        # Parâmetros de busca
        params = {
            "seller_id": self.user_id,
            "limit": 100,
            "offset": 0
        }
        
        if last_sync:
            # Filtro por data (formato: 2026-07-01T00:00:00Z)
            params["created_from"] = last_sync.isoformat() + "Z"
        
        # Status de interesse
        statuses = [
            "pending_acceptance",
            "accepted", 
            "awaiting_receipt",
            "receipt_confirmed"
        ]
        
        total_fetched = 0
        
        for status in statuses:
            params["status"] = status
            offset = 0
            
            while True:
                params["offset"] = offset
                response = self._get("/returns", params)
                
                if not response or "results" not in response:
                    break
                
                results = response.get("results", [])
                if not results:
                    break
                
                for ret in results:
                    self._upsert_return(db, ret)
                    total_fetched += 1
                
                # Paginação
                total = response.get("total", 0)
                if offset + len(results) >= total:
                    break
                
                offset += len(results)
        
        # Atualizar checkpoint
        now = datetime.utcnow().isoformat()
        if last_sync_state:
            last_sync_state.last_updated = now
        else:
            last_sync_state = MercadoLivreSyncState(
                scope="returns",
                last_updated=now
            )
            db.add(last_sync_state)
        
        db.commit()
        print(f"[ML Returns] Sincronizadas {total_fetched} devoluções")
        
        return total_fetched
    
    def _upsert_return(self, db: Session, data: Dict):
        """Insere ou atualiza devolução no BD."""
        
        return_id = str(data.get("id"))
        
        # Buscar existente
        existing = db.query(MercadoLivreReturn).filter_by(
            return_id=return_id
        ).first()
        
        if existing:
            # Atualizar
            existing.status = data.get("status")
            existing.order_id = data.get("order_id")
            existing.item_id = data.get("item_id")
            existing.title = data.get("title")
            existing.sku = data.get("sku")
            existing.quantity = data.get("quantity")
            existing.reason = data.get("reason")
            existing.refund_amount = data.get("refund_amount")
            existing.updated_at = datetime.utcnow()
        else:
            # Criar novo
            mr = MercadoLivreReturn(
                return_id=return_id,
                order_id=data.get("order_id"),
                item_id=data.get("item_id"),
                title=data.get("title"),
                sku=data.get("sku"),
                quantity=data.get("quantity"),
                status=data.get("status"),
                reason=data.get("reason"),
                refund_amount=data.get("refund_amount"),
                raw_data=json.dumps(data)
            )
            db.add(mr)
        
        db.flush()
```

### Models (SQLAlchemy)

```python
# backend/app/models.py (adicionar)

from sqlalchemy import Column, String, Float, DateTime, Text, Integer
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class MercadoLivreReturn(Base):
    __tablename__ = "ml_returns"
    
    id = Column(Integer, primary_key=True)
    return_id = Column(String(50), unique=True, index=True)
    order_id = Column(String(50))
    item_id = Column(String(50))
    title = Column(String(255))
    sku = Column(String(100))
    quantity = Column(Integer)
    status = Column(String(50))  # pending_acceptance, accepted, etc
    reason = Column(String(100))  # Motivo da devolução
    refund_amount = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    raw_data = Column(Text)  # JSON completo da API

class MercadoLivreClaim(Base):
    __tablename__ = "ml_claims"
    
    id = Column(Integer, primary_key=True)
    claim_id = Column(String(50), unique=True, index=True)
    order_id = Column(String(50))
    item_id = Column(String(50))
    title = Column(String(255))
    sku = Column(String(100))
    quantity = Column(Integer)
    status = Column(String(50))  # opened, acknowledged, under_review, etc
    reason = Column(String(100))  # not_received, item_not_as_described, etc
    description = Column(Text)
    expiration_date = Column(DateTime)  # Quando claim expira
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    raw_data = Column(Text)
```

---

## 2. Sincronização de Reclamações

```python
# backend/app/utils/ml_claims_sync.py

class MercadoLivreClaimsManager:
    """Sincroniza reclamações (claims) do ML."""
    
    API_BASE = "https://api.mercadolivre.com.br"
    
    def __init__(self, access_token_getter, user_id: str):
        self.get_token = access_token_getter
        self.user_id = user_id
    
    def sync_claims(self, db: Session) -> int:
        """Sincroniza reclamações abertas e em mediação."""
        
        last_sync_state = db.query(MercadoLivreSyncState).filter_by(
            scope="claims"
        ).first()
        
        last_sync = None
        if last_sync_state:
            try:
                last_sync = datetime.fromisoformat(last_sync_state.last_updated)
            except:
                pass
        
        statuses = ["opened", "acknowledged", "under_review", "in_mediation"]
        total_fetched = 0
        
        for status in statuses:
            params = {
                "seller_id": self.user_id,
                "status": status,
                "limit": 100,
                "offset": 0
            }
            
            if last_sync:
                params["created_from"] = last_sync.isoformat() + "Z"
            
            offset = 0
            while True:
                params["offset"] = offset
                response = self._get("/claims", params)
                
                if not response or "results" not in response:
                    break
                
                results = response.get("results", [])
                if not results:
                    break
                
                for claim in results:
                    self._upsert_claim(db, claim)
                    total_fetched += 1
                
                total = response.get("total", 0)
                if offset + len(results) >= total:
                    break
                
                offset += len(results)
        
        # Update checkpoint
        now = datetime.utcnow().isoformat()
        if last_sync_state:
            last_sync_state.last_updated = now
        else:
            last_sync_state = MercadoLivreSyncState(
                scope="claims",
                last_updated=now
            )
            db.add(last_sync_state)
        
        db.commit()
        print(f"[ML Claims] Sincronizadas {total_fetched} reclamações")
        
        return total_fetched
    
    def _upsert_claim(self, db: Session, data: Dict):
        """Insere ou atualiza claim."""
        
        claim_id = str(data.get("id"))
        existing = db.query(MercadoLivreClaim).filter_by(claim_id=claim_id).first()
        
        if existing:
            existing.status = data.get("status")
            existing.description = data.get("description")
            existing.expiration_date = data.get("expiration_date")
            existing.updated_at = datetime.utcnow()
        else:
            mc = MercadoLivreClaim(
                claim_id=claim_id,
                order_id=data.get("order_id"),
                item_id=data.get("item_id"),
                title=data.get("title"),
                sku=data.get("sku"),
                quantity=data.get("quantity"),
                status=data.get("status"),
                reason=data.get("reason"),
                description=data.get("description"),
                expiration_date=data.get("expiration_date"),
                raw_data=json.dumps(data)
            )
            db.add(mc)
        
        db.flush()
```

---

## 3. Endpoints FastAPI

```python
# backend/app/main.py (adicionar rotas)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from app.utils.ml_returns_sync import MercadoLivreReturnsManager
from app.utils.ml_claims_sync import MercadoLivreClaimsManager

router = APIRouter(prefix="/api/ml", tags=["Mercado Livre"])

@router.get("/returns")
def list_returns(
    status: str = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Lista devoluções sincronizadas."""
    query = db.query(MercadoLivreReturn)
    
    if status:
        query = query.filter_by(status=status)
    
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "return_id": r.return_id,
                "order_id": r.order_id,
                "item_id": r.item_id,
                "title": r.title,
                "sku": r.sku,
                "quantity": r.quantity,
                "status": r.status,
                "reason": r.reason,
                "refund_amount": r.refund_amount,
                "updated_at": r.updated_at.isoformat()
            }
            for r in items
        ]
    }

@router.get("/claims")
def list_claims(
    status: str = None,
    urgent: bool = False,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """Lista reclamações sincronizadas."""
    query = db.query(MercadoLivreClaim)
    
    if status:
        query = query.filter_by(status=status)
    
    # Claims urgentes: faltam <24h para expirar
    if urgent:
        tomorrow = datetime.utcnow() + timedelta(hours=24)
        query = query.filter(
            MercadoLivreClaim.expiration_date < tomorrow,
            MercadoLivreClaim.status.in_(["opened", "acknowledged"])
        )
    
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "claim_id": c.claim_id,
                "order_id": c.order_id,
                "item_id": c.item_id,
                "title": c.title,
                "status": c.status,
                "reason": c.reason,
                "description": c.description,
                "expiration_date": c.expiration_date.isoformat() if c.expiration_date else None,
                "updated_at": c.updated_at.isoformat()
            }
            for c in items
        ]
    }

@router.post("/returns/{return_id}/confirm")
def confirm_return_receipt(
    return_id: str,
    db: Session = Depends(get_db)
):
    """Confirma recebimento de retorno no ML."""
    
    mr = db.query(MercadoLivreReturn).filter_by(return_id=return_id).first()
    if not mr:
        raise HTTPException(status_code=404, detail="Devolução não encontrada")
    
    # Chamar API do ML
    manager = MercadoLivreReturnsManager(
        get_access_token_func,
        user_id
    )
    
    # POST /returns/{id}/confirm
    token = manager.get_token()
    url = f"{manager.API_BASE}/returns/{return_id}/confirm"
    
    # ... implementar requisição POST ...
    
    return {"status": "success", "return_id": return_id}

@router.post("/claims/{claim_id}/message")
def send_claim_message(
    claim_id: str,
    message: str,
    db: Session = Depends(get_db)
):
    """Envia mensagem em reclamação aberta."""
    
    mc = db.query(MercadoLivreClaim).filter_by(claim_id=claim_id).first()
    if not mc:
        raise HTTPException(status_code=404, detail="Reclamação não encontrada")
    
    # POST /claims/{id}/messages
    # ... implementar ...
    
    return {"status": "success", "claim_id": claim_id}

@router.post("/sync/returns")
def trigger_returns_sync(db: Session = Depends(get_db)):
    """Dispara sincronização manual de devoluções."""
    
    manager = MercadoLivreReturnsManager(
        get_access_token_func,
        user_id
    )
    
    count = manager.sync_returns(db)
    return {"synced": count, "timestamp": datetime.utcnow().isoformat()}

@router.post("/sync/claims")
def trigger_claims_sync(db: Session = Depends(get_db)):
    """Dispara sincronização manual de reclamações."""
    
    manager = MercadoLivreClaimsManager(
        get_access_token_func,
        user_id
    )
    
    count = manager.sync_claims(db)
    return {"synced": count, "timestamp": datetime.utcnow().isoformat()}
```

---

## 4. Webhook Handler (para Seller Center)

```python
# backend/app/webhooks.py

from fastapi import APIRouter, Request
import json
from sqlalchemy.orm import Session

webhook_router = APIRouter()

@webhook_router.post("/webhook/mercadolivre")
async def handle_ml_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook para eventos do Mercado Livre.
    Configurar em: Seller Center → Integração → Webhooks
    
    Tópicos:
    - orders/order.return_request
    - orders/order.claim_opened
    - orders/order.claim_resolved
    """
    
    try:
        body = await request.json()
    except:
        return {"status": "error"}
    
    topic = body.get("topic")
    data = body.get("data", {})
    
    # Responder rápido (< 3s)
    if topic == "orders/order.return_request":
        # Novo retorno solicitado
        return_id = data.get("return_id")
        order_id = data.get("order_id")
        print(f"[Webhook] Novo retorno: {return_id}")
        
        # Dispara sync em background
        # ... usar background task ...
        
    elif topic == "orders/order.claim_opened":
        # Nova reclamação aberta
        claim_id = data.get("claim_id")
        order_id = data.get("order_id")
        print(f"[Webhook] Nova reclamação: {claim_id}")
        
    elif topic == "orders/order.claim_resolved":
        # Reclamação resolvida
        claim_id = data.get("claim_id")
        print(f"[Webhook] Reclamação resolvida: {claim_id}")
    
    # Sempre retornar 200 em até 3 segundos
    return {"status": "received"}
```

---

## 5. Job Agendado (sincronização periódica)

```python
# backend/app/jobs.py (adicionar)

from apscheduler.schedulers.background import BackgroundScheduler
from app.utils.ml_returns_sync import MercadoLivreReturnsManager
from app.utils.ml_claims_sync import MercadoLivreClaimsManager

def sync_ml_returns():
    """Sincroniza retornos a cada 5 minutos."""
    db = SessionLocal()
    try:
        manager = MercadoLivreReturnsManager(
            integracoes_ml.get_access_token,
            user_id
        )
        manager.sync_returns(db)
    except Exception as e:
        print(f"[Job] Erro ao sincronizar devoluções: {e}")
    finally:
        db.close()

def sync_ml_claims():
    """Sincroniza reclamações a cada 5 minutos."""
    db = SessionLocal()
    try:
        manager = MercadoLivreClaimsManager(
            integracoes_ml.get_access_token,
            user_id
        )
        manager.sync_claims(db)
    except Exception as e:
        print(f"[Job] Erro ao sincronizar reclamações: {e}")
    finally:
        db.close()

def start_ml_sync_jobs():
    """Inicia jobs agendados de sincronização."""
    scheduler = BackgroundScheduler()
    
    # A cada 5 minutos
    scheduler.add_job(sync_ml_returns, 'interval', minutes=5, id='ml_returns_sync')
    scheduler.add_job(sync_ml_claims, 'interval', minutes=5, id='ml_claims_sync')
    
    scheduler.start()
    print("[Jobs] Sincronização ML iniciada (returns + claims a cada 5min)")
```

---

## 6. Frontend - Aba de Devoluções/Reclamações

```tsx
// frontend/src/components/MercadoLivreReturns.tsx

import React, { useState, useEffect } from 'react';
import api from '../services/api';

export const MercadoLivreReturns: React.FC = () => {
  const [returns, setReturns] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'returns' | 'claims'>('returns');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'returns') {
        const res = await api.get('/ml/returns');
        setReturns(res.data.items);
      } else {
        const res = await api.get('/ml/claims?urgent=true');
        setClaims(res.data.items);
      }
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmReturn = async (returnId: string) => {
    try {
      await api.post(`/ml/returns/${returnId}/confirm`);
      fetchData();
    } catch (error) {
      console.error('Erro ao confirmar devolução:', error);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Devoluções e Reclamações (Mercado Livre)</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('returns')}
          style={{ marginRight: '10px', fontWeight: activeTab === 'returns' ? 'bold' : 'normal' }}
        >
          Devoluções ({returns.length})
        </button>
        <button 
          onClick={() => setActiveTab('claims')}
          style={{ fontWeight: activeTab === 'claims' ? 'bold' : 'normal' }}
        >
          Reclamações Urgentes ({claims.length})
        </button>
      </div>

      {loading && <p>Carregando...</p>}

      {activeTab === 'returns' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc' }}>
              <th>ID</th>
              <th>Produto</th>
              <th>Status</th>
              <th>Motivo</th>
              <th>Reembolso</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((ret: any) => (
              <tr key={ret.return_id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{ret.return_id}</td>
                <td>{ret.title}</td>
                <td>{ret.status}</td>
                <td>{ret.reason}</td>
                <td>R$ {ret.refund_amount?.toFixed(2)}</td>
                <td>
                  {ret.status === 'receipt_confirmed' && (
                    <button onClick={() => confirmReturn(ret.return_id)}>
                      Processar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeTab === 'claims' && (
        <div>
          {claims.length === 0 ? (
            <p>Nenhuma reclamação urgente</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ccc' }}>
                  <th>ID</th>
                  <th>Produto</th>
                  <th>Motivo</th>
                  <th>Expira em</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim: any) => (
                  <tr key={claim.claim_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td>{claim.claim_id}</td>
                    <td>{claim.title}</td>
                    <td>{claim.reason}</td>
                    <td>{new Date(claim.expiration_date).toLocaleDateString()}</td>
                    <td>
                      <button onClick={() => window.open(`https://www.mercadolivre.com.br/claims/${claim.claim_id}`)}>
                        Ver no ML
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
```

---

## Checklist de Implementação

- [ ] Adicionar models `MercadoLivreReturn` e `MercadoLivreClaim` ao SQLAlchemy
- [ ] Criar `ml_returns_sync.py` e `ml_claims_sync.py` com managers
- [ ] Adicionar endpoints `/api/ml/returns` e `/api/ml/claims`
- [ ] Implementar jobs agendados (polling a cada 5min)
- [ ] Configurar webhook em Seller Center
- [ ] Criar componente React de exibição
- [ ] Testar com devoluções reais
- [ ] Documentar no CLAUDE.md do projeto
