"""
Devoluções ML — handlers HTTP (Starlette).

Portado das rotas Flask de DEVOLUCOES-ML-main/app.py em 15/07/2026.

O que NÃO veio, e por quê:
- `/login`, `/logout`, `require_login`, PIN_MERCADO_LIVRE: já temos auth por
  operador (headers x-operator-*). O `require_login()` que abria cada rota lá
  virou o nosso contexto de operador, aplicado pelo app inteiro.
- `/mercadolivre/auth/start|callback`: temos nosso próprio OAuth em /api/ml/*.
- `/`, `/uploads/<f>`: servidos pelo nosso app/Dockerfile.

Adaptações: jsonify -> JSONResponse, request.args -> request.query_params,
`<int:item_id>` -> request.path_params, sqlite3 -> SQLAlchemy (devolucoes_sync).
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, FileResponse

from app.devolucoes_ml import (
    MLDevolucoesError,
    ml_get,
    claim_available_actions,
    enviar_return_review,
    oferecer_reembolso_total,
    oferecer_reembolso_parcial,
    permitir_devolucao,
)
from app.devolucoes_sync import (
    STATUS_PERMITIDOS,
    _linha,
    _linhas,
    _exec,
    reconciliar_avulsos,
    add_ml_trace_event,
    build_ml_devolucao,
    env_int,
    finish_ml_sync_run,
    ml_live_return_queue,
    ml_worker_count,
    now_iso,
    novo_trace_id,
    refresh_local_mediations,
    refresh_ml_classification_cache,
    resumo_from_classification_cache,
    start_ml_sync_run,
    sync_ml_completo,
    trace_payload,
    upsert_ml_devolucao,
)
from app.integracoes_ml import ml

BUCKETS_VISIVEIS = {"para_revisao", "para_retirar", "outros_problemas"}


def _erro(msg: str, status: int = 400, **extra) -> JSONResponse:
    return JSONResponse({"mensagem": msg, **extra}, status_code=status)


def _ml_pronto() -> Optional[str]:
    """Devolve o user_id do ML, ou None se a integração não estiver configurada."""
    user_id = str(getattr(ml, "user_id", "") or "").strip()
    return user_id or None


# Um sync roda no executor, então um restart do processo (deploy, crash) deixa a
# run em 'running' para sempre. Sem este teto, uma run órfã trancaria o botão com
# 409 até alguém mexer no banco. 40min: o pior caso medido foi ~14min.
SYNC_ORFAO_MINUTOS = 40


def _sync_em_curso(tipo: str) -> Optional[int]:
    """id da sync_run viva deste tipo, ignorando as órfãs de processo morto."""
    row = _linha("""
        SELECT id FROM ml_sync_runs
        WHERE tipo = :t AND status = 'running'
          AND datetime(iniciado_em) > datetime('now', :janela)
        ORDER BY id DESC LIMIT 1
    """, {"t": tipo, "janela": f"-{SYNC_ORFAO_MINUTOS} minutes"})
    return int(row["id"]) if row else None


# ------------------------------------------------------------------ listagem

async def listar_devolucoes(request: Request):
    q = request.query_params
    clauses = ["1=1"]
    params: dict = {}

    if q.get("incluir_inativos") != "true":
        clauses.append("COALESCE(ml_ativo, 1) = 1")
    for key in ("status", "marketplace"):
        valor = (q.get(key) or "").strip()
        if valor:
            clauses.append(f"{key} = :{key}")
            params[key] = valor
    busca = (q.get("busca") or "").strip()
    if busca:
        clauses.append("(pedido_id LIKE :b OR cliente_nome LIKE :b OR produto_nome LIKE :b "
                       "OR codigo_rastreio LIKE :b OR ml_claim_id LIKE :b)")
        params["b"] = f"%{busca}%"
    prioridade = (q.get("prioridade") or "").strip()
    if prioridade:
        clauses.append("prioridade_prazo = :prio")
        params["prio"] = prioridade
    if q.get("requer_acao") == "true":
        clauses.append("requer_acao = 1")

    rows = _linhas(f"""
        SELECT * FROM devolucoes
        WHERE {' AND '.join(clauses)}
        ORDER BY
          CASE prioridade_prazo
            WHEN 'hoje' THEN 1 WHEN 'amanha' THEN 2 WHEN 'semana' THEN 3
            WHEN 'full_ml' THEN 4 ELSE 5
          END,
          datetime(COALESCE(prazo_resolucao, data_solicitacao)) ASC,
          id DESC
    """, params)
    return JSONResponse(rows)


async def buscar_devolucao(request: Request):
    item_id = int(request.path_params["item_id"])
    row = _linha("SELECT * FROM devolucoes WHERE id = :i", {"i": item_id})
    if not row:
        return _erro("Devolucao nao encontrada", 404)
    return JSONResponse(row)


async def historico_devolucao(request: Request):
    item_id = int(request.path_params["item_id"])
    return JSONResponse(_linhas(
        "SELECT * FROM historico_status WHERE devolucao_id = :i ORDER BY id DESC",
        {"i": item_id}))


MEDIATION_FINAL_STATUSES = {"aprovado", "parcial", "reprovado"}


async def listar_mediacoes(request: Request):
    rows = _linhas("""
        SELECT d.* FROM devolucoes d
        WHERE (
            d.status IN ('aguardando_plataforma','contestacao_aberta','aprovado','parcial','reprovado')
            OR COALESCE(d.mediacao_mensagem, '') <> ''
            OR EXISTS (SELECT 1 FROM contestacoes c WHERE c.devolucao_id = d.id)
        )
        ORDER BY datetime(COALESCE(d.ultima_sincronizacao_ml, d.data_solicitacao)) DESC
    """)
    # situacao_mediacao é derivada, não é coluna: a tela conta "Chamados"
    # (processando) e "Reembolso" (concluida) em cima dela.
    for r in rows:
        status = str(r.get("status") or "").lower()
        r["situacao_mediacao"] = ("concluida" if status in MEDIATION_FINAL_STATUSES
                                  else "processando")
    return JSONResponse(rows)


# -------------------------------------------------------------- filas / cards

async def cards_por_bucket(request: Request):
    bucket = (request.query_params.get("bucket") or "").strip()
    if bucket not in BUCKETS_VISIVEIS:
        return _erro(f"Bucket invalido. Use um de: {sorted(BUCKETS_VISIVEIS)}")
    rows = _linhas("""
        SELECT claim_id, pedido_id, pack_id, order_ids, bucket, regra,
               reason_id, motivo_label, produto_nome, produto_imagem,
               valor_pago, taxa_venda, ml_tipo_logistica,
               return_status, shipment_status, shipment_destination,
               mandatory, due_date, date_created, last_updated
        FROM ml_claim_classifications
        WHERE active = 1 AND bucket = :b
        ORDER BY
          CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
          due_date ASC, last_updated DESC
    """, {"b": bucket})
    for r in rows:
        try:
            r["order_ids"] = json.loads(r.get("order_ids") or "[]")
        except json.JSONDecodeError:
            r["order_ids"] = []
    return JSONResponse({"bucket": bucket, "total": len(rows), "cards": rows})


async def resumo_ml(request: Request):
    return JSONResponse(resumo_from_classification_cache())


async def filtros_ml(request: Request):
    resumo = resumo_from_classification_cache()
    return JSONResponse({"fonte": resumo["fonte"], "proximas": resumo})


async def fila_ml_live(request: Request):
    """Fila calculada AO VIVO no ML (lenta). O normal é usar /cards, que lê o cache."""
    user_id = _ml_pronto()
    if not user_id:
        return _erro("Mercado Livre nao configurado (ML_USER_ID ausente).")
    try:
        return JSONResponse(ml_live_return_queue(user_id))
    except MLDevolucoesError as exc:
        return _erro("Nao foi possivel calcular a fila ao vivo do Mercado Livre", 400, erro=str(exc))
    except Exception as exc:
        return _erro("Nao foi possivel calcular a fila ao vivo do Mercado Livre", 400, erro=str(exc))


async def painel_pos_venda(request: Request):
    """
    Todos os números do painel numa consulta só.

    Existe por causa do peso: a tela montava isso no navegador a partir de
    /api/devolucoes + /api/devolucoes/mediacoes — 4 MB de JSON (1300+ linhas
    com todas as colunas) baixados a cada abertura para exibir sete contadores.
    Agregado em SQL a resposta cabe em bytes e a tela abre instantânea; a lista
    completa só é buscada quando o operador abre o painel flutuante.

    As regras replicam 1:1 as do layout original (ver Devolucoes.tsx).
    """
    FINAIS = "('aprovado','parcial','reprovado','encerrado','sem_divergencia')"
    MEDIACAO_FINAL = "('aprovado','parcial','reprovado')"
    EM_MEDIACAO = ("(d.status IN ('aguardando_plataforma','contestacao_aberta','aprovado',"
                   "'parcial','reprovado') OR COALESCE(d.mediacao_mensagem,'') <> '' "
                   "OR EXISTS (SELECT 1 FROM contestacoes c WHERE c.devolucao_id = d.id))")

    row = _linha(f"""
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN {EM_MEDIACAO} AND d.status NOT IN {MEDIACAO_FINAL}
                   THEN 1 ELSE 0 END) AS chamados,
          SUM(CASE WHEN {EM_MEDIACAO} AND d.status IN {MEDIACAO_FINAL}
                   THEN 1 ELSE 0 END) AS reembolsos,
          SUM(CASE WHEN (d.motivo_devolucao = 'PDD9952'
                         OR LOWER(COALESCE(d.acao_recomendada,'')) LIKE '%reputa%')
                    AND d.status NOT IN {FINAIS} THEN 1 ELSE 0 END) AS riscos,
          COALESCE(SUM(ABS(COALESCE(d.ml_tarifa_devolucao, 0))), 0) AS total_tarifas,
          SUM(CASE WHEN COALESCE(d.etapa_checklist_atual, 0) > 0
                    AND d.status NOT IN {FINAIS} THEN 1 ELSE 0 END) AS checklists_ativos,
          SUM(CASE WHEN d.status IN ('produto_recebido','divergencia_encontrada','em_analise')
                    AND COALESCE(d.requer_acao, 1) = 1 THEN 1 ELSE 0 END) AS aguardando,
          -- "perto do vencimento" = urgência crítica ou alta = prazo em até 3 dias.
          -- O '-3 hours' converte para o fuso de Brasília antes de cortar o dia:
          -- o ML manda o prazo em -04:00 e o SQLite normaliza para UTC, então um
          -- prazo de 20/07 23:34 (BRT) viraria 21/07 e ficaria 1 dia fora da conta.
          SUM(CASE WHEN d.status NOT IN {FINAIS}
                    AND d.prazo_resolucao IS NOT NULL AND TRIM(d.prazo_resolucao) <> ''
                    AND date(datetime(d.prazo_resolucao, '-3 hours'))
                        <= date('now', '-3 hours', '+3 day')
                   THEN 1 ELSE 0 END) AS perto
        FROM devolucoes d
        WHERE COALESCE(d.ml_ativo, 1) = 1
    """) or {}

    total = int(row.get("total") or 0)
    ativos = int(row.get("checklists_ativos") or 0)
    return JSONResponse({
        "total": total,
        "chamados": int(row.get("chamados") or 0),
        "reembolsos": int(row.get("reembolsos") or 0),
        "riscos": int(row.get("riscos") or 0),
        "total_tarifas": float(row.get("total_tarifas") or 0),
        "checklists_ativos": ativos,
        "aguardando": int(row.get("aguardando") or 0),
        "perto": int(row.get("perto") or 0),
        "pct_pendencias": round((ativos / total) * 100) if total else 0,
    })


async def resumo_financeiro(request: Request):
    row = _linha("""
        SELECT COUNT(*) as total_devolucoes,
               SUM(CASE WHEN status = 'aprovado' THEN 1 ELSE 0 END) as total_aprovadas,
               SUM(CASE WHEN status = 'parcial'  THEN 1 ELSE 0 END) as total_parciais,
               SUM(CASE WHEN status = 'reprovado' THEN 1 ELSE 0 END) as total_reprovadas,
               COALESCE(SUM(valor_recuperado), 0) as valor_recuperado,
               COALESCE(SUM(valor_perdido), 0) as valor_perdido
        FROM devolucoes
    """)
    return JSONResponse(row or {})


# --------------------------------------------------- esteira "chegando hoje"

# O -3h converte o instante do ML (que vem em -03:00/-04:00, normalizado p/ UTC
# pelo SQLite) para o dia de Brasília antes de cortar — mesma convenção do painel.
_HOJE_BRT = "date('now', '-3 hours')"


async def chegando_hoje(request: Request):
    """
    Fila do barracão: devoluções a caminho do endereço do vendedor que ainda não
    foram bipadas — o operador bipa conforme cada uma chega fisicamente.

    O ML NÃO entrega uma data de previsão barata: o `lead_time` vem null no
    payload do retorno (ficaria em /shipments/{id}, uma chamada extra por item).
    Então a esteira não filtra por "hoje" — mostra o pool que está vindo
    (shipment shipped/delivered, destino seller_address), ordenado pelo prazo.
    Só ficam de fora as que voltam pro FULL (destino warehouse).
    """
    rows = _linhas("""
        SELECT claim_id, pedido_id, pack_id, order_ids, produto_nome, produto_imagem,
               valor_pago, ml_tipo_logistica, motivo_label, previsao_chegada,
               shipment_status, shipment_destination, due_date
        FROM ml_claim_classifications
        WHERE active = 1
          AND COALESCE(recebido_em, '') = ''
          AND shipment_destination = 'seller_address'
          AND shipment_status IN ('shipped', 'delivered')
          AND bucket IN ('para_retirar', 'para_revisao')
        ORDER BY CASE WHEN COALESCE(due_date, '') = '' THEN 1 ELSE 0 END, due_date ASC
    """)
    for r in rows:
        try:
            r["order_ids"] = json.loads(r.get("order_ids") or "[]")
        except json.JSONDecodeError:
            r["order_ids"] = []
    return JSONResponse({"total": len(rows), "cards": rows})


async def chegando_resumo(request: Request):
    """
    Fase 3 — separa a QUANTIDADE A CHEGAR por destino: o que vem pro seu barracão
    (seller_address, bipável) vs o que volta pro FULL/warehouse do ML (rastreado,
    não bipado). Amarra no projeto de devolução do FULL.
    """
    row = _linha("""
        SELECT
          SUM(CASE WHEN shipment_destination = 'seller_address'
                    AND shipment_status IN ('shipped','delivered')
                    AND bucket IN ('para_retirar','para_revisao')
                    AND COALESCE(recebido_em,'') = '' THEN 1 ELSE 0 END) AS barracao,
          SUM(CASE WHEN shipment_destination = 'seller_address'
                    AND shipment_status IN ('shipped','delivered')
                    AND bucket IN ('para_retirar','para_revisao')
                    AND COALESCE(recebido_em,'') <> '' THEN 1 ELSE 0 END) AS barracao_recebido,
          SUM(CASE WHEN shipment_destination = 'warehouse'
                    AND shipment_status IN ('shipped','ready_to_ship') THEN 1 ELSE 0 END) AS full_a_caminho
        FROM ml_claim_classifications WHERE active = 1
    """) or {}
    return JSONResponse({
        "barracao_a_chegar": int(row.get("barracao") or 0),
        "barracao_recebido": int(row.get("barracao_recebido") or 0),
        "full_a_caminho": int(row.get("full_a_caminho") or 0),
    })


# ----------------------------------------------- recebidos filtráveis (Fase 2)

def _full_ou_organica(tipo: Optional[str]) -> str:
    return "full" if str(tipo or "") == "full_ml" else "organica"


async def recebidos(request: Request):
    """
    Fase 2 — tudo que foi bipado/recebido, com os campos para o operador FILTRAR
    (motivo, situação/bucket, logística FULL vs orgânica, urgência por prazo). A
    filtragem em si é no cliente: o conjunto de recebidos é pequeno e cabe de uma.
    """
    rows = _linhas("""
        SELECT claim_id, pedido_id, produto_nome, produto_imagem, valor_pago,
               motivo_label, bucket, shipment_status, shipment_destination,
               ml_tipo_logistica, due_date, recebido_em, mandatory
        FROM ml_claim_classifications
        WHERE active = 1 AND COALESCE(recebido_em,'') <> ''
        ORDER BY recebido_em DESC
    """)
    for r in rows:
        r["logistica"] = _full_ou_organica(r.get("ml_tipo_logistica"))
    # Facetas para os chips (contagem por dimensão).
    def conta(chave):
        acc = {}
        for r in rows:
            acc[r.get(chave) or "—"] = acc.get(r.get(chave) or "—", 0) + 1
        return acc
    return JSONResponse({
        "total": len(rows), "itens": rows,
        "facetas": {
            "bucket": conta("bucket"),
            "logistica": conta("logistica"),
            "motivo": conta("motivo_label"),
        },
    })


async def bipar_chegada(request: Request):
    """
    Bipagem no barracão: cruza o código lido (venda, pacote ou rastreio) com a
    fila e marca o item como recebido → em espera de resolução.

    Casa por dígitos contra pedido_id, pack_id ou qualquer um dos order_ids. Não
    exige que a previsão seja hoje: um item que chegou adiantado também bipa.
    """
    body = await request.json()
    codigo = re.sub(r"\D", "", str(body.get("codigo") or ""))
    if not codigo:
        return _erro("Informe o código bipado (pedido, pacote ou rastreio).")

    # O operador bipa a ETIQUETA (shipment_id, ex.: 47533782341). Também casamos
    # pedido/pacote/order_ids e o tracking (MEL<shipment_id>...) via LIKE.
    row = _linha("""
        SELECT claim_id, pedido_id, produto_nome, produto_imagem, recebido_em,
               bucket, shipment_status, shipment_destination
        FROM ml_claim_classifications
        WHERE active = 1
          AND (pedido_id = :c OR pack_id = :c OR shipment_id = :c
               OR order_ids LIKE :like OR tracking_number LIKE :like2)
        LIMIT 1
    """, {"c": codigo, "like": f'%"{codigo}"%', "like2": f'%{codigo}%'})
    if not row:
        return _bipar_fallback_ao_vivo(codigo)
    situacao = {"bucket": row.get("bucket"),
                "shipment_status": row.get("shipment_status"),
                "shipment_destination": row.get("shipment_destination")}
    if row.get("recebido_em"):
        return JSONResponse({"mensagem": "Este item já foi bipado.", "ja_recebido": True,
                             "claim_id": row["claim_id"],
                             "produto_nome": row.get("produto_nome"), **situacao})

    quando = now_iso()
    _exec("UPDATE ml_claim_classifications SET recebido_em = :d WHERE claim_id = :c",
          {"d": quando, "c": row["claim_id"]})
    return JSONResponse({"mensagem": "Recebido — em espera de resolução",
                         "claim_id": row["claim_id"],
                         "produto_nome": row.get("produto_nome"),
                         "produto_imagem": row.get("produto_imagem"),
                         "recebido_em": quando, **situacao})


def _shipment_ao_vivo(codigo: str) -> dict:
    """Consulta /shipments/{id} best-effort — valida a etiqueta e tenta o pedido."""
    try:
        sh = ml_get(f"/shipments/{codigo}") or {}
    except Exception:
        return {}
    return {
        "order_id": str(sh.get("order_id") or ""),
        "status": str(sh.get("status") or ""),
        "raw": sh,
    }


def _bipar_fallback_ao_vivo(codigo: str) -> JSONResponse:
    """
    A etiqueta não está no cache (devolução nova, fora da janela do sync). O bipe
    NÃO pode travar a operação: valida no ML ao vivo, registra o recebimento
    avulso e vincula à devolução no próximo sync (reconciliar_avulsos). Se por
    sorte o pedido já estiver no cache, casa e marca recebido na hora.
    """
    quando = now_iso()
    vivo = _shipment_ao_vivo(codigo)
    order_id = vivo.get("order_id") or ""

    # O pedido já pode estar no cache mesmo sem o shipment_id preenchido.
    if order_id:
        row = _linha("""
            SELECT claim_id, produto_nome, produto_imagem, recebido_em, bucket,
                   shipment_status, shipment_destination
            FROM ml_claim_classifications
            WHERE active = 1 AND (pedido_id = :o OR order_ids LIKE :ol) LIMIT 1
        """, {"o": order_id, "ol": f'%"{order_id}"%'})
        if row:
            if not row.get("recebido_em"):
                _exec("UPDATE ml_claim_classifications SET recebido_em = :d, shipment_id = :s "
                      "WHERE claim_id = :c",
                      {"d": quando, "s": codigo, "c": row["claim_id"]})
            return JSONResponse({"mensagem": "Recebido — em espera de resolução",
                                 "claim_id": row["claim_id"],
                                 "produto_nome": row.get("produto_nome"),
                                 "produto_imagem": row.get("produto_imagem"),
                                 "recebido_em": quando, "via": "fallback_pedido",
                                 "bucket": row.get("bucket"),
                                 "shipment_status": row.get("shipment_status"),
                                 "shipment_destination": row.get("shipment_destination")})

    # Não achou nem pelo pedido: registra avulso para vincular no próximo sync.
    _exec("""INSERT INTO recebimentos_avulsos (codigo, order_id, shipment_status, recebido_em, info)
             VALUES (:c, :o, :st, :d, :info)""",
          {"c": codigo, "o": order_id, "st": vivo.get("status") or "",
           "d": quando, "info": json.dumps(vivo.get("raw") or {})[:4000]})
    reconciliar_avulsos()  # tenta vincular já, caso o claim esteja no cache
    achou_ml = bool(vivo)
    return JSONResponse({
        "mensagem": ("Recebido e registrado — vou vincular à devolução no próximo sync."
                     if achou_ml else
                     "Recebido e registrado. Código não confirmado no ML ainda — "
                     "será vinculado quando sincronizar."),
        "avulso": True, "recebido_em": quando, "codigo": codigo,
        "order_id": order_id, "confirmado_ml": achou_ml})


# ------------------------------------------- shipment ao vivo (debug/aprendizado)

async def debug_shipment(request: Request):
    """Retorna /shipments/{sid} cru — para mapear a forma real do payload."""
    sid = re.sub(r"\D", "", request.query_params.get("sid") or "")
    if not sid:
        return _erro("passe ?sid=<shipment_id>")
    try:
        return JSONResponse({"sid": sid, "shipment": ml_get(f"/shipments/{sid}")})
    except Exception as exc:
        return _erro(f"ml_get falhou: {exc}", 502)


# ------------------------------------------- diff vs ML Seller Center (debug)

_BUCKETS_VISIVEIS = ("para_revisao", "para_retirar", "outros_problemas")


def _so_digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


async def diff_seller_center(request: Request):
    """
    Diagnóstico read-only: recebe os IDs que o ML lista em "Próximas a serem
    atendidas" e mostra, claim a claim, onde a NOSSA classificação diverge —
    a coluna `regra` explica POR QUE cada um caiu no balde em que caiu.

    Não altera nada. Body: {"ids": ["2000...", "5417...", ...]} (aceita número
    de venda/pedido, pacote, order_id ou claim_id — casa por dígitos).
    """
    body = await request.json()
    ids = {_so_digitos(x) for x in (body.get("ids") or [])}
    ids.discard("")
    if not ids:
        return _erro("Envie 'ids': a lista de números que o ML mostra na fila.")

    rows = _linhas("""
        SELECT claim_id, pedido_id, pack_id, order_ids, bucket, regra,
               produto_nome, shipment_destination
        FROM ml_claim_classifications WHERE active = 1
    """)

    def chaves(r: dict) -> set:
        ks = {_so_digitos(r.get("claim_id")), _so_digitos(r.get("pedido_id")),
              _so_digitos(r.get("pack_id"))}
        try:
            ks.update(_so_digitos(o) for o in json.loads(r.get("order_ids") or "[]"))
        except json.JSONDecodeError:
            pass
        ks.discard("")
        return ks

    idx: dict = {}
    for r in rows:
        for k in chaves(r):
            idx.setdefault(k, r)

    ml_mostra_nos_escondemos, nao_encontrados = [], []
    for i in sorted(ids):
        r = idx.get(i)
        if not r:
            nao_encontrados.append(i)
        elif r["bucket"] not in _BUCKETS_VISIVEIS:
            ml_mostra_nos_escondemos.append({
                "id": i, "claim_id": r["claim_id"], "bucket": r["bucket"],
                "regra": r["regra"], "produto_nome": r["produto_nome"],
                "destino": r["shipment_destination"],
            })

    nos_mostramos_ml_nao = [
        {"claim_id": r["claim_id"], "pedido_id": r["pedido_id"], "bucket": r["bucket"],
         "regra": r["regra"], "produto_nome": r["produto_nome"]}
        for r in rows
        if r["bucket"] in _BUCKETS_VISIVEIS and not (chaves(r) & ids)
    ]

    return JSONResponse({
        "recebidos": len(ids),
        "ml_mostra_nos_escondemos": ml_mostra_nos_escondemos,
        "nos_mostramos_ml_nao": nos_mostramos_ml_nao,
        "nao_encontrados_no_cache": nao_encontrados,
        "resumo": {
            "ml_mostra_nos_escondemos": len(ml_mostra_nos_escondemos),
            "nos_mostramos_ml_nao": len(nos_mostramos_ml_nao),
            "nao_encontrados": len(nao_encontrados),
        },
    })


# ------------------------------------------------------------------- sync

def _rodar_sync_rapido(user_id: str, sync_run_id: int, trace_id: str) -> None:
    """Corpo do sync da fila, fora do event loop (chamado em threadpool)."""
    from time import perf_counter
    sync_started = perf_counter()
    try:
        cache_result = refresh_ml_classification_cache(user_id, sync_run_id, trace_id)
        refresh_local_mediations(sync_run_id, trace_id)
        resumo = cache_result["resumo"]
        resumo["fonte"] = "mercado_livre_cache_classificacao"
        add_ml_trace_event(trace_id, sync_run_id, "summary_database", details={
            k: resumo.get(k) for k in ("total", "para_revisao", "para_retirar", "outros_problemas")})
        finish_ml_sync_run(
            sync_run_id,
            status="success" if not cache_result["erros"] else "partial",
            total_declarado=sum(int(v or 0) for v in cache_result["declarados"].values()),
            total_encontrado=cache_result["inspecionados"],
            total_processado=cache_result["cache_misses"],
            total_erros=len(cache_result["erros"]),
            detalhes={"trace_id": trace_id, **cache_result})
        add_ml_trace_event(trace_id, sync_run_id, "sync_finish",
                           status="success" if not cache_result["erros"] else "partial",
                           details=cache_result, started_at=sync_started)
    except Exception as exc:
        finish_ml_sync_run(sync_run_id, status="error", total_erros=1,
                           detalhes={"erro": str(exc)})
        add_ml_trace_event(trace_id, sync_run_id, "sync_finish", status="error",
                           details={"erro": str(exc)}, started_at=sync_started)


async def sincronizar_ml(request: Request):
    """
    Dispara o refresh da fila e volta na hora (202). Ver sincronizar_ml_completo:
    o proxy do Railway derruba a conexão antes de um sync destes terminar.

    O passo a passo vai para ml_trace_events sob um trace_id — é como se
    diagnostica um sync que veio torto, via /sync-trace/{trace_id}.
    """
    trace_id = novo_trace_id()
    user_id = _ml_pronto()
    if not user_id:
        return _erro("Mercado Livre nao configurado (ML_USER_ID ausente).")

    em_curso = _sync_em_curso("classification_cache")
    if em_curso:
        return JSONResponse({"mensagem": "Ja existe uma atualizacao da fila em andamento",
                             "sync_run_id": em_curso, "status": "running"},
                            status_code=409)

    sync_run_id = start_ml_sync_run("classification_cache",
                                    {"user_id": user_id, "trace_id": trace_id})
    add_ml_trace_event(trace_id, sync_run_id, "sync_start", details={
        "tipo": "classification_cache", "user_id": user_id, "modo": "background",
        "max_pages": env_int("ML_LIVE_QUEUE_MAX_PAGES", 3),
        "closed_returns_pages": env_int("ML_LIVE_QUEUE_CLOSED_RETURNS_PAGES", 2),
        "closed_mediations_pages": env_int("ML_LIVE_QUEUE_CLOSED_MEDIATIONS_PAGES", 5),
        "sort": "last_updated:desc",
        "workers": ml_worker_count("ML_LIVE_QUEUE_WORKERS", 4),
    })
    asyncio.get_running_loop().run_in_executor(
        None, _rodar_sync_rapido, user_id, sync_run_id, trace_id)
    return JSONResponse({"mensagem": "Atualizacao da fila iniciada",
                         "sync_run_id": sync_run_id, "trace_id": trace_id,
                         "status": "running"}, status_code=202)


def _rodar_sync_completo(user_id: str, sync_run_id: int, trace_id: str) -> None:
    """Corpo do sync completo, já fora do event loop (chamado em threadpool)."""
    try:
        resultado = sync_ml_completo(user_id, sync_run_id, trace_id)
        finish_ml_sync_run(
            sync_run_id,
            status="success" if not resultado["erros"] else "partial",
            total_declarado=resultado["encontrados"],
            total_encontrado=resultado["encontrados"],
            total_processado=resultado["processados"],
            total_erros=resultado["total_erros"],
            detalhes={"trace_id": trace_id, **resultado})
    except Exception as exc:
        finish_ml_sync_run(sync_run_id, status="error", total_erros=1,
                           detalhes={"erro": str(exc), "trace_id": trace_id})


async def sincronizar_ml_completo(request: Request):
    """
    Dispara o sync pesado e volta na hora (202) — NÃO espera terminar.

    Ele leva ~5min e o proxy do Railway derruba a conexão antes disso: o sync
    terminava certo no servidor, mas o navegador recebia "upstream error" (texto
    puro do gateway) e o operador via um erro no lugar do sucesso. Agora a rota
    só agenda; quem acompanha é /sync-status/{sync_run_id}.
    """
    trace_id = novo_trace_id()
    user_id = _ml_pronto()
    if not user_id:
        return _erro("Mercado Livre nao configurado (ML_USER_ID ausente).")

    em_curso = _sync_em_curso("completo")
    if em_curso:
        return JSONResponse({"mensagem": "Ja existe uma sincronizacao completa em andamento",
                             "sync_run_id": em_curso, "status": "running"},
                            status_code=409)

    sync_run_id = start_ml_sync_run("completo", {"user_id": user_id, "trace_id": trace_id})
    add_ml_trace_event(trace_id, sync_run_id, "sync_start",
                       details={"tipo": "completo", "user_id": user_id, "modo": "background"})
    asyncio.get_running_loop().run_in_executor(
        None, _rodar_sync_completo, user_id, sync_run_id, trace_id)
    return JSONResponse({"mensagem": "Sincronizacao completa iniciada",
                         "sync_run_id": sync_run_id, "trace_id": trace_id,
                         "status": "running"}, status_code=202)


async def sync_status(request: Request):
    """Progresso de uma sync_run — o cliente faz polling aqui enquanto roda."""
    run_id = int(request.path_params["sync_run_id"])
    row = _linha("SELECT * FROM ml_sync_runs WHERE id = :i", {"i": run_id})
    if not row:
        return _erro("Sincronizacao nao encontrada", 404)
    try:
        row["detalhes"] = json.loads(row.get("detalhes") or "{}")
    except json.JSONDecodeError:
        row["detalhes"] = {}
    return JSONResponse(row)


async def sync_diagnostico(request: Request):
    runs = _linhas("SELECT * FROM ml_sync_runs ORDER BY id DESC LIMIT 20")
    for r in runs:
        try:
            r["detalhes"] = json.loads(r.get("detalhes") or "{}")
        except json.JSONDecodeError:
            r["detalhes"] = {}
    diffs = _linhas("SELECT * FROM ml_reconciliation_diffs ORDER BY id DESC LIMIT 50")
    return JSONResponse({"runs": runs, "diffs": diffs})


async def sync_trace_ultimo(request: Request):
    row = _linha("SELECT trace_id FROM ml_trace_events ORDER BY id DESC LIMIT 1")
    if not row:
        return JSONResponse({"trace_id": None, "sync_run": None, "eventos": []})
    return JSONResponse(trace_payload(str(row["trace_id"])))


async def sync_trace(request: Request):
    return JSONResponse(trace_payload(str(request.path_params["trace_id"])))


# ---------------------------------------------------- conferência da chegada

async def confirmar_chegada(request: Request):
    """
    Registra a conferência física: chegou como esperado ou com divergência.

    O status é o que o upsert do sync respeita depois — 'sem_divergencia' com
    chegada 'esperado' faz a devolução parar de pedir ação.
    """
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    chegada = str(body.get("chegada_status") or "").strip()
    if chegada not in {"esperado", "divergente", "nao_chegou"}:
        return _erro("chegada_status deve ser: esperado, divergente ou nao_chegou")

    row = _linha("SELECT * FROM devolucoes WHERE id = :i", {"i": item_id})
    if not row:
        return _erro("Devolucao nao encontrada", 404)

    novo_status = {"esperado": "sem_divergencia",
                   "divergente": "divergencia_encontrada",
                   "nao_chegou": "nao_recebido"}[chegada]
    observacao = str(body.get("observacao") or "").strip()

    _exec("""UPDATE devolucoes
             SET chegada_status = :ch, status = :st, requer_acao = :ra,
                 observacao_final = :obs, ml_ativo = :ativo
             WHERE id = :i""",
          {"ch": chegada, "st": novo_status,
           "ra": 0 if chegada == "esperado" else 1,
           "obs": observacao or row.get("observacao_final") or "",
           "ativo": 0 if chegada == "esperado" else 1,
           "i": item_id})
    _exec("""INSERT INTO historico_status (devolucao_id, status_anterior, status_novo, data_alteracao)
             VALUES (:i, :ant, :novo, :d)""",
          {"i": item_id, "ant": row.get("status") or "", "novo": novo_status, "d": now_iso()})
    return JSONResponse({"mensagem": "Chegada registrada", "status": novo_status,
                         "chegada_status": chegada})


# ------------------------------------------------------------- checklist

async def get_checklist(request: Request):
    item_id = int(request.path_params["item_id"])
    return JSONResponse(_linha("SELECT * FROM checklists WHERE devolucao_id = :i",
                               {"i": item_id}) or {})


CHECKLIST_FLAGS = [
    "produto_confere", "embalagem_integra", "possui_sinais_de_uso", "item_quebrado",
    "faltando_pecas", "motivo_confere", "embalagem_rasgada", "produto_amassado",
    "produto_riscado", "produto_quebrado", "produto_sujo", "faltando_acessorios",
    "produto_errado", "sem_embalagem_original",
]


async def salvar_checklist(request: Request):
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    if not _linha("SELECT id FROM devolucoes WHERE id = :i", {"i": item_id}):
        return _erro("Devolucao nao encontrada", 404)

    params = {f: (int(bool(body[f])) if body.get(f) is not None else None)
              for f in CHECKLIST_FLAGS}
    params["observacoes"] = str(body.get("observacoes") or "")
    params["data_checklist"] = now_iso()
    params["devolucao_id"] = item_id

    existente = _linha("SELECT id FROM checklists WHERE devolucao_id = :i", {"i": item_id})
    if existente:
        sets = ", ".join(f"{f} = :{f}" for f in CHECKLIST_FLAGS + ["observacoes", "data_checklist"])
        _exec(f"UPDATE checklists SET {sets} WHERE devolucao_id = :devolucao_id", params)
    else:
        cols = CHECKLIST_FLAGS + ["observacoes", "data_checklist", "devolucao_id"]
        _exec(f"INSERT INTO checklists ({', '.join(cols)}) "
              f"VALUES ({', '.join(':' + c for c in cols)})", params)
    return JSONResponse({"mensagem": "Checklist salvo"})


async def salvar_progresso_checklist(request: Request):
    """Guarda em que etapa o operador parou, p/ retomar a conferência depois."""
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    _exec("""UPDATE devolucoes
             SET etapa_checklist_atual = :etapa, conteudo_progresso_checklist = :cont
             WHERE id = :i""",
          {"etapa": int(body.get("etapa") or 0),
           "cont": json.dumps(body.get("conteudo") or {}, ensure_ascii=False),
           "i": item_id})
    return JSONResponse({"mensagem": "Progresso salvo"})


async def historico_incompletos(request: Request):
    return JSONResponse(_linhas("""
        SELECT d.* FROM devolucoes d
        LEFT JOIN checklists c ON c.devolucao_id = d.id
        WHERE c.id IS NULL AND d.status IN ('produto_recebido','em_analise')
        ORDER BY d.id DESC
    """))


# ------------------------------------------------------------ evidências

async def listar_evidencias(request: Request):
    item_id = int(request.path_params["item_id"])
    return JSONResponse(_linhas(
        "SELECT * FROM evidencias WHERE devolucao_id = :i ORDER BY id DESC", {"i": item_id}))


# --------------------------------------------------------- contestações

async def listar_contestacoes(request: Request):
    item_id = int(request.path_params["item_id"])
    rows = _linhas("SELECT * FROM contestacoes WHERE devolucao_id = :i ORDER BY id DESC",
                   {"i": item_id})
    for r in rows:
        try:
            r["evidencia_ids"] = json.loads(r.get("evidencia_ids") or "[]")
        except json.JSONDecodeError:
            r["evidencia_ids"] = []
    return JSONResponse(rows)


async def criar_contestacao(request: Request):
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    if not _linha("SELECT id FROM devolucoes WHERE id = :i", {"i": item_id}):
        return _erro("Devolucao nao encontrada", 404)
    _exec("""INSERT INTO contestacoes (devolucao_id, tipo_divergencia, descricao,
                                       valor_contestado, evidencia_ids, texto_contestacao,
                                       status, data_abertura)
             VALUES (:i, :tipo, :desc, :valor, :evid, :texto, 'aberta', :d)""",
          {"i": item_id, "tipo": str(body.get("tipo_divergencia") or ""),
           "desc": str(body.get("descricao") or ""),
           "valor": float(body.get("valor_contestado") or 0),
           "evid": json.dumps(body.get("evidencia_ids") or []),
           "texto": str(body.get("texto_contestacao") or ""), "d": now_iso()})
    _exec("UPDATE devolucoes SET status = 'contestacao_aberta' WHERE id = :i", {"i": item_id})
    return JSONResponse({"mensagem": "Contestacao aberta"}, status_code=201)


# ---------------------------------------------------------- criação manual

async def criar_devolucao(request: Request):
    body = await request.json()
    obrigatorios = ["pedido_id", "cliente_nome", "produto_nome", "motivo_devolucao", "valor_produto"]
    faltando = [c for c in obrigatorios if not body.get(c)]
    if faltando:
        return _erro(f"Campos obrigatorios ausentes: {', '.join(faltando)}")
    status = str(body.get("status") or "aguardando_produto")
    if status not in STATUS_PERMITIDOS:
        return _erro(f"Status invalido. Use um de: {sorted(STATUS_PERMITIDOS)}")
    _exec("""INSERT INTO devolucoes (marketplace, pedido_id, cliente_nome, produto_nome,
                                     motivo_devolucao, valor_produto, status, data_solicitacao,
                                     codigo_rastreio)
             VALUES (:mp, :ped, :cli, :prod, :mot, :val, :st, :d, :rast)""",
          {"mp": str(body.get("marketplace") or "Mercado Livre"),
           "ped": str(body["pedido_id"]), "cli": str(body["cliente_nome"]),
           "prod": str(body["produto_nome"]), "mot": str(body["motivo_devolucao"]),
           "val": float(body["valor_produto"]), "st": status, "d": now_iso(),
           "rast": str(body.get("codigo_rastreio") or "")})
    return JSONResponse({"mensagem": "Devolucao criada"}, status_code=201)


# ============================================================================
# Fase 3 — Custos e prejuízos
# ============================================================================

EMBALAGEM_KEY = "devolucao_custo_embalagem"
EMBALAGEM_DEFAULT = 0.50


def _mes_brt(quando: Optional[str] = None) -> str:
    """Mês YYYY-MM no fuso de Brasília (o ML manda tudo em UTC)."""
    base = (datetime.fromisoformat(quando.replace("Z", "+00:00"))
            if quando else datetime.now(timezone.utc))
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return (base.astimezone(timezone.utc) - timedelta(hours=3)).strftime("%Y-%m")


def _config_get_float(chave: str, default: float) -> float:
    row = _linha("SELECT valor FROM configuracoes_app WHERE chave = :c", {"c": chave})
    if not row:
        return default
    try:
        return float(row["valor"])
    except (TypeError, ValueError):
        return default


def _config_set(chave: str, valor: str) -> None:
    _exec("""INSERT INTO configuracoes_app (chave, valor, atualizado_em)
             VALUES (:c, :v, :d)
             ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
                                              atualizado_em = excluded.atualizado_em""",
          {"c": chave, "v": str(valor), "d": now_iso()})


def _custo_produto_sku(sku: str) -> float:
    sku = str(sku or "").strip()
    if not sku:
        return 0.0
    row = _linha("SELECT custo FROM custos_produto WHERE produto_chave = :s", {"s": sku})
    try:
        return round(float(row["custo"]), 2) if row else 0.0
    except (TypeError, ValueError):
        return 0.0


async def config_custos(request: Request):
    """GET/PUT do custo de embalagem (editável). Default R$ 0,50."""
    if request.method in ("PUT", "POST"):
        body = await request.json()
        try:
            valor = round(float(body.get("custo_embalagem")), 2)
        except (TypeError, ValueError):
            return _erro("custo_embalagem inválido")
        if valor < 0:
            return _erro("custo_embalagem não pode ser negativo")
        _config_set(EMBALAGEM_KEY, valor)
        return JSONResponse({"mensagem": "Configuração salva", "custo_embalagem": valor})
    return JSONResponse({"custo_embalagem": _config_get_float(EMBALAGEM_KEY, EMBALAGEM_DEFAULT)})


async def custos_dashboard(request: Request):
    """
    Dashboard de custos/prejuízos. Consolida o ledger custos_devolucao (frete
    reverso + dano + embalagem) por mês, e traz o prejuízo de mediação (perdas
    reais em contestações) das devoluções para contexto.
    """
    mes = (request.query_params.get("mes") or _mes_brt()).strip()

    total = _linha("""
        SELECT COUNT(*) AS lancamentos,
               COALESCE(SUM(frete_reverso), 0) AS frete_reverso,
               COALESCE(SUM(custo_produto), 0) AS custo_produto,
               COALESCE(SUM(custo_embalagem), 0) AS custo_embalagem,
               COALESCE(SUM(total), 0) AS total,
               COALESCE(SUM(danificado), 0) AS danificados
        FROM custos_devolucao WHERE mes = :m
    """, {"m": mes}) or {}

    # Prejuízo de mediação do mês (perdas de contestações), fonte independente.
    med = _linha("""
        SELECT COALESCE(SUM(valor_perdido), 0) AS perdido,
               COALESCE(SUM(valor_recuperado), 0) AS recuperado
        FROM devolucoes
        WHERE status IN ('reprovado','parcial')
          AND strftime('%Y-%m', datetime(COALESCE(ultima_sincronizacao_ml, data_solicitacao), '-3 hours')) = :m
    """, {"m": mes}) or {}

    serie = _linhas("""
        SELECT mes, COALESCE(SUM(total), 0) AS total
        FROM custos_devolucao
        WHERE mes >= :desde
        GROUP BY mes ORDER BY mes ASC
    """, {"desde": _mes_brt((datetime.now(timezone.utc) - timedelta(days=210)).isoformat())})

    itens = _linhas("""
        SELECT cd.*, d.produto_nome, d.pedido_id, d.ml_claim_id, d.ml_tipo_logistica
        FROM custos_devolucao cd
        LEFT JOIN devolucoes d ON d.id = cd.devolucao_id
        WHERE cd.mes = :m
        ORDER BY cd.total DESC, cd.id DESC
    """, {"m": mes})

    return JSONResponse({
        "mes": mes,
        "resumo": {
            "lancamentos": int(total.get("lancamentos") or 0),
            "frete_reverso": round(float(total.get("frete_reverso") or 0), 2),
            "custo_produto": round(float(total.get("custo_produto") or 0), 2),
            "custo_embalagem": round(float(total.get("custo_embalagem") or 0), 2),
            "total": round(float(total.get("total") or 0), 2),
            "danificados": int(total.get("danificados") or 0),
            "prejuizo_mediacao": round(float(med.get("perdido") or 0), 2),
            "recuperado_mediacao": round(float(med.get("recuperado") or 0), 2),
        },
        "serie_mensal": serie,
        "itens": itens,
    })


# ============================================================================
# Fase 4 — Divergência / fraude (previstas × entregue × bipadas)
# ============================================================================

async def divergencia(request: Request):
    """
    Cruza, para o pool que vem ao barracão (seller_address):
      previstas  — a caminho (shipped/delivered), ainda na fila
      entregue   — transportadora marcou delivered
      bipadas    — o operador bipou (recebido_em preenchido)
    Divergência = entregue − bipadas (produto que 'chegou' mas ninguém recebeu):
    faltante, erro logístico ou fraude. Lista os suspeitos.
    """
    row = _linha("""
        SELECT
          SUM(CASE WHEN shipment_destination='seller_address'
                    AND shipment_status IN ('shipped','delivered')
                    AND bucket IN ('para_retirar','para_revisao') THEN 1 ELSE 0 END) AS previstas,
          SUM(CASE WHEN shipment_destination='seller_address'
                    AND shipment_status='delivered'
                    AND bucket IN ('para_retirar','para_revisao') THEN 1 ELSE 0 END) AS entregue,
          SUM(CASE WHEN shipment_destination='seller_address'
                    AND shipment_status='delivered'
                    AND bucket IN ('para_retirar','para_revisao')
                    AND COALESCE(recebido_em,'') <> '' THEN 1 ELSE 0 END) AS bipadas
        FROM ml_claim_classifications WHERE active = 1
    """) or {}

    suspeitos = _linhas("""
        SELECT claim_id, pedido_id, pack_id, produto_nome, produto_imagem,
               shipment_id, tracking_number, due_date, motivo_label
        FROM ml_claim_classifications
        WHERE active = 1
          AND shipment_destination='seller_address'
          AND shipment_status='delivered'
          AND bucket IN ('para_retirar','para_revisao')
          AND COALESCE(recebido_em,'') = ''
        ORDER BY due_date ASC
    """)

    previstas = int(row.get("previstas") or 0)
    entregue = int(row.get("entregue") or 0)
    bipadas = int(row.get("bipadas") or 0)
    return JSONResponse({
        "previstas": previstas,
        "entregue_transportadora": entregue,
        "bipadas": bipadas,
        "divergencia": max(entregue - bipadas, 0),
        "a_caminho": max(previstas - entregue, 0),
        "suspeitos": suspeitos,
    })


# ============================================================================
# Fase 5 — Avaliação → ação (finalizar) + evidências
# ============================================================================

async def finalizar_avaliacao(request: Request):
    """
    Fecha a avaliação da devolução e LANÇA o custo no dashboard.

    resultado='concluido'  → sem problema; devolução finalizada.
    resultado='ocorrencia' → com problema; segue para mediação/contestação.

    Custo = frete_reverso (do ML) + embalagem (config) + custo_produto (se
    danificado, buscado por SKU). Cada parte é sobreponível pelo body.
    """
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    resultado = str(body.get("resultado") or "").strip()
    if resultado not in {"concluido", "ocorrencia"}:
        return _erro("resultado deve ser 'concluido' ou 'ocorrencia'")

    row = _linha("SELECT * FROM devolucoes WHERE id = :i", {"i": item_id})
    if not row:
        return _erro("Devolucao nao encontrada", 404)

    danificado = bool(body.get("danificado"))
    frete_reverso = round(abs(float(row.get("ml_tarifa_devolucao") or 0)), 2)
    embalagem = (round(float(body["custo_embalagem"]), 2)
                 if body.get("custo_embalagem") is not None
                 else _config_get_float(EMBALAGEM_KEY, EMBALAGEM_DEFAULT))
    if body.get("custo_produto") is not None:
        custo_produto = round(float(body["custo_produto"]), 2)
    else:
        custo_produto = _custo_produto_sku(row.get("ml_sku")) if danificado else 0.0
    total = round(frete_reverso + embalagem + custo_produto, 2)
    observacao = str(body.get("observacao") or "").strip()
    agora = now_iso()
    mes = _mes_brt(agora)

    _exec("""
        INSERT INTO custos_devolucao (devolucao_id, ml_claim_id, mes, sku, danificado,
              frete_reverso, custo_produto, custo_embalagem, total, resultado,
              observacao, created_at, updated_at)
        VALUES (:did, :cid, :mes, :sku, :dan, :fr, :cp, :ce, :tot, :res, :obs, :d, :d)
        ON CONFLICT(devolucao_id) DO UPDATE SET
          mes = excluded.mes, sku = excluded.sku, danificado = excluded.danificado,
          frete_reverso = excluded.frete_reverso, custo_produto = excluded.custo_produto,
          custo_embalagem = excluded.custo_embalagem, total = excluded.total,
          resultado = excluded.resultado, observacao = excluded.observacao,
          updated_at = excluded.updated_at
    """, {"did": item_id, "cid": str(row.get("ml_claim_id") or ""), "mes": mes,
          "sku": str(row.get("ml_sku") or ""), "dan": 1 if danificado else 0,
          "fr": frete_reverso, "cp": custo_produto, "ce": embalagem, "tot": total,
          "res": resultado, "obs": observacao, "d": agora})

    if resultado == "concluido":
        novo_status = "sem_divergencia"
        _exec("""UPDATE devolucoes
                 SET status = :st, chegada_status = 'esperado', requer_acao = 0,
                     ml_ativo = 0, observacao_final = :obs
                 WHERE id = :i""",
              {"st": novo_status, "obs": observacao or row.get("observacao_final") or "",
               "i": item_id})
    else:
        novo_status = "divergencia_encontrada"
        _exec("""UPDATE devolucoes
                 SET status = :st, requer_acao = 1, ml_ativo = 1,
                     observacao_final = :obs
                 WHERE id = :i""",
              {"st": novo_status, "obs": observacao or row.get("observacao_final") or "",
               "i": item_id})

    _exec("""INSERT INTO historico_status (devolucao_id, status_anterior, status_novo, data_alteracao)
             VALUES (:i, :ant, :novo, :d)""",
          {"i": item_id, "ant": row.get("status") or "", "novo": novo_status, "d": agora})

    return JSONResponse({
        "mensagem": "Avaliação finalizada",
        "resultado": resultado, "status": novo_status,
        "custo": {"frete_reverso": frete_reverso, "custo_produto": custo_produto,
                  "custo_embalagem": embalagem, "total": total, "mes": mes},
    })


EVID_EXT_OK = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"}


async def upload_evidencia(request: Request):
    """Anexa foto/arquivo à devolução (multipart 'file'). Guarda no UPLOAD_DIR."""
    from app.main import UPLOAD_DIR
    item_id = int(request.path_params["item_id"])
    if not _linha("SELECT id FROM devolucoes WHERE id = :i", {"i": item_id}):
        return _erro("Devolucao nao encontrada", 404)
    form = await request.form()
    file = form.get("file")
    if not file or not getattr(file, "filename", ""):
        return _erro("Envie o arquivo no campo 'file'.")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in EVID_EXT_OK:
        return _erro(f"Extensão não permitida. Use: {sorted(EVID_EXT_OK)}")
    conteudo = await file.read()
    if len(conteudo) > 15 * 1024 * 1024:
        return _erro("Arquivo maior que 15 MB.", 413)
    nome_seguro = f"evid_{item_id}_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, nome_seguro), "wb") as f:
        f.write(conteudo)
    _exec("""INSERT INTO evidencias (devolucao_id, tipo, arquivo, descricao, data_upload)
             VALUES (:i, :tipo, :arq, :desc, :d)""",
          {"i": item_id, "tipo": str(form.get("tipo") or "foto"), "arq": nome_seguro,
           "desc": str(form.get("descricao") or ""), "d": now_iso()})
    return JSONResponse({"mensagem": "Evidência anexada", "arquivo": nome_seguro}, status_code=201)


async def servir_evidencia(request: Request):
    """Serve o arquivo de evidência, com proteção contra path traversal."""
    from app.main import UPLOAD_DIR
    nome = os.path.basename(str(request.path_params["nome"]))
    caminho = os.path.realpath(os.path.join(UPLOAD_DIR, nome))
    if not caminho.startswith(os.path.realpath(UPLOAD_DIR)) or not os.path.isfile(caminho):
        return _erro("Arquivo nao encontrado", 404)
    return FileResponse(caminho)


# ============================================================================
# Fase 6 — Ações sobre o ML (mutação; exigem confirmação)
# ============================================================================

def _acoes_do_claim(claim_id: str) -> set:
    try:
        detalhe = ml_get(f"/post-purchase/v1/claims/{claim_id}")
    except Exception:
        return set()
    return {str(a.get("action") or "") for a in claim_available_actions(detalhe)}


async def ml_review(request: Request):
    """
    Envia a revisão da devolução ao ML: chegou como esperado (ok) ou com problema
    (fail) — evita ter que entrar no site. Valida que a ação existe no claim.
    """
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    aprovado = bool(body.get("aprovado", True))
    row = _linha("SELECT ml_claim_id, ml_return_id FROM devolucoes WHERE id = :i", {"i": item_id})
    if not row:
        return _erro("Devolucao nao encontrada", 404)
    return_id = str(row.get("ml_return_id") or "").strip()
    if not return_id:
        return _erro("Devolução sem return_id do ML — não há revisão a enviar.")
    acoes = _acoes_do_claim(str(row.get("ml_claim_id") or ""))
    review_ok = {"return_review_unified_ok", "return_review_ok"}
    review_fail = {"return_review_unified_fail", "return_review_fail"}
    disponiveis = review_ok if aprovado else review_fail
    if not (acoes & disponiveis):
        return _erro("O Mercado Livre não oferece esta revisão para este caso agora.",
                     409, acoes_disponiveis=sorted(acoes))
    try:
        resp = await run_in_threadpool(enviar_return_review, return_id, aprovado)
    except MLDevolucoesError as exc:
        return _erro("Falha ao enviar revisão ao Mercado Livre", 502, erro=str(exc))
    return JSONResponse({"mensagem": "Revisão enviada ao Mercado Livre",
                         "aprovado": aprovado, "resposta_ml": resp})


async def ml_resolucao(request: Request):
    """
    Dispara uma resolução esperada no ML: reembolso total/parcial ou aceitar a
    devolução. É operação de EFEITO (mexe em dinheiro) — exige confirmar=true e
    valida contra as available_actions do claim.
    """
    item_id = int(request.path_params["item_id"])
    body = await request.json()
    if not body.get("confirmar"):
        return _erro("Confirme a ação (confirmar=true) — ela tem efeito no Mercado Livre.")
    tipo = str(body.get("tipo") or "").strip()
    row = _linha("SELECT ml_claim_id FROM devolucoes WHERE id = :i", {"i": item_id})
    if not row:
        return _erro("Devolucao nao encontrada", 404)
    claim_id = str(row.get("ml_claim_id") or "").strip()
    if not claim_id:
        return _erro("Devolução sem claim do ML.")
    acoes = _acoes_do_claim(claim_id)
    try:
        if tipo == "refund_total":
            if "refund" not in acoes:
                return _erro("Reembolso total indisponível neste claim.", 409,
                             acoes_disponiveis=sorted(acoes))
            resp = await run_in_threadpool(oferecer_reembolso_total, claim_id)
        elif tipo == "refund_parcial":
            valor = float(body.get("valor") or 0)
            if valor <= 0:
                return _erro("Informe o valor do reembolso parcial.")
            resp = await run_in_threadpool(oferecer_reembolso_parcial, claim_id, valor)
        elif tipo == "allow_return":
            resp = await run_in_threadpool(permitir_devolucao, claim_id)
        else:
            return _erro("tipo deve ser: refund_total, refund_parcial ou allow_return")
    except MLDevolucoesError as exc:
        return _erro("Falha ao executar a resolução no Mercado Livre", 502, erro=str(exc))
    return JSONResponse({"mensagem": "Resolução enviada ao Mercado Livre",
                         "tipo": tipo, "resposta_ml": resp})
