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
