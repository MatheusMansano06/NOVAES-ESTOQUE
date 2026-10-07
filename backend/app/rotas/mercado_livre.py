"""Rotas /api/ml/*: anúncios, vendas, promoções, Full e integração OAuth do Mercado Livre."""
from starlette.responses import JSONResponse, RedirectResponse, HTMLResponse
from starlette.requests import Request
from database import SessionLocal
import json
import re
import time
from typing import Any, Dict
from datetime import datetime
from app.models import MercadoLivreItemCache, MLNotificacao
from app.utils.lista_compra import registrar_snapshot_vendas
from app.utils.radar_full import calcular_radar_full
from app.integracoes.mercado_livre import ml

from app.rotas.comum import (
    Route,
)


async def ml_status(request: Request):
    """GET /api/ml/status — situação da integração Mercado Livre."""
    return JSONResponse(ml.status(), headers={"Cache-Control": "no-store"})


async def ml_anuncios(request: Request):
    """GET /api/ml/anuncios?status=active&offset=0&limit=50 — lista anúncios do ML (somente leitura)."""
    status = request.query_params.get("status", "active")
    q = (request.query_params.get("q", "") or "").strip()
    force_refresh = request.query_params.get("force_refresh", "").strip().lower() in {"1", "true", "yes", "sim"}
    try:
        offset = int(request.query_params.get("offset", 0))
        limit = int(request.query_params.get("limit", 50))
    except (TypeError, ValueError):
        offset, limit = 0, 50
    limit = max(10, min(limit, 50))
    offset = max(0, offset)
    resultado = ml.listar_anuncios(status=status, offset=offset, limit=limit, force_refresh=force_refresh, q=q)
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_anuncio_vendas(request: Request):
    """GET /api/ml/anuncios/{item_id}/vendas — histórico de vendas do anúncio
    (cliente, IDs, CEP, data, pagamento crédito/débito/pix e financeiro por venda).
    Paginação: ?offset=0&limit=20"""
    item_id = request.path_params["item_id"]
    # Por padrão NÃO sincroniza (lê do banco = instantâneo). O ?sync=1 força
    # a atualização (botão Atualizar). O job agendado mantém o espelho em dia.
    sync = request.query_params.get("sync", "0").strip().lower() in {"1", "true", "sim", "yes"}
    offset = int(request.query_params.get("offset", "0")) if request.query_params.get("offset", "").isdigit() else 0
    limit = int(request.query_params.get("limit", "20")) if request.query_params.get("limit", "").isdigit() else 20
    offset = max(0, offset)
    limit = max(1, min(limit, 100))  # clamp entre 1 e 100
    try:
        resultado = ml.vendas_do_anuncio(item_id, sync=sync, offset=offset, limit=limit)
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=502, headers={"Cache-Control": "no-store"})
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_vendas_por_mes(request: Request):
    """GET /api/ml/anuncios/{item_id}/vendas-por-mes — histórico agrupado por mês com DIFAL."""
    item_id = request.path_params["item_id"]
    sync = request.query_params.get("sync", "0").strip().lower() in {"1", "true", "sim", "yes"}
    try:
        resultado = ml.vendas_por_mes(item_id, sync=sync)
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=502, headers={"Cache-Control": "no-store"})
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_vendas_sync(request: Request):
    """POST /api/ml/vendas/sync — força atualização do espelho de pedidos.
    Body opcional: {"full": true} para varrer todo o histórico."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    incremental = not bool(body.get("full"))
    resultado = ml.sync_vendas(incremental=incremental)
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_promocoes(request: Request):
    """GET /api/ml/promocoes — promoções/campanhas ativas da Central de Promoções do ML."""
    resultado = ml.listar_promocoes()
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_promocao_candidatos(request: Request):
    """GET /api/ml/promocoes/{promotion_id}/candidatos?promotion_type= — anúncios elegíveis
    e ainda não inscritos (status=candidate) na promoção indicada."""
    promotion_id = request.path_params.get("promotion_id")
    promotion_type = (request.query_params.get("promotion_type", "") or "").strip()
    if not promotion_id or not promotion_type:
        return JSONResponse({"erro": "promotion_id e promotion_type são obrigatórios", "candidatos": []}, status_code=400)
    resultado = ml.listar_candidatos_promocao(promotion_id, promotion_type)
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_promocao_inscrever(request: Request):
    """POST /api/ml/promocoes/itens/{item_id}/inscrever {promotion_id, promotion_type, deal_price?}
    — inscreve o anúncio na promoção (ESCREVE no Mercado Livre)."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    promotion_id = (body.get("promotion_id") or "").strip() if isinstance(body.get("promotion_id"), str) else body.get("promotion_id")
    promotion_type = (body.get("promotion_type") or "").strip() if isinstance(body.get("promotion_type"), str) else body.get("promotion_type")
    deal_price = body.get("deal_price")
    if deal_price is not None:
        try:
            deal_price = float(deal_price)
        except (TypeError, ValueError):
            return JSONResponse({"erro": "deal_price inválido"}, status_code=400)
    if not promotion_id or not promotion_type:
        return JSONResponse({"erro": "promotion_id e promotion_type são obrigatórios"}, status_code=400)
    resultado = ml.inscrever_em_promocao(item_id, promotion_id, promotion_type, deal_price)
    code = 200 if not resultado.get("erro") else 502
    return JSONResponse(resultado, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_precificacao(request: Request):
    """GET /api/ml/precificacao?price=X&category_id=Y — tarifa de venda real (Clássico/Premium)."""
    try:
        price = float(request.query_params.get("price", 0))
    except (TypeError, ValueError):
        return JSONResponse({"erro": "price inválido"}, status_code=400)
    category_id = request.query_params.get("category_id") or None
    if price <= 0:
        return JSONResponse({"erro": "price obrigatório"}, status_code=400)
    return JSONResponse(ml.precificacao(price, category_id), headers={"Cache-Control": "no-store"})


async def ml_margens(request: Request):
    """POST /api/ml/margens {"skus":[...]} — margem por SKU (preço/frete/tarifa reais
    do ML, do cache). Usado pelo Catálogo para mostrar a margem dos nossos anúncios."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    skus = body.get("skus") if isinstance(body, dict) else None
    if skus is not None and not isinstance(skus, list):
        skus = None
    return JSONResponse(ml.margens_por_sku(skus), headers={"Cache-Control": "no-store"})


async def ml_imagens(request: Request):
    """GET /api/ml/imagens — mapa {SKU: imagem} de todo o cache do ML (qualquer status).
    Usado na Lista de Separação para mostrar a foto de cada item do inbound."""
    return JSONResponse(ml.imagens_por_sku(), headers={"Cache-Control": "no-store"})


async def ml_anuncio_detalhes(request: Request):
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    force_refresh = request.query_params.get("force_refresh", "").strip().lower() in {"1", "true", "yes", "sim"}
    result = ml.obter_anuncio_completo(item_id, force_refresh=force_refresh)
    code = 200 if not result.get("erro") else 502
    return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_anuncio_descricao(request: Request):
    item_id = request.path_params.get("item_id")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    plain_text = (body.get("plain_text") or "").strip()
    if not plain_text:
        return JSONResponse({"erro": "plain_text obrigatório"}, status_code=400)
    result = ml.atualizar_descricao(item_id, plain_text)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_atributos(request: Request):
    item_id = request.path_params.get("item_id")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    attrs = body.get("attributes") or []
    updates = {}
    for attr in attrs:
        attr_id = str(attr.get("id") or "").strip()
        if not attr_id:
            continue
        updates[attr_id] = {
            "value_name": attr.get("value_name"),
            "value_id": attr.get("value_id"),
        }
    if not updates:
        return JSONResponse({"erro": "Nenhum atributo informado"}, status_code=400)
    result = ml.atualizar_atributos(item_id, updates)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_dimensoes(request: Request):
    item_id = request.path_params.get("item_id")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    largura_cm = str(body.get("largura_cm") or "").strip()
    altura_cm = str(body.get("altura_cm") or "").strip()
    comprimento_cm = str(body.get("comprimento_cm") or "").strip()
    peso_g = str(body.get("peso_g") or "").strip()
    package_type = str(body.get("package_type") or "Com embalagem adicional").strip()
    if not all([largura_cm, altura_cm, comprimento_cm, peso_g]):
        return JSONResponse({"erro": "Todos os campos de dimensões são obrigatórios"}, status_code=400)
    result = ml.atualizar_dimensoes(item_id, largura_cm, altura_cm, comprimento_cm, peso_g, package_type)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_precos_quantidade(request: Request):
    """GET lê os tiers de atacado B2B; POST cria/atualiza (lista vazia remove)."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    if request.method == "GET":
        result = ml.obter_precos_quantidade(item_id)
        code = 200 if not result.get("erro") else 502
        return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    tiers = body.get("tiers")
    if not isinstance(tiers, list):
        return JSONResponse({"erro": "tiers deve ser uma lista"}, status_code=400)
    result = ml.salvar_precos_quantidade(item_id, tiers)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_preco_resumo(request: Request):
    """GET — valor cheio + valor promocional efetivo do anúncio (para o balão)."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    force_refresh = request.query_params.get("force_refresh", "").strip().lower() in {"1", "true", "yes", "sim"}
    result = ml.resumo_preco(item_id, force_refresh=force_refresh)
    code = 200 if not result.get("erro") else 502
    return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_sync_cache(request: Request):
    """
    POST /api/ml/sync
    Atualiza o espelho local do Mercado Livre.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    item_id = str(body.get("item_id") or "").strip()
    status = str(body.get("status") or "active").strip() or "active"
    try:
        offset = int(body.get("offset", 0) or 0)
        limit = int(body.get("limit", 50) or 50)
    except (TypeError, ValueError):
        offset, limit = 0, 50

    full = str(body.get("full") or "").strip().lower() in {"1", "true", "yes", "sim"}
    if item_id:
        result = ml.sync_item(item_id, force=True)
    else:
        # sincroniza o catálogo (incremental, ou completo se full=true) e devolve a
        # lista já do cache + o resumo do que o sync fez (observabilidade).
        sync = ml.sync_catalogo(status=status, force_full=full)
        result = ml.listar_anuncios(status=status, offset=offset, limit=limit, force_refresh=False)
        result["sync"] = sync
    code = 200 if not result.get("erro") else 502
    return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_anuncio_aplicar_preco(request: Request):
    """POST — aplica o preço base ao anúncio no Mercado Livre."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    result = ml.aplicar_preco(item_id, body.get("preco"))
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_estoque(request: Request):
    """POST — altera o estoque (available_quantity) do anúncio no ML."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    result = ml.atualizar_quantidade(item_id, body.get("quantidade"))
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_status(request: Request):
    """POST — muda o status do anúncio: active (reativar), paused (pausar) ou closed (finalizar)."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    result = ml.mudar_status(item_id, body.get("status"))
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_excluir(request: Request):
    """POST — exclui o anúncio (fecha e marca como deleted) no ML."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    result = ml.excluir_anuncio(item_id)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_duplicar(request: Request):
    """POST — duplica o anúncio no ML (novo item pausado).
    Body opcional: {"category_id": "MLB...", "titulo": "..."}."""
    item_id = request.path_params.get("item_id")
    if not item_id:
        return JSONResponse({"erro": "item_id obrigatório"}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        body = {}
    category_id = (body or {}).get("category_id") or None
    novo_titulo = (body or {}).get("titulo") or None
    result = ml.duplicar_anuncio(item_id, category_id=category_id, novo_titulo=novo_titulo)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_categorias_buscar(request: Request):
    """GET — busca categorias do ML por palavra-chave (p/ duplicar em outra categoria)."""
    q = request.query_params.get("q", "")
    result = ml.buscar_categorias(q)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


async def ml_conta(request: Request):
    """GET — dados da conta do vendedor no ML (card do dashboard)."""
    result = ml.conta()
    code = 200 if not result.get("erro") else 502
    return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})


