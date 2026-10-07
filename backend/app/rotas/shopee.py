"""Rotas /api/shopee/* e /api/negociacoes-shopee/*: integração e negociação de campanhas."""
from starlette.responses import JSONResponse, FileResponse, RedirectResponse, HTMLResponse
from starlette.requests import Request
from database import SessionLocal
import os
import json
from typing import Any, Dict
from datetime import datetime
from app.models import NegociacaoShopee, NegociacaoShopeeItem
from app import negociacao_shopee as negoc
from app.integracoes.shopee import shopee

from app.rotas.comum import (
    Route,
    UPLOAD_DIR,
)


async def shopee_status(request: Request):
    """GET /api/shopee/status — mesmo formato de /api/ml|olist/status."""
    return JSONResponse(shopee.status())


async def shopee_loja(request: Request):
    """GET /api/shopee/loja — dados da loja autorizada."""
    dados = shopee.info_loja()
    if dados.get("error"):
        return JSONResponse(
            {"erro": dados.get("error"), "mensagem": dados.get("message")}, status_code=502
        )
    return JSONResponse({
        "shop_id": dados.get("shop_id"),
        "nome": dados.get("shop_name"),
        "regiao": dados.get("region"),
        "status": dados.get("status"),
        "fulfillment_shopee": dados.get("shop_fulfillment_flag"),
    })


async def shopee_dashboard(request: Request):
    """GET /api/shopee/dashboard — saude da conta Shopee."""
    dados = shopee.dashboard()
    if dados.get("erro"):
        return JSONResponse(dados, status_code=502)
    return JSONResponse(dados)


async def shopee_token_forma(request: Request):
    """GET /api/shopee/token-forma — formato do token salvo, sem os valores."""
    return JSONResponse(shopee.forma_do_token())


async def shopee_renovar(request: Request):
    """POST /api/shopee/renovar — força a renovação para testar a cadeia."""
    return JSONResponse(shopee.renovar_agora())


async def shopee_diagnostico(request: Request):
    """GET /api/shopee/diagnostico — o que cada endpoint da Shopee devolve."""
    return JSONResponse(shopee.diagnostico())


async def shopee_promocoes(request: Request):
    """GET /api/shopee/promocoes — campanhas de desconto da loja."""
    status = request.query_params.get("status") or "ongoing"
    dados = shopee.listar_promocoes(status)
    return JSONResponse(dados, status_code=502 if dados.get("erro") else 200)


async def shopee_negociacao(request: Request):
    """POST /api/shopee/negociacao — preço da campanha + estoque do vendedor,
    por model_id. Alimenta a planilha de negociação do gerente de contas."""
    corpo = await request.json()
    discount_id = corpo.get("discount_id")
    item_ids = corpo.get("item_ids") or []
    if not discount_id or not item_ids:
        return JSONResponse({"erro": "discount_id e item_ids são obrigatórios"}, status_code=400)

    precos = shopee.precos_da_promocao(int(discount_id))
    if precos.get("erro"):
        return JSONResponse(precos, status_code=502)
    estoques = shopee.estoque_vendedor(item_ids)
    return JSONResponse({
        "precos": precos["precos"],
        "estoques": estoques["estoques"],
        "falhas": estoques["falhas"],
    })


# --------------------------------------------------------------------------
# Negociação Shopee — planilha mensal do gerente de contas
# --------------------------------------------------------------------------

NEGOC_DIR = os.path.join(UPLOAD_DIR, "negociacoes")


def _negoc_pasta(neg_id: int) -> str:
    caminho = os.path.join(NEGOC_DIR, str(neg_id))
    os.makedirs(caminho, exist_ok=True)
    return caminho


