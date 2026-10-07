"""Rotas /api/embaldes/*: inbounds do FULL (separação, balanço, baixas e histórico)."""
from starlette.responses import JSONResponse
from starlette.requests import Request
from database import SessionLocal
import os
import json
from datetime import datetime
import uuid
from app.models import VinculoOlist, EmbaleFU, ItemEmbaleFU, HistoricoFullEmbale, LogOperacao
from app.utils.inbound_parser import extrair_items_embale_pdf
from app.integracoes.olist import olist

from app.rotas.comum import (
    MAX_PAGINATION_LIMIT,
    Route,
    UPLOAD_DIR,
    _calcular_reserva_inbound,
    _itens_full_reduzidos,
    _normalizar_tokens,
    _operador_contexto,
    _quantidade_planejada_full,
    _registrar_log_operacao,
    _request_eh_master,
)


def _similaridade_titulo(a, b):
    """Jaccard dos tokens significativos de dois títulos (0..1)."""
    ta, tb = set(_normalizar_tokens(a)), set(_normalizar_tokens(b))
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    uni = len(ta | tb)
    return inter / uni if uni else 0.0


def _sku_tem_overlap(sku_a, sku_b):
    """True se dois SKUs (de sistemas diferentes) compartilham um pedaço
    significativo (>=4 chars). Ex.: ICON-FUME vs VISFUMICON -> compartilham
    'icon' e 'fum'. Usado só como leve desempate, não como prova."""
    a = "".join(c for c in (sku_a or "").lower() if c.isalnum())
    b = "".join(c for c in (sku_b or "").lower() if c.isalnum())
    if len(a) < 4 or len(b) < 4:
        return False
    for i in range(len(a) - 3):
        if a[i:i + 4] in b:
            return True
    return False


def _buscar_itens_inbound_similares(db, olist_produto_id, olist_sku,
                                    olist_nome, limite=6):
    """
    Procura, nos inbounds ATIVOS (não encerrados), itens que provavelmente
    são o MESMO produto deste anúncio Olist, mesmo que o SKU seja de outro
    sistema (ML) ou o item ainda não tenha sido vinculado.

    Sinais de match (em ordem de confiança):
      - já vinculado a este olist_produto_id (score 100)
      - SKU do inbound == SKU Olist (score 95)
      - semelhança de título (Jaccard >= 0.45) -> score proporcional,
        com leve bônus se os SKUs compartilham pedaço.

    Retorna candidatos ordenados por score (maior primeiro). NÃO altera nada
    — quem decide é o usuário (resolve ambiguidade tipo Fumê x Cristal).
    """
    pid = str(olist_produto_id) if olist_produto_id else None
    sku = (olist_sku or "").strip().lower()
    candidatos = []

    # Tokens-ASSINATURA: palavras do título Olist cujo começo (3 chars) também
    # aparece no SKU Olist. Ex.: anúncio "...Fume..." com SKU "VISFUMICON" ->
    # 'fume' é assinatura (visFUMicon). Servem para distinguir VARIAÇÕES (Fumê
    # x Cristal): o candidato que tem a assinatura ganha pontos.
    sku_limpo = "".join(c for c in sku if c.isalnum())
    assinaturas = set()
    if sku_limpo:
        for tok in set(_normalizar_tokens(olist_nome)):
            if len(tok) >= 3 and tok[:3] in sku_limpo:
                assinaturas.add(tok)

    ativos = db.query(EmbaleFU).filter(EmbaleFU.status != "encerrado").all()
    for emb in ativos:
        for it in emb.itens:
            score = 0.0
            motivo = None
            if pid and it.olist_produto_id and str(it.olist_produto_id) == pid:
                score, motivo = 100.0, "vinculado"
            elif sku and it.sku_inbound and it.sku_inbound.strip().lower() == sku:
                score, motivo = 95.0, "sku"
            else:
                sim = _similaridade_titulo(olist_nome, it.titulo_anuncio)
                if sim >= 0.45:
                    motivo = "titulo"
                    score = round(sim * 70, 1)
                    if assinaturas:
                        cand_toks = set(_normalizar_tokens(it.titulo_anuncio))
                        frac = len(assinaturas & cand_toks) / len(assinaturas)
                        score = round(score + frac * 30, 1)
                    elif _sku_tem_overlap(it.sku_inbound, olist_sku):
                        score = min(94.0, score + 10)
            if not motivo:
                continue

            qtd_sep = _quantidade_planejada_full(it)  # FULL atual (pode ter sido reduzido)
            qtd_original = float(it.quantidade_separada or 0)
            qtd_baix = it.quantidade_baixada or 0
            candidatos.append({
                "inbound_id": emb.id,
                "numero_inbound": emb.numero_inbound,
                "nome_inbound": emb.nome_embalde,
                "status_inbound": emb.status,
                "item_id": it.id,
                "titulo": it.titulo_anuncio,
                "sku_inbound": it.sku_inbound,
                "qtd_full": qtd_sep,
                "qtd_baixada": qtd_baix,
                "restante_full": max(0, qtd_sep - qtd_baix),
                "qtd_original": qtd_original,
                "full_reduzido": qtd_sep < qtd_original,
                "baixa_aplicada": int(it.baixa_aplicada or 0),
                "ja_vinculado": bool(it.olist_produto_id),
                "score": score,
                "motivo": motivo,
            })

    candidatos.sort(key=lambda c: c["score"], reverse=True)
    return candidatos[:limite]


