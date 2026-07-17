"""
Devoluções ML — sync com a Post-Purchase API e persistência.

Portado de DEVOLUCOES-ML-main/app.py em 15/07/2026. Continuação de
devolucoes_ml.py (que tem a API e as regras congeladas de classificação).

Adaptações em relação ao original:

- `db()` (sqlite3 cru, row_factory=Row) virou a SessionLocal do SQLAlchemy. As
  queries seguem em SQL cru via `exec_driver_sql`: a lógica de upsert decide
  quando a decisão local do operador sobrevive a um re-sync, e reescrevê-la em
  ORM arriscaria mudar semântica sem querer. O ganho seria estético; o risco, não.
- Placeholders `?` viraram `:nome` (o driver do SQLAlchemy não aceita `?` aqui).
- `env_int`/`current_env` (que liam o .env deles) viraram os.getenv direto.
- `ml_get` vem de devolucoes_ml (que reusa nosso token e manda x-format-new).

O literal "Mercado Livre" (com espaço e maiúsculas) é o valor de `marketplace`
gravado e consultado. Não normalizar: o upsert casa por ele.
"""

import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Any, Optional

from sqlalchemy import text

from database import SessionLocal
from app.devolucoes_ml import (
    ML_CLASSIFIER_VERSION,
    ML_ENRICHMENT_VERSION,
    action_names,
    claim_available_actions,
    classify_ml_live_queue_claim,
    ml_get,
    motivo_label,
)

MARKETPLACE = "Mercado Livre"

STATUS_PERMITIDOS = {
    "aguardando_produto", "em_transito", "nao_recebido", "produto_recebido",
    "em_analise", "divergencia_encontrada", "sem_divergencia", "contestacao_aberta",
    "aguardando_plataforma", "aprovado", "parcial", "reprovado", "encerrado",
}
MEDIATION_TRACKING_STATUSES = {"contestacao_aberta", "aguardando_plataforma", "divergencia_encontrada"}
MEDIATION_FINAL_STATUSES = {"aprovado", "parcial", "reprovado"}

BUCKET_ORDER = {"para_revisao": 1, "para_retirar": 2, "outros_problemas": 3,
                "fora_da_fila": 4, "erro": 5}


# ------------------------------------------------------------------ utilidades

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def ml_worker_count(name: str, default: int) -> int:
    """Teto de 8: acima disso o ML começa a responder 429."""
    return max(1, min(env_int(name, default), 8))


def _linhas(sql: str, params: Optional[dict] = None) -> list[dict]:
    with SessionLocal() as db:
        res = db.execute(text(sql), params or {})
        cols = list(res.keys())
        return [dict(zip(cols, row)) for row in res.fetchall()]


def _linha(sql: str, params: Optional[dict] = None) -> Optional[dict]:
    rows = _linhas(sql, params)
    return rows[0] if rows else None


def _exec(sql: str, params: Optional[dict] = None) -> Any:
    with SessionLocal() as db:
        res = db.execute(text(sql), params or {})
        db.commit()
        return res


# ------------------------------------------------- rastreio do sync (diagnóstico)

def start_ml_sync_run(tipo: str, detalhes: Optional[dict] = None) -> int:
    with SessionLocal() as db:
        res = db.execute(text("""
            INSERT INTO ml_sync_runs (tipo, status, iniciado_em, detalhes)
            VALUES (:tipo, 'running', :ini, :det)
        """), {"tipo": tipo, "ini": now_iso(), "det": json_dumps(detalhes or {})})
        db.commit()
        return int(res.lastrowid)


def finish_ml_sync_run(sync_run_id: int, *, status: str, total_declarado: int = 0,
                       total_encontrado: int = 0, total_processado: int = 0,
                       total_erros: int = 0, detalhes: Optional[dict] = None) -> None:
    _exec("""
        UPDATE ml_sync_runs
        SET status = :st, finalizado_em = :fim, total_declarado = :td,
            total_encontrado = :te, total_processado = :tp, total_erros = :ter,
            detalhes = :det
        WHERE id = :id
    """, {"st": status, "fim": now_iso(), "td": int(total_declarado or 0),
          "te": int(total_encontrado or 0), "tp": int(total_processado or 0),
          "ter": int(total_erros or 0), "det": json_dumps(detalhes or {}),
          "id": sync_run_id})


def add_ml_trace_event(trace_id: Optional[str], sync_run_id: Optional[int], step: str, *,
                       status: str = "ok", details: Optional[dict] = None,
                       claim_id: Any = "", started_at: Optional[float] = None) -> None:
    if not trace_id:
        return
    duration_ms = int((perf_counter() - started_at) * 1000) if started_at else 0
    _exec("""
        INSERT INTO ml_trace_events (trace_id, sync_run_id, step, status, duration_ms,
                                     claim_id, details, created_at)
        VALUES (:tid, :srid, :step, :st, :dur, :cid, :det, :cat)
    """, {"tid": trace_id, "srid": sync_run_id, "step": step, "st": status,
          "dur": duration_ms, "cid": str(claim_id or ""),
          "det": json_dumps(details or {}), "cat": now_iso()})


def add_ml_reconciliation_diff(sync_run_id: int, tipo: str, severidade: str,
                               referencia: str, detalhe: str) -> None:
    _exec("""
        INSERT INTO ml_reconciliation_diffs (sync_run_id, tipo, severidade, referencia,
                                             detalhe, created_at)
        VALUES (:srid, :tipo, :sev, :ref, :det, :cat)
    """, {"srid": sync_run_id, "tipo": tipo, "sev": severidade, "ref": referencia,
          "det": detalhe, "cat": now_iso()})


def save_raw_payload(sync_run_id: Optional[int], resource_type: str, resource_id: str,
                     payload: Any, claim_id: str = "") -> None:
    """Guarda o payload cru p/ auditar depois. UNIQUE(resource_type, resource_id)."""
    _exec("""
        INSERT INTO ml_raw_payloads (sync_run_id, resource_type, resource_id, claim_id,
                                     payload, captured_at)
        VALUES (:srid, :rt, :rid, :cid, :pl, :cat)
        ON CONFLICT(resource_type, resource_id) DO UPDATE SET
            sync_run_id = excluded.sync_run_id,
            claim_id = excluded.claim_id,
            payload = excluded.payload,
            captured_at = excluded.captured_at
    """, {"srid": sync_run_id, "rt": resource_type, "rid": str(resource_id),
          "cid": str(claim_id or ""), "pl": json_dumps(payload), "cat": now_iso()})