async def ml_garimpo(request: Request):
    """GET /api/ml/garimpo?q=varal — Garimpador de Categoria.
    Analisa um termo no ML: categoria/nicho, mais buscados na categoria,
    palavras frequentes e distribuição de atributos do catálogo."""
    q = request.query_params.get("q", "")
    result = ml.garimpar(q)
    code = 200 if result.get("ok") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code, headers={"Cache-Control": "no-store"})


_radar_cache: Dict[str, Any] = {}
_RADAR_TTL_SEGUNDOS = 600  # estoque muda o dia todo; leitura ao vivo leva alguns segundos


def _ensure_date_created(db):
    """Garante date_created dos anúncios ativos (base da velocidade no bootstrap)."""
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


async def ml_divergencia_dimensoes(request: Request):
    """GET /api/ml/divergencia-dimensoes
    Anúncios ativos cuja embalagem declarada (SELLER_PACKAGE_*) difere da medida
    pelo ML (PACKAGE_*). Lê do cache local — sem chamada à API do ML."""
    from app.utils.divergencia_dimensoes import comparar
    db = SessionLocal()
    try:
        linhas = db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.status == "active").all()
        itens = []
        for r in linhas:
            d = comparar(r.attributes_json)
            if d:
                itens.append({
                    "item_id": r.item_id, "titulo": r.titulo, "sku": r.sku,
                    "logistic_type": r.logistic_type, "estoque": r.estoque_disponivel,
                    "vendidos": r.vendidos, "permalink": r.permalink, "thumbnail": r.thumbnail, **d,
                })
        itens.sort(key=lambda i: -i["maior_dif_pct"])
        sync = max((r.synced_at for r in linhas if r.synced_at), default=None)
        return JSONResponse({
            "total_ativos": len(linhas), "total": len(itens), "itens": itens,
            "sincronizado_em": sync.isoformat() if sync else None,
        })
    finally:
        db.close()