async def buscar_no_inbound(request: Request):
    """
    GET /api/embaldes/buscar-no-inbound?olist_produto_id=&olist_sku=&olist_nome=
    Read-only: lista itens dos inbounds ATIVOS que provavelmente são este
    produto, para o usuário confirmar antes de subir estoque.
    """
    db = SessionLocal()
    try:
        pid = request.query_params.get("olist_produto_id", "")
        sku = request.query_params.get("olist_sku", "")
        nome = request.query_params.get("olist_nome", "")
        if not pid and not sku and not nome:
            return JSONResponse({"candidatos": [], "total": 0})
        cands = _buscar_itens_inbound_similares(db, pid, sku, nome)
        return JSONResponse({"candidatos": cands, "total": len(cands)})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def reserva_inbound_produto(request: Request):
    """
    GET /api/embaldes/reserva-produto?olist_produto_id=X&olist_sku=Y
    Read-only: retorna quanto deste produto está reservado para inbounds
    ATIVOS (pra avisar o usuário ANTES de subir estoque). Não altera nada.
    """
    db = SessionLocal()
    try:
        pid = request.query_params.get("olist_produto_id", "")
        sku = request.query_params.get("olist_sku", "")
        reserva, detalhes = _calcular_reserva_inbound(db, pid, sku, aplicar=False)
        return JSONResponse({
            "reservado_full": reserva,
            "tem_reserva": reserva > 0,
            "detalhes": detalhes,
            "reduzidos": _itens_full_reduzidos(db, pid, sku),
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


# ==================== ENDPOINTS INBOUND / LISTA DE SEPARAÇÃO ====================

async def upload_embale(request: Request):
    """
    POST /api/embaldes/upload
    Faz upload de um PDF de Inbound do Mercado Livre (lista de separação).
    Extrai os items (SKU, código ML, título, unidades) e vincula
    automaticamente com anúncios Olist via SKU.
    """
    db = SessionLocal()
    try:
        # Receber arquivo
        form = await request.form()
        arquivo = form.get("arquivo")
        nome_embale = form.get("nome_embale") or "Inbound sem nome"
        data_limite_str = form.get("data_limite") or ""

        if not arquivo:
            return JSONResponse({"erro": "Arquivo não fornecido"}, status_code=400)

        # Parsear data limite (formato YYYY-MM-DD do input HTML)
        data_limite = None
        if data_limite_str:
            try:
                data_limite = datetime.strptime(data_limite_str[:10], "%Y-%m-%d")
            except ValueError:
                return JSONResponse({"erro": "Data limite inválida"}, status_code=400)

        # Validar tipo de arquivo
        if not arquivo.filename.lower().endswith('.pdf'):
            return JSONResponse({"erro": "Apenas arquivos PDF são aceitos"}, status_code=400)

        # Salvar arquivo com UUID
        arquivo_uuid = f"{uuid.uuid4()}_{arquivo.filename}"
        caminho_arquivo = os.path.join(UPLOAD_DIR, arquivo_uuid)

        conteudo = await arquivo.read()
        with open(caminho_arquivo, 'wb') as f:
            f.write(conteudo)

        # Extrair items do PDF ANTES de criar o registro
        resultado = extrair_items_embale_pdf(caminho_arquivo)

        if isinstance(resultado, dict) and resultado.get("erro"):
            return JSONResponse(
                {"erro": resultado.get("mensagem", "Erro ao processar PDF")},
                status_code=400
            )

        items_extraidos = resultado.get("items", [])
        numero_inbound = resultado.get("numero_inbound")
        total_unidades = resultado.get("total_unidades", 0)

        # IDEMPOTÊNCIA: se já existe um inbound com este número, SUBSTITUI
        # (deleta o antigo e seus itens). Evita itens fantasmas/duplicados
        # de uploads anteriores do mesmo inbound.
        substituiu_id = None
        if numero_inbound:
            existente = db.query(EmbaleFU).filter(
                EmbaleFU.numero_inbound == numero_inbound
            ).first()
            if existente:
                substituiu_id = existente.id
                db.delete(existente)  # cascade remove os itens antigos
                db.commit()

        # Criar inbound no BD
        embale = EmbaleFU(
            nome_embalde=nome_embale,
            numero_inbound=numero_inbound,
            total_unidades=total_unidades,
            arquivo_original=arquivo.filename,
            arquivo_uuid=arquivo_uuid,
            data_limite=data_limite,
            status="processando"
        )
        db.add(embale)
        db.commit()
        db.refresh(embale)

        # Processar cada item
        items_processados = 0
        items_validados = 0
        items_com_erro = []

        for item_data in items_extraidos:
            sku = (item_data.get("sku") or "").strip()
            codigo_ml = (item_data.get("codigo_ml") or "").strip()
            titulo = (item_data.get("titulo_anuncio") or "").strip()
            qtd = item_data.get("quantidade_separada", 0)

            item_embale = ItemEmbaleFU(
                embalde_id=embale.id,
                titulo_anuncio=titulo,
                quantidade_separada=qtd,
                sku_inbound=sku or None,
                codigo_ml=codigo_ml or None,
                validado=0
            )

            # 1) Match primário por SKU (exato, case-insensitive)
            vinculo = None
            if sku:
                vinculo = db.query(VinculoOlist).filter(
                    VinculoOlist.olist_sku.ilike(sku)
                ).first()

            # 2) Fallback: match por título do anúncio
            if not vinculo and titulo:
                vinculo = db.query(VinculoOlist).filter(
                    VinculoOlist.olist_nome.ilike(f"%{titulo}%")
                ).first()

            if vinculo:
                item_embale.olist_produto_id = vinculo.olist_produto_id
                item_embale.olist_sku = vinculo.olist_sku
                item_embale.olist_nome = vinculo.olist_nome
                item_embale.validado = 1
                item_embale.validacao_mensagem = f"Vinculado via SKU {vinculo.olist_sku}"
                item_embale.data_validacao = datetime.utcnow()
                items_validados += 1
            else:
                item_embale.validado = 0
                item_embale.validacao_mensagem = (
                    f"SKU '{sku}' não encontrado nos vínculos Olist" if sku
                    else "Item sem SKU identificável"
                )
                items_com_erro.append({"sku": sku, "titulo": titulo})

            db.add(item_embale)
            items_processados += 1

        db.commit()

        msg = f"Inbound {numero_inbound or ''} processado: {items_validados}/{items_processados} items vinculados"
        if substituiu_id:
            msg += " (substituiu um inbound anterior com o mesmo número)"

        _registrar_log_operacao(
            request,
            "inbound_upload",
            "embale",
            embale.id,
            f"Upload do inbound {numero_inbound or embale.nome_embalde}",
            {
                "nome_embale": embale.nome_embalde,
                "numero_inbound": numero_inbound,
                "itens_processados": items_processados,
                "itens_validados": items_validados,
                "substituiu_inbound_id": substituiu_id,
            },
        )

        return JSONResponse({
            "id": embale.id,
            "nome_embale": embale.nome_embalde,
            "numero_inbound": numero_inbound,
            "total_unidades": total_unidades,
            "status": "processado",
            "itens_processados": items_processados,
            "itens_validados": items_validados,
            "itens_com_erro": len(items_com_erro),
            "erros": items_com_erro if items_com_erro else None,
            "substituiu_inbound_id": substituiu_id,
            "mensagem": msg
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def listar_embaldes(request: Request):
    """
    GET /api/embaldes
    Lista todos os embaldes/listas de separação
    """
    try:
        db = SessionLocal()

        skip = int(request.query_params.get("skip", 0))
        limit = min(int(request.query_params.get("limit", 10)), MAX_PAGINATION_LIMIT)
        status = request.query_params.get("status", None)

        query = db.query(EmbaleFU)

        if status:
            query = query.filter(EmbaleFU.status == status)

        total = query.count()
        embaldes = query.offset(skip).limit(limit).all()

        def status_display(embale):
            """Retorna status para exibição: 'encerrado', 'processando', ou 'valendo'"""
            if embale.status == "encerrado":
                return "encerrado"
            # Se está processando mas não tem data limite, é "valendo" (sem deadline)
            if not embale.data_limite:
                return "valendo"
            return "processando"

        return JSONResponse({
            "total": total,
            "skip": skip,
            "limit": limit,
            "items": [
                {
                    "total_planejado_full": sum(_progresso_item_full(i)[0] for i in e.itens),
                    "total_baixado_full": sum(_progresso_item_full(i)[1] for i in e.itens),
                    "id": e.id,
                    "nome_embalde": e.nome_embalde,
                    "numero_inbound": e.numero_inbound,
                    "total_unidades": e.total_unidades,
                    "arquivo_original": e.arquivo_original,
                    "data_upload": e.data_upload.isoformat(),
                    "data_limite": e.data_limite.isoformat() if e.data_limite else None,
                    "data_encerramento": e.data_encerramento.isoformat() if e.data_encerramento else None,
                    "status": status_display(e),
                    "qtd_items": len(e.itens),
                    "qtd_validados": sum(1 for i in e.itens if i.validado == 1),
                    "qtd_baixados": sum(1 for i in e.itens if _progresso_item_full(i)[1] >= _progresso_item_full(i)[0] and _progresso_item_full(i)[0] > 0),
                    "qtd_em_espera": sum(1 for i in e.itens if (i.em_espera or 0) == 1),
                    "total_lido": sum(i.quantidade_separada or 0 for i in e.itens),
                    "revisao_salva_em": e.revisao_salva_em.isoformat() if e.revisao_salva_em else None,
                }
                for e in embaldes
            ]
        })

    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def obter_embale(request: Request):
    """
    GET /api/embaldes/{id}
    Obtém detalhes de um embale específico
    """
    try:
        db = SessionLocal()
        embale_id = int(request.path_params.get("embale_id"))

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()

        if not embale:
            return JSONResponse({"erro": "Embale não encontrado"}, status_code=404)

        return JSONResponse({
            "id": embale.id,
            "nome_embalde": embale.nome_embalde,
            "numero_inbound": embale.numero_inbound,
            "total_unidades": embale.total_unidades,
            "arquivo_original": embale.arquivo_original,
            "data_upload": embale.data_upload.isoformat(),
            "data_limite": embale.data_limite.isoformat() if embale.data_limite else None,
            "data_encerramento": embale.data_encerramento.isoformat() if embale.data_encerramento else None,
            "status": embale.status,
            "itens": [
                {
                    "id": i.id,
                    "titulo_anuncio": i.titulo_anuncio,
                    "quantidade_separada": i.quantidade_separada,
                    "sku_inbound": i.sku_inbound,
                    "codigo_ml": i.codigo_ml,
                    "olist_produto_id": i.olist_produto_id,
                    "olist_sku": i.olist_sku,
                    "olist_nome": i.olist_nome,
                    "validado": i.validado,
                    "validacao_mensagem": i.validacao_mensagem,
                    "imagem": i.olist_imagem,
                    "em_espera": i.em_espera or 0,
                    "nao_enviar": i.nao_enviar or 0,
                }
                for i in embale.itens
            ]
        })

    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def atualizar_data_limite_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/data-limite
    Atualiza a data limite (deadline de envio do FULL) de um inbound.
    Body JSON: {"data_limite": "YYYY-MM-DD"}  (ou null para remover)
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        body = await request.json()
        data_limite_str = body.get("data_limite")

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        data_limite_anterior = embale.data_limite.isoformat() if embale.data_limite else None

        if data_limite_str:
            try:
                embale.data_limite = datetime.strptime(data_limite_str[:10], "%Y-%m-%d")
            except ValueError:
                return JSONResponse({"erro": "Data limite inválida"}, status_code=400)
        else:
            embale.data_limite = None

        # Encerrado com data nova no futuro (ou sem data) volta pra ação. Data já
        # vencida não reabre: o job encerrar_inbounds_vencidos fecharia de novo.
        reaberto = False
        if embale.status == "encerrado" and (not embale.data_limite or embale.data_limite > datetime.utcnow()):
            embale.status = "processando"
            embale.data_encerramento = None
            reaberto = True

        db.commit()
        _registrar_log_operacao(
            request,
            "data_limite_inbound_atualizada",
            "embale",
            embale.id,
            f"Data limite do inbound #{embale.numero_inbound or embale.id} atualizada",
            {
                "embale_id": embale.id,
                "numero_inbound": embale.numero_inbound,
                "data_limite_anterior": data_limite_anterior,
                "data_limite_nova": embale.data_limite.isoformat() if embale.data_limite else None,
                "reaberto": reaberto,
            },
        )
        return JSONResponse({
            "id": embale.id,
            "data_limite": embale.data_limite.isoformat() if embale.data_limite else None,
            "reaberto": reaberto,
            "mensagem": "Inbound reaberto: voltou para Em ação" if reaberto else "Data limite atualizada"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


def _descartar_vinculo_memorizado_inativo(db, item) -> None:
    """O upload copia o vínculo memorizado do SKU (VinculoOlist) sem saber se o
    produto ainda existe; produto excluído/inativo na Olist seguia vinculado.
    Na 1ª revisão confere a situação e, se não for ativo, apaga a memória e
    solta o item: o _resolver_olist_para_item busca de novo (só ativos).
    Só para vínculo vindo da memória — o manual não é reconferido."""
    if not item.olist_produto_id or not (item.validacao_mensagem or "").startswith("Vinculado via SKU"):
        return
    det = olist.obter_detalhes_completo(str(item.olist_produto_id))
    # ponytail: sem resposta da API mantém o vínculo (não solta tudo se a Olist cair)
    if det is None or (det.get("situacao") or "A").upper() == "A":
        return
    print(f"[VINCULO] {item.sku_inbound}: produto {item.olist_produto_id} situacao={det.get('situacao')} -> refazendo vínculo")
    db.query(VinculoOlist).filter(VinculoOlist.olist_produto_id == str(item.olist_produto_id)).delete()
    item.olist_produto_id = None
    item.olist_sku = None
    item.olist_nome = None
    item.validado = 0
    item.validacao_mensagem = None


def _resolver_olist_para_item(item):
    """
    Dado um ItemEmbaleFU, resolve o produto Olist correspondente.
    Retorna (produto_id, nome_olist) ou (None, None) se não encontrar.
    Ordem de prioridade:
    1) Vínculo já salvo (olist_produto_id)
    2) Busca por SKU do inbound (prioridade alta)
    3) Busca por título do inbound (fallback)
    """
    if item.olist_produto_id:
        return item.olist_produto_id, (item.olist_nome or "")

    # 1) Tenta SKU primeiro
    sku = (item.sku_inbound or "").strip()
    if sku:
        try:
            resultados = olist.buscar_produtos(sku, limite_resultados=15)
            # Preferir match de SKU exato
            for p in resultados:
                if (p.get("sku") or "").strip().lower() == sku.lower():
                    return str(p.get("id")), (p.get("nome") or "")
            # Se achou algo por SKU (mesmo que não exato), usa
            if resultados:
                p = resultados[0]
                return str(p.get("id")), (p.get("nome") or "")
        except Exception:
            pass

    # 2) Fallback: tenta título
    titulo = (item.titulo_anuncio or "").strip()
    if titulo:
        try:
            resultados = olist.buscar_produtos(titulo, limite_resultados=15)
            # Tenta achar match por nome
            for p in resultados:
                if titulo.lower() in (p.get("nome") or "").lower():
                    return str(p.get("id")), (p.get("nome") or "")
            # Senão, primeiro resultado
            if resultados:
                p = resultados[0]
                return str(p.get("id")), (p.get("nome") or "")
        except Exception:
            pass

    return None, None


def _preencher_imagens_olist(db, itens):
    """Para itens já vinculados (olist_produto_id) e ainda sem foto cacheada,
    busca a imagem na Olist (campo 'anexos') e salva em olist_imagem.
    Roda uma única vez por item (depois fica em cache); falhas são silenciosas
    porque foto é opcional e nunca pode travar a separação."""
    import concurrent.futures

    faltando = [i for i in itens if i.olist_produto_id and not i.olist_imagem]
    if not faltando:
        return
    ids = {i.olist_produto_id for i in faltando}

    def _img(pid):
        try:
            return pid, olist.obter_imagem_produto(pid)
        except Exception:
            return pid, None

    mapa = {}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for pid, img in ex.map(_img, ids):
                mapa[pid] = img
    except Exception:
        return

    mudou = False
    for i in faltando:
        img = mapa.get(i.olist_produto_id)
        if img:
            i.olist_imagem = img
            db.add(i)
            mudou = True
    if mudou:
        try:
            db.commit()
        except Exception:
            db.rollback()


def _progresso_item_full(item) -> tuple[float, float]:
    """Retorna (planejado, realizado) para progresso persistido do inbound."""
    planejado = _quantidade_planejada_full(item)
    realizado = min(max(0.0, float(item.quantidade_baixada or 0)), planejado)
    return planejado, realizado


def _pedido_full_pendente(db, item_id):
    """Pedido de mudança do "Vai pro FULL" esperando o master (None se não há)."""
    return (db.query(HistoricoFullEmbale)
            .filter(HistoricoFullEmbale.item_id == item_id, HistoricoFullEmbale.status == "pendente")
            .order_by(HistoricoFullEmbale.id.desc()).first())


_MSG_PENDENTE = "A mudança do Vai pro FULL deste item aguarda aprovação do administrador. Nada é retirado até lá."


def _marcar_historico_full(db, embale_id, revisao):
    """Marca cada item da revisão com tem_historico_full = True quando houve
    qualquer mudança registrada na quantidade do FULL daquele item."""
    try:
        ids = {row[0] for row in db.query(HistoricoFullEmbale.item_id)
               .filter(HistoricoFullEmbale.embale_id == embale_id).all()}
    except Exception:
        ids = set()
    try:
        pendentes = {h.item_id: h for h in db.query(HistoricoFullEmbale)
                     .filter(HistoricoFullEmbale.embale_id == embale_id, HistoricoFullEmbale.status == "pendente")}
    except Exception:
        pendentes = {}
    for r in revisao:
        r["tem_historico_full"] = r.get("item_id") in ids
        h = pendentes.get(r.get("item_id"))
        r["full_pendente"] = None if not h else {"id": h.id, "de": h.quantidade_anterior, "para": h.quantidade_nova,
                                                  "solicitante": h.solicitante}


def _resumo_revisao_salva_item(item):
    produto_id = item.olist_produto_id
    qtd_full = _quantidade_planejada_full(item)
    qtd_original = float(item.quantidade_separada or 0)

    if not produto_id:
        return {
            "item_id": item.id,
            "titulo_anuncio": item.titulo_anuncio,
            "sku_inbound": item.sku_inbound,
            "quantidade_original": qtd_original,
            "quantidade_full": qtd_full,
            "olist_encontrado": False,
            "olist_produto_id": None,
            "olist_nome": None,
            "estoque_atual": None,
            "baixa_proposta": None,
            "resultado": None,
            "falta": None,
            "tem_falta": False,
            "estoque_indisponivel": False,
            "baixa_aplicada": item.baixa_aplicada or 0,
            "vinculado": item.validado or 0,
            "foi_balanceado": item.foi_balanceado or 0,
            "saldo_disponivel": item.saldo_disponivel,
            "em_espera": item.em_espera or 0,
            "imagem": item.olist_imagem,
        }

    saldo = item.olist_estoque_antes
    if saldo is None:
        return {
            "item_id": item.id,
            "titulo_anuncio": item.titulo_anuncio,
            "sku_inbound": item.sku_inbound,
            "quantidade_original": qtd_original,
            "quantidade_full": qtd_full,
            "olist_encontrado": True,
            "olist_produto_id": produto_id,
            "olist_nome": item.olist_nome,
            "estoque_atual": None,
            "baixa_proposta": None,
            "resultado": None,
            "falta": None,
            "tem_falta": False,
            "estoque_indisponivel": True,
            "baixa_aplicada": item.baixa_aplicada or 0,
            "vinculado": item.validado or 0,
            "foi_balanceado": item.foi_balanceado or 0,
            "saldo_disponivel": item.saldo_disponivel,
            "em_espera": item.em_espera or 0,
            "imagem": item.olist_imagem,
        }

    saldo = float(saldo or 0)
    falta = max(0.0, qtd_full - saldo)
    tem_falta = falta > 0
    disponivel_para_baixa = max(0.0, saldo)

    return {
        "item_id": item.id,
        "titulo_anuncio": item.titulo_anuncio,
        "sku_inbound": item.sku_inbound,
        "quantidade_original": qtd_original,
        "quantidade_full": qtd_full,
        "olist_encontrado": True,
        "olist_produto_id": produto_id,
        "olist_nome": item.olist_nome,
        "estoque_atual": saldo,
        "baixa_proposta": qtd_full if not tem_falta else min(disponivel_para_baixa, qtd_full),
        "resultado": (saldo - qtd_full) if not tem_falta else None,
        "falta": falta,
        "tem_falta": tem_falta,
        "estoque_indisponivel": False,
        "baixa_aplicada": item.baixa_aplicada or 0,
        "vinculado": item.validado or 0,
        "foi_balanceado": item.foi_balanceado or 0,
        "saldo_disponivel": item.saldo_disponivel,
        "em_espera": item.em_espera or 0,
        "imagem": item.olist_imagem,
    }


async def revisar_baixa_embale(request: Request):
    """
    GET /api/embaldes/{embale_id}/revisao
    Revisão (SOMENTE LEITURA - não altera nada na Olist).
    Para cada item do inbound: bate o SKU na Olist, pega o saldo atual e
    calcula quanto vai pro FULL, o resultado e a falta (se inbound > saldo).
    """
    import concurrent.futures

    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        # Itens excluídos da separação ("não vai ser enviado") ficam fora da lista,
        # mas seguem no banco para o Histórico FULL (reversível).
        itens = [i for i in embale.itens if (i.nao_enviar or 0) != 1]
        force_refresh = request.query_params.get("refresh", "").strip().lower() in {"1", "true", "yes", "sim"}

        # Foto direto da Olist (primária); preenche o cache uma única vez por item.
        _preencher_imagens_olist(db, itens)

        if embale.revisao_salva_em and not force_refresh:
            # Item vinculado sem estoque de referência (vínculo novo, ou desfeito na versão antiga)
            # aparecia como "Estoque indisponível" e sem botões: busca na Olist e grava.
            # ponytail: no máximo 10 por abertura, para não deixar a revisão lenta.
            sem_saldo = [i for i in itens if i.olist_produto_id and i.olist_estoque_antes is None and i.baixa_aplicada != 1][:10]
            for i in sem_saldo:
                saldo = (olist.obter_estoque(str(i.olist_produto_id)) or {}).get("saldo")
                if saldo is not None:
                    i.olist_estoque_antes = float(saldo)
                    db.add(i)
            if sem_saldo:
                db.commit()
            revisao = [_resumo_revisao_salva_item(item) for item in itens]
            _marcar_historico_full(db, embale.id, revisao)
            resumo = {
                "total": len(revisao),
                "encontrados": sum(1 for item in revisao if item["olist_encontrado"]),
                "nao_encontrados": sum(1 for item in revisao if not item["olist_encontrado"]),
                "com_falta": sum(1 for item in revisao if item["tem_falta"]),
            }
            return JSONResponse({
                "embale_id": embale.id,
                "nome_embalde": embale.nome_embalde,
                "numero_inbound": embale.numero_inbound,
                "status": embale.status,
                "revisao_salva_em": embale.revisao_salva_em.isoformat(),
                "ultimo_item_separacao": embale.ultimo_item_separacao,
                "resumo": resumo,
                "itens": revisao,
            })

        # 1) Resolver produto Olist de cada item.
        #    Persiste o vínculo encontrado no banco para acelerar as próximas
        #    revisões (não precisa buscar de novo) e reduzir chamadas à API.
        resolvidos = {}  # item_id -> (produto_id, nome)
        revisado_em = datetime.utcnow()
        for item in itens:
            _descartar_vinculo_memorizado_inativo(db, item)
            pid, nome = _resolver_olist_para_item(item)
            resolvidos[item.id] = (pid, nome)
            # Salva o vínculo se for novo (ainda não tinha olist_produto_id).
            # Marca validado=1 também — senão o item aparecia "Sem vínculo"
            # mesmo já tendo anúncio resolvido na Olist.
            if pid:
                item.olist_produto_id = pid
                item.olist_nome = nome
                item.validado = 1
                item.validacao_mensagem = None
            if item.quantidade_baixar is None:
                item.quantidade_baixar = float(item.quantidade_separada or 0)
            item.data_validacao = revisado_em
            db.add(item)
        db.commit()

        # 2) Buscar saldo na Olist (throttled internamente p/ respeitar 120/min).
        #    Workers baixos: o gargalo real é o rate limit, não a CPU.
        def _get_estoque(produto_id):
            try:
                return produto_id, olist.obter_estoque(produto_id)
            except Exception:
                return produto_id, None

        ids_para_estoque = {pid for (pid, _) in resolvidos.values() if pid}
        estoques = {}  # produto_id -> saldo (int) ou None
        if ids_para_estoque:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
                for produto_id, dados in ex.map(_get_estoque, ids_para_estoque):
                    estoques[produto_id] = (dados or {}).get("saldo") if dados else None

        # 3) Montar revisão
        revisao = []
        resumo = {"total": len(itens), "encontrados": 0, "nao_encontrados": 0, "com_falta": 0}

        for item in itens:
            produto_id, nome_olist = resolvidos[item.id]
            qtd_full = _quantidade_planejada_full(item)

            if not produto_id:
                item.olist_estoque_antes = None
                item.falta = None
                resumo["nao_encontrados"] += 1
                revisao.append({
                    "item_id": item.id,
                    "titulo_anuncio": item.titulo_anuncio,
                    "sku_inbound": item.sku_inbound,
                    "quantidade_original": float(item.quantidade_separada or 0),
                    "quantidade_full": qtd_full,
                    "olist_encontrado": False,
                    "olist_produto_id": None,
                    "olist_nome": None,
                    "estoque_atual": None,
                    "resultado": None,
                    "falta": None,
                    "tem_falta": False,
                    "estoque_indisponivel": False,
                    "baixa_aplicada": item.baixa_aplicada or 0,
                    "vinculado": item.validado or 0,
                    "foi_balanceado": item.foi_balanceado or 0,
                    "saldo_disponivel": item.saldo_disponivel,
                    "em_espera": item.em_espera or 0,
                    "imagem": item.olist_imagem,
                })
                db.add(item)
                continue

            resumo["encontrados"] += 1
            saldo = estoques.get(produto_id)

            if saldo is None:
                item.olist_estoque_antes = None
                item.falta = None
                # Achou o produto mas não conseguiu ler o estoque
                revisao.append({
                    "item_id": item.id,
                    "titulo_anuncio": item.titulo_anuncio,
                    "sku_inbound": item.sku_inbound,
                    "quantidade_original": float(item.quantidade_separada or 0),
                    "quantidade_full": qtd_full,
                    "olist_encontrado": True,
                    "olist_produto_id": produto_id,
                    "olist_nome": nome_olist,
                    "estoque_atual": None,
                    "resultado": None,
                    "falta": None,
                    "tem_falta": False,
                    "estoque_indisponivel": True,
                    "baixa_aplicada": item.baixa_aplicada or 0,
                    "vinculado": item.validado or 0,
                    "foi_balanceado": item.foi_balanceado or 0,
                    "saldo_disponivel": item.saldo_disponivel,
                    "em_espera": item.em_espera or 0,
                    "imagem": item.olist_imagem,
                })
                db.add(item)
                continue

            item.olist_estoque_antes = float(saldo or 0)
            falta = max(0, qtd_full - saldo)
            item.falta = float(falta)
            tem_falta = falta > 0
            if tem_falta:
                resumo["com_falta"] += 1

            # Quanto dá pra baixar de fato (nunca negativo)
            disponivel_para_baixa = max(0, saldo)

            revisao.append({
                "item_id": item.id,
                "titulo_anuncio": item.titulo_anuncio,
                "sku_inbound": item.sku_inbound,
                "quantidade_original": float(item.quantidade_separada or 0),
                "quantidade_full": qtd_full,
                "olist_encontrado": True,
                "olist_produto_id": produto_id,
                "olist_nome": nome_olist,
                "estoque_atual": saldo,
                # Sem falta: baixa = qtd_full, resultado = saldo - qtd_full
                # Com falta: baixa proposta = tudo que tem (>=0); usuário declara a qtd
                "baixa_proposta": qtd_full if not tem_falta else disponivel_para_baixa,
                "resultado": (saldo - qtd_full) if not tem_falta else None,
                "falta": falta,
                "tem_falta": tem_falta,
                "baixa_aplicada": item.baixa_aplicada or 0,
                "vinculado": item.validado or 0,
                "foi_balanceado": item.foi_balanceado or 0,
                "saldo_disponivel": item.saldo_disponivel,
                "em_espera": item.em_espera or 0,
                "imagem": item.olist_imagem,
            })
            db.add(item)

        if not embale.revisao_salva_em:
            embale.revisao_salva_em = revisado_em
        db.add(embale)
        db.commit()

        _marcar_historico_full(db, embale.id, revisao)

        return JSONResponse({
            "embale_id": embale.id,
            "nome_embalde": embale.nome_embalde,
            "numero_inbound": embale.numero_inbound,
            "status": embale.status,
            "revisao_salva_em": embale.revisao_salva_em.isoformat() if embale.revisao_salva_em else None,
            "ultimo_item_separacao": embale.ultimo_item_separacao,
            "resumo": resumo,
            "itens": revisao,
        })

    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


def _aplicar_baixa_item(db, item, embale, qtd_override=None):
    """
    Aplica a baixa de UM item na Olist (tipo='S' = Saída).
    Retorna dict com status: ok | ja_baixado | zerado | nao_encontrado | falha.
    Não faz commit (quem chama decide quando commitar).
    """
    if item.baixa_aplicada == 1:
        return {
            "item_id": item.id, "status": "ja_baixado",
            "mensagem": "Já foi baixado anteriormente",
            "quantidade_baixada": item.quantidade_baixada
        }

    if _pedido_full_pendente(db, item.id):
        return {"item_id": item.id, "status": "pendente_aprovacao", "erro": _MSG_PENDENTE}

    produto_id, nome_olist = _resolver_olist_para_item(item)
    if not produto_id:
        return {
            "item_id": item.id, "status": "nao_encontrado",
            "erro": "Produto não encontrado na Olist"
        }

    # Quantidade: override declarado, senão a do FULL
    if qtd_override is not None:
        qtd_baixar = float(qtd_override)
    else:
        qtd_baixar = _quantidade_planejada_full(item)

    if qtd_baixar <= 0:
        # Nada vai pro FULL: não há o que retirar, mas o item está resolvido (fica verde e conta
        # como concluído). Sem isso, balanço com FULL=0 corrigia a Olist e o item ficava pendente.
        item.quantidade_baixar = 0.0
        item.quantidade_baixada = 0.0
        item.baixa_aplicada = 1
        item.data_baixa = datetime.utcnow()
        db.add(item)
        return {
            "item_id": item.id, "status": "zerado",
            "quantidade_baixada": 0,
            "mensagem": "Nada a baixar (FULL = 0): item marcado como concluído"
        }

    sucesso = olist.atualizar_estoque(
        produto_id=produto_id,
        quantidade=qtd_baixar,
        tipo="S",  # Saída
        observacao=f"Baixa do Inbound #{embale.numero_inbound} (FULL)"
    )

    if sucesso:
        if item.olist_estoque_antes is None:
            estoque_antes = olist.obter_estoque(produto_id)
            item.olist_estoque_antes = float((estoque_antes or {}).get("saldo") or 0)
        item.quantidade_baixar = float(qtd_baixar)
        item.quantidade_baixada = qtd_baixar
        item.baixa_aplicada = 1
        item.data_baixa = datetime.utcnow()
        db.add(item)
        return {
            "item_id": item.id, "status": "ok",
            "quantidade_baixada": qtd_baixar,
            "mensagem": f"Baixa de {int(qtd_baixar)} un. aplicada com sucesso"
        }
    return {
        "item_id": item.id, "status": "falha",
        "erro": "Falha ao aplicar baixa na Olist",
        "detalhe": olist._ultimo_erro_estoque,
    }


async def confirmar_baixa_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/confirmar-baixa
    Confirma e aplica a baixa de estoque na Olist para cada produto (EM MASSA).

    Body: {
      "itens": {"item_id": quantidade_a_baixar, ...},  // declaração p/ itens com falta
      "somente_ids": [item_id, ...]  // opcional: baixar só estes itens
    }
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        body = await request.json()
        itens_declarados = body.get("itens", {})
        somente_ids = body.get("somente_ids")  # None = todos

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)

        itens = list(embale.itens)
        if somente_ids:
            ids_set = {int(i) for i in somente_ids}
            itens = [i for i in itens if i.id in ids_set]

        resultados = []
        erros = []

        for item in itens:
            qtd_override = itens_declarados.get(str(item.id))
            r = _aplicar_baixa_item(db, item, embale, qtd_override=qtd_override)
            if r["status"] in ("nao_encontrado", "falha"):
                erros.append(r)
            else:
                resultados.append(r)

        db.commit()

        resumo_sucesso = sum(1 for r in resultados if r.get("status") in ("ok", "ja_baixado"))
        _registrar_log_operacao(
            request,
            "baixa_full_em_massa",
            "embale",
            embale.id,
            f"Baixa em massa do inbound #{embale.numero_inbound or embale.id}",
            {
                "embale_id": embale.id,
                "sucesso": resumo_sucesso,
                "total_itens": len(itens),
                "erros_count": len(erros),
            },
        )
        return JSONResponse({
            "embale_id": embale.id,
            "total_itens": len(itens),
            "sucesso": resumo_sucesso,
            "erros_count": len(erros),
            "resultados": resultados,
            "erros": erros,
            "mensagem": f"{resumo_sucesso}/{len(itens)} itens processados com sucesso"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def baixa_item_individual(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/baixa
    Aplica a baixa de UM único item na Olist (produto por produto).
    Body opcional: {"quantidade": N}  (default = quantidade do FULL)
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))

        try:
            body = await request.json()
        except Exception:
            body = {}
        qtd = body.get("quantidade")

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        r = _aplicar_baixa_item(db, item, embale, qtd_override=qtd)
        db.commit()

        status_code = 200 if r["status"] in ("ok", "ja_baixado", "zerado") else 400
        if r["status"] in ("ok", "ja_baixado", "zerado"):
            _registrar_log_operacao(
                request,
                "baixa_item_full",
                "item_embale",
                item.id,
                f"Baixa individual do item {item.sku_inbound or item.titulo_anuncio}",
                {
                    "embale_id": embale.id,
                    "item_id": item.id,
                    "quantidade": r.get("quantidade_baixada") or qtd,
                    "status": r.get("status"),
                },
            )
        return JSONResponse(r, status_code=status_code)

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def vincular_item_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/vincular
    Vincula manualmente um item do inbound a um anúncio existente na Olist.
    Body: {"olist_produto_id", "olist_sku", "olist_nome", "olist_preco"?}
    Salva também a memória de vínculo (de-para) para inbounds futuros.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        data = await request.json()

        olist_produto_id = data.get("olist_produto_id")
        olist_sku = data.get("olist_sku", "")
        olist_nome = data.get("olist_nome", "")
        olist_preco = float(data.get("olist_preco", 0) or 0)

        if not olist_produto_id:
            return JSONResponse({"erro": "olist_produto_id é obrigatório"}, status_code=400)

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        # Transferência de baixa: se o item JÁ FOI baixado e o vínculo está mudando
        # para outro produto, estorna a quantidade que subiu pro FULL no produto
        # ANTIGO (entrada) e baixa a mesma no NOVO (saída), mantendo o item baixado.
        old_produto_id = item.olist_produto_id
        qtd_baixada = float(item.quantidade_baixada or 0)
        precisa_transferir = (
            (item.baixa_aplicada or 0) == 1
            and old_produto_id
            and str(old_produto_id) != str(olist_produto_id)
            and qtd_baixada > 0
        )
        transferencia = None
        if precisa_transferir:
            obs = f"Troca de vínculo do inbound #{embale.numero_inbound or embale.id} (item {item.sku_inbound or item.titulo_anuncio})"
            # 1) Estorna (devolve) no produto antigo
            ok_estorno = olist.atualizar_estoque(
                produto_id=str(old_produto_id), quantidade=qtd_baixada, tipo="E",
                observacao=f"Estorno por {obs}",
            )
            if not ok_estorno:
                return JSONResponse({
                    "erro": f"Falha ao estornar {qtd_baixada:g} un no produto antigo da Olist. Vínculo NÃO foi trocado.",
                    "detalhe": olist._ultimo_erro_estoque,
                }, status_code=502)
            # 2) Aplica a baixa no produto novo
            ok_baixa = olist.atualizar_estoque(
                produto_id=str(olist_produto_id), quantidade=qtd_baixada, tipo="S",
                observacao=f"Baixa transferida por {obs}",
            )
            if not ok_baixa:
                # O estorno já voltou pro antigo; o item deixa de estar baixado
                # (o estoque não está mais "no FULL" em lugar nenhum). Troca o
                # vínculo mesmo assim e avisa para refazer a baixa no novo.
                item.baixa_aplicada = 0
                item.quantidade_baixada = None
                item.data_baixa = None
                transferencia = {
                    "estornado": qtd_baixada, "baixado_novo": 0,
                    "aviso": "Estorno feito no produto antigo, mas a baixa no novo falhou. O item ficou SEM baixa — refaça a baixa no produto novo.",
                    "detalhe": olist._ultimo_erro_estoque,
                }
            else:
                transferencia = {"estornado": qtd_baixada, "baixado_novo": qtd_baixada}

        # Salva o vínculo no item
        item.olist_produto_id = str(olist_produto_id)
        item.olist_sku = olist_sku
        item.olist_nome = olist_nome
        item.validado = 1
        item.validacao_mensagem = None
        item.data_validacao = datetime.utcnow()
        item.olist_estoque_antes = None
        item.falta = None
        # Limpa a foto cacheada: o produto mudou, a imagem é refeita na próxima
        # revisão a partir do novo produto Olist (evita foto do vínculo antigo).
        item.olist_imagem = None
        db.add(item)
        embale.revisao_salva_em = None
        db.add(embale)

        # Memória de vínculo (de-para): usa SKU/título do inbound como chave,
        # para casar automaticamente em inbounds futuros.
        chave_desc = item.titulo_anuncio or item.sku_inbound or ""
        chave_cod = item.sku_inbound or ""
        if chave_desc:
            vinculo = db.query(VinculoOlist).filter(
                VinculoOlist.nf_descricao == chave_desc,
                VinculoOlist.olist_produto_id == str(olist_produto_id)
            ).first()
            if vinculo:
                vinculo.nf_codigo = chave_cod
                vinculo.olist_sku = olist_sku
                vinculo.olist_nome = olist_nome
                vinculo.olist_preco = olist_preco
                vinculo.vezes_usado = (vinculo.vezes_usado or 1) + 1
                vinculo.atualizado_em = datetime.utcnow()
            else:
                db.add(VinculoOlist(
                    nf_codigo=chave_cod,
                    nf_descricao=chave_desc,
                    olist_produto_id=str(olist_produto_id),
                    olist_sku=olist_sku,
                    olist_nome=olist_nome,
                    olist_preco=olist_preco,
                    vezes_usado=1,
                ))

        db.commit()
        _registrar_log_operacao(
            request,
            "vinculo_item_inbound",
            "item_embale",
            item.id,
            f"Item do inbound vinculado à Olist: {olist_nome}",
            {
                "embale_id": embale.id,
                "item_id": item.id,
                "sku_inbound": item.sku_inbound,
                "olist_produto_id": str(olist_produto_id),
                "olist_produto_id_antigo": str(old_produto_id) if old_produto_id else None,
                "olist_sku": olist_sku,
                "olist_nome": olist_nome,
                "transferencia_baixa": transferencia,
            },
        )
        if transferencia and transferencia.get("aviso"):
            mensagem = f"Vínculo trocado para {olist_nome}. {transferencia['aviso']}"
        elif transferencia:
            mensagem = f"Vínculo trocado para {olist_nome}. Estornei {transferencia['estornado']:g} un no produto antigo e baixei no novo."
        else:
            mensagem = f"Vinculado a: {olist_nome}"
        return JSONResponse({
            "sucesso": True,
            "item_id": item_id,
            "olist_produto_id": str(olist_produto_id),
            "olist_nome": olist_nome,
            "transferencia": transferencia,
            "mensagem": mensagem,
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def ajustar_quantidade_full_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/quantidade-full
    Ajusta a quantidade planejada para ir ao FULL e persiste no banco.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        data = await request.json()
        quantidade_full = float(data.get("quantidade_full", 0))

        if quantidade_full < 0:
            return JSONResponse({"erro": "Quantidade do FULL nÃ£o pode ser negativa"}, status_code=400)

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound nÃ£o encontrado"}, status_code=404)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item nÃ£o encontrado neste inbound"}, status_code=404)
        if item.baixa_aplicada == 1:
            return JSONResponse({"erro": "Este item jÃ¡ teve a baixa aplicada"}, status_code=400)

        ja_reservado = float(item.quantidade_baixada or 0)
        if quantidade_full < ja_reservado:
            return JSONResponse({
                "erro": f"NÃ£o dÃ¡ para reduzir abaixo de {ja_reservado:g}, porque essa quantidade jÃ¡ foi reservada/baixada."
            }, status_code=400)

        # Quantidade planejada ANTES da mudança (para registrar no histórico)
        quantidade_anterior = _quantidade_planejada_full(item)
        mudou = abs(quantidade_full - quantidade_anterior) > 0.0001
        pendente = _pedido_full_pendente(db, item.id)

        if pendente:  # pedido antigo (fluxo de aprovação removido) perde o sentido
            pendente.status = "recusado"
            pendente.decidido_por = _operador_contexto(request)["operador_nome"]
            pendente.decidido_em = datetime.utcnow()

        item.quantidade_baixar = quantidade_full
        if item.olist_estoque_antes is not None:
            item.falta = max(0.0, quantidade_full - float(item.olist_estoque_antes or 0))
        db.add(item)

        # Histórico: registra TODA mudança do "Vai pro FULL" (aumento ou redução)
        if abs(quantidade_full - quantidade_anterior) > 0.0001:
            db.add(HistoricoFullEmbale(
                embale_id=embale.id,
                item_id=item.id,
                titulo_anuncio=item.titulo_anuncio,
                sku_inbound=item.sku_inbound,
                quantidade_anterior=quantidade_anterior,
                quantidade_nova=quantidade_full,
                tipo="aumento" if quantidade_full > quantidade_anterior else "reducao",
                status="aprovado", solicitante=_operador_contexto(request)["operador_nome"],
                decidido_por=_operador_contexto(request)["operador_nome"], decidido_em=datetime.utcnow(),
            ))

        db.commit()

        if abs(quantidade_full - quantidade_anterior) > 0.0001:
            _registrar_log_operacao(
                request,
                "quantidade_full_ajustada",
                "item_embale",
                item.id,
                f"Quantidade do FULL ajustada para {quantidade_full:g}",
                {
                    "embale_id": embale.id,
                    "item_id": item.id,
                    "quantidade_anterior": quantidade_anterior,
                    "quantidade_nova": quantidade_full,
                },
            )

        return JSONResponse({
            "sucesso": True,
            "item_id": item.id,
            "quantidade_full": quantidade_full,
            "snapshot": _resumo_revisao_salva_item(item),
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def balancear_item_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/balancear
    Faz o balanço de estoque de um item: corrige estoque na Olist e aplica baixa do FULL.

    Body: {"quantidade_real": N}  (quantidade conferida no físico)

    Fluxo:
    1. Atualiza Olist para quantidade_real (corrige erros passados)
    2. Desconta a quantidade destinada ao FULL
    3. Marca o item como "balanceado"

    Retorna: estoque_olist_antes, estoque_olist_depois, qtd_full_desconta, saldo_disponivel
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        data = await request.json()
        quantidade_real = float(data.get("quantidade_real", 0))

        if quantidade_real < 0:
            return JSONResponse({"erro": "Quantidade não pode ser negativa"}, status_code=400)
        if not float(quantidade_real).is_integer():
            return JSONResponse({"erro": f"Quantidade real deve ser em unidades inteiras (recebi {quantidade_real:g}). Digite sem ponto: 1527, não 1.527."}, status_code=400)

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        if not item.olist_produto_id:
            return JSONResponse({"erro": "Item não está vinculado à Olist"}, status_code=400)
        if _pedido_full_pendente(db, item.id):
            return JSONResponse({"erro": _MSG_PENDENTE}, status_code=409)

        # Obter estoque ANTES (sem cache, p/ valor fiel no momento do balanço)
        produto_id = item.olist_produto_id
        estoque_antes = (olist.obter_estoque(produto_id, usar_cache=False) or {}).get("saldo", 0) or 0

        # Quantidade planejada para o FULL (editavel na revisao)
        qtd_full = _quantidade_planejada_full(item)

        # Quando o conferido no físico é MENOR que o que vai pro FULL, temos
        # divergência: corrige a Olist para o real, mas NÃO baixa — o item
        # continua pendente/divergente e a falta é notificada no WhatsApp.
        tem_divergencia = quantidade_real < qtd_full

        # 1. Atualizar Olist para quantidade_real (balanço completo)
        # tipo="B" é ABSOLUTO na Tiny: o valor enviado VIRA o estoque atual.
        sucesso = olist.atualizar_estoque(
            produto_id=produto_id,
            quantidade=quantidade_real,  # absoluto: estoque passa a ser exatamente isto
            tipo="B",  # Balanço (não é entrada nem saída, é correção)
            observacao=f"Balanço do Inbound #{embale.numero_inbound}: corrigido de {estoque_antes} para {quantidade_real}"
        )

        if not sucesso:
            db.rollback()
            return JSONResponse({
                "erro": "Falha ao atualizar estoque na Olist",
                "detalhe": olist._ultimo_erro_estoque,
            }, status_code=500)

        if tem_divergencia:
            # Corrige a Olist mas NÃO baixa. Mantém divergência (falta) para o
            # operador resolver e dispara a notificação no WhatsApp (no frontend).
            # Sem baixa, a Olist agora vale exatamente o real conferido.
            estoque_depois = float(quantidade_real)
            item.olist_estoque_antes = estoque_depois  # snapshot da revisão lê isto
            item.falta = max(0.0, qtd_full - quantidade_real)
            item.saldo_disponivel = 0
            item.foi_balanceado = 1
            item.data_balanceamento = datetime.utcnow()
            # Divergência: além de corrigir a Olist, deixa o item EM ESPERA
            # automaticamente — sai da separação até ser ajustado no Histórico
            # FULL (declarar nova qtd e voltar, ou excluir).
            item.em_espera = 1
            item.data_em_espera = datetime.utcnow()
            db.add(item)
            db.commit()
            _registrar_log_operacao(
                request,
                "balanco_item_full_divergente",
                "item_embale",
                item.id,
                f"Balanço divergente do item {item.sku_inbound or item.titulo_anuncio}",
                {
                    "embale_id": embale.id,
                    "item_id": item.id,
                    "sku_inbound": item.sku_inbound,
                    "olist_produto_id": str(produto_id),
                    "quantidade_real": quantidade_real,
                    "qtd_full": qtd_full,
                    "falta": item.falta,
                    "estoque_antes": estoque_antes,
                    "estoque_depois": estoque_depois,
                },
            )
            return JSONResponse({
                "item_id": item.id,
                "titulo": item.titulo_anuncio,
                "sku_inbound": item.sku_inbound,
                "estoque_olist_antes": estoque_antes,
                "estoque_olist_depois": estoque_depois,
                "quantidade_real_conferida": quantidade_real,
                "qtd_full_desconta": qtd_full,
                "falta": item.falta,
                "saldo_disponivel": 0,
                "tem_divergencia": True,
                "em_espera": 1,
                "baixa_status": "nao_baixado_divergencia",
                "mensagem": f"Olist corrigida para {quantidade_real:g} un. Faltam {item.falta:g} un para o FULL ({qtd_full:g}). Item ficou EM ESPERA — ajuste no Histórico FULL (declare a nova qtd e volte, ou exclua)."
            })

        # Sem divergência (conferido >= FULL): aplica a baixa normalmente.
        # 2. Aplicar baixa do FULL automaticamente
        baixa_resultado = _aplicar_baixa_item(db, item, embale, qtd_override=qtd_full)

        # 3. Atualizar o item como balanceado.
        # Olist foi setada para quantidade_real (absoluto) e depois baixou qtd_full,
        # então o saldo final é (real - full).
        estoque_depois = max(0.0, float(quantidade_real) - qtd_full)
        item.quantidade_baixar = qtd_full
        item.olist_estoque_antes = estoque_depois  # snapshot da revisão lê isto
        item.falta = max(0.0, qtd_full - quantidade_real)
        item.saldo_disponivel = max(0, quantidade_real - qtd_full)
        item.foi_balanceado = 1
        item.data_balanceamento = datetime.utcnow()
        db.add(item)
        db.commit()
        _registrar_log_operacao(
            request,
            "balanco_item_full",
            "item_embale",
            item.id,
            f"Balanço do item {item.sku_inbound or item.titulo_anuncio}",
            {
                "embale_id": embale.id,
                "item_id": item.id,
                "sku_inbound": item.sku_inbound,
                "olist_produto_id": str(produto_id),
                "quantidade_real": quantidade_real,
                "qtd_full": qtd_full,
                "falta": item.falta,
                "saldo_disponivel": item.saldo_disponivel,
                "estoque_antes": estoque_antes,
                "estoque_depois": estoque_depois,
                "baixa_status": baixa_resultado.get("status"),
            },
        )

        return JSONResponse({
            "item_id": item.id,
            "titulo": item.titulo_anuncio,
            "sku_inbound": item.sku_inbound,
            "estoque_olist_antes": estoque_antes,
            "estoque_olist_depois": estoque_depois,
            "quantidade_real_conferida": quantidade_real,
            "qtd_full_desconta": qtd_full,
            "falta": item.falta,
            "saldo_disponivel": item.saldo_disponivel,
            "tem_divergencia": False,
            "baixa_status": baixa_resultado.get("status"),
            "mensagem": f"Balanço realizado. Olist: {estoque_antes} → {estoque_depois}. FULL desconta {qtd_full}, sobram {item.saldo_disponivel}."
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


def _componentes_kit_olist(produto_id: str, qtd_full: float):
    """Lê os componentes de um produto kit da Olist usando o ID direto.
    A API v3 traz tipo=='K' e o array 'kit' com {produto:{id,sku,descricao}, quantidade}.
    Buscar por SKU (detectar_e_buscar_kit) pegava o produto errado — por isso usamos o id.

    Se o id vinculado NÃO for um kit (ex.: a Olist tem uma duplicata Simples/excluída
    com o mesmo código do kit ativo), procuramos pelo código um kit ativo de verdade.
    Retorna (eh_kit: bool, tipo: str, componentes: list, nome_kit, sku_kit, kit_id).
    """
    detalhe = olist.obter_detalhes_completo(str(produto_id)) or {}
    tipo = detalhe.get("tipo")
    kit_id = str(produto_id)
    if tipo != "K" or not (detalhe.get("kit") or []):
        # Pode ser o gêmeo Simples/excluído. Tenta achar o kit ativo pelo código.
        sku = detalhe.get("sku") or ""
        alt, alt_id = olist.buscar_kit_por_codigo(sku, id_preferencial=produto_id) if sku else (None, None)
        if not alt:
            return False, tipo, [], None, None, kit_id
        detalhe, tipo, kit_id = alt, "K", str(alt_id)
    componentes = []
    for c in (detalhe.get("kit") or []):
        p = c.get("produto") or {}
        cid = str(p.get("id") or "")
        por_kit = float(c.get("quantidade") or 1)
        estoque_atual = None
        if cid:
            est = olist.obter_estoque(cid)
            if isinstance(est, dict):
                estoque_atual = est.get("saldo", est.get("disponivel"))
        componentes.append({
            "produto_id": cid,
            "sku": p.get("sku") or "",
            "descricao": p.get("descricao") or "",
            "estoque_atual": estoque_atual,
            "quantidade_no_kit": por_kit,
            "quantidade_sugerida": int(round(por_kit * qtd_full)),
        })
    return True, tipo, componentes, detalhe.get("descricao"), detalhe.get("sku"), kit_id


def _kit_equivalente_minimo(componentes: list, campo: str) -> float:
    """Converte o estoque dos componentes para o equivalente em kits completos."""
    equivalentes = []
    for c in componentes:
        try:
            por_kit = float((c or {}).get("quantidade_no_kit") or 1)
        except (TypeError, ValueError):
            por_kit = 1
        if por_kit <= 0:
            por_kit = 1
        try:
            valor = float((c or {}).get(campo) or 0)
        except (TypeError, ValueError):
            valor = 0
        equivalentes.append(valor / por_kit)
    return min(equivalentes) if equivalentes else 0.0


async def kit_componentes_embale(request: Request):
    """
    GET /api/embaldes/{embale_id}/itens/{item_id}/kit
    Detecta se o item do inbound é um KIT na Olist e devolve os componentes
    (anúncios unitários) com a quantidade sugerida. A Olist não deixa mexer no
    estoque de um kit direto — baixa/balanço têm que ser feitos em cada componente.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        qtd_full = _quantidade_planejada_full(item)
        pid = str(item.olist_produto_id or "").strip()
        if not pid:
            return JSONResponse({"eh_kit": False, "motivo": "Item sem produto Olist vinculado", "qtd_full": qtd_full})

        eh_kit, tipo, componentes, nome_kit, sku_kit, kit_id = _componentes_kit_olist(pid, qtd_full)
        if not eh_kit:
            return JSONResponse({"eh_kit": False, "tipo": tipo, "qtd_full": qtd_full})

        # Se o kit real estava numa duplicata (id diferente do vinculado), corrige o
        # vínculo para os próximos acessos apontarem direto ao kit ativo.
        if kit_id and str(kit_id) != pid:
            item.olist_produto_id = str(kit_id)
            db.commit()

        return JSONResponse({
            "eh_kit": True,
            "nome_kit": nome_kit,
            "sku_kit": sku_kit,
            "qtd_full": qtd_full,
            "componentes": componentes,
        }, headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def balancear_kit_componentes_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/balancear-kit
    Body: {"componentes": [{"produto_id": "...", "sku": "...", "quantidade_real": N,
                            "quantidade_baixar": N, "quantidade_no_kit": N}]}
    Faz o balanço dos componentes unitários de um kit. Cada componente é
    corrigido por balanço (tipo B) e, se houver saldo suficiente, recebe a baixa
    do FULL (tipo S). O item pai só é marcado como baixado quando TODOS os
    componentes concluírem a sequência completa.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        body = await request.json()
        componentes = body.get("componentes") if isinstance(body, dict) else None
        if not isinstance(componentes, list) or not componentes:
            return JSONResponse({"erro": "Informe os componentes do kit"}, status_code=400)

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)
        if item.baixa_aplicada == 1:
            return JSONResponse({"erro": "Este item já teve a baixa aplicada"}, status_code=400)
        if _pedido_full_pendente(db, item.id):
            return JSONResponse({"erro": _MSG_PENDENTE}, status_code=409)

        qtd_full = _quantidade_planejada_full(item)
        resultados = []

        for c in componentes:
            payload = c or {}
            pid = str(payload.get("produto_id") or "").strip()
            sku_c = payload.get("sku") or ""
            try:
                qtd_real = float(payload.get("quantidade_real") or 0)
            except (TypeError, ValueError):
                qtd_real = -1
            try:
                qtd_baixar = float(payload.get("quantidade_baixar") or 0)
            except (TypeError, ValueError):
                qtd_baixar = 0
            try:
                por_kit = float(payload.get("quantidade_no_kit") or 1)
            except (TypeError, ValueError):
                por_kit = 1
            if por_kit <= 0:
                por_kit = 1

            if not pid or qtd_real < 0 or qtd_baixar < 0 or not float(qtd_real).is_integer():
                resultados.append({
                    "produto_id": pid,
                    "sku": sku_c,
                    "status": "invalido",
                    "sucesso": False,
                    "quantidade_real": max(0, qtd_real),
                    "quantidade_baixar": max(0, qtd_baixar),
                    "quantidade_no_kit": por_kit,
                    "detalhe": "produto_id ou quantidades inválidos",
                })
                continue

            estoque_antes = (olist.obter_estoque(pid, usar_cache=False) or {}).get("saldo", 0) or 0
            ok_balanco = olist.atualizar_estoque(
                produto_id=pid,
                quantidade=qtd_real,
                tipo="B",
                observacao=f"Balanço do Inbound #{embale.numero_inbound}: componente do kit {item.sku_inbound or item.titulo_anuncio or ''}",
            )
            if not ok_balanco:
                resultados.append({
                    "produto_id": pid,
                    "sku": sku_c,
                    "status": "falha_balanco",
                    "sucesso": False,
                    "quantidade_real": qtd_real,
                    "quantidade_baixar": qtd_baixar,
                    "quantidade_no_kit": por_kit,
                    "estoque_antes": estoque_antes,
                    "detalhe": olist._ultimo_erro_estoque,
                })
                continue

            if qtd_real < qtd_baixar:
                falta = max(0.0, qtd_baixar - qtd_real)
                resultados.append({
                    "produto_id": pid,
                    "sku": sku_c,
                    "status": "divergencia",
                    "sucesso": False,
                    "quantidade_real": qtd_real,
                    "quantidade_baixar": qtd_baixar,
                    "quantidade_no_kit": por_kit,
                    "estoque_antes": estoque_antes,
                    "estoque_depois": qtd_real,
                    "falta": falta,
                    "detalhe": f"Componente balanceado para {qtd_real:g}, mas faltam {falta:g} un para baixar no FULL.",
                })
                continue

            # Olist recusa saída de quantidade 0 (HTTP 400): nada a baixar = só o balanço.
            ok_baixa = qtd_baixar == 0 or olist.atualizar_estoque(
                produto_id=pid,
                quantidade=qtd_baixar,
                tipo="S",
                observacao=f"Baixa do Inbound #{embale.numero_inbound} (FULL) — componente do kit {item.sku_inbound or item.titulo_anuncio or ''}",
            )
            if not ok_baixa:
                resultados.append({
                    "produto_id": pid,
                    "sku": sku_c,
                    "status": "falha_baixa",
                    "sucesso": False,
                    "quantidade_real": qtd_real,
                    "quantidade_baixar": qtd_baixar,
                    "quantidade_no_kit": por_kit,
                    "estoque_antes": estoque_antes,
                    "detalhe": olist._ultimo_erro_estoque,
                })
                continue

            resultados.append({
                "produto_id": pid,
                "sku": sku_c,
                "status": "ok",
                "sucesso": True,
                "quantidade_real": qtd_real,
                "quantidade_baixar": qtd_baixar,
                "quantidade_no_kit": por_kit,
                "estoque_antes": estoque_antes,
                "estoque_depois": max(0.0, qtd_real - qtd_baixar),
                "saldo_disponivel": max(0.0, qtd_real - qtd_baixar),
            })

        todos_ok = bool(resultados) and all(r.get("status") == "ok" for r in resultados)
        tem_divergencia = any(r.get("status") == "divergencia" for r in resultados)
        tem_falha = any(r.get("status") in {"invalido", "falha_balanco", "falha_baixa"} for r in resultados)

        if not tem_falha:
            kits_reais = _kit_equivalente_minimo(resultados, "quantidade_real")
            kits_restantes = _kit_equivalente_minimo(
                resultados,
                "estoque_depois" if todos_ok else "quantidade_real",
            )
            item.olist_estoque_antes = kits_restantes if todos_ok else kits_reais
            item.falta = max(0.0, qtd_full - kits_reais)
            item.saldo_disponivel = max(0.0, kits_restantes if todos_ok else 0.0)
            item.foi_balanceado = 1
            item.data_balanceamento = datetime.utcnow()
            if todos_ok:
                item.quantidade_baixar = qtd_full
                item.quantidade_baixada = qtd_full
                item.baixa_aplicada = 1
                item.data_baixa = datetime.utcnow()
            elif tem_divergencia:
                # Divergência no kit: deixa o item EM ESPERA automaticamente até
                # ser ajustado no Histórico FULL (declarar nova qtd ou excluir).
                item.em_espera = 1
                item.data_em_espera = datetime.utcnow()
            db.add(item)
            db.commit()
            _registrar_log_operacao(
                request,
                "balanco_kit_componentes",
                "item_embale",
                item.id,
                f"Balanço dos componentes do kit {item.sku_inbound or item.titulo_anuncio}",
                {
                    "embale_id": embale.id,
                    "item_id": item.id,
                    "qtd_full": qtd_full,
                    "todos_ok": todos_ok,
                    "tem_divergencia": tem_divergencia,
                    "resultados": resultados,
                },
            )
        else:
            db.rollback()

        mensagem = "Balanço dos componentes concluído com sucesso."
        if tem_falha:
            mensagem = "Alguns componentes falharam no balanço/baixa. O item não foi marcado como concluído."
        elif tem_divergencia:
            mensagem = "Componentes balanceados, mas faltou estoque em pelo menos um deles. O item segue divergente."

        return JSONResponse({
            "todos_ok": todos_ok,
            "tem_divergencia": tem_divergencia,
            "resultados": resultados,
            "qtd_full_desconta": qtd_full,
            "quantidade_real_conferida": None if tem_falha else _kit_equivalente_minimo(resultados, "quantidade_real"),
            "falta": None if tem_falha else item.falta,
            "saldo_disponivel": None if tem_falha else item.saldo_disponivel,
            "mensagem": mensagem,
        }, status_code=200 if not tem_falha else 502)
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def baixar_kit_componentes_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/baixar-kit
    Body: {"componentes": [{"produto_id": "...", "quantidade": N, "sku": "..."}]}
    Dá baixa (saída) do estoque de CADA componente do kit na Olist. Marca o item
    do inbound como baixado só se TODOS os componentes baixarem.
    Atenção: as baixas na Olist não são transacionais — se um componente baixar e
    outro falhar, o que baixou já foi descontado; por isso devolvemos o resultado
    de cada um para o operador não repetir o que já desceu.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        body = await request.json()
        componentes = body.get("componentes") if isinstance(body, dict) else None
        if not isinstance(componentes, list) or not componentes:
            return JSONResponse({"erro": "Informe os componentes e as quantidades"}, status_code=400)

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)
        if item.baixa_aplicada == 1:
            return JSONResponse({"erro": "Este item já teve a baixa aplicada"}, status_code=400)
        if _pedido_full_pendente(db, item.id):
            return JSONResponse({"erro": _MSG_PENDENTE}, status_code=409)

        resultados = []
        for c in componentes:
            pid = str((c or {}).get("produto_id") or "").strip()
            sku_c = (c or {}).get("sku") or ""
            try:
                qtd = float((c or {}).get("quantidade") or 0)
            except (TypeError, ValueError):
                qtd = 0
            if not pid or qtd <= 0:
                resultados.append({"produto_id": pid, "sku": sku_c, "sucesso": False,
                                   "detalhe": "produto_id ou quantidade inválidos"})
                continue
            ok = olist.atualizar_estoque(
                produto_id=pid, quantidade=qtd, tipo="S",
                observacao=f"Baixa do Inbound #{embale.numero_inbound} (FULL) — componente do kit {item.sku_inbound or ''}",
            )
            resultados.append({
                "produto_id": pid, "sku": sku_c, "quantidade": qtd,
                "sucesso": bool(ok),
                "detalhe": None if ok else olist._ultimo_erro_estoque,
            })

        todos_ok = bool(resultados) and all(r["sucesso"] for r in resultados)
        if todos_ok:
            item.quantidade_baixar = _quantidade_planejada_full(item)
            item.quantidade_baixada = item.quantidade_baixar
            item.baixa_aplicada = 1
            item.data_baixa = datetime.utcnow()
            db.add(item)
            db.commit()
            _registrar_log_operacao(
                request,
                "baixa_kit_componentes",
                "item_embale",
                item.id,
                f"Baixa dos componentes do kit {item.sku_inbound or item.titulo_anuncio}",
                {
                    "embale_id": embale.id,
                    "item_id": item.id,
                    "qtd_full": item.quantidade_baixar,
                    "resultados": resultados,
                },
            )
        else:
            db.rollback()

        return JSONResponse({
            "todos_ok": todos_ok,
            "resultados": resultados,
            "mensagem": ("Todos os componentes baixados na Olist." if todos_ok
                         else "Alguns componentes falharam — o item NÃO foi marcado como baixado. Confira os que já desceram antes de repetir."),
        }, status_code=200 if todos_ok else 502)
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


_ACOES_ITEM_FULL = ("balanco_item_full", "balanco_item_full_divergente", "balanco_kit_componentes", "baixa_kit_componentes")


def _movimentos_desfazer(item_produto_id: str | None, qtd_baixada: float, logs: list[tuple[str, dict]]) -> list[dict]:
    """
    Calcula o que lançar na Olist para desfazer a baixa/balanço de um item do inbound.
    logs: (acao, detalhes) do item, do MAIS NOVO para o mais antigo.
    Devolve [{"produto_id", "sku", "ajuste"}]: ajuste > 0 = entrada (E), < 0 = saída (S).
    Soma o EFEITO (diferença) de cada operação desde o último desfazer e aplica o contrário —
    não volta a um valor absoluto, para não apagar vendas que caíram na Olist no meio.
    """
    ja_revertidos: set[str] = set()
    efeito: dict[str, float] = {}
    skus: dict[str, str] = {}
    kit = False

    def soma(pid, sku, valor):
        if pid:
            efeito[str(pid)] = efeito.get(str(pid), 0.0) + valor
            skus.setdefault(str(pid), sku or "")

    produto_da_vez = item_produto_id  # produto do item naquele ponto do histórico (andando para trás)
    for acao, det in logs:
        if acao == "desfazer_item_full":
            break  # daqui para trás já foi desfeito
        if acao == "vinculo_item_inbound":
            # A troca de vínculo já transferiu a baixa para o produto novo (fica em qtd_baixada);
            # o que veio antes dela foi lançado no produto antigo.
            produto_da_vez = str(det.get("olist_produto_id_antigo") or "") or None
            continue
        if acao == "desfazer_item_full_parcial":
            ja_revertidos.update(str(x) for x in det.get("revertidos") or [])
        elif acao in ("balanco_item_full", "balanco_item_full_divergente"):
            # Só a parte do balanço (tipo B); a baixa do item entra uma vez só, abaixo.
            soma(det.get("olist_produto_id") or produto_da_vez, det.get("sku_inbound"),
                 float(det.get("quantidade_real") or 0) - float(det.get("estoque_antes") or 0))
        elif acao == "baixa_kit_componentes":
            kit = True
            for r in det.get("resultados") or []:
                if r.get("sucesso"):
                    soma(r.get("produto_id"), r.get("sku"), -float(r.get("quantidade") or 0))
        elif acao == "balanco_kit_componentes":
            kit = True
            for r in det.get("resultados") or []:
                st = r.get("status")
                if st not in ("ok", "divergencia", "falha_baixa"):
                    continue  # falha_balanco/invalido: nada foi lançado nesse componente
                baixou = float(r.get("quantidade_baixar") or 0) if st == "ok" else 0.0
                soma(r.get("produto_id"), r.get("sku"), float(r.get("quantidade_real") or 0) - baixou - float(r.get("estoque_antes") or 0))

    # Baixa do próprio item (simples ou a que veio junto do balanço): é quantidade_baixada.
    # Em kit a baixa é por componente e já está nos logs acima (quantidade_baixada do item é só o marcador).
    if not kit and qtd_baixada > 0:
        soma(item_produto_id, "", -qtd_baixada)

    return [{"produto_id": pid, "sku": skus[pid], "ajuste": -v}
            for pid, v in efeito.items() if abs(v) > 1e-9 and pid not in ja_revertidos]


async def desfazer_item_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/desfazer
    Desfaz na Olist a baixa/balanço do item e o devolve para pendente (para refazer).
    Se um lançamento falhar no meio, guarda o que já foi revertido para não repetir no próximo clique.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)
        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)
        if item.baixa_aplicada != 1 and item.foi_balanceado != 1:
            return JSONResponse({"erro": "Este item não tem baixa nem balanço para desfazer"}, status_code=400)

        logs = [
            (l.acao, json.loads(l.detalhes_json) if l.detalhes_json else {})
            for l in db.query(LogOperacao)
            .filter(LogOperacao.entidade_tipo == "item_embale", LogOperacao.entidade_id == str(item.id),
                    LogOperacao.acao.in_(_ACOES_ITEM_FULL + ("desfazer_item_full", "desfazer_item_full_parcial",
                                                             "vinculo_item_inbound")))
            .order_by(LogOperacao.id.desc())
            .limit(20)
        ]
        produto_id = item.olist_produto_id or _resolver_olist_para_item(item)[0]
        movs = _movimentos_desfazer(str(produto_id) if produto_id else None, float(item.quantidade_baixada or 0), logs)

        revertidos, falha = [], None
        for m in movs:
            ok = olist.atualizar_estoque(
                produto_id=m["produto_id"],
                quantidade=abs(m["ajuste"]),
                tipo="E" if m["ajuste"] > 0 else "S",
                observacao=f"Desfazer baixa/balanço do Inbound #{embale.numero_inbound} ({item.sku_inbound or item.titulo_anuncio or ''})",
            )
            if not ok:
                falha = {**m, "detalhe": olist._ultimo_erro_estoque}
                break
            revertidos.append(m["produto_id"])

        if falha:
            _registrar_log_operacao(request, "desfazer_item_full_parcial", "item_embale", item.id,
                                    f"Desfazer parcial do item {item.sku_inbound or item.titulo_anuncio}",
                                    {"embale_id": embale.id, "revertidos": revertidos, "falha": falha})
            return JSONResponse({
                "erro": f"Falhou ao desfazer {falha['sku'] or falha['produto_id']} na Olist. Clique de novo: o que já voltou não é repetido.",
                "detalhe": falha["detalhe"],
                "revertidos": revertidos,
            }, status_code=502)

        item.baixa_aplicada = 0
        item.quantidade_baixada = None
        item.data_baixa = None
        item.foi_balanceado = 0
        item.data_balanceamento = None
        item.saldo_disponivel = None
        item.falta = None
        if produto_id:
            saldo = (olist.obter_estoque(str(produto_id), usar_cache=False) or {}).get("saldo")
            item.olist_estoque_antes = float(saldo) if saldo is not None else item.olist_estoque_antes
        if item.em_espera == 1:
            item.em_espera = 0
            item.data_em_espera = None
        db.add(item)
        db.commit()
        _registrar_log_operacao(request, "desfazer_item_full", "item_embale", item.id,
                                f"Desfez baixa/balanço do item {item.sku_inbound or item.titulo_anuncio}",
                                {"embale_id": embale.id, "movimentos": movs})
        resumo = ", ".join(f"{'+' if m['ajuste'] > 0 else '-'}{abs(m['ajuste']):g} {m['sku'] or m['produto_id']}" for m in movs)
        return JSONResponse({
            "sucesso": True,
            "movimentos": movs,
            "mensagem": f"Desfeito na Olist ({resumo or 'nada a lançar'}). O item voltou para pendente.",
        })
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def decidir_pedido_full_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/historico-full/{hist_id}/decidir   Body: {"aprovar": true|false}
    Só o master. Aprovar aplica a nova qtd no "Vai pro FULL"; recusar mantém a anterior.
    """
    if not _request_eh_master(request):
        return JSONResponse({"erro": "Só o administrador aprova mudança do Vai pro FULL."}, status_code=403)
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        hist_id = int(request.path_params.get("hist_id"))
        aprovar = bool((await request.json() or {}).get("aprovar"))
        h = db.query(HistoricoFullEmbale).filter(HistoricoFullEmbale.id == hist_id,
                                                 HistoricoFullEmbale.embale_id == embale_id).first()
        if not h:
            return JSONResponse({"erro": "Pedido não encontrado"}, status_code=404)
        if h.status != "pendente":
            return JSONResponse({"erro": f"Este pedido já foi {h.status or 'aplicado'}."}, status_code=409)
        item = db.query(ItemEmbaleFU).filter(ItemEmbaleFU.id == h.item_id).first()
        if aprovar:
            if not item or item.baixa_aplicada == 1:
                return JSONResponse({"erro": "O item já teve a baixa aplicada: não dá para mudar o FULL."}, status_code=409)
            item.quantidade_baixar = float(h.quantidade_nova)
            if item.olist_estoque_antes is not None:
                item.falta = max(0.0, float(h.quantidade_nova) - float(item.olist_estoque_antes or 0))
            db.add(item)
        h.status = "aprovado" if aprovar else "recusado"
        h.decidido_por = _operador_contexto(request)["operador_nome"]
        h.decidido_em = datetime.utcnow()
        db.commit()
        _registrar_log_operacao(request, "quantidade_full_aprovada" if aprovar else "quantidade_full_recusada",
                                "item_embale", h.item_id,
                                f"{'Aprovou' if aprovar else 'Recusou'} FULL {h.quantidade_anterior:g} -> {h.quantidade_nova:g}",
                                {"embale_id": embale_id, "hist_id": h.id, "solicitante": h.solicitante})
        return JSONResponse({"sucesso": True, "status": h.status})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def listar_historico_full_embale(request: Request):
    """
    GET /api/embaldes/{embale_id}/historico-full
    Lista o histórico de mudanças na quantidade do FULL deste inbound
    (mais recentes primeiro).
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        registros = (db.query(HistoricoFullEmbale)
                     .filter(HistoricoFullEmbale.embale_id == embale_id)
                     .order_by(HistoricoFullEmbale.criado_em.desc())
                     .all())
        return JSONResponse({
            "embale_id": embale_id,
            "total": len(registros),
            "itens": [
                {
                    "id": h.id,
                    "item_id": h.item_id,
                    "titulo_anuncio": h.titulo_anuncio,
                    "sku_inbound": h.sku_inbound,
                    "quantidade_anterior": h.quantidade_anterior,
                    "quantidade_nova": h.quantidade_nova,
                    "tipo": h.tipo,
                    "status": h.status or "aprovado",
                    "solicitante": h.solicitante,
                    "decidido_por": h.decidido_por,
                    "criado_em": h.criado_em.isoformat() if h.criado_em else None,
                }
                for h in registros
            ]
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def marcar_em_espera_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/em-espera
    Marca/desmarca um item como "em espera" (bloqueado por fatores externos).
    Body: {"em_espera": 1 ou 0}
    Quando em espera, o item fica bloqueado para edição.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        data = await request.json()
        em_espera = int(data.get("em_espera", 0))

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        # Marcar/desmarcar em espera
        item.em_espera = em_espera
        if em_espera == 1:
            item.data_em_espera = datetime.utcnow()
        else:
            item.data_em_espera = None

        db.commit()
        _registrar_log_operacao(
            request,
            "item_inbound_em_espera" if em_espera == 1 else "item_inbound_retomado",
            "item_embale",
            item.id,
            f"Item {item.sku_inbound or item.titulo_anuncio} {'colocado em espera' if em_espera == 1 else 'retornado para fluxo ativo'}",
            {
                "embale_id": embale.id,
                "item_id": item.id,
                "em_espera": item.em_espera,
                "data_em_espera": item.data_em_espera.isoformat() if item.data_em_espera else None,
            },
        )

        return JSONResponse({
            "item_id": item.id,
            "em_espera": item.em_espera,
            "data_em_espera": item.data_em_espera.isoformat() if item.data_em_espera else None,
            "mensagem": "Em espera" if em_espera == 1 else "Voltando à ativa"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def marcar_nao_enviar_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/itens/{item_id}/nao-enviar
    Marca/desmarca um item como "não vai ser enviado".
    Body: {"nao_enviar": 1 ou 0}
    Quando excluído (1), o item sai da lista de separação mas continua no banco
    (aparece no Histórico FULL e pode ser trazido de volta). Sai também de
    "em espera". Não permite excluir item cuja baixa já foi aplicada.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        item_id = int(request.path_params.get("item_id"))
        data = await request.json()
        nao_enviar = int(data.get("nao_enviar", 0))

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        item = next((i for i in embale.itens if i.id == item_id), None)
        if not item:
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        if nao_enviar == 1 and item.baixa_aplicada == 1:
            return JSONResponse(
                {"erro": "Este item já teve a baixa aplicada — não dá para excluir da separação."},
                status_code=400,
            )

        item.nao_enviar = nao_enviar
        if nao_enviar == 1:
            item.data_nao_enviar = datetime.utcnow()
            # Excluir tira de "em espera" (sai da lista de separação de vez)
            item.em_espera = 0
            item.data_em_espera = None
        else:
            item.data_nao_enviar = None

        db.commit()
        _registrar_log_operacao(
            request,
            "item_inbound_excluido" if nao_enviar == 1 else "item_inbound_reincluido",
            "item_embale",
            item.id,
            f"Item {item.sku_inbound or item.titulo_anuncio} "
            f"{'excluído da separação (não enviar)' if nao_enviar == 1 else 'reincluído na separação'}",
            {
                "embale_id": embale.id,
                "item_id": item.id,
                "nao_enviar": item.nao_enviar,
                "data_nao_enviar": item.data_nao_enviar.isoformat() if item.data_nao_enviar else None,
            },
        )

        return JSONResponse({
            "item_id": item.id,
            "nao_enviar": item.nao_enviar,
            "data_nao_enviar": item.data_nao_enviar.isoformat() if item.data_nao_enviar else None,
            "mensagem": "Excluído da separação" if nao_enviar == 1 else "Reincluído na separação",
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def salvar_posicao_separacao(request: Request):
    """
    POST /api/embaldes/{embale_id}/posicao-separacao
    Salva no inbound o item onde a separação parou, para retomar de onde parou.
    Body: {"item_id": N}  (item_id pode ser null para limpar)
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        data = await request.json()
        item_id_raw = data.get("item_id")
        item_id = int(item_id_raw) if item_id_raw is not None else None

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        # Valida que o item pertence ao inbound (ignora silenciosamente se não)
        if item_id is not None and not any(i.id == item_id for i in embale.itens):
            return JSONResponse({"erro": "Item não encontrado neste inbound"}, status_code=404)

        embale.ultimo_item_separacao = item_id
        db.commit()
        return JSONResponse({"sucesso": True, "ultimo_item_separacao": item_id})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def listar_historico_completo_embale(request: Request):
    """
    GET /api/embaldes/{embale_id}/historico-completo
    Devolve, para um inbound:
      - em_espera: itens atualmente em espera (bloqueados)
      - alteracoes: TODA mudança da quantidade que vai pro FULL (aumento/redução)
    Alimenta a aba "Histórico FULL".
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        resumo_por_item = {i.id: _resumo_revisao_salva_item(i) for i in embale.itens}
        em_espera = [
            {
                "item_id": i.id,
                "titulo_anuncio": i.titulo_anuncio,
                "sku_inbound": i.sku_inbound,
                "quantidade_full": _quantidade_planejada_full(i),
                "estoque_atual": resumo_por_item.get(i.id, {}).get("estoque_atual"),
                "data_em_espera": i.data_em_espera.isoformat() if i.data_em_espera else None,
                "imagem": i.olist_imagem,
            }
            for i in embale.itens if (i.em_espera or 0) == 1 and (i.nao_enviar or 0) != 1
        ]
        em_espera.sort(key=lambda x: x["data_em_espera"] or "", reverse=True)

        # Itens excluídos da separação ("não vão ser enviados") — reversível.
        nao_enviar = [
            {
                "item_id": i.id,
                "titulo_anuncio": i.titulo_anuncio,
                "sku_inbound": i.sku_inbound,
                "quantidade_full": _quantidade_planejada_full(i),
                "estoque_atual": resumo_por_item.get(i.id, {}).get("estoque_atual"),
                "data_nao_enviar": i.data_nao_enviar.isoformat() if i.data_nao_enviar else None,
                "imagem": i.olist_imagem,
            }
            for i in embale.itens if (i.nao_enviar or 0) == 1
        ]
        nao_enviar.sort(key=lambda x: x["data_nao_enviar"] or "", reverse=True)

        registros = (db.query(HistoricoFullEmbale)
                     .filter(HistoricoFullEmbale.embale_id == embale_id)
                     .order_by(HistoricoFullEmbale.criado_em.desc())
                     .all())
        alteracoes = [
            {
                "id": h.id,
                "item_id": h.item_id,
                "titulo_anuncio": h.titulo_anuncio,
                "sku_inbound": h.sku_inbound,
                "quantidade_anterior": h.quantidade_anterior,
                "quantidade_nova": h.quantidade_nova,
                "estoque_atual": resumo_por_item.get(h.item_id, {}).get("estoque_atual"),
                "tipo": h.tipo,
                "status": h.status or "aprovado",
                "solicitante": h.solicitante,
                "decidido_por": h.decidido_por,
                "criado_em": h.criado_em.isoformat() if h.criado_em else None,
            }
            for h in registros
        ]

        return JSONResponse({
            "embale_id": embale.id,
            "nome_embalde": embale.nome_embalde,
            "numero_inbound": embale.numero_inbound,
            "em_espera": em_espera,
            "total_em_espera": len(em_espera),
            "nao_enviar": nao_enviar,
            "total_nao_enviar": len(nao_enviar),
            "alteracoes": alteracoes,
            "total_alteracoes": len(alteracoes),
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def encerrar_embale(request: Request):
    """
    POST /api/embaldes/{embale_id}/encerrar
    Encerra manualmente um inbound (para de descontar do estoque).
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        if embale.status == "encerrado":
            return JSONResponse({"erro": "Inbound já está encerrado"}, status_code=400)

        embale.status = "encerrado"
        embale.data_encerramento = datetime.utcnow()
        db.commit()
        _registrar_log_operacao(
            request,
            "inbound_encerrado",
            "embale",
            embale.id,
            f"Inbound #{embale.numero_inbound or embale.id} encerrado",
            {
                "embale_id": embale.id,
                "numero_inbound": embale.numero_inbound,
                "nome_embale": embale.nome_embalde,
                "data_encerramento": embale.data_encerramento.isoformat() if embale.data_encerramento else None,
            },
        )

        return JSONResponse({
            "id": embale.id,
            "status": embale.status,
            "data_encerramento": embale.data_encerramento.isoformat(),
            "mensagem": "Inbound encerrado"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def deletar_embale(request: Request):
    """
    DELETE /api/embaldes/{embale_id}
    Deleta permanentemente um inbound (geralmente encerrado).
    Remove o inbound e todos os seus itens da base de dados.
    """
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))

        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)

        # Deletar todos os itens do inbound (cascata automática via ORM)
        for item in embale.itens:
            db.delete(item)

        # Deletar o inbound
        db.delete(embale)
        db.commit()

        return JSONResponse({
            "id": embale_id,
            "mensagem": "Inbound deletado permanentemente"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def atualizar_nome_embale(request: Request):
    db = SessionLocal()
    try:
        embale_id = int(request.path_params.get("embale_id"))
        body = await request.json()
        nome_embale = (body.get("nome_embale") or "").strip()
        if not nome_embale:
            return JSONResponse({"erro": "Nome do inbound é obrigatório"}, status_code=400)
        embale = db.query(EmbaleFU).filter(EmbaleFU.id == embale_id).first()
        if not embale:
            return JSONResponse({"erro": "Inbound não encontrado"}, status_code=404)
        nome_anterior = embale.nome_embalde
        embale.nome_embalde = nome_embale
        db.commit()
        _registrar_log_operacao(
            request,
            "nome_inbound_atualizado",
            "embale",
            embale.id,
            f"Nome do inbound atualizado para {embale.nome_embalde}",
            {
                "embale_id": embale.id,
                "nome_anterior": nome_anterior,
                "nome_novo": embale.nome_embalde,
            },
        )
        return JSONResponse({"id": embale.id, "nome_embale": embale.nome_embalde, "mensagem": "Nome do inbound atualizado"})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/embaldes/reserva-produto", reserva_inbound_produto, methods=["GET"]),
    Route("/api/embaldes/buscar-no-inbound", buscar_no_inbound, methods=["GET"]),
    Route("/api/embaldes/upload", upload_embale, methods=["POST"]),
    Route("/api/embaldes", listar_embaldes, methods=["GET"]),
    Route("/api/embaldes/{embale_id}", obter_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}", deletar_embale, methods=["DELETE"]),
    Route("/api/embaldes/{embale_id}/nome", atualizar_nome_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/data-limite", atualizar_data_limite_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/revisao", revisar_baixa_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/confirmar-baixa", confirmar_baixa_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/baixa", baixa_item_individual, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/vincular", vincular_item_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/quantidade-full", ajustar_quantidade_full_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/balancear", balancear_item_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/kit", kit_componentes_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/balancear-kit", balancear_kit_componentes_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/baixar-kit", baixar_kit_componentes_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/desfazer", desfazer_item_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/historico-full", listar_historico_full_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/historico-full/{hist_id}/decidir", decidir_pedido_full_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/historico-completo", listar_historico_completo_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/posicao-separacao", salvar_posicao_separacao, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/em-espera", marcar_em_espera_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/nao-enviar", marcar_nao_enviar_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/encerrar", encerrar_embale, methods=["POST"]),
]
