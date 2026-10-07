"""Rotas /api/embalagens/*: estoque de caixas e inserts com baixa automática por venda."""
from starlette.responses import JSONResponse
from starlette.requests import Request
from database import SessionLocal
from typing import Dict
from datetime import datetime
from app.models import MercadoLivreItemCache, Embalagem, EmbalagemCompra, EmbalagemMovimento, EmbalagemVinculo
from app.utils.embalagens import (
    processar_baixas_embalagem,
    dims_do_produto,
    custo_medio_ponderado,
    resolver_caixa,
)

from app.rotas.comum import (
    Route,
)


# ====================== ESTOQUE DE EMBALAGENS ======================

def _emb_dict(e: Embalagem) -> Dict:
    return {
        "id": e.id, "nome": e.nome, "criterio": e.criterio,
        "altura_cm": e.altura_cm, "largura_cm": e.largura_cm, "comprimento_cm": e.comprimento_cm,
        "estoque_atual": int(e.estoque_atual or 0), "estoque_minimo": int(e.estoque_minimo or 0),
        "custo_medio": round(float(e.custo_medio or 0), 4), "url_compra": e.url_compra,
        "ativo": int(e.ativo or 0), "observacao": e.observacao,
        "atualizado_em": e.atualizado_em.isoformat() if e.atualizado_em else None,
    }