async def radar_full(request: Request):
    """GET /api/ml/radar-full?meta_dias=30&lead_time=5&horizonte=21[&refresh=1]
    Radar de Envio Full: por SKU, quando rompe e até que dia enviar reposição.
    Cruza estoque Full ao vivo (liberado + chegando) com a velocidade de venda."""
    def _int(nome, padrao, lo, hi):
        try:
            return max(lo, min(hi, int(request.query_params.get(nome) or padrao)))
        except (TypeError, ValueError):
            return padrao

    meta_dias = _int("meta_dias", 30, 1, 365)
    lead_time = _int("lead_time", 5, 0, 60)
    horizonte = _int("horizonte", 21, 1, 180)
    refresh = request.query_params.get("refresh") in ("1", "true", "yes")
    chave = f"{meta_dias}:{lead_time}:{horizonte}"

    cache = _radar_cache.get(chave)
    if cache and not refresh and (time.time() - cache["ts"]) < _RADAR_TTL_SEGUNDOS:
        dados = dict(cache["data"])
        dados["cache"] = {"hit": True, "idade_segundos": int(time.time() - cache["ts"])}
        return JSONResponse(dados, headers={"Cache-Control": "no-store"})

    db = SessionLocal()
    try:
        _ensure_date_created(db)
        try:
            registrar_snapshot_vendas(db)
        except Exception:
            db.rollback()
        dados = calcular_radar_full(ml, db, meta_dias=meta_dias, lead_time_dias=lead_time, horizonte=horizonte)
        if not dados.get("erro"):
            _radar_cache[chave] = {"ts": time.time(), "data": dados}
        dados["cache"] = {"hit": False, "idade_segundos": 0}
        return JSONResponse(dados, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def ml_anuncio_imagens_upload(request: Request):
    item_id = request.path_params.get("item_id")
    form = await request.form()
    existing_ids_raw = form.get("existing_ids") or "[]"
    try:
        existing_ids = json.loads(existing_ids_raw)
        if not isinstance(existing_ids, list):
            existing_ids = []
    except Exception:
        existing_ids = []

    files = []
    for key, value in form.multi_items():
        if key != "files":
            continue
        file_bytes = await value.read()
        files.append({
            "name": value.filename or "imagem",
            "bytes": file_bytes,
            "mime": getattr(value, "content_type", None),
        })
    if not files:
        return JSONResponse({"erro": "Nenhum arquivo enviado"}, status_code=400)
    result = ml.upload_imagem_e_atualizar(item_id, files, existing_ids)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_anuncio_imagens_reordenar(request: Request):
    item_id = request.path_params.get("item_id")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"erro": "JSON inválido"}, status_code=400)
    pictures = body.get("pictures") or []
    result = ml.atualizar_imagens(item_id, pictures)
    code = 200 if not result.get("erro") else int(result.get("status_code") or 502)
    return JSONResponse(result, status_code=code)