def trace_payload(trace_id: str) -> dict:
    events = _linhas("SELECT * FROM ml_trace_events WHERE trace_id = :t ORDER BY id",
                     {"t": trace_id})
    for e in events:
        try:
            e["details"] = json.loads(e.get("details") or "{}")
        except json.JSONDecodeError:
            e["details"] = {}
    run = None
    if events and events[0].get("sync_run_id"):
        run = _linha("SELECT * FROM ml_sync_runs WHERE id = :i",
                     {"i": events[0]["sync_run_id"]})
    if run:
        try:
            run["detalhes"] = json.loads(run.get("detalhes") or "{}")
        except json.JSONDecodeError:
            run["detalhes"] = {}
    return {"trace_id": trace_id, "sync_run": run, "eventos": events}


# ---------------------------------------------------- ML: busca e enriquecimento

def ml_claims_search(user_id: str, status: str, *, claim_type: str = "returns",
                     max_pages: int = 10, sort: str = "date_desc",
                     sync_run_id: Optional[int] = None,
                     trace_id: Optional[str] = None) -> tuple[list[dict], int]:
    claims: list[dict] = []
    total = 0
    for page in range(max_pages):
        page_started = perf_counter()
        offset = page * 100
        data = ml_get("/post-purchase/v1/claims/search", {
            "user_id": user_id, "status": status, "type": claim_type,
            "limit": 100, "offset": offset, "sort": sort,
        })
        total = int((data.get("paging") or {}).get("total") or total or 0)
        batch = data.get("data") or data.get("results") or []
        claims.extend(batch)
        add_ml_trace_event(trace_id, sync_run_id, "claims_search_page", details={
            "status_filter": status, "type": claim_type, "page": page + 1,
            "offset": offset, "limit": 100, "batch": len(batch),
            "total_declarado": total, "acumulado": len(claims),
        }, started_at=page_started)
        if len(batch) < 100 or len(claims) >= total:
            break
    return claims, total or len(claims)


def ml_return_shipments(retorno: Optional[dict]) -> list[dict]:
    """O ML já devolveu 3 formatos diferentes aqui; aceita todos."""
    retorno = retorno or {}
    shipments = retorno.get("shipments")
    if isinstance(shipments, list) and shipments:
        return [s or {} for s in shipments]
    shipping = retorno.get("shipping")
    if isinstance(shipping, dict) and shipping:
        return [shipping]
    shipment = retorno.get("shipment")
    if isinstance(shipment, dict) and shipment:
        return [shipment]
    return [{}]


_RETURN_INFO_VAZIO = {
    "return_id": "", "status": "", "shipment_status": "", "shipment_destination": "",
    "date_created": "", "refund_at": "", "seller_status": "", "seller_reason": "",
    "product_condition": "", "orders": [], "related_entities": [],
}


def claim_return_info(claim_id) -> dict:
    for _ in range(2):
        try:
            retorno = ml_get(f"/post-purchase/v2/claims/{claim_id}/returns")
            shipment = ml_return_shipments(retorno)[0]
            orders = retorno.get("orders") if isinstance(retorno, dict) else []
            return {
                "return_id": str((retorno or {}).get("id") or ""),
                "status": str((retorno or {}).get("status") or "").lower(),
                "shipment_status": str((shipment or {}).get("status") or "").lower(),
                "shipment_destination": str(((shipment or {}).get("destination") or {}).get("name") or "").lower(),
                "date_created": (retorno or {}).get("date_created") or "",
                "refund_at": str((retorno or {}).get("refund_at") or "").lower(),
                "seller_status": str((retorno or {}).get("seller_status") or "").lower(),
                "seller_reason": str((retorno or {}).get("seller_reason") or "").lower(),
                "product_condition": str((retorno or {}).get("product_condition") or "").lower(),
                "orders": orders if isinstance(orders, list) else [],
                "related_entities": retorno.get("related_entities") if isinstance(retorno, dict) else [],
            }
        except Exception:
            continue
    return dict(_RETURN_INFO_VAZIO)


def order_financials(order: Optional[dict]) -> dict:
    order = order or {}
    payments = order.get("payments") or []
    items = order.get("order_items") or []
    valor_pago = sum(float(p.get("total_paid_amount") or p.get("transaction_amount") or 0) for p in payments)
    valor_reembolsado = sum(
        float(p.get("total_paid_amount") or p.get("transaction_amount") or 0)
        for p in payments
        if str(p.get("status") or "").lower() in {"refunded", "charged_back"})
    taxa_venda = sum(float(i.get("sale_fee") or 0) for i in items)
    custo_envio = sum(float(p.get("shipping_cost") or 0) for p in payments)
    status_pagamento = ",".join(sorted({str(p.get("status") or "") for p in payments if p.get("status")}))
    return {
        "ml_valor_pago": valor_pago, "ml_valor_reembolsado": valor_reembolsado,
        "ml_taxa_venda": taxa_venda, "ml_custo_envio": custo_envio,
        "ml_status_pagamento": status_pagamento,
    }


def order_visuals(order: Optional[dict], claim_id) -> dict:
    order = order or {}
    order_item = ((order.get("order_items") or []) + [{}])[0]
    item = order_item.get("item") or {}
    shipping = order.get("shipping") or {}
    logistic_type = str(shipping.get("logistic_type") or "").lower()
    order_tags = set(order.get("tags") or [])
    full_ml = logistic_type == "fulfillment" or (bool(order.get("fulfilled")) and "d2c" not in order_tags)
    picture = item.get("secure_thumbnail") or item.get("thumbnail") or ""
    item_id = item.get("id")
    if item_id and not picture:
        try:
            ml_item = ml_get(f"/items/{item_id}")
            picture = ml_item.get("secure_thumbnail") or ml_item.get("thumbnail") or ""
            pictures = ml_item.get("pictures") or []
            if pictures:
                picture = pictures[0].get("secure_url") or pictures[0].get("url") or picture
        except Exception:
            picture = ""
    financials = order_financials(order)
    return {
        "produto_nome": item.get("title") or "",
        "produto_imagem": picture or "",
        "valor_pago": float(financials.get("ml_valor_pago") or 0),
        "taxa_venda": float(financials.get("ml_taxa_venda") or 0),
        "ml_tipo_logistica": "full_ml" if full_ml else "seller_address",
        "pack_id": str(order.get("pack_id") or ""),
    }


