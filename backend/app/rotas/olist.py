"""Rotas /api/olist/*: produtos, vínculos, estoque e OAuth da Olist (+ imagem quadrada pública)."""
from starlette.responses import JSONResponse, RedirectResponse, HTMLResponse, Response
from starlette.requests import Request
from database import SessionLocal
import json
import asyncio
import threading
import re
from typing import Dict
from datetime import datetime
import urllib.request
import urllib.parse
import io
from app.models import ItemEstoque, VinculoOlist, ItemEmbaleFU, MercadoLivreItemCache, HistoricoFullEmbale
from app.integracoes.olist import olist
from app.integracoes.shopee import shopee

from app.rotas.comum import (
    Route,
    _calcular_reserva_inbound,
    _itens_full_reduzidos,
    _normalizar_tokens,
    _operador_contexto,
    _registrar_log_operacao,
)


async def atualizar_ncm_olist(request: Request):
    """POST /api/olist/atualizar-ncm  Body: {produto_id, ncm, shopee_item_id?}
    Corrige o NCM na Olist e, se shopee_item_id vier preenchido, na Shopee também."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"sucesso": False, "erro": "JSON inválido"}, status_code=400)

    produto_id = body.get("produto_id")
    ncm = body.get("ncm")
    shopee_item_id = body.get("shopee_item_id")
    if not produto_id or not ncm:
        return JSONResponse({"sucesso": False, "erro": "Informe produto_id e ncm"}, status_code=400)

    resultado = olist.atualizar_ncm_produto(str(produto_id), str(ncm))
    resultado_shopee = shopee.atualizar_ncm(str(shopee_item_id), str(ncm)) if shopee_item_id else None
    sucesso = bool(resultado.get("sucesso") and (resultado_shopee is None or resultado_shopee.get("sucesso")))
    return JSONResponse(
        {"sucesso": sucesso, "erro": resultado.get("erro") or (resultado_shopee or {}).get("erro"), "shopee": resultado_shopee},
        status_code=200 if sucesso else 502,
    )


_conferencia_ncm_lock = threading.Lock()
_conferencia_ncm_estado: Dict = {
    "status": "idle",  # idle | rodando | pronto | erro
    "resultado": None,
    "erro": None,
    "iniciado_em": None,
    "concluido_em": None,
}


def _rodar_conferencia_ncm(termo: str, ncm_esperado: str, incluir_excluidos: bool) -> None:
    """Roda em thread separada — 1 request por produto (throttle 120/min da
    Olist) travaria o único worker do app para todo o resto (mesmo problema
    já corrigido na Lista de Compra: ver _rodar_lista_compra_parados)."""
    global _conferencia_ncm_estado
    try:
        ncm_esperado_digitos = re.sub(r"\D", "", ncm_esperado)
        todos = olist.listar_todos_produtos(limite=3000)
        candidatos = [
            p for p in todos
            if termo in (p.get("nome") or "").lower()
            and (incluir_excluidos or p.get("situacao") != "E")
        ]

        # Só entra na lista quem tem anúncio em pelo menos um canal (ML ou
        # Shopee) — a Olist não expõe isso no cadastro do produto (é um dado
        # do Hub de Integração dela, não do endpoint /produtos que já usamos).
        db = SessionLocal()
        try:
            ml_skus = {
                re.sub(r"[^a-z0-9]", "", (s or "").lower())
                for (s,) in db.query(MercadoLivreItemCache.sku).filter(MercadoLivreItemCache.sku.isnot(None)).all()
            }
        finally:
            db.close()
        shopee_itens_fiscais = shopee.listar_todos_itens_fiscais() if shopee.configurado else []
        shopee_por_sku = {}
        for si in shopee_itens_fiscais:
            chave = re.sub(r"[^a-z0-9]", "", (si.get("sku") or "").lower())
            if chave:
                shopee_por_sku[chave] = si
        shopee_skus = set(shopee_por_sku)

        def _tem_integracao(p: Dict) -> bool:
            sku_norm = re.sub(r"[^a-z0-9]", "", (p.get("sku") or p.get("codigo_produto") or "").lower())
            return bool(sku_norm) and (sku_norm in ml_skus or sku_norm in shopee_skus)

        candidatos = [p for p in candidatos if _tem_integracao(p)]

        itens = []
        for p in candidatos:
            produto_id = p.get("id")
            detalhe = olist.obter_detalhes_completo(str(produto_id)) if produto_id else None
            ncm_atual = str((detalhe or {}).get("ncm") or "")
            sku_norm = re.sub(r"[^a-z0-9]", "", (p.get("sku") or p.get("codigo_produto") or "").lower())
            item_shopee = shopee_por_sku.get(sku_norm)
            # A Olist devolve o NCM formatado com pontos (ex.: "6506.10.10") —
            # comparar só os dígitos, senão nunca bate mesmo quando é o mesmo NCM.
            olist_bate = re.sub(r"\D", "", ncm_atual) == ncm_esperado_digitos
            shopee_ncm = str((item_shopee or {}).get("ncm") or "")
            shopee_bate = (re.sub(r"\D", "", shopee_ncm) == ncm_esperado_digitos) if item_shopee else True
            itens.append({
                "id": produto_id,
                "sku": p.get("sku") or p.get("codigo_produto") or "",
                "nome": p.get("nome") or "",
                "situacao": p.get("situacao") or "",
                "tipo": (detalhe or {}).get("tipo") or "",
                "ncm_atual": ncm_atual,
                "shopee_item_id": (item_shopee or {}).get("item_id") or "",
                "shopee_ncm": shopee_ncm,
                "bate": olist_bate and shopee_bate,
            })

        _conferencia_ncm_estado.update({
            "status": "pronto",
            "resultado": {"itens": itens, "total": len(itens), "termo": termo, "ncm_esperado": ncm_esperado},
            "erro": None,
            "concluido_em": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        print(f"[ERRO] Conferência NCM: {e}")
        _conferencia_ncm_estado.update({"status": "erro", "erro": str(e), "concluido_em": datetime.utcnow().isoformat()})


async def conferencia_ncm_olist_iniciar(request: Request):
    """POST /api/olist/conferencia-ncm/iniciar?termo=Viseira&ncm_esperado=65070000
    Dispara a varredura em background e devolve na hora."""
    termo = (request.query_params.get("termo") or "Viseira").strip().lower()
    ncm_esperado = (request.query_params.get("ncm_esperado") or "65070000").strip()
    incluir_excluidos = (request.query_params.get("incluir_excluidos") or "").lower() in ("1", "true", "sim")

    with _conferencia_ncm_lock:
        if _conferencia_ncm_estado["status"] == "rodando":
            return JSONResponse({"status": "rodando", "iniciado_em": _conferencia_ncm_estado["iniciado_em"]})
        _conferencia_ncm_estado.update({
            "status": "rodando", "resultado": None, "erro": None,
            "iniciado_em": datetime.utcnow().isoformat(), "concluido_em": None,
        })
        threading.Thread(target=_rodar_conferencia_ncm, args=(termo, ncm_esperado, incluir_excluidos), daemon=True).start()
    return JSONResponse({"status": "rodando", "iniciado_em": _conferencia_ncm_estado["iniciado_em"]})


async def conferencia_ncm_olist_status(request: Request):
    """GET /api/olist/conferencia-ncm — status/resultado da última varredura disparada."""
    return JSONResponse(_conferencia_ncm_estado)


_produtos_tipos_lock = threading.Lock()
_produtos_tipos_estado: Dict = {
    "status": "idle",  # idle | rodando | pronto | erro
    "resultado": None,
    "erro": None,
    "iniciado_em": None,
    "concluido_em": None,
}


def _rodar_produtos_tipos() -> None:
    """Traz TODOS os produtos com o campo 'tipo' (S=Simples, K=Kit, ...) —
    esse campo já vem de graça na listagem paginada (GET /produtos), sem
    precisar de 1 chamada por produto. Roda em thread só porque forçamos
    refresh do cache (a listagem antiga, de antes desse campo ser lido,
    não teria 'tipo'); a filtragem por palavra é feita no frontend, sem
    nova consulta à Olist a cada busca."""
    global _produtos_tipos_estado
    try:
        todos = olist.listar_todos_produtos(limite=3000, forcar_refresh=True)
        itens = [
            {
                "id": p.get("id"),
                "sku": p.get("sku") or p.get("codigo_produto") or "",
                "nome": p.get("nome") or "",
                "situacao": p.get("situacao") or "",
                "tipo": p.get("tipo") or "",
            }
            for p in todos
            if p.get("situacao") != "E"
        ]
        _produtos_tipos_estado.update({
            "status": "pronto",
            "resultado": {"itens": itens, "total": len(itens)},
            "erro": None,
            "concluido_em": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        print(f"[ERRO] Produtos por tipo: {e}")
        _produtos_tipos_estado.update({"status": "erro", "erro": str(e), "concluido_em": datetime.utcnow().isoformat()})


async def produtos_tipos_iniciar(request: Request):
    """POST /api/olist/produtos-tipos/iniciar — dispara a varredura em background e devolve na hora."""
    with _produtos_tipos_lock:
        if _produtos_tipos_estado["status"] == "rodando":
            return JSONResponse({"status": "rodando", "iniciado_em": _produtos_tipos_estado["iniciado_em"]})
        _produtos_tipos_estado.update({
            "status": "rodando", "resultado": None, "erro": None,
            "iniciado_em": datetime.utcnow().isoformat(), "concluido_em": None,
        })
        threading.Thread(target=_rodar_produtos_tipos, daemon=True).start()
    return JSONResponse({"status": "rodando", "iniciado_em": _produtos_tipos_estado["iniciado_em"]})


async def produtos_tipos_status(request: Request):
    """GET /api/olist/produtos-tipos — status/resultado da última varredura disparada."""
    return JSONResponse(_produtos_tipos_estado)


_IMG_HOSTS = ("http2.mlstatic.com", "s3.amazonaws.com")
# Amazon: >= 1000px de um lado e >= 500 do outro, só JPEG/PNG (sem webp). TikTok: lado >= 300.
_IMG_LADO = 1000


# código curto -> URL de origem. A Olist recusa link longo ("extensão não encontrada") e baixa a imagem
# na hora do PUT, então basta valer durante o job. ponytail: some no restart; rodar o job de novo resolve.
_img_quadrada_urls: Dict[str, str] = {}


def _baixar_imagem(url: str):
    from PIL import Image
    if urllib.parse.urlparse(url).hostname not in _IMG_HOSTS:
        raise ValueError("host não permitido")
    with urllib.request.urlopen(url, timeout=30) as r:
        return Image.open(io.BytesIO(r.read()))


async def imagem_quadrada(request: Request):
    """GET /api/imagem-quadrada/{cod}.jpg -> a imagem centralizada num quadrado branco
    (ampliada até o lado maior ter 1000px), em JPEG. URL pública para a Olist baixar (ela exige extensão no link).
    Só aceita imagens do ML e do S3 da Olist."""
    from PIL import Image
    try:
        url = _img_quadrada_urls[request.path_params["cod"]]
        img = (await asyncio.to_thread(_baixar_imagem, url)).convert("RGB")
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=400)
    escala = _IMG_LADO / max(img.size)
    if escala > 1:
        img = img.resize((round(img.width * escala), round(img.height * escala)), Image.LANCZOS)
    lado = max(img.size)
    tela = Image.new("RGB", (lado, lado), "white")
    tela.paste(img, ((lado - img.width) // 2, (lado - img.height) // 2))
    buf = io.BytesIO()
    tela.save(buf, "JPEG", quality=92)
    return Response(buf.getvalue(), media_type="image/jpeg")

async def buscar_produtos_olist(request: Request):
    """Busca produtos na Olist via API v3 (OAuth2) ou token simples (fallback)"""
    try:
        query = request.query_params.get("q", "")

        if not query or len(query) < 1:
            return JSONResponse({
                "produtos": [],
                "total": 0,
                "mensagem": "Digite ao menos 1 caractere para buscar"
            })

        # Buscar via API (com fallback automático para token simples)
        print(f"[BUSCA] Buscando na Olist: {query}")
        produtos = olist.buscar_produtos(query)

        if produtos:
            return JSONResponse({
                "produtos": produtos,
                "total": len(produtos),
                "termo_busca": query,
                "metodo": "oauth2_v3"
            })

        # Sem produtos: distinguir "Olist desconectado" de "produto realmente não existe".
        try:
            st = olist.status()
        except Exception:
            st = {}
        if not st.get("autorizado"):
            print("[BUSCA] Olist não autorizado — sinalizando reconexão")
            return JSONResponse({
                "produtos": [],
                "total": 0,
                "termo_busca": query,
                "nao_autorizado": True,
                "url_autorizacao": st.get("url_autorizacao") or "/api/olist/conectar",
                "mensagem": "Olist desconectado — reconecte a integração para buscar produtos."
            })

        # Nenhum produto encontrado (mas a integração está ok)
        return JSONResponse({
            "produtos": [],
            "total": 0,
            "termo_busca": query,
            "formulario_manual": True,
            "mensagem": f"Nenhum produto encontrado com '{query}'."
        })

    except Exception as e:
        print(f"[ERRO] Busca: {str(e)}")
        return JSONResponse({
            "produtos": [],
            "total": 0,
            "formulario_manual": True,
            "erro": str(e)
        })


async def listar_produtos_olist(request: Request):
    """Lista todos os produtos na Olist (usa cache)"""
    try:
        print("[LISTA] Listando todos os produtos da Olist")
        produtos = olist.listar_todos_produtos(limite=2000)

        return JSONResponse({
            "produtos": produtos,
            "total": len(produtos),
            "metodo": "list_all"
        })
    except Exception as e:
        print(f"[ERRO] Listagem: {str(e)}")
        return JSONResponse({
            "produtos": [],
            "total": 0,
            "erro": str(e)
        })


async def obter_estoque_produto_olist(request: Request):
    """Busca o estoque de UM produto sob demanda (rapido - 1 requisicao)"""
    try:
        produto_id = request.query_params.get("id", "").strip()
        if not produto_id:
            return JSONResponse({"error": "id obrigatorio"}, status_code=400)

        estoque = olist.obter_estoque(produto_id)
        if estoque:
            return JSONResponse({
                "estoque_atual": estoque.get("disponivel", 0),
                "estoque_saldo": estoque.get("saldo", 0),
                "estoque_reservado": estoque.get("reservado", 0),
            })
        return JSONResponse({
            "estoque_atual": 0,
            "estoque_saldo": 0,
            "estoque_reservado": 0,
        })
    except Exception as e:
        print(f"[ERRO] Estoque produto: {str(e)}")
        return JSONResponse({"estoque_atual": 0, "estoque_saldo": 0, "estoque_reservado": 0})


async def refresh_cache_produtos_olist(request: Request):
    """Forca recarregar o cache de produtos da Olist (atualizar lista)"""
    try:
        print("[CACHE] Refresh forcado do cache de produtos")
        produtos = olist.listar_todos_produtos(limite=2000, forcar_refresh=True)
        return JSONResponse({
            "status": "sucesso",
            "total": len(produtos),
            "mensagem": f"Cache atualizado: {len(produtos)} produtos"
        })
    except Exception as e:
        print(f"[ERRO] Refresh cache: {str(e)}")
        return JSONResponse({"status": "erro", "mensagem": str(e)}, status_code=500)


async def detectar_kit_automatico(request: Request):
    """
    Detecta automaticamente se um SKU é um KIT na Olist
    e retorna os componentes unitários para atualizar estoque
    GET /api/olist/detectar-kit?sku=V+RL3
    """
    try:
        sku = request.query_params.get("sku", "").strip()

        if not sku:
            return JSONResponse({
                "eh_kit": False,
                "erro": "SKU não informado"
            }, status_code=400)

        print(f"[KIT-AUTO] Detectando kit para SKU: {sku}")

        # Tenta detectar kit
        resultado = olist.detectar_e_buscar_kit(sku)

        if resultado.get("eh_kit"):
            # É um kit!
            componentes = resultado.get("componentes", [])
            print(f"[KIT-AUTO] KIT DETECTADO: {sku} com {len(componentes)} componente(s)")

            return JSONResponse({
                "eh_kit": True,
                "sku_principal": resultado.get("sku_principal"),
                "nome_kit": resultado.get("nome_kit"),
                "preco_kit": resultado.get("preco_kit"),
                "componentes": componentes,
                "mensagem": f"✅ KIT detectado! {len(componentes)} componentes encontrados"
            })
        else:
            # Não é kit, retorna o produto normal
            produto = resultado.get("produto")
            print(f"[KIT-AUTO] Não é kit. Tipo: {resultado.get('tipo')}")

            return JSONResponse({
                "eh_kit": False,
                "tipo": resultado.get("tipo"),
                "produto": produto,
                "mensagem": "Este SKU não é um kit, use a busca normal"
            })

    except Exception as e:
        print(f"[ERRO KIT-AUTO] {str(e)}")
        return JSONResponse({
            "eh_kit": False,
            "erro": str(e)
        }, status_code=500)


# ===== NOVOS ENDPOINTS - INTEGRAÇÃO OLIST =====

async def olist_status(request: Request):
    """Retorna status da integração Olist"""
    status = olist.status()
    return JSONResponse(status)


async def olist_diagnostico(request: Request):
    """Diagnóstico da integração Olist - para debug"""
    try:
        diagnostico = {
            "oauth2_configurado": bool(olist.client_id and olist.client_secret),
            "token_simples_configurado": bool(olist.token_v2),
            "token_oauth2_valido": bool(olist.get_access_token()),
            "tentar_lista_produtos": False,
            "erro": None
        }

        # Tentar listar alguns produtos com mais detalhes
        print("[DIAG] Testando conexão com Olist...")
        token = olist.get_access_token() or olist.token_v2

        if token:
            try:
                url = "https://api.tiny.com.br/public-api/v3/produtos?limit=1"
                headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=5) as response:
                    resposta = json.loads(response.read().decode("utf-8"))
                    diagnostico["conexao_ok"] = True
                    diagnostico["resposta_tipo"] = type(resposta).__name__
                    diagnostico["primeiro_campo"] = list(resposta.keys())[0] if isinstance(resposta, dict) else "lista"
            except urllib.error.HTTPError as e:
                diagnostico["conexao_ok"] = False
                diagnostico["erro"] = f"HTTP {e.code}: {e.read().decode('utf-8')[:100]}"
            except Exception as e:
                diagnostico["conexao_ok"] = False
                diagnostico["erro"] = str(e)
        else:
            diagnostico["erro"] = "Nenhum token disponível"

        return JSONResponse(diagnostico)
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)


async def vincular_produto_olist(request: Request):
    """Vincula um produto da NF com um anúncio da Olist"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")
        olist_produto_id = data.get("olist_produto_id")
        olist_sku = data.get("olist_sku", "")
        olist_nome = data.get("olist_nome", "")

        # 🔒 VALIDAÇÃO: Verificar se campos obrigatórios estão presentes
        if not item_id or not olist_produto_id:
            return JSONResponse({"error": "item_id e olist_produto_id são obrigatórios"}, status_code=400)

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        # Salvar vinculação no item
        item.olist_produto_id = olist_produto_id
        item.olist_sku = olist_sku
        item.olist_nome = olist_nome
        item.vinculado_em = datetime.utcnow()

        # MEMÓRIA DE VÍNCULOS: salva o de-para (descricao/codigo do fornecedor -> anúncio Olist)
        # para sugerir automaticamente em notas futuras com a mesma descrição/código.
        olist_preco = float(data.get("olist_preco", 0) or 0)
        vinculo = db.query(VinculoOlist).filter(
            VinculoOlist.nf_descricao == item.descricao,
            VinculoOlist.olist_produto_id == str(olist_produto_id)
        ).first()

        if vinculo:
            # Já existe esse de-para: atualiza e conta uso
            vinculo.nf_codigo = item.codigo_produto
            vinculo.olist_sku = olist_sku
            vinculo.olist_nome = olist_nome
            vinculo.olist_preco = olist_preco
            vinculo.vezes_usado = (vinculo.vezes_usado or 1) + 1
            vinculo.atualizado_em = datetime.utcnow()
        else:
            vinculo = VinculoOlist(
                nf_codigo=item.codigo_produto,
                nf_descricao=item.descricao,
                olist_produto_id=str(olist_produto_id),
                olist_sku=olist_sku,
                olist_nome=olist_nome,
                olist_preco=olist_preco,
                vezes_usado=1,
            )
            db.add(vinculo)

        db.commit()

        _registrar_log_operacao(
            request,
            "vinculo_manual_nota",
            "item_estoque",
            item.id,
            f"Produto vinculado à Olist: {olist_nome}",
            {
                "item_id": item.id,
                "codigo_produto": item.codigo_produto,
                "descricao": item.descricao,
                "olist_produto_id": str(olist_produto_id),
                "olist_sku": olist_sku,
                "olist_nome": olist_nome,
            },
        )

        return JSONResponse({
            "sucesso": True,
            "mensagem": f"Produto vinculado: {olist_nome}",
            "item_id": item_id,
            "olist_produto_id": olist_produto_id
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def aceitar_sugestao_vinculo(request: Request):
    """Aceita uma sugestão de vinculação automática (fuzzy match)"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")
        olist_produto_id = data.get("olist_produto_id")
        olist_sku = data.get("olist_sku", "")
        olist_nome = data.get("olist_nome", "")
        olist_preco = float(data.get("olist_preco", 0) or 0)

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        # Vincular item
        item.olist_produto_id = olist_produto_id
        item.olist_sku = olist_sku
        item.olist_nome = olist_nome
        item.vinculado_em = datetime.utcnow()

        # Atualizar memória de vínculos
        vinculo = db.query(VinculoOlist).filter(
            VinculoOlist.nf_descricao == item.descricao,
            VinculoOlist.olist_produto_id == str(olist_produto_id)
        ).first()

        if vinculo:
            vinculo.nf_codigo = item.codigo_produto
            vinculo.vezes_usado = (vinculo.vezes_usado or 1) + 1
            vinculo.atualizado_em = datetime.utcnow()
        else:
            vinculo = VinculoOlist(
                nf_codigo=item.codigo_produto,
                nf_descricao=item.descricao,
                olist_produto_id=str(olist_produto_id),
                olist_sku=olist_sku,
                olist_nome=olist_nome,
                olist_preco=olist_preco,
                vezes_usado=1,
            )
            db.add(vinculo)

        db.commit()

        _registrar_log_operacao(
            request,
            "vinculo_sugestao_aceito",
            "item_estoque",
            item.id,
            f"Sugestão de vínculo aceita: {olist_nome}",
            {
                "item_id": item.id,
                "codigo_produto": item.codigo_produto,
                "descricao": item.descricao,
                "olist_produto_id": str(olist_produto_id),
                "olist_sku": olist_sku,
                "olist_nome": olist_nome,
            },
        )

        return JSONResponse({
            "sucesso": True,
            "mensagem": f"Sugestão aceita: {olist_nome}",
            "item_id": item_id
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


def _normalizar_sku_texto(valor):
    return "".join(c for c in (valor or "").lower() if c.isalnum())


def _quantidade_item_para_olist(item: ItemEstoque) -> float:
    base = item.quantidade_confirmada
    if base is None:
        base = item.quantidade_nf
    try:
        return max(0.0, float(base or 0))
    except Exception:
        return 0.0


def _limpar_vinculo_item(item: ItemEstoque):
    item.olist_produto_id = None
    item.olist_sku = None
    item.olist_nome = None
    item.vinculado_em = None
    item.estoque_olist_atualizado_em = None
    item.quantidade_olist_enviada = 0


def _item_combina_vinculo_memoria(item: ItemEstoque, vinculo: VinculoOlist) -> bool:
    if str(item.olist_produto_id or "") != str(vinculo.olist_produto_id or ""):
        return False

    sku_item = _normalizar_sku_texto(item.olist_sku)
    sku_vinculo = _normalizar_sku_texto(vinculo.olist_sku)
    codigo_item = _normalizar_sku_texto(item.codigo_produto)
    codigo_vinculo = _normalizar_sku_texto(vinculo.nf_codigo)
    desc_item = " ".join(_normalizar_tokens(item.descricao or ""))
    desc_vinculo = " ".join(_normalizar_tokens(vinculo.nf_descricao or ""))

    if sku_item and sku_vinculo and sku_item == sku_vinculo:
        return True
    if codigo_item and codigo_vinculo and codigo_item == codigo_vinculo:
        return True
    if desc_item and desc_vinculo and desc_item == desc_vinculo:
        return True
    return False


def _restaurar_full_original(db, request, item_ids, olist_produto_id, olist_sku):
    """Volta o Vai pro FULL ao original do PDF nos itens escolhidos pelo conferente
    (só os que _itens_full_reduzidos devolve para ESTE produto). Registra no histórico. Não commita."""
    validos = {r["item_id"]: r for r in _itens_full_reduzidos(db, olist_produto_id, olist_sku)}
    quem = _operador_contexto(request)["operador_nome"]
    for iid in item_ids or []:
        r = validos.get(int(iid)) if str(iid).isdigit() else None
        if not r:
            continue
        it = db.query(ItemEmbaleFU).filter(ItemEmbaleFU.id == r["item_id"]).first()
        it.quantidade_baixar = r["original"]
        db.add(it)
        db.add(HistoricoFullEmbale(
            embale_id=r["inbound_id"], item_id=it.id, titulo_anuncio=it.titulo_anuncio,
            sku_inbound=it.sku_inbound, quantidade_anterior=r["atual"], quantidade_nova=r["original"],
            tipo="aumento", status="aprovado", solicitante=quem, decidido_por=quem, decidido_em=datetime.utcnow(),
        ))


async def atualizar_estoque_olist(request: Request):
    """Atualiza estoque do produto na Olist (entrada de mercadoria da NF)"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")
        item_ids = data.get("item_ids")  # lista opcional: subida EM MASSA de varios registros
        quantidade = data.get("quantidade", 0)  # quantidade a ADICIONAR (entrada)
        tipo = data.get("tipo", "E")  # E=Entrada (padrao), B=Balanco, S=Saida
        # MODO BALANÇO: quando o usuário informa o estoque REAL atual (corrige
        # estoque fictício antigo). Estoque final = real informado + qtd da NF.
        estoque_real = data.get("estoque_real")

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        if not item.olist_produto_id:
            return JSONResponse({
                "error": "Produto não está vinculado à Olist"
            }, status_code=400)

        agora = datetime.utcnow()
        modo_balanco = estoque_real is not None
        estoque_final_balanco = None

        # Conferente marcou "segurar a quantidade original" em itens com FULL reduzido.
        restaurar_ids = data.get("restaurar_full_item_ids") or []
        if restaurar_ids and (modo_balanco or tipo == "E"):
            _restaurar_full_original(db, request, restaurar_ids, item.olist_produto_id, item.olist_sku)
            db.flush()

        if modo_balanco:
            # Corrige a base fictícia e soma só a parte ORGÂNICA da NF,
            # respeitando a mesma reserva de inbound FULL da subida normal.
            try:
                base_real = max(0.0, float(estoque_real))
            except (TypeError, ValueError):
                return JSONResponse({"error": "Estoque real inválido"}, status_code=400)

            reserva_full = 0.0
            reserva_detalhes = []
            reserva_full, reserva_detalhes = _calcular_reserva_inbound(
                db, item.olist_produto_id, item.olist_sku,
                disponivel=float(quantidade), aplicar=True, agora=agora,
                olist_nome=item.olist_nome
            )

            quantidade_subir = max(0.0, float(quantidade) - reserva_full)
            estoque_final_balanco = base_real + quantidade_subir
            sucesso = olist.atualizar_estoque(
                item.olist_produto_id,
                quantidade=estoque_final_balanco,  # tipo B = absoluto
                tipo="B",
                preco_unitario=float(item.preco_unitario or 0),
                observacao=(
                    f"Balanço via NF: base real {int(base_real)} + "
                    f"{int(quantidade_subir)} orgânico "
                    f"(NF {int(float(quantidade))} - FULL {int(reserva_full)}) = "
                    f"{int(estoque_final_balanco)}"
                )
            )
        else:
            # ===== REGRA DO INBOUND =====
            # Só se aplica em ENTRADA (tipo 'E'). Segura a qtd destinada ao FULL
            # de inbounds ativos que ainda não deram baixa, e sobe só o restante.
            reserva_full = 0.0
            reserva_detalhes = []
            if tipo == "E":
                reserva_full, reserva_detalhes = _calcular_reserva_inbound(
                    db, item.olist_produto_id, item.olist_sku,
                    disponivel=float(quantidade), aplicar=True, agora=agora,
                    olist_nome=item.olist_nome
                )

            quantidade_subir = max(0.0, float(quantidade) - reserva_full)

            # Sobe na Olist só o que sobrou (se sobrou). Se segurou tudo, não
            # precisa chamar a Olist (nada de organico entra).
            sucesso = True
            if quantidade_subir > 0:
                sucesso = olist.atualizar_estoque(
                    item.olist_produto_id,
                    quantidade=quantidade_subir,
                    tipo=tipo,
                    preco_unitario=float(item.preco_unitario or 0)
                )

        if sucesso:
            # Determina TODOS os itens que participaram desta entrada.
            # Em massa, o frontend manda item_ids (todos os registros do grupo).
            if isinstance(item_ids, list) and item_ids:
                ids_marcar = item_ids
            else:
                ids_marcar = [item_id]

            # Vincula todos ao mesmo anuncio Olist, marca todos como subidos e
            # registra quanto de fato entrou na Olist por item.
            itens_grupo = db.query(ItemEstoque).filter(ItemEstoque.id.in_(ids_marcar)).all()
            pesos = [_quantidade_item_para_olist(it) for it in itens_grupo]
            total_pesos = sum(pesos)
            restante_subido = float(quantidade_subir)
            for idx, it in enumerate(itens_grupo):
                it.olist_produto_id = item.olist_produto_id
                it.olist_sku = item.olist_sku
                it.olist_nome = item.olist_nome
                it.estoque_olist_atualizado_em = agora
                if total_pesos > 0:
                    if idx == len(itens_grupo) - 1:
                        qtd_item_subida = max(0.0, restante_subido)
                    else:
                        qtd_item_subida = round((float(quantidade_subir) * pesos[idx]) / total_pesos, 4)
                        restante_subido = max(0.0, restante_subido - qtd_item_subida)
                else:
                    qtd_item_subida = 0.0
                it.quantidade_olist_enviada = qtd_item_subida

            db.commit()  # persiste tb as baixas dos inbounds (reserva)

            if modo_balanco:
                if reserva_full > 0:
                    inbs = ", ".join(f"#{d['numero_inbound']}" for d in reserva_detalhes)
                    msg = (
                        f"Balanço aplicado: estoque corrigido para {int(estoque_final_balanco)} un na Olist "
                        f"(base real {int(float(estoque_real))} + {int(quantidade_subir)} orgânico). "
                        f"Da NF, {int(reserva_full)} un ficaram reservadas pro FULL (inbound {inbs})."
                    )
                else:
                    msg = (
                        f"Balanço aplicado: estoque corrigido para {int(estoque_final_balanco)} un na Olist "
                        f"(base real {int(float(estoque_real))} + {int(float(quantidade))} da NF)."
                    )
            elif reserva_full > 0:
                inbs = ", ".join(f"#{d['numero_inbound']}" for d in reserva_detalhes)
                msg = (f"Entrada de {int(float(quantidade))} un: subi {int(quantidade_subir)} "
                       f"na Olist e segurei {int(reserva_full)} pro FULL (inbound {inbs}).")
            else:
                msg = f"Entrada de {int(quantidade_subir)} unidades registrada na Olist"

            return JSONResponse({
                "sucesso": True,
                "mensagem": msg,
                "olist_produto_id": item.olist_produto_id,
                "quantidade_recebida": float(quantidade),
                "quantidade_subida": quantidade_subir,
                "modo_balanco": modo_balanco,
                "estoque_final": estoque_final_balanco,
                "reservado_full": reserva_full,
                "reserva_detalhes": reserva_detalhes,
                "itens_marcados": len(itens_grupo)
            })
        else:
            db.rollback()  # desfaz tb as reservas do inbound
            return JSONResponse({
                "error": "Falha ao atualizar estoque na Olist",
                "detalhe": olist._ultimo_erro_estoque,
            }, status_code=500)

    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()

async def olist_sugestao_vinculo(request: Request):
    """
    Dado o código/descrição de um produto da NF, retorna o anúncio Olist
    que já foi vinculado antes a esse mesmo produto (se existir).
    Casa por código exato OU descrição exata.
    """
    codigo = request.query_params.get("codigo", "").strip()
    descricao = request.query_params.get("descricao", "").strip()

    db = SessionLocal()
    try:
        vinculo = None
        # 1) Tenta por código do fornecedor (mais confiável)
        if codigo:
            vinculo = db.query(VinculoOlist).filter(
                VinculoOlist.nf_codigo == codigo
            ).order_by(VinculoOlist.vezes_usado.desc()).first()
        # 2) Se não achou, tenta por descrição exata
        if not vinculo and descricao:
            vinculo = db.query(VinculoOlist).filter(
                VinculoOlist.nf_descricao == descricao
            ).order_by(VinculoOlist.vezes_usado.desc()).first()

        if not vinculo:
            return JSONResponse({"encontrado": False})

        return JSONResponse({
            "encontrado": True,
            "vinculo": {
                "id": vinculo.id,
                "nf_codigo": vinculo.nf_codigo,
                "nf_descricao": vinculo.nf_descricao,
                "olist_produto_id": vinculo.olist_produto_id,
                "olist_sku": vinculo.olist_sku,
                "olist_nome": vinculo.olist_nome,
                "olist_preco": vinculo.olist_preco,
                "vezes_usado": vinculo.vezes_usado,
            }
        })
    finally:
        db.close()


async def olist_listar_vinculos(request: Request):
    """Lista todos os vínculos salvos (de-para fornecedor -> Olist)"""
    db = SessionLocal()
    try:
        vinculos = db.query(VinculoOlist).order_by(VinculoOlist.atualizado_em.desc()).all()
        return JSONResponse({
            "total": len(vinculos),
            "vinculos": [{
                "id": v.id,
                "nf_codigo": v.nf_codigo,
                "nf_descricao": v.nf_descricao,
                "olist_produto_id": v.olist_produto_id,
                "olist_sku": v.olist_sku,
                "olist_nome": v.olist_nome,
                "olist_preco": v.olist_preco,
                "vezes_usado": v.vezes_usado,
                "criado_em": v.criado_em.isoformat() if v.criado_em else None,
            } for v in vinculos]
        })
    finally:
        db.close()


async def adicionar_produto_olist_manual(request: Request):
    """Adiciona um produto Olist manualmente para opções de vinculação"""
    db = SessionLocal()
    try:
        data = await request.json()
        sku = data.get("sku", "").strip()
        nome = data.get("nome", "").strip()
        preco = float(data.get("preco", 0) or 0)
        estoque = int(data.get("estoque", 0) or 0)

        if not sku or not nome:
            return JSONResponse(
                {"error": "SKU e Nome são obrigatórios"},
                status_code=400
            )

        # Criar como sugestão retornável
        resultado = {
            "id": f"manual_{sku}",
            "sku": sku,
            "nome": nome,
            "preco": preco,
            "estoque_atual": estoque,
            "estoque_saldo": estoque,
            "estoque_reservado": 0,
            "fonte": "manual"
        }

        return JSONResponse(resultado)

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def olist_conectar(request: Request):
    """Redireciona o usuário para autorizar o app no Olist"""
    if not olist.enabled:
        return HTMLResponse(
            "<h2>Erro: Credenciais OLIST_CLIENT_ID/SECRET não configuradas no .env</h2>",
            status_code=400
        )
    url = olist.get_authorization_url()
    return RedirectResponse(url)


async def olist_callback(request: Request):
    """Recebe o código de autorização do Olist e troca por token"""
    code = request.query_params.get("code")
    erro = request.query_params.get("error")

    if erro:
        return HTMLResponse(f"""
            <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h2 style="color:#d32f2f">Autorizacao negada</h2>
            <p>Erro: {erro}</p>
            <a href="http://localhost:5173">Voltar ao sistema</a>
            </body></html>
        """, status_code=400)

    if not code:
        return HTMLResponse("<h2>Código de autorização não recebido</h2>", status_code=400)

    sucesso = olist.trocar_code_por_token(code)

    if sucesso:
        return HTMLResponse("""
            <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h1 style="color:#2e7d32">✓ Olist conectado com sucesso!</h1>
            <p>A integração está ativa. Você já pode buscar produtos e atualizar estoque.</p>
            <a href="http://localhost:5173" style="display:inline-block;margin-top:20px;
               padding:12px 30px;background:#1976d2;color:white;text-decoration:none;
               border-radius:6px;font-weight:bold">Voltar ao Estoque Virtual</a>
            </body></html>
        """)
    else:
        return HTMLResponse("""
            <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h2 style="color:#d32f2f">Falha ao obter token</h2>
            <p>Verifique se as credenciais e a URL de redirecionamento estão corretas.</p>
            <a href="http://localhost:5173">Voltar ao sistema</a>
            </body></html>
        """, status_code=500)


async def olist_deletar_vinculo(request: Request):
    db = SessionLocal()
    try:
        data = await request.json()
        vinculo_id = data.get("id")
        v = db.query(VinculoOlist).filter(VinculoOlist.id == vinculo_id).first()
        if not v:
            return JSONResponse({"error": "Vínculo não encontrado"}, status_code=404)

        candidatos = db.query(ItemEstoque).filter(
            ItemEstoque.olist_produto_id == str(v.olist_produto_id)
        ).all()
        itens_afetados = [
            it for it in candidatos
            if _item_combina_vinculo_memoria(it, v)
        ]

        quantidade_reverter = round(
            sum(
                float(
                    it.quantidade_olist_enviada
                    if it.quantidade_olist_enviada is not None
                    else _quantidade_item_para_olist(it)
                )
                for it in itens_afetados
                if it.estoque_olist_atualizado_em
            ),
            4,
        )
        if quantidade_reverter > 0:
            sucesso = olist.atualizar_estoque(
                v.olist_produto_id,
                quantidade=quantidade_reverter,
                tipo="S",
                preco_unitario=float(v.olist_preco or 0),
            )
            if not sucesso:
                db.rollback()
                return JSONResponse({"error": "Falha ao reverter estoque na Olist"}, status_code=500)

        itens_limpos = 0
        for it in itens_afetados:
            if it.olist_produto_id or it.estoque_olist_atualizado_em or (it.quantidade_olist_enviada or 0):
                _limpar_vinculo_item(it)
                itens_limpos += 1

        db.delete(v)
        db.commit()
        qtd_txt = str(int(quantidade_reverter)) if float(quantidade_reverter).is_integer() else str(quantidade_reverter)
        mensagem = "Vínculo removido"
        if quantidade_reverter > 0:
            mensagem += f" e {qtd_txt} un foram retiradas da Olist"
        if itens_limpos > 0:
            mensagem += f" ({itens_limpos} item(ns) desvinculados)"
        return JSONResponse({"sucesso": True, "mensagem": mensagem, "quantidade_revertida": quantidade_reverter, "itens_limpos": itens_limpos})
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/olist/conectar", olist_conectar, methods=["GET"]),
    Route("/api/olist/callback", olist_callback, methods=["GET"]),
    Route("/api/olist/status", olist_status, methods=["GET"]),
    Route("/api/olist/diagnostico", olist_diagnostico, methods=["GET"]),
    Route("/api/olist/produtos", buscar_produtos_olist, methods=["GET"]),
    Route("/api/olist/detectar-kit", detectar_kit_automatico, methods=["GET"]),
    Route("/api/olist/produtos-todos", listar_produtos_olist, methods=["GET"]),
    Route("/api/olist/estoque-produto", obter_estoque_produto_olist, methods=["GET"]),
    Route("/api/olist/refresh-cache", refresh_cache_produtos_olist, methods=["POST"]),
    Route("/api/olist/vincular-produto", vincular_produto_olist, methods=["POST"]),
    Route("/api/olist/aceitar-sugestao", aceitar_sugestao_vinculo, methods=["POST"]),
    Route("/api/olist/atualizar-estoque", atualizar_estoque_olist, methods=["POST"]),
    Route("/api/olist/adicionar-manual", adicionar_produto_olist_manual, methods=["POST"]),
    Route("/api/olist/sugestao-vinculo", olist_sugestao_vinculo, methods=["GET"]),
    Route("/api/olist/vinculos", olist_listar_vinculos, methods=["GET"]),
    Route("/api/olist/vinculos/deletar", olist_deletar_vinculo, methods=["POST"]),
    Route("/api/olist/atualizar-ncm", atualizar_ncm_olist, methods=["POST"]),
    Route("/api/olist/conferencia-ncm", conferencia_ncm_olist_status, methods=["GET"]),
    Route("/api/olist/conferencia-ncm/iniciar", conferencia_ncm_olist_iniciar, methods=["POST"]),
    Route("/api/olist/produtos-tipos", produtos_tipos_status, methods=["GET"]),
    Route("/api/olist/produtos-tipos/iniciar", produtos_tipos_iniciar, methods=["POST"]),
    Route("/api/imagem-quadrada/{cod}.jpg", imagem_quadrada, methods=["GET"]),
]