async def ml_conectar(request: Request):
    """GET /api/ml/conectar — redireciona pro login do Mercado Livre (re-autorização)."""
    if not ml.enabled:
        return HTMLResponse("<h2>Configure ML_CLIENT_ID/ML_CLIENT_SECRET no .env</h2>", status_code=400)
    return RedirectResponse(ml.get_authorization_url())


async def ml_callback(request: Request):
    """GET /api/ml/callback — recebe o code do ML e troca por token."""
    code = request.query_params.get("code")
    erro = request.query_params.get("error")
    if erro:
        return HTMLResponse(f"<h2 style='color:#d32f2f'>Autorização negada: {erro}</h2>", status_code=400)
    if not code:
        return HTMLResponse("<h2>Código de autorização não recebido</h2>", status_code=400)
    if ml.trocar_code_por_token(code):
        return HTMLResponse("""<html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h1 style="color:#2e7d32">✓ Mercado Livre conectado!</h1>
            <a href="/" style="display:inline-block;margin-top:20px;padding:12px 30px;background:#1976d2;color:#fff;text-decoration:none;border-radius:6px">Voltar</a>
            </body></html>""")
    return HTMLResponse("<h2 style='color:#d32f2f'>Falha ao obter token do ML</h2>", status_code=500)


def _extrair_claim_id(resource: str) -> str:
    """Pega o id do claim do 'resource' da notificação (aceita prefixo post-purchase)."""
    m = re.search(r"/claims/(\d+)", str(resource or ""))
    return m.group(1) if m else ""