def fetch_order_for_claim(claim_detail: dict, return_info: dict) -> Optional[dict]:
    resource_id = claim_detail.get("resource_id")
    candidates: list[str] = []
    if resource_id:
        candidates.append(str(resource_id))
    for order in return_info.get("orders") or []:
        if order.get("order_id"):
            candidates.append(str(order["order_id"]))
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        try:
            return ml_get(f"/orders/{candidate}")
        except Exception:
            continue
    return None


def ml_claim_return_cost(claim_id: str) -> float:
    claim_id = str(claim_id or "").strip()
    if not claim_id:
        return 0.0
    try:
        payload = ml_get(f"/post-purchase/v1/claims/{claim_id}/charges/return-cost")
        return round(abs(float((payload or {}).get("amount") or 0.0)), 2)
    except Exception:
        return 0.0


def bucket_action_meta(detail: dict, bucket: str) -> dict:
    actions = claim_available_actions(detail)
    review_actions = {"return_review_unified_ok", "return_review_unified_fail",
                      "return_review_ok", "return_review_fail"}
    target = None
    if bucket == "para_revisao":
        target = next((a for a in actions if a.get("action") in review_actions), None)
    elif bucket == "outros_problemas":
        target = next((a for a in actions if a.get("action") == "send_message_to_mediator"), None)
    if not target:
        target = next((a for a in actions if a.get("due_date")), None)
    return {
        "mandatory": int(bool(target and target.get("mandatory"))),
        "due_date": str((target or {}).get("due_date") or ""),
    }


# ------------------------------------------------ cache da classificação

def cached_claim_classification(claim_id, last_updated: Optional[str]) -> Optional[dict]:
    """
    Devolve a classificação em cache, ou None se precisar reclassificar.

    Invalida em 3 situações: o claim mudou (last_updated), as REGRAS mudaram
    (classifier_version) ou o enriquecimento mudou (enrichment_version). São os
    carimbos de versão que impedem servir bucket calculado por regra antiga.
    """
    row = _linha("SELECT * FROM ml_claim_classifications WHERE claim_id = :c LIMIT 1",
                 {"c": str(claim_id or "")})
    try:
        payload = json.loads(row["payload"] or "{}") if row else {}
    except json.JSONDecodeError:
        payload = {}
    if (not row
            or row["last_updated"] != (last_updated or "")
            or payload.get("classifier_version") != ML_CLASSIFIER_VERSION
            or payload.get("enrichment_version") != ML_ENRICHMENT_VERSION):
        return None
    data = dict(row)
    for campo in ("seller_actions", "order_ids"):
        try:
            data[campo] = json.loads(data.get(campo) or "[]")
        except json.JSONDecodeError:
            data[campo] = []
    data["payload"] = payload
    data["cache_hit"] = True
    return data


def save_claim_classification(item: dict) -> None:
    _exec("""
        INSERT INTO ml_claim_classifications (
          claim_id, pedido_id, order_ids, status, stage, claim_type, reason_id,
          return_id, return_status, shipment_status, shipment_destination,
          seller_actions, bucket, regra, last_updated, payload, active, updated_at,
          produto_nome, produto_imagem, valor_pago, taxa_venda, ml_tipo_logistica,
          motivo_label, pack_id, mandatory, due_date, date_created
        ) VALUES (
          :claim_id, :pedido_id, :order_ids, :status, :stage, :claim_type, :reason_id,
          :return_id, :return_status, :shipment_status, :shipment_destination,
          :seller_actions, :bucket, :regra, :last_updated, :payload, 1, :updated_at,
          :produto_nome, :produto_imagem, :valor_pago, :taxa_venda, :ml_tipo_logistica,
          :motivo_label, :pack_id, :mandatory, :due_date, :date_created
        )
        ON CONFLICT(claim_id) DO UPDATE SET
          pedido_id = excluded.pedido_id, order_ids = excluded.order_ids,
          status = excluded.status, stage = excluded.stage,
          claim_type = excluded.claim_type, reason_id = excluded.reason_id,
          return_id = excluded.return_id, return_status = excluded.return_status,
          shipment_status = excluded.shipment_status,
          shipment_destination = excluded.shipment_destination,
          seller_actions = excluded.seller_actions, bucket = excluded.bucket,
          regra = excluded.regra, last_updated = excluded.last_updated,
          payload = excluded.payload, active = 1, updated_at = excluded.updated_at,
          produto_nome = excluded.produto_nome, produto_imagem = excluded.produto_imagem,
          valor_pago = excluded.valor_pago, taxa_venda = excluded.taxa_venda,
          ml_tipo_logistica = excluded.ml_tipo_logistica,
          motivo_label = excluded.motivo_label, pack_id = excluded.pack_id,
          mandatory = excluded.mandatory, due_date = excluded.due_date,
          date_created = excluded.date_created
    """, {
        "claim_id": str(item.get("claim_id") or ""),
        "pedido_id": str(item.get("pedido_id") or ""),
        "order_ids": json_dumps(item.get("order_ids") or []),
        "status": str(item.get("status") or ""),
        "stage": str(item.get("stage") or ""),
        "claim_type": str(item.get("type") or ""),
        "reason_id": str(item.get("reason_id") or ""),
        "return_id": str(item.get("return_id") or ""),
        "return_status": str(item.get("return_status") or ""),
        "shipment_status": str(item.get("shipment_status") or ""),
        "shipment_destination": str(item.get("shipment_destination") or ""),
        "seller_actions": json_dumps(item.get("seller_actions") or []),
        "bucket": str(item.get("bucket") or "fora_da_fila"),
        "regra": str(item.get("regra") or ""),
        "last_updated": str(item.get("last_updated") or ""),
        "payload": json_dumps(item),
        "updated_at": now_iso(),
        "produto_nome": str(item.get("produto_nome") or ""),
        "produto_imagem": str(item.get("produto_imagem") or ""),
        "valor_pago": float(item.get("valor_pago") or 0),
        "taxa_venda": float(item.get("taxa_venda") or 0),
        "ml_tipo_logistica": str(item.get("ml_tipo_logistica") or ""),
        "motivo_label": str(item.get("motivo_label") or ""),
        "pack_id": str(item.get("pack_id") or ""),
        "mandatory": int(item.get("mandatory") or 0),
        "due_date": str(item.get("due_date") or ""),
        "date_created": str(item.get("date_created") or ""),
    })


