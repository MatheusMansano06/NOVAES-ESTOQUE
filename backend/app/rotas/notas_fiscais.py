"""Rotas de notas fiscais e estoque virtual: upload de NF-e, conferência e divergências."""
from starlette.responses import JSONResponse, FileResponse, Response
from starlette.requests import Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import SessionLocal
import os
import threading
import re
from typing import Dict
from datetime import datetime
import uuid
from difflib import SequenceMatcher
from app.models import (
    NotaFiscal,
    ItemEstoque,
    ConfirmacaoEstoque,
    StatusEstoque,
    VinculoOlist,
    EmbaleFU,
    ItemEmbaleFU,
    MercadoLivreItemCache,
)
from app.utils.nfe_parser import NFeParsing
from app.utils.nfe_pdf_generator import NFePDFGenerator
from app.integracoes.olist import olist
from app.integracoes.mercado_livre import ml
from app.integracoes.shopee import shopee

from app.rotas.comum import (
    MAX_PAGINATION_LIMIT,
    Route,
    UPLOAD_DIR,
    _quantidade_planejada_full,
    _registrar_log_operacao,
)


# Cache para armazenar access_token da Olist

# 📋 Constantes de configuração
MIN_AUTO_CONFIDENCE = 0.95  # Vincular automaticamente apenas com 95%+ de confiança
MIN_FUZZY_CONFIDENCE = 0.80  # Sugerir vinculação com 80%+ de confiança

def serialize_item(item):
    """Serializa um ItemEstoque para JSON, incluindo dados Olist"""
    return {
        "id": item.id,
        "codigo_produto": item.codigo_produto,
        "descricao": item.descricao,
        "quantidade_nf": item.quantidade_nf,
        "quantidade_confirmada": item.quantidade_confirmada,
        "preco_unitario": item.preco_unitario,
        "status": item.status.value if hasattr(item.status, "value") else item.status,
        "divergencia": item.divergencia,
        "data_criacao": item.data_criacao.isoformat() if item.data_criacao else None,
        # Dados de integração Olist
        "olist_produto_id": item.olist_produto_id,
        "olist_sku": item.olist_sku,
        "olist_nome": item.olist_nome,
        "vinculado_em": item.vinculado_em.isoformat() if item.vinculado_em else None,
        "estoque_olist_atualizado_em": item.estoque_olist_atualizado_em.isoformat() if item.estoque_olist_atualizado_em else None,
        "quantidade_olist_enviada": float(item.quantidade_olist_enviada or 0),
    }


def serialize_nota(nf):
    """Serializa uma NotaFiscal (com itens) para JSON"""
    return {
        "id": nf.id,
        "numero_nf": nf.numero_nf,
        "serie": nf.serie,
        "fornecedor": nf.fornecedor,
        "cnpj": nf.cnpj,
        "endereco": nf.endereco,
        "data_emissao": nf.data_emissao.isoformat() if nf.data_emissao else None,
        "data_upload": nf.data_upload.isoformat() if nf.data_upload else None,
        "arquivo_original": nf.arquivo_original,
        "status": nf.status,
        "erros": nf.erros,
        "valor_frete": nf.valor_frete or 0,
        "itens": [serialize_item(item) for item in nf.itens],
    }


def similaridade(str1: str, str2: str) -> float:
    """Calcula similaridade entre duas strings (0 a 1)"""
    return SequenceMatcher(None, str1.lower(), str2.lower()).ratio()


def auto_buscar_vinculo(db: Session, item: ItemEstoque):
    """
    Busca automáticamente um vínculo para o item.
    Retorna (vinculo_encontrado, confianca)
    - Match exato por código: confiança 100%
    - Match exato por descrição: confiança 95%
    - Match por similaridade (>80%): confiança varia
    """
    # 1) Tenta match exato por código
    if item.codigo_produto:
        vinculo = db.query(VinculoOlist).filter(
            VinculoOlist.nf_codigo == item.codigo_produto
        ).order_by(VinculoOlist.vezes_usado.desc()).first()
        if vinculo:
            return vinculo, 1.0  # 100% confiança

    # 2) Tenta match exato por descrição
    if item.descricao:
        vinculo = db.query(VinculoOlist).filter(
            VinculoOlist.nf_descricao == item.descricao
        ).order_by(VinculoOlist.vezes_usado.desc()).first()
        if vinculo:
            return vinculo, 0.95  # 95% confiança

    # 3) Tenta fuzzy match por descrição (acima de MIN_FUZZY_CONFIDENCE)
    if item.descricao:
        # ⚡ PERFORMANCE: Usar SQL LIKE para pré-filtrar antes do loop
        termo = item.descricao[:30]  # Primeiros 30 caracteres
        vinculos_candidatos = db.query(VinculoOlist).filter(
            VinculoOlist.nf_descricao.like(f"%{termo}%")
        ).all()

        best_match = None
        best_score = 0
        for v in vinculos_candidatos:
            # 🔒 SEGURANÇA: Verificar se nf_descricao não é None
            if v.nf_descricao is None:
                continue
            score = similaridade(item.descricao, v.nf_descricao)
            if score > best_score:
                best_score = score
                best_match = v
        if best_match and best_score >= MIN_FUZZY_CONFIDENCE:
            return best_match, best_score

    return None, 0