async def ml_notificacoes(request: Request):
    """
    POST /api/ml/notificacoes — webhook do Mercado Livre. Responde 200 SEMPRE e
    rápido (o ML desativa o tópico se demorar/errar).

    Segurança: não confia no corpo. Só registra a notificação (auditoria/dedup)
    e confere que o user_id é o desta conta. Nenhum processamento de negócio
    roda a partir daqui hoje — o módulo de devoluções foi removido e será
    refeito; quando o novo assinar um tópico, o processamento entra aqui.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    topic = str(body.get("topic") or "").strip().lower()
    resource = str(body.get("resource") or "")
    user_id = str(body.get("user_id") or "")
    recebido = datetime.utcnow().isoformat() + "Z"

    # Registra sempre (auditoria/dedup/diagnóstico).
    db = SessionLocal()
    try:
        notif = MLNotificacao(
            topic=topic, resource=resource, resource_id=_extrair_claim_id(resource),
            user_id=user_id, application_id=str(body.get("application_id") or ""),
            attempts=int(body.get("attempts") or 0), recebido_em=recebido,
            status="recebido", payload=json.dumps(body, ensure_ascii=False)[:8000])
        db.add(notif)
        db.commit()
    except Exception:
        pass
    finally:
        db.close()

    # 200 sempre, para o ML não desativar o tópico.
    return JSONResponse({"ok": True}, status_code=200)


async def ml_notificacoes_recentes(request: Request):
    """GET /api/ml/notificacoes — últimas notificações recebidas (diagnóstico)."""
    db = SessionLocal()
    try:
        rows = db.query(MLNotificacao).order_by(MLNotificacao.id.desc()).limit(50).all()
        return JSONResponse([{
            "id": r.id, "topic": r.topic, "resource": r.resource,
            "resource_id": r.resource_id, "status": r.status,
            "recebido_em": r.recebido_em, "processado_em": r.processado_em,
            "detalhe": r.detalhe,
        } for r in rows])
    finally:
        db.close()


rotas = [
    Route("/api/ml/status", ml_status, methods=["GET"]),
    Route("/api/ml/sync", ml_sync_cache, methods=["POST"]),
    Route("/api/ml/anuncios", ml_anuncios, methods=["GET"]),
    Route("/api/ml/promocoes", ml_promocoes, methods=["GET"]),
    Route("/api/ml/promocoes/itens/{item_id:str}/inscrever", ml_promocao_inscrever, methods=["POST"]),
    Route("/api/ml/promocoes/{promotion_id:str}/candidatos", ml_promocao_candidatos, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/vendas", ml_anuncio_vendas, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/vendas-por-mes", ml_vendas_por_mes, methods=["GET"]),
    Route("/api/ml/vendas/sync", ml_vendas_sync, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}", ml_anuncio_detalhes, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/description", ml_anuncio_descricao, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/attributes", ml_anuncio_atributos, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/dimensions", ml_anuncio_dimensoes, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/precos-quantidade", ml_anuncio_precos_quantidade, methods=["GET", "POST"]),
    Route("/api/ml/anuncios/{item_id:str}/preco-resumo", ml_anuncio_preco_resumo, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/preco", ml_anuncio_aplicar_preco, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/estoque", ml_anuncio_estoque, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/status", ml_anuncio_status, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/excluir", ml_anuncio_excluir, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/duplicar", ml_anuncio_duplicar, methods=["POST"]),
    Route("/api/ml/categorias", ml_categorias_buscar, methods=["GET"]),
    Route("/api/ml/conta", ml_conta, methods=["GET"]),
    Route("/api/ml/garimpo", ml_garimpo, methods=["GET"]),
    Route("/api/ml/radar-full", radar_full, methods=["GET"]),
    Route("/api/ml/divergencia-dimensoes", ml_divergencia_dimensoes, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/pictures/upload", ml_anuncio_imagens_upload, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/pictures", ml_anuncio_imagens_reordenar, methods=["POST"]),
    Route("/api/ml/precificacao", ml_precificacao, methods=["GET"]),
    Route("/api/ml/margens", ml_margens, methods=["POST"]),
    Route("/api/ml/imagens", ml_imagens, methods=["GET"]),
    Route("/api/ml/conectar", ml_conectar, methods=["GET"]),
    Route("/api/ml/callback", ml_callback, methods=["GET"]),
    Route("/api/ml/notificacoes", ml_notificacoes, methods=["POST"]),
    Route("/api/ml/notificacoes", ml_notificacoes_recentes, methods=["GET"]),
]