# ----------------------------------------------------------- fila ao vivo

def inspect_claim_for_queue(claim: dict, *, use_cache: bool = True) -> tuple[dict, bool]:
    claim_id = str(claim.get("id") or "")
    last_updated = str(claim.get("last_updated") or "")
    if use_cache:
        cached = cached_claim_classification(claim_id, last_updated)
        if cached:
            payload = dict(cached.get("payload") or {})
            payload["cache_hit"] = True
            return payload, True
    detail = ml_get(f"/post-purchase/v1/claims/{claim_id}")
    return_info = claim_return_info(claim_id)
    bucket, rule = classify_ml_live_queue_claim(detail, return_info)
    orders = return_info.get("orders") or []
    order_ids = [str(o.get("order_id")) for o in orders if o.get("order_id")]
    # Performance: fora da fila não precisa enriquecer com order/item (muito custoso).
    if bucket == "fora_da_fila":
        visuals = {"produto_nome": "", "produto_imagem": "", "valor_pago": 0.0,
                   "taxa_venda": 0.0, "ml_tipo_logistica": "", "pack_id": ""}
    else:
        visuals = order_visuals(fetch_order_for_claim(detail, return_info), claim_id)
    action_meta = bucket_action_meta(detail, bucket)
    reason_id = detail.get("reason_id")
    item = {
        "claim_id": claim_id,
        "pedido_id": str(detail.get("resource_id") or ""),
        "order_ids": order_ids,
        "status": detail.get("status"),
        "stage": detail.get("stage"),
        "type": detail.get("type"),
        "reason_id": reason_id,
        "return_id": return_info.get("return_id"),
        "return_status": return_info.get("status"),
        "shipment_status": return_info.get("shipment_status"),
        "shipment_destination": return_info.get("shipment_destination"),
        "seller_actions": action_names(detail),
        "bucket": bucket,
        "regra": rule,
        "date_created": detail.get("date_created"),
        "last_updated": detail.get("last_updated") or last_updated,
        "cache_hit": False,
        "classifier_version": ML_CLASSIFIER_VERSION,
        "enrichment_version": ML_ENRICHMENT_VERSION,
        "produto_nome": visuals["produto_nome"],
        "produto_imagem": visuals["produto_imagem"],
        "valor_pago": visuals["valor_pago"],
        "taxa_venda": visuals["taxa_venda"],
        "ml_tipo_logistica": visuals["ml_tipo_logistica"],
        "pack_id": visuals["pack_id"],
        "motivo_label": motivo_label(reason_id),
        "mandatory": action_meta["mandatory"],
        "due_date": action_meta["due_date"],
    }
    save_claim_classification(item)
    return item, False


def apply_ml_queue_window(rows: list[dict]) -> None:
    for item in rows:
        if item.get("bucket") == "fora_da_fila" and ":outside_recent_window" in item.get("regra", ""):
            item["bucket"] = "outros_problemas"


def ml_live_claims_for_queue(user_id: str, *, max_pages: int = 3) -> tuple[list[dict], dict]:
    claims: list[dict] = []
    seen: set[str] = set()
    declared: dict[str, int] = {}
    searches = [
        ("returns", "opened", max_pages),
        ("returns", "closed", env_int("ML_LIVE_QUEUE_CLOSED_RETURNS_PAGES", 2)),
        ("mediations", "opened", env_int("ML_LIVE_QUEUE_MAX_PAGES_MEDIATIONS", 2)),
        ("mediations", "closed", env_int("ML_LIVE_QUEUE_CLOSED_MEDIATIONS_PAGES", 5)),
    ]
    for claim_type, status_filter, pages in searches:
        batch, total = ml_claims_search(user_id, status_filter, claim_type=claim_type,
                                        max_pages=pages, sort="last_updated:desc")
        declared[f"{claim_type}_{status_filter}"] = total
        for claim in batch:
            # Mediações fechadas recentes ficam no cache para classificar
            # corretamente "outros problemas" (ex.: devolução em revisão).
            claim_id = str(claim.get("id") or "")
            if claim_id and claim_id not in seen:
                seen.add(claim_id)
                claims.append(claim)
    return claims, declared


def ml_live_return_queue(user_id: str) -> dict:
    started = perf_counter()
    claims, declared = ml_live_claims_for_queue(
        user_id, max_pages=env_int("ML_SYNC_MAX_PAGES_OPENED", 10))
    rows: list[dict] = []
    cache_hits = 0
    cache_misses = 0

    def inspect(claim: dict) -> dict:
        item, _ = inspect_claim_for_queue(claim)
        return item

    with ThreadPoolExecutor(max_workers=ml_worker_count("ML_LIVE_QUEUE_WORKERS", 4)) as ex:
        futures = {ex.submit(inspect, c): c for c in claims}
        for future in as_completed(futures):
            try:
                item = future.result()
                rows.append(item)
                if item.get("cache_hit"):
                    cache_hits += 1
                else:
                    cache_misses += 1
            except Exception as exc:
                claim = futures[future]
                rows.append({
                    "claim_id": str(claim.get("id") or ""),
                    "pedido_id": str(claim.get("resource_id") or ""),
                    "status": claim.get("status"), "stage": claim.get("stage"),
                    "type": claim.get("type"), "reason_id": claim.get("reason_id"),
                    "bucket": "erro", "regra": str(exc),
                })

    rows.sort(key=lambda i: (BUCKET_ORDER.get(i["bucket"], 9), i.get("last_updated") or ""))
    apply_ml_queue_window(rows)
    proximas = {b: sum(1 for i in rows if i["bucket"] == b)
                for b in ("para_revisao", "para_retirar", "outros_problemas")}
    proximas["total"] = sum(proximas.values())
    return {
        "fonte": "mercado_livre_live_queue_v2",
        "duracao_ms": int((perf_counter() - started) * 1000),
        "declarados": declared,
        "inspecionados": len(rows),
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "proximas": proximas,
        "itens": rows,
    }


