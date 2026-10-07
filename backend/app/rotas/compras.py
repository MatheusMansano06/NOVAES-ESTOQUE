"""Rotas de compras e custos: lista de compra, preços, custos, apelidos e calculadora TikTok."""
from starlette.responses import JSONResponse
from starlette.requests import Request
from database import SessionLocal
import asyncio
import threading
import re
from typing import Dict
from datetime import datetime, timedelta
from app.models import (
    ApelidoFornecedor,
    PrecoVendaProduto,
    MercadoLivreItemCache,
    CustoProduto,
    OlistEstoqueSnapshot,
    CalculoTikTok,
)
from app.utils.lista_compra import calcular_lista_compra, registrar_snapshot_vendas
from app.integracoes.olist import olist
from app.integracoes.mercado_livre import ml
from app.integracoes.shopee import shopee
from app.central.financeiro.custos import limpar_cache as limpar_cache_custos, registrar_custo

from app.rotas.comum import (
    Route,
    _operador_contexto,
)


_lista_compra_lock = threading.Lock()
_lista_compra_estado: Dict = {
    "status": "idle",  # idle | rodando | pronto | erro
    "resultado": None,
    "erro": None,
    "iniciado_em": None,
    "concluido_em": None,
}


def _rodar_lista_compra_parados() -> None:
    """
    Roda em thread separada (nunca no event loop) — a varredura da Olist é
    lenta (throttle de 120/min em ~665 produtos ativos) e uma request síncrona
    desse tamanho trava TODO o resto do app, que roda num único worker.
    """
    global _lista_compra_estado
    try:
        db = SessionLocal()
        try:
            ml_parados = [
                {"item_id": i.item_id, "sku": i.sku, "titulo": i.titulo, "estoque": i.estoque_disponivel or 0}
                for i in db.query(MercadoLivreItemCache).filter(
                    MercadoLivreItemCache.status == "paused",
                    MercadoLivreItemCache.estoque_disponivel == 0,
                ).all()
            ]
        finally:
            db.close()

        shopee_parados = shopee.listar_pausados_sem_estoque() if shopee.configurado else []
        olist_parados = olist.listar_ativos_com_estoque_zero()

        por_sku: Dict[str, Dict] = {}

        def _chave(sku: str) -> str:
            return (sku or "").strip().upper()

        for item in ml_parados:
            chave = _chave(item["sku"])
            if not chave:
                continue
            registro = por_sku.setdefault(chave, {"sku": item["sku"], "nome": item["titulo"], "canais": {}})
            registro["canais"]["mercado_livre"] = {"item_id": item["item_id"], "estoque": item["estoque"]}
            registro["nome"] = registro["nome"] or item["titulo"]

        for item in shopee_parados:
            chave = _chave(item["sku"])
            if not chave:
                continue
            registro = por_sku.setdefault(chave, {"sku": item["sku"], "nome": item["nome"], "canais": {}})
            registro["canais"]["shopee"] = {"item_id": item["item_id"], "estoque": item["estoque"]}
            registro["nome"] = registro["nome"] or item["nome"]

        for item in olist_parados:
            chave = _chave(item["sku"])
            if not chave:
                continue
            registro = por_sku.setdefault(chave, {"sku": item["sku"], "nome": item["nome"], "canais": {}})
            registro["canais"]["olist"] = {"produto_id": item["produto_id"], "estoque": item["estoque"]}
            registro["nome"] = registro["nome"] or item["nome"]

        lista = sorted(por_sku.values(), key=lambda r: (-len(r["canais"]), r["sku"]))
        _lista_compra_estado.update({
            "status": "pronto",
            "resultado": {
                "total": len(lista),
                "por_canal": {
                    "mercado_livre": len(ml_parados),
                    "shopee": len(shopee_parados),
                    "olist": len(olist_parados),
                },
                "itens": lista,
            },
            "erro": None,
            "concluido_em": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        print(f"[LISTA-COMPRA] Erro na varredura: {e}")
        _lista_compra_estado.update({"status": "erro", "erro": str(e), "concluido_em": datetime.utcnow().isoformat()})


async def lista_compra_parados_iniciar(request: Request):
    """POST /api/lista-compra/parados/iniciar — dispara a varredura em background e devolve na hora."""
    with _lista_compra_lock:
        if _lista_compra_estado["status"] == "rodando":
            return JSONResponse({"status": "rodando", "iniciado_em": _lista_compra_estado["iniciado_em"]})
        _lista_compra_estado.update({
            "status": "rodando", "resultado": None, "erro": None,
            "iniciado_em": datetime.utcnow().isoformat(), "concluido_em": None,
        })
        threading.Thread(target=_rodar_lista_compra_parados, daemon=True).start()
    return JSONResponse({"status": "rodando", "iniciado_em": _lista_compra_estado["iniciado_em"]})


async def lista_compra_parados_status(request: Request):
    """GET /api/lista-compra/parados — status/resultado da última varredura disparada."""
    return JSONResponse(_lista_compra_estado)


async def apelidos_fornecedores(request: Request):
    db = SessionLocal()
    try:
        if request.method == "GET":
            rows = db.query(ApelidoFornecedor).all()
            ultimo_update = None
            if rows:
                ultimo_update = max((r.atualizado_em or r.criado_em or datetime.utcnow()).isoformat() for r in rows)
            return JSONResponse(
                {
                    "apelidos": {r.nome_fornecedor: r.apelido for r in rows},
                    "total": len(rows),
                    "updated_at": ultimo_update,
                },
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        body = await request.json()
        nome = (body.get("nome_fornecedor") or "").strip()
        apelido = (body.get("apelido") or "").strip()
        if not nome:
            return JSONResponse({"erro": "nome_fornecedor obrigatorio"}, status_code=400)

        row = db.query(ApelidoFornecedor).filter(ApelidoFornecedor.nome_fornecedor == nome).first()
        if not apelido:
            if row:
                db.delete(row)
                db.commit()
            return JSONResponse({"ok": True, "removido": True, "nome_fornecedor": nome}, headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})

        if row:
            row.apelido = apelido
            row.atualizado_em = datetime.utcnow()
        else:
            db.add(ApelidoFornecedor(nome_fornecedor=nome, apelido=apelido))
        db.commit()
        return JSONResponse(
            {"ok": True, "nome_fornecedor": nome, "apelido": apelido, "updated_at": datetime.utcnow().isoformat()},
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def precos_venda(request: Request):
    """
    GET  /api/precos-venda  -> {precos: {chave: preco}}
    POST /api/precos-venda  Body: {produto_chave, preco_venda} (upsert; preco 0/None remove)
    Chave = olist_sku quando vinculado, senão codigo_produto.
    """
    db = SessionLocal()
    try:
        if request.method == "GET":
            rows = db.query(PrecoVendaProduto).all()
            return JSONResponse(
                {"precos": {r.produto_chave: r.preco_venda for r in rows}},
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        body = await request.json()
        chave = (body.get("produto_chave") or "").strip()
        if not chave:
            return JSONResponse({"erro": "produto_chave obrigatório"}, status_code=400)
        try:
            preco = float(body.get("preco_venda") or 0)
        except (TypeError, ValueError):
            return JSONResponse({"erro": "preco_venda inválido"}, status_code=400)

        row = db.query(PrecoVendaProduto).filter(PrecoVendaProduto.produto_chave == chave).first()
        if preco <= 0:
            if row:
                db.delete(row)
                db.commit()
            return JSONResponse({"ok": True, "removido": True, "produto_chave": chave})

        if row:
            row.preco_venda = preco
            row.atualizado_em = datetime.utcnow()
        else:
            db.add(PrecoVendaProduto(produto_chave=chave, preco_venda=preco))
        db.commit()
        return JSONResponse({"ok": True, "produto_chave": chave, "preco_venda": preco})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def custos_produto(request: Request):
    """
    GET  /api/custos  -> {custos: {SKU: {custo, imposto_pct, atualizado_em}}}
    POST /api/custos  Body: lote {custos:[{sku, custo, imposto_pct}]}  OU  item único {sku, custo, imposto_pct}
    Upsert por SKU. custo <= 0 e sem registro é ignorado; com registro, atualiza.
    Custo oficial/autoritário usado na margem dos anúncios do Mercado Livre.
    """
    db = SessionLocal()
    try:
        if request.method == "GET":
            rows = db.query(CustoProduto).all()
            return JSONResponse(
                {"custos": {
                    r.produto_chave: {
                        "custo": r.custo,
                        "imposto_pct": r.imposto_pct,
                        "atualizado_em": r.atualizado_em.isoformat() if r.atualizado_em else None,
                    } for r in rows
                }},
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        body = await request.json()
        # Normaliza: aceita lote {"custos":[...]} ou item único {sku,...}
        if isinstance(body, dict) and isinstance(body.get("custos"), list):
            itens = body["custos"]
        elif isinstance(body, dict):
            itens = [body]
        else:
            return JSONResponse({"erro": "corpo inválido"}, status_code=400)

        salvos = 0
        ignorados = 0
        for it in itens:
            if not isinstance(it, dict):
                ignorados += 1
                continue
            sku = (str(it.get("sku") or it.get("produto_chave") or "")).strip()
            if not sku:
                ignorados += 1
                continue
            try:
                custo = float(it.get("custo") or 0)
            except (TypeError, ValueError):
                ignorados += 1
                continue
            imposto_raw = it.get("imposto_pct")
            try:
                imposto = float(imposto_raw) if imposto_raw is not None else 9.0
            except (TypeError, ValueError):
                imposto = 9.0

            row = db.query(CustoProduto).filter(CustoProduto.produto_chave == sku).first()
            if custo <= 0 and not row:
                ignorados += 1
                continue
            if row and custo > 0 and custo != row.custo:
                # mudança de custo entra no histórico com vigência a partir de agora (o passado mantém o custo antigo)
                registrar_custo(db, sku, custo, datetime.utcnow(), _operador_contexto(request)["operador_nome"])
                row.imposto_pct = imposto
            elif row:
                row.custo = custo
                row.imposto_pct = imposto
                row.atualizado_em = datetime.utcnow()
            else:
                db.add(CustoProduto(produto_chave=sku, custo=custo, imposto_pct=imposto))
            salvos += 1

        db.commit()
        if salvos:
            limpar_cache_custos()
        return JSONResponse({"ok": True, "salvos": salvos, "ignorados": ignorados})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


_CAMPOS_TIKTOK = ("preco_venda", "custo", "embalagem", "comissao_pct", "imposto_pct", "taxa_fixa",
                  "afiliado_pct", "frete", "ads_pct", "outros", "lucro", "margem_pct")


async def tiktok_calculos(request: Request):
    """GET /api/tiktok/calculos -> {calculos:[...]} (mais recentes primeiro). POST salva um cálculo."""
    db = SessionLocal()
    try:
        if request.method == "GET":
            rows = db.query(CalculoTikTok).order_by(CalculoTikTok.id.desc()).all()
            return JSONResponse({"calculos": [
                {"id": r.id, "sku": r.sku, "produto": r.produto, "classificacao": r.classificacao,
                 "criado_em": r.criado_em.isoformat() if r.criado_em else None,
                 **{c: getattr(r, c) for c in _CAMPOS_TIKTOK}} for r in rows
            ]}, headers={"Cache-Control": "no-store"})
        body = await request.json()
        sku = str(body.get("sku") or "").strip()
        if not sku:
            return JSONResponse({"erro": "SKU obrigatório"}, status_code=400)
        try:
            campos = {c: float(body.get(c) or 0) for c in _CAMPOS_TIKTOK}
        except (TypeError, ValueError):
            return JSONResponse({"erro": "valores numéricos inválidos"}, status_code=400)
        db.add(CalculoTikTok(sku=sku, produto=str(body.get("produto") or "").strip()[:300],
                             classificacao=str(body.get("classificacao") or "")[:30], **campos))
        db.commit()
        return JSONResponse({"ok": True})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def comparativo_skus(request: Request):
    """GET /api/comparativo-skus?skus=A,B -> margem do mesmo SKU no ML, Shopee e TikTok."""
    skus = [s.strip() for s in (request.query_params.get("skus") or "").split(",") if s.strip()][:50]
    db = SessionLocal()
    try:
        from app.comparativo_sku import comparar
        dados = await asyncio.to_thread(comparar, db, skus)
        return JSONResponse({"itens": dados}, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def tiktok_calculo_excluir(request: Request):
    """DELETE /api/tiktok/calculos/{id} · PATCH edita custo (lucro/margem/classificação recalculados no front)."""
    db = SessionLocal()
    try:
        q = db.query(CalculoTikTok).filter(CalculoTikTok.id == int(request.path_params["calculo_id"]))
        if request.method == "PATCH":
            body = await request.json()
            row = q.first()
            if not row:
                return JSONResponse({"erro": "cálculo não encontrado"}, status_code=404)
            try:
                custo, lucro, margem = (float(body[k]) for k in ("custo", "lucro", "margem_pct"))
            except (KeyError, TypeError, ValueError):
                return JSONResponse({"erro": "custo, lucro e margem_pct numéricos obrigatórios"}, status_code=400)
            if custo < 0:
                return JSONResponse({"erro": "custo não pode ser negativo"}, status_code=400)
            row.custo, row.lucro, row.margem_pct = custo, lucro, margem
            row.classificacao = str(body.get("classificacao") or row.classificacao)[:30]
            # O custo editado aqui também vira o custo oficial do SKU (margem dos Anúncios ML), com histórico de vigência.
            oficial = db.query(CustoProduto).filter(CustoProduto.produto_chave == row.sku).first()
            mudou_oficial = custo > 0 and (not oficial or abs((oficial.custo or 0) - custo) > 0.009)
            if mudou_oficial:
                registrar_custo(db, row.sku, custo, datetime.utcnow(), _operador_contexto(request)["operador_nome"])
            db.commit()
            if mudou_oficial:
                limpar_cache_custos()
            return JSONResponse({"ok": True, "custo_oficial_atualizado": mudou_oficial})
        q.delete()
        db.commit()
        return JSONResponse({"ok": True})
    finally:
        db.close()


_lock_estoque_olist = threading.Lock()


def _refrescar_estoque_olist():
    """Atualiza o snapshot do saldo da Olist (estoque orgânico) p/ todos os SKUs
    ativos do ML. Roda em segundo plano: 1 chamada por SKU (throttled pela Olist)."""
    if not _lock_estoque_olist.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        ativos = db.query(MercadoLivreItemCache.sku).filter(
            MercadoLivreItemCache.status == "active"
        ).all()
        skus = sorted({(s[0] or "").strip().upper() for s in ativos if s[0]})
        if not skus:
            return
        snapshots_existentes = db.query(OlistEstoqueSnapshot).filter(
            OlistEstoqueSnapshot.sku.is_not(None),
            OlistEstoqueSnapshot.produto_id.is_not(None),
        ).all()
        mapa_fixado = {}
        mapa_fixado_norm = {}
        for row in snapshots_existentes:
            sku_row = (row.sku or "").strip().upper()
            pid_row = str(row.produto_id or "").strip()
            sku_row_norm = _normalizar_sku_lista_compra(sku_row)
            if sku_row and pid_row and sku_row not in mapa_fixado:
                mapa_fixado[sku_row] = pid_row
            if sku_row_norm and pid_row and sku_row_norm not in mapa_fixado_norm:
                mapa_fixado_norm[sku_row_norm] = pid_row

        # Mapa SKU -> produto_id da Olist (1 carga em bulk do cache de produtos)
        try:
            produtos = olist.listar_todos_produtos(limite=5000)
        except Exception:
            produtos = []
        mapa = {}
        mapa_norm = {}
        for p in produtos:
            sk = (p.get("sku") or p.get("codigo_produto") or "").strip().upper()
            pid = str(p.get("id") or "").strip()
            sk_norm = _normalizar_sku_lista_compra(sk)
            if sk and pid and sk not in mapa:
                mapa[sk] = pid
            if sk_norm and pid and sk_norm not in mapa_norm:
                mapa_norm[sk_norm] = pid
        for sku in skus:
            sku_norm = _normalizar_sku_lista_compra(sku)
            pid = (
                mapa_fixado.get(sku)
                or (mapa_fixado_norm.get(sku_norm) if sku_norm else None)
                or mapa.get(sku)
                or (mapa_norm.get(sku_norm) if sku_norm else None)
            )
            if not pid and sku_norm:
                try:
                    candidatos = olist.buscar_produtos(sku, limite_resultados=10)
                except Exception:
                    candidatos = []
                for candidato in candidatos:
                    cand_sku = (candidato.get("sku") or candidato.get("codigo_produto") or "").strip()
                    if _normalizar_sku_lista_compra(cand_sku) == sku_norm:
                        pid = str(candidato.get("id") or "").strip()
                        break
            if not pid:
                continue
            try:
                est = olist.obter_estoque(pid)
            except Exception:
                est = None
            saldo = (est or {}).get("saldo")
            if saldo is None:
                continue
            row = db.query(OlistEstoqueSnapshot).filter(OlistEstoqueSnapshot.sku == sku).first()
            if not row:
                row = OlistEstoqueSnapshot(sku=sku)
                db.add(row)
            row.produto_id = pid
            row.saldo = float(saldo)
            row.atualizado_em = datetime.utcnow()
            db.commit()
    except Exception as e:
        print(f"[LISTA-COMPRA] Erro ao refrescar estoque Olist: {e}")
        db.rollback()
    finally:
        db.close()
        _lock_estoque_olist.release()


def _normalizar_sku_lista_compra(valor: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(valor or "").lower())


async def lista_compra_atualizar_estoque(request: Request):
    """POST — dispara a atualização do snapshot de estoque da Olist (background)."""
    if _lock_estoque_olist.locked():
        return JSONResponse({"status": "ja_rodando"})
    threading.Thread(target=_refrescar_estoque_olist, daemon=True).start()
    return JSONResponse({"status": "iniciado"})


async def lista_compra_vincular_estoque_olist(request: Request):
    """Vínculo manual SKU ML -> produto Olist para a Lista de Compra."""
    db = SessionLocal()
    try:
        try:
            body = await request.json()
        except Exception:
            body = {}

        sku = str(body.get("sku") or "").strip().upper()
        produto_id = str(body.get("produto_id") or "").strip()
        if not sku or not produto_id:
            return JSONResponse({"erro": "SKU e produto_id são obrigatórios"}, status_code=400)

        produto = None
        try:
            produto = olist.obter_produto_por_id(produto_id)
        except Exception:
            produto = None

        try:
            est = olist.obter_estoque(produto_id, usar_cache=False)
        except Exception:
            est = None
        if est is None:
            return JSONResponse({"erro": "Não consegui ler o estoque deste produto na Olist"}, status_code=502)

        row = db.query(OlistEstoqueSnapshot).filter(OlistEstoqueSnapshot.sku == sku).first()
        if not row:
            row = OlistEstoqueSnapshot(sku=sku)
            db.add(row)

        row.sku = sku
        row.produto_id = produto_id
        row.saldo = float((est or {}).get("saldo") or 0)
        row.atualizado_em = datetime.utcnow()
        db.commit()

        return JSONResponse({
            "sucesso": True,
            "sku": sku,
            "produto_id": produto_id,
            "produto_nome": (produto or {}).get("nome"),
            "produto_sku": (produto or {}).get("sku"),
            "saldo": row.saldo,
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def lista_compra(request: Request):
    """GET /api/lista-compra?meta_dias=75 — lista de compra priorizada:
    curva ABC (unidades vendidas) + estoque FULL (ML) / orgânico (Olist) + velocidade."""
    db = SessionLocal()
    try:
        try:
            meta_dias = int(request.query_params.get("meta_dias") or 75)
        except (TypeError, ValueError):
            meta_dias = 75
        meta_dias = max(1, min(365, meta_dias))
        # Garante date_created dos ativos (base da velocidade no bootstrap).
        try:
            faltando = db.query(MercadoLivreItemCache).filter(
                MercadoLivreItemCache.status == "active",
                MercadoLivreItemCache.date_created.is_(None),
            ).all()
            ids = [r.item_id for r in faltando if r.item_id]
            if ids:
                mapa = ml._date_created_map(ids)
                mudou = False
                for r in faltando:
                    dc = mapa.get(str(r.item_id))
                    if dc:
                        r.date_created = dc
                        mudou = True
                if mudou:
                    db.commit()
        except Exception:
            db.rollback()
        # Acumula a foto de vendas do dia (no máx 1x/dia) p/ refinar a velocidade
        try:
            registrar_snapshot_vendas(db)
        except Exception:
            db.rollback()

        # Snapshot do estoque da Olist (orgânico). Auto-atualiza em background se
        # estiver vazio ou velho (>12h); a resposta usa o que já existe.
        snaps_olist = db.query(OlistEstoqueSnapshot).all()
        estoque_olist = {s.sku: s.saldo for s in snaps_olist if s.sku is not None}
        ultima = max((s.atualizado_em for s in snaps_olist if s.atualizado_em), default=None)
        atualizando = _lock_estoque_olist.locked()
        precisa = (not snaps_olist) or (ultima is None) or ((datetime.utcnow() - ultima) > timedelta(hours=12))
        if precisa and not atualizando:
            threading.Thread(target=_refrescar_estoque_olist, daemon=True).start()
            atualizando = True

        dados = calcular_lista_compra(db, meta_dias=meta_dias, estoque_olist=estoque_olist)
        dados["estoque_olist"] = {
            "atualizado_em": ultima.isoformat() if ultima else None,
            "atualizando": atualizando,
            "skus": len(estoque_olist),
        }
        return JSONResponse(dados, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/apelidos-fornecedores", apelidos_fornecedores, methods=["GET", "POST"]),
    Route("/api/precos-venda", precos_venda, methods=["GET", "POST"]),
    Route("/api/custos", custos_produto, methods=["GET", "POST"]),
    Route("/api/tiktok/calculos", tiktok_calculos, methods=["GET", "POST"]),
    Route("/api/comparativo-skus", comparativo_skus, methods=["GET"]),
    Route("/api/tiktok/calculos/{calculo_id:int}", tiktok_calculo_excluir, methods=["DELETE", "PATCH"]),
    Route("/api/lista-compra", lista_compra, methods=["GET"]),
    Route("/api/lista-compra/atualizar-estoque", lista_compra_atualizar_estoque, methods=["POST"]),
    Route("/api/lista-compra/vincular-estoque-olist", lista_compra_vincular_estoque_olist, methods=["POST"]),
    Route("/api/lista-compra/parados", lista_compra_parados_status, methods=["GET"]),
    Route("/api/lista-compra/parados/iniciar", lista_compra_parados_iniciar, methods=["POST"]),
]