async def upload_nfe(request: Request):
    """Upload and process NF-e (XML or PDF)"""
    form = await request.form()
    file = form['file']
    # Frete opcional informado no upload (entra no rateio de custo/margem)
    try:
        valor_frete = float(form.get("valor_frete") or 0)
    except (TypeError, ValueError):
        valor_frete = 0.0

    if not file.filename:
        return JSONResponse({"error": "No file provided"}, status_code=400)

    file_ext = file.filename.split(".")[-1].lower()

    if file_ext not in ['xml', 'pdf']:
        return JSONResponse({"error": "Apenas XML ou PDF permitidos"}, status_code=400)

    content = await file.read()

    try:
        # 🔒 SEGURANÇA: Sanitizar nome do arquivo para evitar path traversal
        safe_filename = uuid.uuid4().hex + os.path.splitext(file.filename)[1]

        if file_ext == "xml":
            result = NFeParsing.parse_xml(content)
        else:
            temp_path = os.path.join(UPLOAD_DIR, safe_filename)
            with open(temp_path, "wb") as f:
                f.write(content)
            result = NFeParsing.parse_pdf_ocr(temp_path)

        if not result.get("sucesso"):
            return JSONResponse({"error": result.get('erro')}, status_code=400)

        db = SessionLocal()
        try:
            nf = NotaFiscal(
                numero_nf=result.get("numero_nf", ""),
                serie=result.get("serie", "1"),
                fornecedor=result.get("fornecedor", ""),
                cnpj=result.get("cnpj", ""),
                endereco=result.get("endereco", ""),
                data_emissao=result.get("data_emissao"),
                arquivo_original=safe_filename,
                tipo_documento="nfe" if file_ext == "xml" else "pdf",
                status="processado",
                valor_frete=valor_frete,
                xml_processado=content.decode('utf-8', errors='ignore') if file_ext == "xml" else None
            )

            db.add(nf)
            db.flush()

            items_criados = []
            sugestoes_vinculacao = []

            for item in result.get("itens", []):
                estoque_item = ItemEstoque(
                    nf_id=nf.id,
                    codigo_produto=item.get("codigo", ""),
                    descricao=item.get("descricao", ""),
                    quantidade_nf=item.get("quantidade", 0.0),
                    preco_unitario=item.get("preco", 0.0),
                    status="quarentena"
                )
                db.add(estoque_item)
                db.flush()  # Para obter o ID do item
                items_criados.append(estoque_item)

            db.commit()

            # Auto-vinculação: buscar sugestões para cada item
            for estoque_item in items_criados:
                vinculo, confianca = auto_buscar_vinculo(db, estoque_item)
                if vinculo:
                    # Auto-vincular se confiança >= MIN_AUTO_CONFIDENCE (match exato)
                    if confianca >= MIN_AUTO_CONFIDENCE:
                        estoque_item.olist_produto_id = vinculo.olist_produto_id
                        estoque_item.olist_sku = vinculo.olist_sku
                        estoque_item.olist_nome = vinculo.olist_nome
                        estoque_item.vinculado_em = datetime.utcnow()
                        db.commit()
                    else:
                        # Sugerir se confiança entre MIN_FUZZY_CONFIDENCE e MIN_AUTO_CONFIDENCE (fuzzy match)
                        sugestoes_vinculacao.append({
                            "item_id": estoque_item.id,
                            "descricao": estoque_item.descricao,
                            "confianca": round(confianca * 100, 1),
                            "sugestao": {
                                "olist_produto_id": vinculo.olist_produto_id,
                                "olist_sku": vinculo.olist_sku,
                                "olist_nome": vinculo.olist_nome,
                                "olist_preco": vinculo.olist_preco,
                                "vezes_usado": vinculo.vezes_usado
                            }
                        })

            _registrar_log_operacao(
                request,
                "nota_upload",
                "nota_fiscal",
                nf.id,
                f"Upload da NF {nf.numero_nf}",
                {
                    "numero_nf": nf.numero_nf,
                    "fornecedor": nf.fornecedor,
                    "itens_encontrados": len(result.get("itens", [])),
                    "arquivo": safe_filename,
                },
            )

            return JSONResponse({
                "id": nf.id,
                "numero_nf": nf.numero_nf,
                "status": "processado",
                "itens_encontrados": len(result.get("itens", [])),
                "sugestoes_vinculacao": sugestoes_vinculacao,
                "erros": None
            })

        finally:
            db.close()

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def get_nfs(request: Request):
    """List all NFs with pagination"""
    try:
        skip = int(request.query_params.get("skip", 0))
        # 🔒 SEGURANÇA: Limitar paginação para evitar DoS
        limit = min(int(request.query_params.get("limit", 100)), MAX_PAGINATION_LIMIT)
    except ValueError:
        return JSONResponse({"error": "Parâmetros skip/limit devem ser números inteiros"}, status_code=400)

    db = SessionLocal()
    try:
        nfs = db.query(NotaFiscal).order_by(NotaFiscal.data_upload.desc()).offset(skip).limit(limit).all()
        total = db.query(NotaFiscal).count()

        items = [serialize_nota(nf) for nf in nfs]

        return JSONResponse({
            "total": total,
            "skip": skip,
            "limit": limit,
            "items": items
        })
    except Exception as e:
        print(f"[ERROR get_nfs] {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()

async def get_nf(request: Request):
    """Get NF details with items"""
    nf_id = int(request.path_params['nf_id'])

    db = SessionLocal()
    try:
        nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()

        if not nf:
            return JSONResponse({"error": "NF não encontrada"}, status_code=404)

        return JSONResponse(serialize_nota(nf))
    finally:
        db.close()


async def atualizar_fiscal_combinado(request: Request):
    """POST /api/fiscal/atualizar  Body: {produto_id?, item_id?, shopee_item_id?, ncm, cest?}
    Corrige o NCM na Olist, o NCM/CEST no Mercado Livre e o NCM na Shopee do
    mesmo produto, numa tacada só. Informe só o(s) id(s) do(s) canal(is) que
    o produto tem — o que faltar simplesmente não é tocado."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"sucesso": False, "erro": "JSON inválido"}, status_code=400)

    produto_id = body.get("produto_id")
    item_id = body.get("item_id")
    shopee_item_id = body.get("shopee_item_id")
    ncm = body.get("ncm")
    cest = body.get("cest")
    if not ncm or (not produto_id and not item_id and not shopee_item_id):
        return JSONResponse({"sucesso": False, "erro": "Informe ncm e ao menos produto_id, item_id ou shopee_item_id"}, status_code=400)

    resultado_olist = olist.atualizar_ncm_produto(str(produto_id), str(ncm)) if produto_id else None
    resultado_ml = ml.atualizar_dados_fiscais(str(item_id), novo_ncm=str(ncm), novo_cest=cest) if item_id else None
    resultado_shopee = shopee.atualizar_ncm(str(shopee_item_id), str(ncm), cest=cest) if shopee_item_id else None

    ok_olist = resultado_olist is None or resultado_olist.get("sucesso")
    ok_ml = resultado_ml is None or resultado_ml.get("sucesso")
    ok_shopee = resultado_shopee is None or resultado_shopee.get("sucesso")
    sucesso = bool(ok_olist and ok_ml and ok_shopee)
    return JSONResponse(
        {"sucesso": sucesso, "olist": resultado_olist, "ml": resultado_ml, "shopee": resultado_shopee},
        status_code=200 if sucesso else 502,
    )


_fiscal_ml_olist_lock = threading.Lock()
_fiscal_ml_olist_estado: Dict = {
    "status": "idle",  # idle | rodando | pronto | erro
    "resultado": None,
    "erro": None,
    "iniciado_em": None,
    "concluido_em": None,
}


def _norm_digitos(valor) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def _rodar_comparacao_fiscal_ml_olist() -> None:
    """Casa produto Olist x anúncio ML pelo SKU e compara os dados fiscais
    (NCM e GTIN/EAN) de cada lado. 1 chamada por produto em cada API (throttle
    de ambas) — por isso roda em thread, nunca no event loop (mesmo motivo de
    _rodar_conferencia_ncm)."""
    global _fiscal_ml_olist_estado
    try:
        db = SessionLocal()
        try:
            # Antes só pegava status=="active" e deixava de fora os pausados
            # (ex.: sem estoque) — esses continuam precisando do NCM/CEST
            # corretos. Só exclui "closed" (anúncio finalizado de verdade).
            ml_itens = (
                db.query(MercadoLivreItemCache)
                .filter(MercadoLivreItemCache.sku.isnot(None), MercadoLivreItemCache.sku != "", MercadoLivreItemCache.status != "closed")
                .all()
            )
            ml_por_sku = {}
            for row in ml_itens:
                chave = re.sub(r"[^a-z0-9]", "", (row.sku or "").lower())
                if chave:
                    ml_por_sku[chave] = row
        finally:
            db.close()

        olist_produtos = olist.listar_todos_produtos(limite=3000)
        olist_por_sku = {}
        for p in olist_produtos:
            if p.get("situacao") == "E":
                continue
            chave = re.sub(r"[^a-z0-9]", "", (p.get("sku") or p.get("codigo_produto") or "").lower())
            if chave:
                olist_por_sku.setdefault(chave, p)

        shopee_itens_fiscais = shopee.listar_todos_itens_fiscais() if shopee.configurado else []
        shopee_por_sku = {}
        for si in shopee_itens_fiscais:
            chave = re.sub(r"[^a-z0-9]", "", (si.get("sku") or "").lower())
            if chave:
                shopee_por_sku[chave] = si

        chaves_comuns = sorted(set(ml_por_sku) & set(olist_por_sku))

        itens = []
        for chave in chaves_comuns:
            p_olist = olist_por_sku[chave]
            item_ml = ml_por_sku[chave]
            item_shopee = shopee_por_sku.get(chave)

            detalhe = olist.obter_detalhes_completo(str(p_olist.get("id"))) or {}
            olist_ncm = detalhe.get("ncm") or ""
            olist_gtin = detalhe.get("gtin") or ""

            fiscal_ml = ml.obter_dados_fiscais(item_ml.item_id)
            sem_dados_ml = fiscal_ml is None
            ml_ncm = (fiscal_ml or {}).get("ncm") or ""
            ml_ean = (fiscal_ml or {}).get("ean") or ""
            ml_cest = (fiscal_ml or {}).get("cest") or ""

            shopee_ncm = (item_shopee or {}).get("ncm") or ""
            shopee_cest = (item_shopee or {}).get("cest") or ""
            sem_shopee = item_shopee is None

            diffs = []
            if not sem_dados_ml:
                if _norm_digitos(olist_ncm) != _norm_digitos(ml_ncm):
                    diffs.append("ncm")
                if olist_gtin and ml_ean and _norm_digitos(olist_gtin) != _norm_digitos(ml_ean):
                    diffs.append("gtin")
            if not sem_shopee and _norm_digitos(olist_ncm) != _norm_digitos(shopee_ncm):
                diffs.append("ncm_shopee")
            # CEST não tem "origem" na Olist (ela não tem esse campo) — só dá
            # pra conferir cruzando ML x Shopee entre si, quando os dois têm
            # anúncio. Sem isso, CEST divergente entre as duas ficava invisível
            # e a linha aparecia "Correto" mesmo com um cadastro incompleto.
            if not sem_dados_ml and not sem_shopee and _norm_digitos(ml_cest) != _norm_digitos(shopee_cest):
                diffs.append("cest")

            sem_dados = sem_dados_ml and sem_shopee
            itens.append({
                "sku": p_olist.get("sku") or p_olist.get("codigo_produto") or "",
                "nome": item_ml.titulo or p_olist.get("nome") or "",
                "produto_id": p_olist.get("id"),
                "item_id": item_ml.item_id,
                "shopee_item_id": (item_shopee or {}).get("item_id") or "",
                "olist_ncm": olist_ncm,
                "ml_ncm": ml_ncm,
                "shopee_ncm": shopee_ncm,
                "olist_gtin": olist_gtin,
                "ml_ean": ml_ean,
                "ml_cest": ml_cest,
                "shopee_cest": shopee_cest,
                "sem_dados_ml": sem_dados_ml,
                "sem_dados_shopee": sem_shopee,
                "divergencias": diffs,
                "status": "sem_dados_ml" if sem_dados else ("divergente" if diffs else "correto"),
            })

        total = len(itens)
        corretos = sum(1 for i in itens if i["status"] == "correto")
        divergentes = sum(1 for i in itens if i["status"] == "divergente")
        sem_dados = sum(1 for i in itens if i["status"] == "sem_dados_ml")

        _fiscal_ml_olist_estado.update({
            "status": "pronto",
            "resultado": {
                "itens": itens,
                "total": total,
                "corretos": corretos,
                "divergentes": divergentes,
                "sem_dados_ml": sem_dados,
            },
            "erro": None,
            "concluido_em": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        print(f"[ERRO] Comparação fiscal ML x Olist: {e}")
        _fiscal_ml_olist_estado.update({"status": "erro", "erro": str(e), "concluido_em": datetime.utcnow().isoformat()})


async def fiscal_ml_olist_iniciar(request: Request):
    """POST /api/fiscal/ml-olist/iniciar — dispara a comparação em background e devolve na hora."""
    with _fiscal_ml_olist_lock:
        if _fiscal_ml_olist_estado["status"] == "rodando":
            return JSONResponse({"status": "rodando", "iniciado_em": _fiscal_ml_olist_estado["iniciado_em"]})
        _fiscal_ml_olist_estado.update({
            "status": "rodando", "resultado": None, "erro": None,
            "iniciado_em": datetime.utcnow().isoformat(), "concluido_em": None,
        })
        threading.Thread(target=_rodar_comparacao_fiscal_ml_olist, daemon=True).start()
    return JSONResponse({"status": "rodando", "iniciado_em": _fiscal_ml_olist_estado["iniciado_em"]})


async def fiscal_ml_olist_status(request: Request):
    """GET /api/fiscal/ml-olist — status/resultado da última comparação disparada."""
    return JSONResponse(_fiscal_ml_olist_estado)


def _so_digitos(ncm: str) -> str:
    return "".join(c for c in (ncm or "") if c.isdigit())


async def conferencia_ncm(request: Request):
    """
    GET /api/notas-fiscais/conferencia-ncm
    Somente leitura. Para cada item de cada NF (com XML salvo), extrai o NCM
    declarado na nota e compara com o NCM cadastrado no produto vinculado na Olist.
    A Olist devolve o NCM formatado com pontos (8714.10.00); a NF vem só com
    dígitos (87141000) — comparamos por dígito, ignorando a formatação.
    """
    db = SessionLocal()
    try:
        notas = db.query(NotaFiscal).order_by(NotaFiscal.data_upload.desc()).all()
        cache_olist_ncm = {}
        resultado = []

        for nf in notas:
            ncm_por_codigo = {}
            sem_xml = not nf.xml_processado
            if not sem_xml:
                parsed = NFeParsing.parse_xml(nf.xml_processado.encode('utf-8', errors='ignore'))
                if parsed.get("sucesso") is not False:
                    for it in parsed.get("itens", []):
                        ncm_por_codigo[it.get("codigo")] = it.get("ncm") or ""

            for item in nf.itens:
                ncm_nf = ncm_por_codigo.get(item.codigo_produto, "") if not sem_xml else ""

                ncm_olist = ""
                if item.olist_produto_id:
                    if item.olist_produto_id in cache_olist_ncm:
                        ncm_olist = cache_olist_ncm[item.olist_produto_id]
                    else:
                        detalhe = olist.obter_detalhes_completo(str(item.olist_produto_id)) or {}
                        ncm_olist = detalhe.get("ncm") or ""
                        cache_olist_ncm[item.olist_produto_id] = ncm_olist

                resultado.append({
                    "nf_id": nf.id,
                    "numero_nf": nf.numero_nf,
                    "fornecedor": nf.fornecedor,
                    "data_upload": nf.data_upload.isoformat() if nf.data_upload else None,
                    "item_id": item.id,
                    "codigo_produto": item.codigo_produto,
                    "descricao": item.descricao,
                    "olist_produto_id": item.olist_produto_id,
                    "olist_sku": item.olist_sku,
                    "olist_nome": item.olist_nome,
                    "sem_xml": sem_xml,
                    "ncm_nf": ncm_nf,
                    "ncm_olist": ncm_olist,
                    "bate": (bool(ncm_nf) and bool(ncm_olist) and _so_digitos(ncm_nf) == _so_digitos(ncm_olist)),
                })

        return JSONResponse({"total": len(resultado), "itens": resultado})
    finally:
        db.close()


async def get_estoque_virtual(request: Request):
    """Get consolidated virtual inventory - sum of all products"""
    from sqlalchemy.orm import joinedload
    db = SessionLocal()
    try:
        # ⚡ PERFORMANCE: Usar joinedload para evitar N+1 queries
        items = db.query(ItemEstoque).options(
            joinedload(ItemEstoque.nota_fiscal)
        ).all()

        # Consolidate by description
        estoque_consolidado = {}
        for item in items:
            desc = item.descricao
            if desc not in estoque_consolidado:
                estoque_consolidado[desc] = {
                    "id_item": item.id,
                    "descricao": desc,
                    "codigo_produto": item.codigo_produto,
                    "quantidade_total": 0,
                    "quantidade_confirmada": 0,
                    "preco_unitario": item.preco_unitario,
                    "notas_fiscais": []
                }

            estoque_consolidado[desc]["quantidade_total"] += item.quantidade_nf
            if item.quantidade_confirmada:
                estoque_consolidado[desc]["quantidade_confirmada"] += item.quantidade_confirmada

            nf = item.nota_fiscal
            estoque_consolidado[desc]["notas_fiscais"].append({
                "numero_nf": nf.numero_nf,
                "serie": nf.serie,
                "fornecedor": nf.fornecedor,
                "quantidade": item.quantidade_nf
            })

        produtos = list(estoque_consolidado.values())

        return JSONResponse({
            "total_produtos": len(produtos),
            "produtos": produtos
        })
    finally:
        db.close()

async def confirmar_estoque(request: Request):
    """Confirm received quantity and register divergence"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")
        quantidade_confirmada = data.get("quantidade_confirmada", 0)
        divergencia = data.get("divergencia", None)
        observacoes = data.get("observacoes", "")

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        item.quantidade_confirmada = quantidade_confirmada
        item.divergencia = divergencia
        # Marcar como conferido (confirmado) quando nao ha divergencia
        if not divergencia:
            item.status = StatusEstoque.CONFIRMADO

        confirmacao = ConfirmacaoEstoque(
            item_estoque_id=item_id,
            quantidade_confirmada=quantidade_confirmada,
            divergencia=divergencia,
            observacoes=observacoes
        )
        db.add(confirmacao)
        db.commit()

        return JSONResponse({
            "success": True,
            "id": confirmacao.id,
            "quantidade_confirmada": quantidade_confirmada,
            "divergencia": divergencia
        })
    except Exception as e:
        # 🔒 ROLLBACK: Desfazer alterações em caso de erro
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()