# ---------------------------------------------------------- upsert (delicado)

def mediation_result_from_resolution(claim_status: str, resolution: Optional[dict]) -> tuple[str, str]:
    status = str(claim_status or "").lower()
    resolution = resolution or {}
    reason = str(resolution.get("reason") or "").lower()
    benefited_set = {str(v or "").lower() for v in (resolution.get("benefited") or [])}

    if status != "closed":
        return "aguardando_plataforma", "Mediacao em processamento pelo Mercado Livre."
    if "respondent" in benefited_set and "complainant" in benefited_set:
        return "parcial", f"Mediacao concluida no Mercado Livre (resolucao: {reason or 'sem motivo informado'})."
    if "respondent" in benefited_set:
        return "aprovado", f"Mediacao concluida a favor do vendedor (resolucao: {reason or 'sem motivo informado'})."
    if "complainant" in benefited_set:
        return "reprovado", f"Mediacao concluida a favor do comprador (resolucao: {reason or 'sem motivo informado'})."
    if reason == "partial_refunded":
        return "parcial", "Mediacao concluida com reembolso parcial no Mercado Livre."
    return "encerrado", f"Mediacao encerrada no Mercado Livre (resolucao: {reason or 'sem motivo informado'})."


def review_payload_has_pending_seller_action(reviews_payload) -> bool:
    data = reviews_payload
    if isinstance(data, str):
        try:
            data = json.loads(data or "[]")
        except Exception:
            data = []
    if not isinstance(data, list):
        return False
    for review in data:
        for rr in (review or {}).get("resource_reviews") or []:
            if (str((rr or {}).get("seller_status") or "").lower() == "pending"
                    or str((rr or {}).get("stage") or "").lower() == "seller_review_pending"):
                return True
    return False


def resolved_return_fee(item: dict) -> float:
    fee = round(abs(float(item.get("ml_tarifa_devolucao") or 0.0)), 2)
    if fee > 0:
        return fee
    claim_id = str(item.get("ml_claim_id") or "").strip()
    return ml_claim_return_cost(claim_id) if claim_id else 0.0


UPSERT_FIELDS = [
    "marketplace", "pedido_id", "cliente_nome", "produto_nome", "motivo_devolucao",
    "valor_produto", "status", "data_solicitacao", "codigo_rastreio", "valor_recuperado",
    "valor_perdido", "observacao_final", "ml_claim_id", "ml_status", "ml_stage",
    "ml_return_status", "ultima_sincronizacao_ml", "ml_destino_devolucao",
    "ml_tipo_logistica", "prazo_resolucao", "prioridade_prazo", "requer_acao",
    "acao_recomendada", "produto_imagem", "chegada_status", "mediacao_mensagem",
    "ml_ativo", "ml_valor_pago", "ml_valor_reembolsado", "ml_taxa_venda",
    "ml_custo_envio", "ml_status_pagamento", "ml_return_id", "ml_return_subtype",
    "ml_status_money", "ml_refund_at", "ml_seller_status", "ml_seller_reason",
    "ml_product_condition", "ml_return_reviews", "ml_tarifa_devolucao",
]


def upsert_ml_devolucao(item: dict) -> str:
    """
    Grava a devolução vinda do ML, PRESERVANDO a decisão local do operador.

    O miolo desta função é sobre o que NÃO sobrescrever: se o operador já
    conferiu e fechou (sem_divergencia / chegada esperado / mediação decidida),
    um re-sync não pode reabrir aquilo. Portado do original mantendo a ordem
    das condições — cada uma cobre um caso real de produção.
    """
    item = {**item, "ultima_sincronizacao_ml": now_iso(),
            "ml_ativo": int(item.get("ml_ativo", 1))}

    if item.get("ml_claim_id"):
        row = _linha("SELECT * FROM devolucoes WHERE ml_claim_id = :c LIMIT 1",
                     {"c": item["ml_claim_id"]})
        if not row:
            # Devolução criada à mão para este pedido, ainda sem claim: adota.
            row = _linha("""SELECT * FROM devolucoes
                            WHERE marketplace = :mp AND pedido_id = :p
                              AND COALESCE(ml_claim_id, '') = '' LIMIT 1""",
                         {"mp": MARKETPLACE, "p": item["pedido_id"]})
    else:
        row = _linha("SELECT * FROM devolucoes WHERE marketplace = :mp AND pedido_id = :p LIMIT 1",
                     {"mp": MARKETPLACE, "p": item["pedido_id"]})

    if row:
        if row["ml_claim_id"] and not item.get("ml_claim_id"):
            item["ml_claim_id"] = row["ml_claim_id"]
            for field in ["ml_status", "ml_stage", "ml_return_status", "ml_return_id",
                          "ml_return_subtype", "ml_status_money", "ml_refund_at",
                          "ml_seller_status", "ml_seller_reason", "ml_product_condition",
                          "ml_return_reviews", "ml_destino_devolucao", "ml_tipo_logistica"]:
                incoming = item.get(field)
                if incoming in (None, "", "[]", 0, 0.0) and row[field] not in (None, ""):
                    item[field] = row[field]

        same_claim = str(row["ml_claim_id"] or "") == str(item.get("ml_claim_id") or "")
        local_expected_closed = row["status"] == "sem_divergencia" or row["chegada_status"] == "esperado"
        remote_still_requires_action = int(item.get("requer_acao") or 0) == 1
        full_review_pending = (bool(item.get("_full_review_pending"))
                               or review_payload_has_pending_seller_action(item.get("ml_return_reviews")))
        should_keep_local_final = row["status"] in MEDIATION_FINAL_STATUSES or (
            local_expected_closed and not remote_still_requires_action)
        if full_review_pending:
            should_keep_local_final = False
        local_mediation_tracking = (
            row["status"] in MEDIATION_TRACKING_STATUSES
            or row["status"] in MEDIATION_FINAL_STATUSES
            or bool(str(row["mediacao_mensagem"] or "").strip()))

        if same_claim and full_review_pending:
            item["status"] = "produto_recebido"
            item["requer_acao"] = 1
            item["ml_ativo"] = 1
            item["valor_recuperado"] = 0.0
            item["valor_perdido"] = 0.0
            item["observacao_final"] = ("Devolucao revisada pelo Mercado Livre (Full) "
                                        "com apelo pendente do vendedor.")

        claim_status = str(item.get("ml_status") or "").lower()
        resolution = item.get("_claim_resolution") or {}
        if same_claim and local_mediation_tracking and not full_review_pending:
            mediation_status, mediation_note = mediation_result_from_resolution(claim_status, resolution)
            if claim_status == "closed":
                item["status"] = mediation_status
                item["requer_acao"] = 0
                item["ml_ativo"] = 0
                item["observacao_final"] = mediation_note
                item["ml_tarifa_devolucao"] = resolved_return_fee(item)
                base_valor = float(item.get("valor_produto") or 0)
                if mediation_status == "aprovado":
                    item["valor_recuperado"] = base_valor
                    item["valor_perdido"] = 0.0
                elif mediation_status == "reprovado":
                    item["valor_recuperado"] = 0.0
                    item["valor_perdido"] = base_valor
                elif mediation_status == "parcial":
                    pago = float(item.get("ml_valor_pago") or base_valor)
                    reembolsado = float(item.get("ml_valor_reembolsado") or 0)
                    recuperado = max(0.0, round(pago - reembolsado, 2))
                    item["valor_recuperado"] = recuperado
                    item["valor_perdido"] = max(0.0, round(base_valor - recuperado, 2))
                # Decisão final já registrada localmente vence a recalculada.
                if row["status"] in MEDIATION_FINAL_STATUSES and row["status"] != "encerrado":
                    item["status"] = row["status"]
                    item["valor_recuperado"] = row["valor_recuperado"]
                    item["valor_perdido"] = row["valor_perdido"]
                    item["observacao_final"] = row["observacao_final"] or item["observacao_final"]
                    item["ml_tarifa_devolucao"] = row["ml_tarifa_devolucao"]
            else:
                item["status"] = "aguardando_plataforma"
                item["requer_acao"] = 0
                item["ml_ativo"] = 0
                item["ml_tarifa_devolucao"] = 0.0
                item["valor_recuperado"] = 0.0
                item["valor_perdido"] = 0.0
                item["observacao_final"] = "Mediacao em processamento no Mercado Livre."

        if same_claim and should_keep_local_final:
            item["status"] = row["status"]
            item["chegada_status"] = row["chegada_status"] or item.get("chegada_status", "")
            item["requer_acao"] = row["requer_acao"]
            item["ml_ativo"] = 0

        campos = [f for f in UPSERT_FIELDS if f != "marketplace"]
        sets = ", ".join(f"{f} = :{f}" for f in campos)
        params = {f: item.get(f) for f in campos}
        params["_id"] = row["id"]
        _exec(f"UPDATE devolucoes SET {sets} WHERE id = :_id", params)
        return "updated"

    cols = ", ".join(UPSERT_FIELDS)
    binds = ", ".join(f":{f}" for f in UPSERT_FIELDS)
    _exec(f"INSERT INTO devolucoes ({cols}) VALUES ({binds})",
          {f: item.get(f) for f in UPSERT_FIELDS})
    return "created"