def _negoc_executar(db, neg) -> Dict[str, Any]:
    """Lê as planilhas salvas, busca na Shopee e grava AD/AE. Se a Shopee não
    responder, a negociação fica pendente e o histórico cru já está salvo."""
    pasta = _negoc_pasta(neg.id)
    arquivos = json.loads(neg.arquivos or "[]")

    linhas_por_arquivo = {
        arq["original"]: negoc.ler_planilha(os.path.join(pasta, arq["original"]))
        for arq in arquivos
    }
    item_ids = sorted({l["item_id"] for linhas in linhas_por_arquivo.values() for l in linhas})

    try:
        precos = negoc.coletar_precos(shopee)
        estoques = negoc.coletar_estoques(shopee, item_ids)
    except negoc.ShopeeIndisponivel as e:
        neg.status = "pendente"
        neg.erro = str(e)
        db.commit()
        return {"status": "pendente", "erro": str(e)}

    gravadas = 0
    resultados = []
    for arq in arquivos:
        resultado = negoc.montar(linhas_por_arquivo[arq["original"]], precos, estoques)
        gravadas += negoc.escrever(
            os.path.join(pasta, arq["original"]),
            os.path.join(pasta, arq["preenchido"]),
            resultado["itens"],
        )
        resultados.append(resultado)

    consolidado = resultados[0]
    db.query(NegociacaoShopeeItem).filter(
        NegociacaoShopeeItem.negociacao_id == neg.id
    ).delete()
    vistos = set()
    for resultado in resultados:
        for item in resultado["itens"]:
            chave = (item["item_id"], item["model_id"])
            if chave in vistos:
                continue
            vistos.add(chave)
            db.add(NegociacaoShopeeItem(
                negociacao_id=neg.id,
                item_id=item["item_id"],
                model_id=item["model_id"],
                sku=item["sku"],
                descricao=item["descricao"],
                preco_preenchido=item["preco_preenchido"],
                estoque_preenchido=item["estoque_preenchido"],
                estoque_full=item["estoque_full"],
                campanha_id=item["campanha_id"],
                campanha_nome=item["campanha_nome"],
                preco_referencia=item["preco_referencia"],
                preco_site_d1=item["preco_site_d1"],
                estoque_d1=item["estoque_d1"],
                estoque_full_d1=item["estoque_full_d1"],
                dados_planilha=negoc.dados_extras(item),
            ))

    neg.status = "preenchida"
    neg.erro = ""
    neg.total_linhas = len(vistos)
    neg.total_zerados = consolidado["total_zerados"]
    neg.total_multi_campanha = consolidado["total_multi_campanha"]
    db.commit()

    return {
        "status": "preenchida",
        "linhas_gravadas": gravadas,
        "total_linhas": neg.total_linhas,
        "total_zerados": neg.total_zerados,
        "total_multi_campanha": neg.total_multi_campanha,
        "sem_preco": consolidado["sem_preco"],
        "sem_estoque": consolidado["sem_estoque"],
    }


async def negoc_criar(request: Request):
    """POST /api/negociacoes-shopee — sobe as planilhas do mês e preenche."""
    db = SessionLocal()
    try:
        form = await request.form()
        enviados = [v for k, v in form.multi_items()
                    if k == "arquivos" and getattr(v, "filename", "")]
        if not enviados:
            return JSONResponse({"erro": "Nenhum arquivo enviado"}, status_code=400)

        competencia = (form.get("competencia") or datetime.now().strftime("%Y-%m"))[:7]
        neg = NegociacaoShopee(
            nome=(form.get("nome") or f"Negociação {competencia}").strip()[:150],
            competencia=competencia,
            status="pendente",
        )
        db.add(neg)
        db.commit()

        pasta = _negoc_pasta(neg.id)
        arquivos = []
        for i, enviado in enumerate(enviados):
            original = f"{i}-original.xlsx"
            with open(os.path.join(pasta, original), "wb") as destino:
                destino.write(await enviado.read())
            arquivos.append({
                "nome": os.path.basename(enviado.filename),
                "original": original,
                "preenchido": f"{i}-preenchido.xlsx",
            })
        neg.arquivos = json.dumps(arquivos, ensure_ascii=False)
        db.commit()

        try:
            resumo = _negoc_executar(db, neg)
        except negoc.PlanilhaInvalida as e:
            db.delete(neg)
            db.commit()
            return JSONResponse({"erro": str(e)}, status_code=400)

        return JSONResponse({"id": neg.id, "nome": neg.nome, **resumo})
    finally:
        db.close()


async def negoc_listar(request: Request):
    """GET /api/negociacoes-shopee — histórico, da mais recente para a mais antiga."""
    db = SessionLocal()
    try:
        negociacoes = db.query(NegociacaoShopee).order_by(
            NegociacaoShopee.criado_em.desc(), NegociacaoShopee.id.desc()
        ).all()
        return JSONResponse([{
            "id": n.id,
            "nome": n.nome,
            "competencia": n.competencia,
            "status": n.status,
            "total_linhas": n.total_linhas,
            "total_zerados": n.total_zerados,
            "total_multi_campanha": n.total_multi_campanha,
            "erro": n.erro or "",
            "arquivos": json.loads(n.arquivos or "[]"),
            "criado_em": n.criado_em.isoformat() if n.criado_em else None,
        } for n in negociacoes])
    finally:
        db.close()