async def get_historico_confirmacao(request: Request):
    """Get confirmation history for a product"""
    item_id = int(request.path_params.get('item_id', 0))
    db = SessionLocal()
    try:
        confirmacoes = db.query(ConfirmacaoEstoque).filter(
            ConfirmacaoEstoque.item_estoque_id == item_id
        ).order_by(ConfirmacaoEstoque.data_confirmacao.desc()).all()

        historico = [{
            "id": c.id,
            "quantidade_confirmada": c.quantidade_confirmada,
            "divergencia": c.divergencia,
            "data_confirmacao": c.data_confirmacao.isoformat() if c.data_confirmacao else None,
            "vinculado_olist": c.vinculado_olist,
            "observacoes": c.observacoes
        } for c in confirmacoes]

        return JSONResponse({
            "historico": historico,
            "total": len(historico)
        })
    finally:
        db.close()

async def registrar_divergencia(request: Request):
    """Register divergence and send WhatsApp message"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")
        quantidade_confirmada = data.get("quantidade_confirmada", 0)
        tipo_divergencia = data.get("tipo_divergencia", "a_menos")
        observacoes = data.get("observacoes", "")
        mensagem_whatsapp = data.get("mensagem_whatsapp", "")

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        item.quantidade_confirmada = quantidade_confirmada
        item.divergencia = tipo_divergencia
        # Mark as bloqueado when there's a divergence (needs review)
        item.status = StatusEstoque.BLOQUEADO

        confirmacao = ConfirmacaoEstoque(
            item_estoque_id=item_id,
            quantidade_confirmada=quantidade_confirmada,
            divergencia=tipo_divergencia,
            observacoes=observacoes
        )

        db.add(confirmacao)
        db.commit()

        _registrar_log_operacao(
            request,
            "estoque_confirmado",
            "item_estoque",
            item.id,
            f"Conferência do item {item.codigo_produto or item.descricao}",
            {
                "item_id": item.id,
                "codigo_produto": item.codigo_produto,
                "descricao": item.descricao,
                "quantidade_confirmada": quantidade_confirmada,
                "divergencia": tipo_divergencia,
            },
        )

        numero_whatsapp = "19978149245"  # Número padrão

        # Log seguro: evita UnicodeEncodeError no console do Windows (cp1252)
        # quando a mensagem contem emojis/acentos. O envio real e feito no
        # frontend via link wa.me.
        try:
            print(f"[DIVERGENCIA] item={item_id} tipo={tipo_divergencia} "
                  f"qtd_confirmada={quantidade_confirmada} destino_whatsapp={numero_whatsapp}")
        except Exception:
            pass

        return JSONResponse({
            "sucesso": True,
            "mensagem": "Divergência registrada com sucesso",
            "numero_whatsapp": numero_whatsapp,
            "confirmacao_id": confirmacao.id
        })

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()

# ===== NOVOS ENDPOINTS =====

async def nf_tem_divergencias(request: Request):
    """Verifica se uma nota fiscal tem itens com divergência"""
    nf_id = int(request.path_params['nf_id'])
    db = SessionLocal()
    try:
        itens_com_divergencia = db.query(ItemEstoque).filter(
            ItemEstoque.nf_id == nf_id,
            ItemEstoque.divergencia != None
        ).count()

        return JSONResponse({
            "nf_id": nf_id,
            "tem_divergencias": itens_com_divergencia > 0,
            "quantidade": itens_com_divergencia
        })
    finally:
        db.close()

async def listar_divergencias(request: Request):
    """Lista todas as divergências registradas"""
    db = SessionLocal()
    try:
        divergencias = db.query(ItemEstoque, NotaFiscal).filter(
            ItemEstoque.nf_id == NotaFiscal.id,
            ItemEstoque.divergencia != None
        ).all()

        items = []
        for item, nf in divergencias:
            items.append({
                "item_id": item.id,
                "numero_nf": nf.numero_nf,
                "serie": nf.serie,
                "fornecedor": nf.fornecedor,
                "produto": item.descricao,
                "codigo": item.codigo_produto,
                "tipo_divergencia": item.divergencia,
                "quantidade_nf": item.quantidade_nf,
                "quantidade_confirmada": item.quantidade_confirmada,
                "data_registro": item.data_criacao.isoformat() if item.data_criacao else None
            })

        return JSONResponse({
            "total": len(items),
            "divergencias": items
        })
    finally:
        db.close()

async def listar_divergencias_full(request: Request):
    """
    GET /api/divergencias-full
    Itens de inbounds abertos em que o balanço achou MENOS que o Vai pro FULL e que ainda
    não foram resolvidos (sem baixa, não excluídos). Resolve-se no Histórico FULL.
    """
    db = SessionLocal()
    try:
        linhas = (db.query(ItemEmbaleFU, EmbaleFU)
                  .join(EmbaleFU, ItemEmbaleFU.embalde_id == EmbaleFU.id)
                  .filter(EmbaleFU.status != "encerrado",
                          ItemEmbaleFU.foi_balanceado == 1,
                          ItemEmbaleFU.falta > 0,
                          func.coalesce(ItemEmbaleFU.baixa_aplicada, 0) != 1,
                          func.coalesce(ItemEmbaleFU.nao_enviar, 0) != 1)
                  .order_by(ItemEmbaleFU.data_balanceamento.desc())
                  .all())
        itens = [{
            "item_id": i.id,
            "embale_id": e.id,
            "inbound": e.nome_embalde,
            "numero_inbound": e.numero_inbound,
            "titulo_anuncio": i.titulo_anuncio,
            "sku_inbound": i.sku_inbound,
            "quantidade_full": _quantidade_planejada_full(i),
            "falta": i.falta,
            "conferido": max(0.0, _quantidade_planejada_full(i) - float(i.falta or 0)),
            "em_espera": i.em_espera or 0,
            "data_balanceamento": i.data_balanceamento.isoformat() if i.data_balanceamento else None,
            "imagem": i.olist_imagem,
        } for i, e in linhas]
        return JSONResponse({"total": len(itens), "itens": itens}, headers={"Cache-Control": "no-store"})
    except Exception as ex:
        return JSONResponse({"erro": str(ex)}, status_code=500)
    finally:
        db.close()


async def resolver_divergencia(request: Request):
    """Marca uma divergência como resolvida"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        # Marcar como confirmado (resolvido)
        item.status = StatusEstoque.CONFIRMADO
        item.divergencia = None
        db.commit()

        return JSONResponse({
            "sucesso": True,
            "mensagem": "Divergência marcada como resolvida"
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()

async def deletar_divergencia(request: Request):
    """Deleta uma divergência"""
    db = SessionLocal()
    try:
        data = await request.json()
        item_id = data.get("item_id")

        item = db.query(ItemEstoque).filter(ItemEstoque.id == item_id).first()
        if not item:
            return JSONResponse({"error": "Item não encontrado"}, status_code=404)

        # Voltar para quarentena (como se não tivesse sido conferido)
        item.status = StatusEstoque.QUARENTENA
        item.divergencia = None
        item.quantidade_confirmada = None
        db.commit()

        return JSONResponse({
            "sucesso": True,
            "mensagem": "Divergência deletada com sucesso"
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()

async def adicionar_produto_manual(request: Request):
    """Registra um produto adicionado manualmente (fornecedor mandou errado)"""
    db = SessionLocal()
    try:
        data = await request.json()
        nf_id = data.get("nf_id")
        codigo_recebido = data.get("codigo_recebido")
        descricao_recebida = data.get("descricao_recebida")
        quantidade = data.get("quantidade", 1)
        preco = data.get("preco", 0)

        item_manual = ItemEstoque(
            nf_id=nf_id,
            codigo_produto=codigo_recebido,
            descricao=descricao_recebida,
            quantidade_nf=quantidade,
            quantidade_confirmada=quantidade,
            preco_unitario=preco,
            status=StatusEstoque.CONFIRMADO,
            divergencia="produto_substituido",
            data_criacao=datetime.utcnow()
        )

        db.add(item_manual)
        db.commit()

        _registrar_log_operacao(
            request,
            "produto_manual_adicionado",
            "item_estoque",
            item_manual.id,
            f"Produto manual adicionado na NF {nf_id}",
            {
                "nf_id": nf_id,
                "codigo": codigo_recebido,
                "descricao": descricao_recebida,
                "quantidade": quantidade,
            },
        )

        return JSONResponse({
            "sucesso": True,
            "item_id": item_manual.id,
            "mensagem": "Produto manual adicionado"
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def excluir_nota_fiscal(request: Request):
    """Exclui uma nota fiscal e todos os seus itens"""
    db = SessionLocal()
    try:
        data = await request.json()
        nf_id = data.get("nf_id")

        nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()
        if not nf:
            return JSONResponse({"error": "Nota fiscal não encontrada"}, status_code=404)

        # Excluir arquivo se existir
        try:
            arquivo_path = os.path.join(UPLOAD_DIR, nf.arquivo_original)
            if os.path.exists(arquivo_path):
                os.remove(arquivo_path)
        except:
            pass

        # Excluir nota (cascata deleta itens)
        db.delete(nf)
        db.commit()

        return JSONResponse({
            "sucesso": True,
            "mensagem": f"Nota fiscal #{nf.numero_nf} excluída com sucesso"
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def excluir_multiplas_notas(request: Request):
    """Exclui múltiplas notas fiscais"""
    db = SessionLocal()
    try:
        data = await request.json()
        nf_ids = data.get("nf_ids", [])

        # 🔒 VALIDAÇÃO: Verificar se é uma lista
        if not isinstance(nf_ids, list):
            return JSONResponse({"error": "nf_ids deve ser uma lista"}, status_code=400)

        if not nf_ids:
            return JSONResponse({"error": "Nenhuma nota selecionada"}, status_code=400)

        deletadas = 0
        for nf_id in nf_ids:
            nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()
            if nf:
                try:
                    arquivo_path = os.path.join(UPLOAD_DIR, nf.arquivo_original)
                    if os.path.exists(arquivo_path):
                        os.remove(arquivo_path)
                except:
                    pass
                db.delete(nf)
                deletadas += 1

        db.commit()

        return JSONResponse({
            "sucesso": True,
            "mensagem": f"{deletadas} nota(s) excluída(s) com sucesso"
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def baixar_nota_fiscal(request: Request):
    """Baixa o arquivo original da nota fiscal"""
    nf_id = int(request.path_params['nf_id'])

    db = SessionLocal()
    try:
        nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()
        if not nf:
            return JSONResponse({"error": "Nota fiscal não encontrada"}, status_code=404)

        # 🔒 SEGURANÇA: Validar que o arquivo está dentro de UPLOAD_DIR
        arquivo_path = os.path.join(UPLOAD_DIR, nf.arquivo_original)
        real_path = os.path.realpath(arquivo_path)
        upload_dir_real = os.path.realpath(UPLOAD_DIR)

        if not real_path.startswith(upload_dir_real):
            return JSONResponse({"error": "Acesso negado"}, status_code=403)

        if not os.path.exists(arquivo_path):
            return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

        return FileResponse(
            arquivo_path,
            filename=nf.arquivo_original,
            media_type='application/octet-stream'
        )
    finally:
        db.close()


async def gerar_pdf_nota_fiscal(request: Request):
    """Gera e baixa um PDF formatado da nota fiscal"""
    nf_id = int(request.path_params['nf_id'])

    db = SessionLocal()
    try:
        nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()
        if not nf:
            return JSONResponse({"error": "Nota fiscal não encontrada"}, status_code=404)

        # Se o arquivo é XML, gerar PDF a partir dele
        if nf.tipo_documento == "nfe" and nf.xml_processado:
            pdf_bytes = NFePDFGenerator.gerar_pdf(nf.xml_processado if isinstance(nf.xml_processado, bytes) else nf.xml_processado.encode('utf-8', errors='ignore'))
            if pdf_bytes:
                return Response(
                    content=bytes(pdf_bytes) if isinstance(pdf_bytes, bytearray) else pdf_bytes,
                    media_type='application/pdf',
                    headers={'Content-Disposition': f'attachment; filename="NF-{nf.numero_nf}.pdf"'}
                )

        # Se não conseguiu gerar PDF, retorna o arquivo original
        arquivo_path = os.path.join(UPLOAD_DIR, nf.arquivo_original)
        if not os.path.exists(arquivo_path):
            return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

        return FileResponse(
            arquivo_path,
            filename=f"NF-{nf.numero_nf}.pdf" if nf.arquivo_original.endswith('.pdf') else nf.arquivo_original,
            media_type='application/pdf' if nf.arquivo_original.endswith('.pdf') else 'application/octet-stream'
        )

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        db.close()


async def atualizar_frete_nota(request: Request):
    """POST /api/notas-fiscais/{id}/frete  Body: {valor_frete} — define o frete de uma NF existente."""
    db = SessionLocal()
    try:
        nf_id = int(request.path_params.get("id"))
        body = await request.json()
        try:
            valor = max(0.0, float(body.get("valor_frete") or 0))
        except (TypeError, ValueError):
            return JSONResponse({"erro": "valor_frete inválido"}, status_code=400)

        nf = db.query(NotaFiscal).filter(NotaFiscal.id == nf_id).first()
        if not nf:
            return JSONResponse({"erro": "Nota não encontrada"}, status_code=404)
        nf.valor_frete = valor
        db.commit()
        return JSONResponse({"ok": True, "id": nf_id, "valor_frete": valor})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/notas-fiscais/{id:int}/frete", atualizar_frete_nota, methods=["POST"]),
    Route("/api/upload-nfe", upload_nfe, methods=["POST"]),
    Route("/api/notas-fiscais", get_nfs, methods=["GET"]),
    Route("/api/notas-fiscais/conferencia-ncm", conferencia_ncm, methods=["GET"]),
    Route("/api/notas-fiscais/{nf_id}", get_nf, methods=["GET"]),
    Route("/api/notas-fiscais/{nf_id}/baixar", baixar_nota_fiscal, methods=["GET"]),
    Route("/api/notas-fiscais/{nf_id}/pdf", gerar_pdf_nota_fiscal, methods=["GET"]),
    Route("/api/notas-fiscais/deletar", excluir_nota_fiscal, methods=["POST"]),
    Route("/api/notas-fiscais/deletar-multiplas", excluir_multiplas_notas, methods=["POST"]),
    Route("/api/estoque-virtual", get_estoque_virtual, methods=["GET"]),
    Route("/api/confirmar-estoque", confirmar_estoque, methods=["POST"]),
    Route("/api/registrar-divergencia", registrar_divergencia, methods=["POST"]),
    Route("/api/historico-confirmacao/{item_id}", get_historico_confirmacao, methods=["GET"]),
    Route("/api/notas-fiscais/{nf_id}/tem-divergencias", nf_tem_divergencias, methods=["GET"]),
    Route("/api/divergencias", listar_divergencias, methods=["GET"]),
    Route("/api/divergencias-full", listar_divergencias_full, methods=["GET"]),
    Route("/api/produtos-manuais", adicionar_produto_manual, methods=["POST"]),
    Route("/api/resolver-divergencia", resolver_divergencia, methods=["POST"]),
    Route("/api/deletar-divergencia", deletar_divergencia, methods=["POST"]),
    Route("/api/fiscal/atualizar", atualizar_fiscal_combinado, methods=["POST"]),
    Route("/api/fiscal/ml-olist", fiscal_ml_olist_status, methods=["GET"]),
    Route("/api/fiscal/ml-olist/iniciar", fiscal_ml_olist_iniciar, methods=["POST"]),
]