def novo_trace_id() -> str:
    return uuid.uuid4().hex[:16]


# ------------------------------------------- claim do ML -> linha de devolução

def add_days_iso(value: Optional[str], days: int) -> str:
    base = datetime.fromisoformat(value.replace("Z", "+00:00")) if value else datetime.now(timezone.utc)
    return (base + timedelta(days=days)).isoformat()


def review_due_date(claim: dict) -> Optional[str]:
    for action in claim_available_actions(claim):
        if action.get("action") in {"return_review_ok", "return_review_unified_ok"} and action.get("due_date"):
            return action.get("due_date")
    return None


def has_return_review_action(claim: dict) -> bool:
    review_actions = {"return_review_ok", "return_review_fail",
                      "return_review_unified_ok", "return_review_unified_fail"}
    return any(a.get("action") in review_actions for a in claim_available_actions(claim))


def map_ml_status(claim: dict, retorno: Optional[dict]) -> str:
    claim_status = str(claim.get("status") or "").lower()
    return_status = str((retorno or {}).get("status") or "").lower()
    stage = str(claim.get("stage") or "").lower()
    actions = [a.get("action") for p in claim.get("players") or []
               for a in p.get("available_actions") or []]
    if any(a in {"return_review_ok", "return_review_fail", "return_review_unified_ok",
                 "return_review_unified_fail"} for a in actions):
        return "produto_recebido"
    if claim_status == "closed" or "finished" in return_status:
        return "encerrado"
    if "delivered" in return_status or "received" in return_status:
        return "produto_recebido"
    if "dispute" in stage:
        return "aguardando_plataforma"
    return "aguardando_produto"


def extract_tarifa_devolucao(retorno: Optional[dict]) -> float:
    """Tarifa de devolução dentro do payload do return (fallback do /charges)."""
    if not retorno:
        return 0.0
    charges = retorno.get("charges") or {}
    if isinstance(charges, dict):
        for charge_type, charge_value in charges.items():
            if charge_type and "return" in str(charge_type).lower():
                return float(charge_value or 0)
    return 0.0


def ml_return_reviews(return_id, sync_run_id: Optional[int] = None, claim_id="") -> dict:
    if not return_id:
        return {"reviews": []}
    try:
        reviews = ml_get(f"/post-purchase/v1/returns/{return_id}/reviews")
        save_raw_payload(sync_run_id, "return_reviews", str(return_id), reviews, str(claim_id or ""))
        return reviews
    except Exception:
        return {"reviews": []}