async def embalagens(request: Request):
    """GET /api/embalagens -> {embalagens:[...], resumo:{...}} | POST upsert de embalagem."""
    db = SessionLocal()
    try:
        if request.method == "GET":
            rows = db.query(Embalagem).order_by(Embalagem.nome).all()
            lista = [_emb_dict(e) for e in rows]
            resumo = {
                "total": len(lista),
                "ativas": sum(1 for e in lista if e["ativo"]),
                "em_baixa": sum(1 for e in lista if e["ativo"] and e["estoque_atual"] <= e["estoque_minimo"]),
            }
            return JSONResponse({"embalagens": lista, "resumo": resumo}, headers={"Cache-Control": "no-store"})

        body = await request.json()
        if not isinstance(body, dict):
            return JSONResponse({"erro": "corpo inválido"}, status_code=400)
        nome = (str(body.get("nome") or "")).strip()
        if not nome:
            return JSONResponse({"erro": "nome obrigatório"}, status_code=400)
        criterio = body.get("criterio") if body.get("criterio") in ("dimensao", "toda_venda") else "dimensao"

        def _num(v):
            try:
                return float(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                return None

        emb = db.query(Embalagem).filter(Embalagem.id == body.get("id")).first() if body.get("id") else None
        if not emb:
            emb = Embalagem(nome=nome)
            db.add(emb)
        emb.nome = nome
        emb.criterio = criterio
        emb.altura_cm = _num(body.get("altura_cm")) if criterio == "dimensao" else None
        emb.largura_cm = _num(body.get("largura_cm")) if criterio == "dimensao" else None
        emb.comprimento_cm = _num(body.get("comprimento_cm")) if criterio == "dimensao" else None
        if body.get("estoque_minimo") is not None:
            emb.estoque_minimo = int(body.get("estoque_minimo") or 0)
        if body.get("url_compra") is not None:
            emb.url_compra = (str(body.get("url_compra")) or "").strip() or None
        if body.get("observacao") is not None:
            emb.observacao = (str(body.get("observacao")) or "").strip() or None
        if body.get("ativo") is not None:
            emb.ativo = 1 if body.get("ativo") else 0
        emb.atualizado_em = datetime.utcnow()
        db.commit()
        return JSONResponse({"ok": True, "embalagem": _emb_dict(emb)})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_compra(request: Request):
    """POST /api/embalagens/compra — registra compra (kit): soma estoque + recalcula custo médio."""
    db = SessionLocal()
    try:
        body = await request.json()
        emb = db.query(Embalagem).filter(Embalagem.id == body.get("embalagem_id")).first()
        if not emb:
            return JSONResponse({"erro": "embalagem não encontrada"}, status_code=404)
        qtd = int(body.get("quantidade") or 0)
        valor = float(body.get("valor_total") or 0)
        if qtd <= 0:
            return JSONResponse({"erro": "quantidade deve ser > 0"}, status_code=400)
        url = (str(body.get("url") or "") or "").strip() or None
        compra = EmbalagemCompra(embalagem_id=emb.id, quantidade=qtd, valor_total=valor,
                                 custo_unitario=round(valor / qtd, 4) if qtd else 0, url=url,
                                 observacao=(str(body.get("observacao") or "") or "").strip() or None)
        db.add(compra)
        emb.estoque_atual = int(emb.estoque_atual or 0) + qtd
        if url:
            emb.url_compra = url
        db.flush()
        emb.custo_medio = custo_medio_ponderado(emb.compras)
        emb.atualizado_em = datetime.utcnow()
        db.add(EmbalagemMovimento(embalagem_id=emb.id, quantidade=qtd, motivo="compra",
                                  descricao=f"Compra de {qtd} un por R$ {valor:.2f}"))
        db.commit()
        return JSONResponse({"ok": True, "embalagem": _emb_dict(emb)})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_ajuste(request: Request):
    """POST /api/embalagens/ajuste — define o estoque atual manualmente (movimento 'ajuste')."""
    db = SessionLocal()
    try:
        body = await request.json()
        emb = db.query(Embalagem).filter(Embalagem.id == body.get("embalagem_id")).first()
        if not emb:
            return JSONResponse({"erro": "embalagem não encontrada"}, status_code=404)
        novo = int(body.get("novo_estoque"))
        delta = novo - int(emb.estoque_atual or 0)
        emb.estoque_atual = max(0, novo)
        emb.atualizado_em = datetime.utcnow()
        db.add(EmbalagemMovimento(embalagem_id=emb.id, quantidade=delta, motivo="ajuste",
                                  descricao=(str(body.get("motivo") or "Ajuste manual"))[:255]))
        db.commit()
        return JSONResponse({"ok": True, "embalagem": _emb_dict(emb)})
    except (TypeError, ValueError):
        return JSONResponse({"erro": "novo_estoque inválido"}, status_code=400)
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_vinculo(request: Request):
    """POST /api/embalagens/vinculo — override sku->embalagem (embalagem_id null remove)."""
    db = SessionLocal()
    try:
        body = await request.json()
        sku = (str(body.get("sku") or "")).strip()
        if not sku:
            return JSONResponse({"erro": "sku obrigatório"}, status_code=400)
        vinc = db.query(EmbalagemVinculo).filter(EmbalagemVinculo.sku == sku).first()
        emb_id = body.get("embalagem_id")
        if not emb_id:
            if vinc:
                db.delete(vinc)
                db.commit()
            return JSONResponse({"ok": True, "removido": True})
        if not vinc:
            vinc = EmbalagemVinculo(sku=sku)
            db.add(vinc)
        vinc.embalagem_id = int(emb_id)
        db.commit()
        return JSONResponse({"ok": True})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_movimentos(request: Request):
    """GET /api/embalagens/movimentos?embalagem_id=&limit= — histórico recente."""
    db = SessionLocal()
    try:
        q = db.query(EmbalagemMovimento)
        emb_id = request.query_params.get("embalagem_id")
        if emb_id:
            q = q.filter(EmbalagemMovimento.embalagem_id == int(emb_id))
        try:
            limit = max(1, min(500, int(request.query_params.get("limit") or 200)))
        except (TypeError, ValueError):
            limit = 200
        rows = q.order_by(EmbalagemMovimento.data.desc()).limit(limit).all()
        nomes = {e.id: e.nome for e in db.query(Embalagem).all()}
        return JSONResponse({"movimentos": [{
            "id": m.id, "embalagem_id": m.embalagem_id, "embalagem": nomes.get(m.embalagem_id),
            "item_id": m.item_id, "sku": m.sku, "quantidade": m.quantidade,
            "motivo": m.motivo, "descricao": m.descricao,
            "data": m.data.isoformat() if m.data else None,
        } for m in rows]}, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_produtos(request: Request):
    """GET /api/embalagens/produtos — produtos ML com a caixa reconhecida (auto/override)
    pela dimensão + destaque dos 'a definir'."""
    db = SessionLocal()
    try:
        ativas = db.query(Embalagem).filter(Embalagem.ativo == 1).all()
        caixas = [e for e in ativas if e.criterio == "dimensao"]
        por_id = {e.id: e for e in ativas}
        vinculos = {v.sku.strip().upper(): v.embalagem_id
                    for v in db.query(EmbalagemVinculo).all() if v.sku}
        rows = (db.query(MercadoLivreItemCache)
                .filter(MercadoLivreItemCache.status == "active")
                .all())
        itens = []
        sem = 0
        for r in rows:
            prod_dims = dims_do_produto(r.dimensoes_json)
            manual = bool(r.sku and vinculos.get(r.sku.strip().upper()))
            caixa = resolver_caixa(r.sku, prod_dims, caixas, vinculos, por_id)
            if not caixa:
                sem += 1
            itens.append({
                "item_id": r.item_id, "sku": r.sku, "titulo": r.titulo,
                "imagem": r.imagem_principal or r.thumbnail,
                "dimensoes": r.dimensoes_texto, "tem_dimensao": prod_dims is not None,
                "caixa_id": caixa.id if caixa else None,
                "caixa_nome": caixa.nome if caixa else None,
                "origem": "manual" if manual else ("auto" if caixa else "sem"),
            })
        itens.sort(key=lambda x: (x["origem"] != "sem", x["sku"] or ""))
        return JSONResponse({
            "itens": itens,
            "resumo": {"total": len(itens), "sem_caixa": sem, "caixas_ativas": len(caixas)},
        }, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def embalagem_processar_baixas(request: Request):
    """POST /api/embalagens/processar-baixas — dispara a baixa por venda manualmente."""
    db = SessionLocal()
    try:
        resumo = processar_baixas_embalagem(db)
        return JSONResponse({"ok": True, "resumo": resumo})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/embalagens", embalagens, methods=["GET", "POST"]),
    Route("/api/embalagens/compra", embalagem_compra, methods=["POST"]),
    Route("/api/embalagens/ajuste", embalagem_ajuste, methods=["POST"]),
    Route("/api/embalagens/vinculo", embalagem_vinculo, methods=["POST"]),
    Route("/api/embalagens/movimentos", embalagem_movimentos, methods=["GET"]),
    Route("/api/embalagens/produtos", embalagem_produtos, methods=["GET"]),
    Route("/api/embalagens/processar-baixas", embalagem_processar_baixas, methods=["POST"]),
]