async def negoc_detalhe(request: Request):
    """GET /api/negociacoes-shopee/{id} — a negociação com todas as linhas."""
    db = SessionLocal()
    try:
        neg = db.query(NegociacaoShopee).get(int(request.path_params["id"]))
        if not neg:
            return JSONResponse({"erro": "Negociação não encontrada"}, status_code=404)
        return JSONResponse({
            "id": neg.id,
            "nome": neg.nome,
            "competencia": neg.competencia,
            "status": neg.status,
            "erro": neg.erro or "",
            "arquivos": json.loads(neg.arquivos or "[]"),
            "criado_em": neg.criado_em.isoformat() if neg.criado_em else None,
            "itens": [{
                "item_id": i.item_id,
                "model_id": i.model_id,
                "sku": i.sku,
                "descricao": i.descricao,
                "preco": i.preco_preenchido,
                "estoque": i.estoque_preenchido,
                "estoque_full": i.estoque_full,
                "campanha": i.campanha_nome,
                "preco_referencia": i.preco_referencia,
                "preco_site_d1": i.preco_site_d1,
                "estoque_d1": i.estoque_d1,
                "estoque_full_d1": i.estoque_full_d1,
            } for i in neg.itens],
        })
    finally:
        db.close()


async def negoc_arquivo(request: Request):
    """GET /api/negociacoes-shopee/{id}/arquivo/{idx} — baixa o xlsx preenchido."""
    db = SessionLocal()
    try:
        neg = db.query(NegociacaoShopee).get(int(request.path_params["id"]))
        if not neg:
            return JSONResponse({"erro": "Negociação não encontrada"}, status_code=404)

        arquivos = json.loads(neg.arquivos or "[]")
        idx = int(request.path_params["idx"])
        if idx < 0 or idx >= len(arquivos):
            return JSONResponse({"erro": "Arquivo não encontrado"}, status_code=404)

        arq = arquivos[idx]
        # pendente: a planilha ainda não foi preenchida, devolve a original
        interno = arq["preenchido"] if neg.status == "preenchida" else arq["original"]
        caminho = os.path.join(_negoc_pasta(neg.id), interno)
        if not os.path.exists(caminho):
            return JSONResponse({"erro": "Arquivo não está mais no disco"}, status_code=410)

        sufixo = " - PREENCHIDO" if neg.status == "preenchida" else ""
        base = arq["nome"].rsplit(".xlsx", 1)[0]
        return FileResponse(
            caminho,
            filename=f"{base}{sufixo}.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    finally:
        db.close()


async def negoc_reprocessar(request: Request):
    """POST /api/negociacoes-shopee/{id}/reprocessar — refaz a busca na Shopee."""
    db = SessionLocal()
    try:
        neg = db.query(NegociacaoShopee).get(int(request.path_params["id"]))
        if not neg:
            return JSONResponse({"erro": "Negociação não encontrada"}, status_code=404)
        try:
            return JSONResponse({"id": neg.id, **_negoc_executar(db, neg)})
        except negoc.PlanilhaInvalida as e:
            return JSONResponse({"erro": str(e)}, status_code=400)
    finally:
        db.close()


async def negoc_bi(request: Request):
    """GET /api/negociacoes-shopee/bi — ruptura, preço x referência e giro."""
    db = SessionLocal()
    try:
        recentes = db.query(NegociacaoShopee).filter(
            NegociacaoShopee.status == "preenchida"
        ).order_by(
            NegociacaoShopee.criado_em.desc(), NegociacaoShopee.id.desc()
        ).limit(2).all()
        if not recentes:
            return JSONResponse({"vazio": True})

        atual = recentes[0]
        anterior = recentes[1] if len(recentes) > 1 else None

        ruptura = sorted(
            ({
                "item_id": i.item_id, "sku": i.sku, "descricao": i.descricao,
                "estoque": i.estoque_preenchido, "estoque_full": i.estoque_full,
                "preco": i.preco_preenchido,
            } for i in atual.itens if (i.estoque_preenchido or 0) == 0),
            key=lambda x: -(x["estoque_full"] or 0),
        )

        # A Shopee só preenche "Preço Referência" em uma minoria das linhas; nas
        # demais o comparável é o preço que o produto tinha no site (D-1).
        preco = []
        for i in atual.itens:
            if i.preco_preenchido is None:
                continue
            base = i.preco_referencia or i.preco_site_d1
            if not base:
                continue
            preco.append({
                "item_id": i.item_id, "sku": i.sku, "descricao": i.descricao,
                "preco": i.preco_preenchido,
                "referencia": i.preco_referencia,
                "site_d1": i.preco_site_d1,
                "campanha": i.campanha_nome,
                "base_tipo": "referencia" if i.preco_referencia else "site",
                "desvio_pct": round((i.preco_preenchido - base) / base * 100, 1),
            })
        preco.sort(key=lambda x: x["desvio_pct"])

        giro = {"entraram": [], "sairam": [], "anterior": None}
        if anterior:
            antes = {i.model_id: i for i in anterior.itens}
            agora = {i.model_id: i for i in atual.itens}
            giro = {
                "anterior": {"id": anterior.id, "nome": anterior.nome},
                "entraram": [{"item_id": agora[m].item_id, "sku": agora[m].sku,
                              "descricao": agora[m].descricao}
                             for m in agora.keys() - antes.keys()],
                "sairam": [{"item_id": antes[m].item_id, "sku": antes[m].sku,
                            "descricao": antes[m].descricao}
                           for m in antes.keys() - agora.keys()],
            }

        return JSONResponse({
            "vazio": False,
            "negociacao": {"id": atual.id, "nome": atual.nome,
                           "competencia": atual.competencia,
                           "total_linhas": atual.total_linhas},
            "ruptura": ruptura,
            "preco": preco,
            "giro": giro,
        })
    finally:
        db.close()


async def shopee_conectar(request: Request):
    """GET /api/shopee/conectar — manda o lojista autorizar a loja."""
    if not shopee.configurado:
        return HTMLResponse(
            "<h2>Configure SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY no .env</h2>",
            status_code=400,
        )
    return RedirectResponse(shopee.url_autorizacao())


async def shopee_callback(request: Request):
    """GET /api/shopee/callback — recebe code + shop_id e troca por token."""
    code = request.query_params.get("code")
    shop_id = request.query_params.get("shop_id")
    if not code or not shop_id:
        return HTMLResponse(
            "<h2>Retorno sem code/shop_id — refaça a autorização</h2>", status_code=400
        )

    resposta = shopee.trocar_code(code, shop_id)
    if resposta.get("error"):
        return HTMLResponse(
            f"<h2 style='color:#d32f2f'>Falha ao conectar: {resposta.get('message') or resposta.get('error')}</h2>",
            status_code=502,
        )

    return HTMLResponse("""<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1 style="color:#2e7d32">✓ Shopee conectada!</h1>
        <a href="/" style="display:inline-block;margin-top:20px;padding:12px 30px;background:#1976d2;color:#fff;text-decoration:none;border-radius:6px">Voltar</a>
        </body></html>""")


async def shopee_webhook(request: Request):
    """
    POST /api/shopee/webhook — callback de push notification da Shopee Open
    Platform. Precisa responder 2xx rápido (é isso que a tela de configuração
    de "notificações ao vivo" verifica); GET também aceito por segurança caso
    a Shopee faça handshake por GET.

    ponytail: só loga o payload por enquanto — a integração Shopee ainda não
    existe (sem token/loja conectada). Quando ela for construída, trocar o
    print por persistência + processamento por código de evento, no molde de
    ml_notificacoes/MLNotificacao.
    """
    try:
        body = await request.json() if request.method == "POST" else {}
    except Exception:
        body = {}
    print(f"[SHOPEE][WEBHOOK] {request.method} {json.dumps(body, ensure_ascii=False)[:2000]}")
    return JSONResponse({"ok": True}, status_code=200)


rotas = [
    Route("/api/shopee/status", shopee_status, methods=["GET"]),
    Route("/api/shopee/loja", shopee_loja, methods=["GET"]),
    Route("/api/shopee/dashboard", shopee_dashboard, methods=["GET"]),
    Route("/api/shopee/token-forma", shopee_token_forma, methods=["GET"]),
    Route("/api/shopee/renovar", shopee_renovar, methods=["POST"]),
    Route("/api/shopee/diagnostico", shopee_diagnostico, methods=["GET"]),
    Route("/api/shopee/promocoes", shopee_promocoes, methods=["GET"]),
    Route("/api/shopee/negociacao", shopee_negociacao, methods=["POST"]),
    Route("/api/negociacoes-shopee/bi", negoc_bi, methods=["GET"]),
    Route("/api/negociacoes-shopee", negoc_listar, methods=["GET"]),
    Route("/api/negociacoes-shopee", negoc_criar, methods=["POST"]),
    Route("/api/negociacoes-shopee/{id:int}", negoc_detalhe, methods=["GET"]),
    Route("/api/negociacoes-shopee/{id:int}/arquivo/{idx:int}", negoc_arquivo, methods=["GET"]),
    Route("/api/negociacoes-shopee/{id:int}/reprocessar", negoc_reprocessar, methods=["POST"]),
    Route("/api/shopee/conectar", shopee_conectar, methods=["GET"]),
    Route("/api/shopee/callback", shopee_callback, methods=["GET"]),
    Route("/api/shopee/webhook", shopee_webhook, methods=["GET", "POST"]),
]