def build_ml_devolucao(claim: dict, sync_run_id: Optional[int] = None) -> dict:
    """
    Converte um claim do ML na linha de `devolucoes`.

    Decide prioridade/prazo/ação recomendada. O ponto sutil: em venda FULL o ML
    conduz a revisão e a loja não consegue abrir chamado até ela terminar — daí
    `ml_review_locked`. Uma ação isolada de send_message_to_mediator NÃO
    significa que a revisão acabou (por isso has_seller_action muda no FULL).
    """
    claim_id = claim.get("id")
    resource_id = claim.get("resource_id")
    retorno = None
    order = None
    save_raw_payload(sync_run_id, "claim", str(claim_id), claim, str(claim_id or ""))
    try:
        retorno = ml_get(f"/post-purchase/v2/claims/{claim_id}/returns")
        save_raw_payload(sync_run_id, "return", str(retorno.get("id") or claim_id), retorno, str(claim_id or ""))
    except Exception:
        retorno = None
    return_id = (retorno or {}).get("id")
    reviews_payload = ml_return_reviews(return_id, sync_run_id, claim_id)
    reviews_list = (reviews_payload or {}).get("reviews") or []
    if resource_id:
        try:
            order = ml_get(f"/orders/{resource_id}")
            save_raw_payload(sync_run_id, "order", str(order.get("id") or resource_id), order, str(claim_id or ""))
        except Exception:
            order = None

    item = ((order or {}).get("order_items") or [{}])[0].get("item", {})
    buyer = (order or {}).get("buyer", {})
    buyer_name = " ".join([buyer.get("first_name") or "", buyer.get("last_name") or ""]).strip()
    shipment = ml_return_shipments(retorno)[0]
    destination = (shipment or {}).get("destination", {}).get("name", "")
    return_status = str((retorno or {}).get("status") or "").lower()
    date_base = ((retorno or {}).get("last_updated") or (retorno or {}).get("date_created")
                 or claim.get("date_created"))
    logistic_type = str(((order or {}).get("shipping") or {}).get("logistic_type") or "").lower()
    order_tags = set((order or {}).get("tags") or [])
    full_ml = (logistic_type == "fulfillment" or destination == "warehouse"
               or (bool((order or {}).get("fulfilled")) and "d2c" not in order_tags))
    seller_status = str((retorno or {}).get("seller_status") or "").lower()
    claim_status = str(claim.get("status") or "").lower()
    actions = set(action_names(claim))
    review_actions = {"return_review_ok", "return_review_fail",
                      "return_review_unified_ok", "return_review_unified_fail"}
    has_review_action = bool(actions.intersection(review_actions))
    has_message_action = "send_message_to_mediator" in actions
    # Para FULL, só liberamos fluxo quando houver ação real de revisão de devolução.
    # send_message_to_mediator isolado NÃO significa que a revisão da plataforma terminou.
    has_seller_action = has_review_action if full_ml else (has_review_action or has_message_action)
    review_keywords = ("review", "revis")
    has_review_signal = (
        return_status in {"in_review", "under_review", "pending_review", "reviewing"}
        or seller_status in {"in_review", "under_review", "pending_review", "reviewing"}
        or any(k in return_status for k in review_keywords)
        or any(k in seller_status for k in review_keywords))
    ml_review_locked = not has_seller_action and (full_ml or has_review_signal)
    precisa_revisao = has_return_review_action(claim)
    picture = item.get("secure_thumbnail") or item.get("thumbnail") or ""
    item_id = item.get("id")
    if item_id and not picture:
        try:
            ml_item = ml_get(f"/items/{item_id}")
            save_raw_payload(sync_run_id, "item", str(item_id), ml_item, str(claim_id or ""))
            picture = ml_item.get("secure_thumbnail") or ml_item.get("thumbnail") or ""
            pictures = ml_item.get("pictures") or []
            if pictures:
                picture = pictures[0].get("secure_url") or pictures[0].get("url") or picture
        except Exception:
            picture = ""

    proxima_atender = return_status in {"label_generated", "delivered", "received"} or precisa_revisao
    return_cost = ml_claim_return_cost(str(claim_id or ""))
    full_review_pending = (full_ml and claim_status == "closed" and return_status == "delivered"
                           and "return_review_fail" in actions
                           and review_payload_has_pending_seller_action(reviews_list))

    if ml_review_locked:
        prioridade = "full_ml" if full_ml else "outros_problemas"
        prazo = None
        requer_acao = 0
        acao = ("Devolucao em revisao pelo Mercado Livre. Ainda nao e possivel abrir "
                "chamado/mediacao. Aguarde o termino da revisao da plataforma.")
    elif precisa_revisao or return_status in {"delivered", "received"}:
        prioridade = "hoje"
        prazo = review_due_date(claim) or now_iso()
        requer_acao = 1
        acao = ("Produto esta em Para sua revisao no Mercado Livre. Conferir chegada "
                "e decidir se chegou como esperado.")
    elif return_status == "label_generated":
        prazo = now_iso()
        if claim.get("reason_id") == "PDD9967":
            prioridade = "retirar_correio"
            acao = "Devolucao para retirar no correio."
        else:
            prioridade = "outros_problemas"
            acao = "Devolucao aguardando envio/postagem do comprador. Acompanhar no Mercado Livre."
        requer_acao = 0
    elif full_ml:
        prioridade = "full_ml"
        prazo = None
        requer_acao = 0
        acao = "Venda Full sem acao de revisao para a loja neste momento. Acompanhar no Mercado Livre."
    elif return_status in {"delivered", "label_generated"}:
        prioridade = "hoje"
        prazo = now_iso()
        requer_acao = 1
        acao = "Produto chegou ou esta com etiqueta. Preparar vistoria e decisao."
    elif return_status == "shipped":
        prioridade = "amanha"
        prazo = add_days_iso(date_base, 1)
        requer_acao = 1
        acao = "Produto a caminho. Separar caso para vistoria."
    else:
        prioridade = "semana"
        prazo = add_days_iso(date_base, 2)
        requer_acao = 1
        acao = "Aguardando andamento. Monitorar prazo."

    unit_price = float(((order or {}).get("order_items") or [{}])[0].get("unit_price") or 0)
    quantity = float(((order or {}).get("order_items") or [{}])[0].get("quantity") or 1)
    display_id = (order or {}).get("pack_id") or resource_id or claim_id
    financials = order_financials(order)
    return {
        "marketplace": MARKETPLACE,
        "pedido_id": str(display_id),
        "cliente_nome": buyer_name or buyer.get("nickname") or str(buyer.get("id") or "Cliente Mercado Livre"),
        "produto_nome": item.get("title") or "Produto Mercado Livre",
        "motivo_devolucao": (claim.get("reason_id") or claim.get("reason")
                             or (retorno or {}).get("status") or "Devolucao Mercado Livre"),
        "valor_produto": float((order or {}).get("total_amount") or unit_price * quantity or 0),
        "status": "aguardando_plataforma" if ml_review_locked else map_ml_status(claim, retorno),
        "data_solicitacao": claim.get("date_created") or claim.get("date_opened") or now_iso(),
        "codigo_rastreio": (shipment or {}).get("tracking_number") or (shipment or {}).get("id"),
        "valor_recuperado": 0,
        "valor_perdido": 0,
        "observacao_final": f"Importado do Mercado Livre. Claim {claim_id}.",
        "ml_claim_id": str(claim_id),
        "ml_status": claim.get("status") or "",
        "ml_stage": claim.get("stage") or "",
        "ml_return_status": (retorno or {}).get("status") or "",
        "ml_return_id": str(return_id or ""),
        "ml_return_subtype": (retorno or {}).get("subtype") or "",
        "ml_status_money": (retorno or {}).get("status_money") or "",
        "ml_refund_at": (retorno or {}).get("refund_at") or "",
        "ml_seller_status": (retorno or {}).get("seller_status") or "",
        "ml_seller_reason": (retorno or {}).get("seller_reason") or "",
        "ml_product_condition": (retorno or {}).get("product_condition") or "",
        "ml_return_reviews": json_dumps((reviews_payload or {}).get("reviews") or []),
        "ml_destino_devolucao": destination,
        "ml_tipo_logistica": "full_ml" if full_ml else "seller_address",
        "prazo_resolucao": prazo,
        "prioridade_prazo": prioridade,
        "requer_acao": requer_acao,
        "acao_recomendada": acao,
        "produto_imagem": picture,
        "chegada_status": "",
        "mediacao_mensagem": "",
        "ml_ativo": 1 if proxima_atender else 0,
        "ml_tarifa_devolucao": return_cost if return_cost > 0 else extract_tarifa_devolucao(retorno),
        "_full_review_pending": full_review_pending,
        "_claim_resolution": claim.get("resolution") or {},
        **financials,
    }


# ----------------------------------------------------- refresh do cache/sync

def resumo_from_classification_cache() -> dict:
    rows = _linhas("SELECT bucket, COUNT(*) AS total FROM ml_claim_classifications "
                   "WHERE active = 1 GROUP BY bucket")
    counts = {r["bucket"]: int(r["total"] or 0) for r in rows}
    para_revisao = counts.get("para_revisao", 0)
    para_retirar = counts.get("para_retirar", 0)
    outros = counts.get("outros_problemas", 0)
    return {
        "para_revisao": para_revisao, "para_retirar": para_retirar,
        "outros_problemas": outros, "total": para_revisao + para_retirar + outros,
        "fonte": "cache_classificacao_ml",
    }


def _marcar_ativos(active_ids: set) -> None:
    """
    Zera `active` e reativa só os claims desta rodada.

    É o que faz um claim resolvido no ML sumir da fila sem precisar deletar
    linha (o histórico da classificação fica). Feito em lotes porque o SQLite
    tem teto de variáveis por statement (999) e a conta passa disso.
    """
    with SessionLocal() as db:
        db.execute(text("UPDATE ml_claim_classifications SET active = 0"))
        ids = sorted(active_ids)
        for i in range(0, len(ids), 500):
            lote = ids[i:i + 500]
            binds = ", ".join(f":c{j}" for j in range(len(lote)))
            db.execute(text(f"UPDATE ml_claim_classifications SET active = 1 "
                            f"WHERE claim_id IN ({binds})"),
                       {f"c{j}": v for j, v in enumerate(lote)})
        db.commit()


def refresh_ml_classification_cache(user_id: str, sync_run_id: Optional[int] = None,
                                    trace_id: Optional[str] = None) -> dict:
    started = perf_counter()
    claims, declared = ml_live_claims_for_queue(
        user_id, max_pages=env_int("ML_LIVE_QUEUE_MAX_PAGES", 3))
    active_ids: set = set()
    rows: list[dict] = []
    cache_hits = 0
    cache_misses = 0
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=ml_worker_count("ML_LIVE_QUEUE_WORKERS", 4)) as ex:
        futures = {ex.submit(inspect_claim_for_queue, c): c for c in claims}
        for future in as_completed(futures):
            claim = futures[future]
            try:
                item, hit = future.result()
                rows.append(item)
                cache_hits += 1 if hit else 0
                cache_misses += 0 if hit else 1
            except Exception as exc:
                errors.append(f"{claim.get('id')}: {exc}")

    apply_ml_queue_window(rows)
    for item in rows:
        save_claim_classification(item)
        if item.get("claim_id"):
            active_ids.add(str(item["claim_id"]))

    _marcar_ativos(active_ids)

    resumo = resumo_from_classification_cache()
    result = {
        "duracao_ms": int((perf_counter() - started) * 1000),
        "declarados": declared, "inspecionados": len(rows),
        "cache_hits": cache_hits, "cache_misses": cache_misses,
        "erros": errors[:10], "resumo": resumo,
    }
    add_ml_trace_event(trace_id, sync_run_id, "classification_cache_refresh",
                       status="ok" if not errors else "partial", details=result,
                       started_at=started)
    return result


def refresh_local_mediations(sync_run_id: int, trace_id: str) -> dict:
    """Reconsulta os claims em mediação para captar o desfecho."""
    started = perf_counter()
    tracked = _linhas("""
        SELECT DISTINCT ml_claim_id FROM devolucoes
        WHERE ml_claim_id IS NOT NULL AND TRIM(ml_claim_id) <> ''
          AND (status IN ('aguardando_plataforma','contestacao_aberta','divergencia_encontrada',
                          'aprovado','parcial','reprovado')
               OR COALESCE(mediacao_mensagem, '') <> '')
    """)
    claim_ids = [str(r["ml_claim_id"]) for r in tracked if r["ml_claim_id"]]
    updated = 0
    errors: list[str] = []
    for claim_id in claim_ids:
        try:
            claim = ml_get(f"/post-purchase/v1/claims/{claim_id}")
            upsert_ml_devolucao(build_ml_devolucao(claim, sync_run_id))
            updated += 1
        except Exception as exc:
            errors.append(f"{claim_id}: {exc}")
    result = {"monitorados": len(claim_ids), "atualizados": updated, "erros": errors[:10]}
    add_ml_trace_event(trace_id, sync_run_id, "mediation_tracking_refresh",
                       status="ok" if not errors else "partial", details=result,
                       started_at=started)
    return result
