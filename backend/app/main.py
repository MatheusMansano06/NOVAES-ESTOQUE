from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.responses import JSONResponse, FileResponse, RedirectResponse, HTMLResponse, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from sqlalchemy.orm import Session
from database import engine, Base, SessionLocal
import os
import json
from datetime import datetime, timedelta
import uuid
import urllib.request
import urllib.parse
from dotenv import load_dotenv
from difflib import SequenceMatcher
import unicodedata
import io

from app.models import (
    NotaFiscal, ItemEstoque, ConfirmacaoEstoque, StatusEstoque, VinculoOlist,
    Fornecedor, HistoricoCompra, ConfiguracaoEstoqueMinimo, NotificacaoFornecedor,
    EmbaleFU, ItemEmbaleFU, ApelidoFornecedor, PrecoVendaProduto,
    MercadoLivreItemCache, MercadoLivreSyncState, HistoricoFullEmbale,
    CustoProduto
)
from app.utils.nfe_parser import NFeParsing
from app.utils.nfe_pdf_generator import NFePDFGenerator
from app.utils.embale_parser import extrair_items_embale_pdf
from app.integracoes_olist import olist
from app.integracoes_ml import ml
from app.jobs import iniciar_scheduler

# Carregar variáveis de ambiente do arquivo .env
load_dotenv()

# Create tables
Base.metadata.create_all(bind=engine)


def _garantir_colunas_sqlite():
    """Aplica migrações leves em SQLite sem depender de Alembic."""
    db_url = os.getenv("DATABASE_URL", "")
    if "sqlite" not in db_url:
        return
    try:
        with engine.begin() as conn:
            colunas = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(itens_estoque)").fetchall()}
            if "quantidade_olist_enviada" not in colunas:
                conn.exec_driver_sql("ALTER TABLE itens_estoque ADD COLUMN quantidade_olist_enviada FLOAT")
                print("[DB] Coluna itens_estoque.quantidade_olist_enviada criada")

            # Frete pago na compra (cálculo de margem)
            colunas_nf = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(notas_fiscais)").fetchall()}
            if "valor_frete" not in colunas_nf:
                conn.exec_driver_sql("ALTER TABLE notas_fiscais ADD COLUMN valor_frete FLOAT DEFAULT 0")
                print("[DB] Coluna notas_fiscais.valor_frete criada")

            # Colunas do recurso de Balanço (correção de erros passados)
            colunas_embale = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(itens_embale_fu)").fetchall()}
            migracoes_embale = [
                ("foi_balanceado", "INTEGER DEFAULT 0"),
                ("saldo_disponivel", "FLOAT"),
                ("data_balanceamento", "DATETIME"),
                ("revisao_salva_em", "DATETIME"),
                ("em_espera", "INTEGER DEFAULT 0"),
                ("data_em_espera", "DATETIME"),
            ]
            for nome, tipo in migracoes_embale:
                if nome in {"foi_balanceado", "saldo_disponivel", "data_balanceamento", "em_espera", "data_em_espera"} and nome not in colunas_embale:
                    conn.exec_driver_sql(f"ALTER TABLE itens_embale_fu ADD COLUMN {nome} {tipo}")
                    print(f"[DB] Coluna itens_embale_fu.{nome} criada")

            colunas_embale_header = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(embaldes_fu)").fetchall()}
            if "revisao_salva_em" not in colunas_embale_header:
                conn.exec_driver_sql("ALTER TABLE embaldes_fu ADD COLUMN revisao_salva_em DATETIME")
                print("[DB] Coluna embaldes_fu.revisao_salva_em criada")
            if "ultimo_item_separacao" not in colunas_embale_header:
                conn.exec_driver_sql("ALTER TABLE embaldes_fu ADD COLUMN ultimo_item_separacao INTEGER")
                print("[DB] Coluna embaldes_fu.ultimo_item_separacao criada")

            # Tarifa de venda do ML guardada no cache (margem sem chamada ao vivo)
            colunas_ml = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(ml_item_cache)").fetchall()}
            for nome, tipo in [("tarifa_valor", "FLOAT"), ("tarifa_pct", "FLOAT"), ("tarifa_fixo", "FLOAT")]:
                if colunas_ml and nome not in colunas_ml:
                    conn.exec_driver_sql(f"ALTER TABLE ml_item_cache ADD COLUMN {nome} {tipo}")
                    print(f"[DB] Coluna ml_item_cache.{nome} criada")
    except Exception as e:
        print(f"[DB] Aviso ao garantir colunas SQLite: {e}")


_garantir_colunas_sqlite()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Cache para armazenar access_token da Olist
olist_access_token_cache = {"token": None, "expires_at": None}

# 📋 Constantes de configuração
MIN_AUTO_CONFIDENCE = 0.95  # Vincular automaticamente apenas com 95%+ de confiança
MIN_FUZZY_CONFIDENCE = 0.80  # Sugerir vinculação com 80%+ de confiança
MAX_PAGINATION_LIMIT = 1000  # Limite máximo de itens por página

def obter_olist_access_token():
    """Obtém access_token da Olist usando OAuth"""
    global olist_access_token_cache

    from datetime import datetime, timedelta

    # Se temos token em cache e ainda está válido, usa ele
    if olist_access_token_cache["token"] and olist_access_token_cache["expires_at"]:
        if datetime.utcnow() < datetime.fromisoformat(olist_access_token_cache["expires_at"]):
            return olist_access_token_cache["token"]

    # Caso contrário, faz requisição para obter novo token
    client_id = os.getenv("OLIST_CLIENT_ID", "")
    client_secret = os.getenv("OLIST_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        return None

    try:
        url = "https://accounts.olist.com/api/v1/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials"
        }

        post_data = json.dumps(data).encode('utf-8')
        headers = {
            "Content-Type": "application/json"
        }

        req = urllib.request.Request(url, data=post_data, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=10) as response:
            resposta = json.loads(response.read().decode('utf-8'))

            if "access_token" in resposta:
                token = resposta["access_token"]
                expires_in = resposta.get("expires_in", 3600)
                expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()

                olist_access_token_cache["token"] = token
                olist_access_token_cache["expires_at"] = expires_at

                print(f"[INFO] Novo token Olist obtido, expira em {expires_in}s")
                return token
    except Exception as e:
        print(f"[ERRO] Falha ao obter token Olist: {e}")
        return None

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


async def root(request: Request):
    return JSONResponse({"message": "Estoque Virtual API - Phase 1"})

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
            # Save temp file for OCR processing
            temp_path = os.path.join(UPLOAD_DIR, safe_filename)
            with open(temp_path, "wb") as f:
                f.write(content)
            result = NFeParsing.parse_pdf_ocr(temp_path)

        if not result.get("sucesso"):
            return JSONResponse({"error": result.get('erro')}, status_code=400)

        db = SessionLocal()
        try:
            # Create NF record
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

            # Create items
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

async def get_estoque_virtual(request: Request):
    """Get consolidated virtual inventory - sum of all products"""
    from sqlalchemy.orm import joinedload
    db = SessionLocal()
    try:
        # ⚡ PERFORMANCE: Usar joinedload para evitar N+1 queries
        # Get all items grouped by product description
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

            # Add NF reference
            nf = item.nota_fiscal
            estoque_consolidado[desc]["notas_fiscais"].append({
                "numero_nf": nf.numero_nf,
                "serie": nf.serie,
                "fornecedor": nf.fornecedor,
                "quantidade": item.quantidade_nf
            })

        # Convert to list
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

        # Update item with confirmation
        item.quantidade_confirmada = quantidade_confirmada
        item.divergencia = divergencia
        # Marcar como conferido (confirmado) quando nao ha divergencia
        if not divergencia:
            item.status = StatusEstoque.CONFIRMADO

        # Create confirmation record
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

        # Update item with confirmation
        item.quantidade_confirmada = quantidade_confirmada
        item.divergencia = tipo_divergencia
        # Mark as bloqueado when there's a divergence (needs review)
        item.status = StatusEstoque.BLOQUEADO

        # Create confirmation record
        confirmacao = ConfirmacaoEstoque(
            item_estoque_id=item_id,
            quantidade_confirmada=quantidade_confirmada,
            divergencia=tipo_divergencia,
            observacoes=observacoes
        )

        db.add(confirmacao)
        db.commit()

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


_STOPWORDS_TITULO = {
    "de", "da", "do", "com", "para", "por", "em", "no", "na", "kit",
    "un", "und", "pç", "pc", "pcs", "und.", "modelo", "original", "tipo",
}


def _normalizar_tokens(texto):
    """Quebra um título em tokens significativos (sem acento, minúsculo,
    sem pontuação/números/stopwords) para comparar produtos."""
    if not texto:
        return []
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    limpo = "".join(c if c.isalnum() else " " for c in t)
    toks = []
    for w in limpo.split():
        if len(w) <= 2 or w.isdigit() or w in _STOPWORDS_TITULO:
            continue
        toks.append(w)
    return toks


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

            qtd_sep = it.quantidade_separada or 0
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


def _calcular_reserva_inbound(db, olist_produto_id, olist_sku, disponivel=None,
                              aplicar=False, agora=None, olist_nome=None):
    """
    REGRA DO INBOUND: verifica inbounds ATIVOS (não encerrados) que contêm
    este produto e ainda NÃO deram baixa, e calcula quanto da entrada deve
    ser "segurado" para o FULL (em vez de subir tudo pra Olist).

    - Casa por olist_produto_id (preferência) ou por SKU do inbound.
    - Ignora itens que JÁ deram baixa (baixa_aplicada=1) -> não desconta 2x.
    - Considera o que já foi segurado antes (quantidade_baixada) em entradas
      anteriores do mesmo produto (segura parcial e completa nas próximas).
    - 'disponivel': se informado, limita o total segurado à qtd que chegou
      (NF pequena não segura mais do que tem). Se None = reserva teórica total.

    Se aplicar=True: marca os itens do inbound (quantidade_baixada cresce;
    baixa_aplicada=1 só quando cobre todo o FULL). NÃO commita.

    Retorna (reserva_total, detalhes[]).
    """
    reserva_total = 0.0
    detalhes = []

    pid = str(olist_produto_id) if olist_produto_id else None
    sku = (olist_sku or "").strip().lower()
    if not pid and not sku:
        return 0.0, []

    restante = float(disponivel) if disponivel is not None else None

    ativos = db.query(EmbaleFU).filter(EmbaleFU.status != "encerrado").all()
    for emb in ativos:
        for it in emb.itens:
            if restante is not None and restante <= 0:
                break
            if it.baixa_aplicada == 1:
                continue  # já deu baixa -> não aplica a regra

            casa = False
            if pid and it.olist_produto_id and str(it.olist_produto_id) == pid:
                casa = True
            elif sku and it.sku_inbound and it.sku_inbound.strip().lower() == sku:
                casa = True
            if not casa:
                continue

            ja_segurado = it.quantidade_baixada or 0
            quantidade_planejada = _quantidade_planejada_full(it)
            falta_segurar = quantidade_planejada - ja_segurado
            if falta_segurar <= 0:
                continue

            if restante is not None:
                segurar = min(restante, falta_segurar)
            else:
                segurar = falta_segurar
            if segurar <= 0:
                continue

            reserva_total += segurar
            completo = (ja_segurado + segurar) >= quantidade_planejada
            detalhes.append({
                "inbound_id": emb.id,
                "numero_inbound": emb.numero_inbound,
                "nome_inbound": emb.nome_embalde,
                "item_id": it.id,
                "titulo": it.titulo_anuncio,
                "sku": it.sku_inbound,
                "segurar": segurar,
                "full_total": quantidade_planejada,
                "completo": completo,
            })

            if aplicar:
                it.quantidade_baixada = ja_segurado + segurar
                it.data_baixa = agora or datetime.utcnow()
                if completo:
                    it.baixa_aplicada = 1
                if pid and not it.olist_produto_id:
                    it.olist_produto_id = pid
                if olist_sku and not it.olist_sku:
                    it.olist_sku = olist_sku
                # Marca o item do inbound como VINCULADO (subir estoque pela NF
                # também liga o anúncio aqui — senão aparecia "Sem vínculo").
                if olist_nome and not it.olist_nome:
                    it.olist_nome = olist_nome
                it.validado = 1
                it.validacao_mensagem = None
                db.add(it)

            if restante is not None:
                restante -= segurar

    return reserva_total, detalhes


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
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


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


async def olist_deletar_vinculo(request: Request):
    """Remove um vínculo salvo da memória"""
    db = SessionLocal()
    try:
        data = await request.json()
        vinculo_id = data.get("id")
        v = db.query(VinculoOlist).filter(VinculoOlist.id == vinculo_id).first()
        if not v:
            return JSONResponse({"error": "Vínculo não encontrado"}, status_code=404)
        db.delete(v)
        db.commit()
        return JSONResponse({"sucesso": True, "mensagem": "Vínculo removido"})
    except Exception as e:
        db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
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
                    "validacao_mensagem": i.validacao_mensagem
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

        if data_limite_str:
            try:
                embale.data_limite = datetime.strptime(data_limite_str[:10], "%Y-%m-%d")
            except ValueError:
                return JSONResponse({"erro": "Data limite inválida"}, status_code=400)
        else:
            embale.data_limite = None

        db.commit()
        return JSONResponse({
            "id": embale.id,
            "data_limite": embale.data_limite.isoformat() if embale.data_limite else None,
            "mensagem": "Data limite atualizada"
        })

    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


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


def _quantidade_planejada_full(item) -> float:
    """Quantidade planejada para este item ir ao FULL."""
    if item.quantidade_baixar is None:
        return float(item.quantidade_separada or 0)
    return max(0.0, float(item.quantidade_baixar or 0))


def _progresso_item_full(item) -> tuple[float, float]:
    """Retorna (planejado, realizado) para progresso persistido do inbound."""
    planejado = _quantidade_planejada_full(item)
    realizado = min(max(0.0, float(item.quantidade_baixada or 0)), planejado)
    return planejado, realizado


def _marcar_historico_full(db, embale_id, revisao):
    """Marca cada item da revisão com tem_historico_full = True quando houve
    qualquer mudança registrada na quantidade do FULL daquele item."""
    try:
        ids = {row[0] for row in db.query(HistoricoFullEmbale.item_id)
               .filter(HistoricoFullEmbale.embale_id == embale_id).all()}
    except Exception:
        ids = set()
    for r in revisao:
        r["tem_historico_full"] = r.get("item_id") in ids


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

        itens = list(embale.itens)
        force_refresh = request.query_params.get("refresh", "").strip().lower() in {"1", "true", "yes", "sim"}

        if embale.revisao_salva_em and not force_refresh:
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
        return {
            "item_id": item.id, "status": "zerado",
            "mensagem": "Quantidade a baixar é zero"
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

        # Salva o vínculo no item
        item.olist_produto_id = str(olist_produto_id)
        item.olist_sku = olist_sku
        item.olist_nome = olist_nome
        item.validado = 1
        item.validacao_mensagem = None
        item.data_validacao = datetime.utcnow()
        item.olist_estoque_antes = None
        item.falta = None
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
        return JSONResponse({
            "sucesso": True,
            "item_id": item_id,
            "olist_produto_id": str(olist_produto_id),
            "olist_nome": olist_nome,
            "mensagem": f"Vinculado a: {olist_nome}"
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
            ))

        db.commit()

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
            db.add(item)
            db.commit()
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
                "baixa_status": "nao_baixado_divergencia",
                "mensagem": f"Olist corrigida para {quantidade_real:g} un. Faltam {item.falta:g} un para o FULL ({qtd_full:g}). Item segue divergente — notifique no WhatsApp."
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


async def kit_componentes_embale(request: Request):
    """
    GET /api/embaldes/{embale_id}/itens/{item_id}/kit
    Detecta se o item do inbound é um KIT na Olist e devolve os componentes
    (anúncios unitários) com a quantidade sugerida para baixar pro FULL.
    A Olist não deixa baixar o estoque de um kit direto — a baixa tem que ser
    feita em cada componente.
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

        sku = (item.olist_sku or item.sku_inbound or "").strip()
        qtd_full = _quantidade_planejada_full(item)

        # DEBUG temporário: ?debug=1 devolve a estrutura crua do produto na Olist
        # para descobrir onde a composição/kit está representada na API v3.
        if request.query_params.get("debug") and item.olist_produto_id:
            detalhe = olist.obter_detalhes_completo(str(item.olist_produto_id)) or {}
            achados = {k: detalhe.get(k) for k in detalhe.keys()
                       if any(t in k.lower() for t in ("kit", "compos", "estrut", "produc", "tipo"))}
            return JSONResponse({
                "_debug": True,
                "produto_id": item.olist_produto_id,
                "tipo": detalhe.get("tipo"),
                "chaves": sorted(list(detalhe.keys())),
                "campos_relevantes": achados,
            })

        if not sku:
            return JSONResponse({"eh_kit": False, "motivo": "Item sem SKU Olist", "qtd_full": qtd_full})

        info = olist.detectar_e_buscar_kit(sku) or {}
        if not info.get("eh_kit"):
            return JSONResponse({"eh_kit": False, "tipo": info.get("tipo"), "qtd_full": qtd_full})

        componentes = []
        for c in info.get("componentes", []):
            por_kit = float(c.get("quantidade_no_kit") or 1)
            componentes.append({
                "produto_id": str(c.get("id") or ""),
                "sku": c.get("sku") or "",
                "descricao": c.get("nome") or c.get("descricao") or "",
                "estoque_atual": c.get("estoque_atual"),
                "quantidade_no_kit": por_kit,
                # Sugestão = quantos de cada componente para o total de kits do FULL
                "quantidade_sugerida": int(round(por_kit * qtd_full)),
            })

        return JSONResponse({
            "eh_kit": True,
            "nome_kit": info.get("nome_kit"),
            "sku_kit": info.get("sku_principal") or sku,
            "qtd_full": qtd_full,
            "componentes": componentes,
        }, headers={"Cache-Control": "no-store"})
    except Exception as e:
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

        em_espera = [
            {
                "item_id": i.id,
                "titulo_anuncio": i.titulo_anuncio,
                "sku_inbound": i.sku_inbound,
                "quantidade_full": _quantidade_planejada_full(i),
                "data_em_espera": i.data_em_espera.isoformat() if i.data_em_espera else None,
            }
            for i in embale.itens if (i.em_espera or 0) == 1
        ]
        em_espera.sort(key=lambda x: x["data_em_espera"] or "", reverse=True)

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
                "tipo": h.tipo,
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
            if row:
                row.custo = custo
                row.imposto_pct = imposto
                row.atualizado_em = datetime.utcnow()
            else:
                db.add(CustoProduto(produto_chave=sku, custo=custo, imposto_pct=imposto))
            salvos += 1

        db.commit()
        return JSONResponse({"ok": True, "salvos": salvos, "ignorados": ignorados})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


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
        embale.nome_embalde = nome_embale
        db.commit()
        return JSONResponse({"id": embale.id, "nome_embale": embale.nome_embalde, "mensagem": "Nome do inbound atualizado"})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


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


routes = [
    Route("/api/health", root, methods=["GET"]),
    Route("/api/apelidos-fornecedores", apelidos_fornecedores, methods=["GET", "POST"]),
    Route("/api/notas-fiscais/{id:int}/frete", atualizar_frete_nota, methods=["POST"]),
    Route("/api/precos-venda", precos_venda, methods=["GET", "POST"]),
    Route("/api/custos", custos_produto, methods=["GET", "POST"]),
    Route("/api/ml/status", ml_status, methods=["GET"]),
    Route("/api/ml/sync", ml_sync_cache, methods=["POST"]),
    Route("/api/ml/anuncios", ml_anuncios, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}", ml_anuncio_detalhes, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/description", ml_anuncio_descricao, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/attributes", ml_anuncio_atributos, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/dimensions", ml_anuncio_dimensoes, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/precos-quantidade", ml_anuncio_precos_quantidade, methods=["GET", "POST"]),
    Route("/api/ml/anuncios/{item_id:str}/preco-resumo", ml_anuncio_preco_resumo, methods=["GET"]),
    Route("/api/ml/anuncios/{item_id:str}/preco", ml_anuncio_aplicar_preco, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/pictures/upload", ml_anuncio_imagens_upload, methods=["POST"]),
    Route("/api/ml/anuncios/{item_id:str}/pictures", ml_anuncio_imagens_reordenar, methods=["POST"]),
    Route("/api/ml/precificacao", ml_precificacao, methods=["GET"]),
    Route("/api/ml/margens", ml_margens, methods=["POST"]),
    Route("/api/ml/imagens", ml_imagens, methods=["GET"]),
    Route("/api/ml/conectar", ml_conectar, methods=["GET"]),
    Route("/api/ml/callback", ml_callback, methods=["GET"]),
    Route("/api/upload-nfe", upload_nfe, methods=["POST"]),
    Route("/api/notas-fiscais", get_nfs, methods=["GET"]),
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
    Route("/api/produtos-manuais", adicionar_produto_manual, methods=["POST"]),
    Route("/api/resolver-divergencia", resolver_divergencia, methods=["POST"]),
    Route("/api/deletar-divergencia", deletar_divergencia, methods=["POST"]),
    # Integração Olist (OAuth2)
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
    Route("/api/embaldes/reserva-produto", reserva_inbound_produto, methods=["GET"]),
    Route("/api/embaldes/buscar-no-inbound", buscar_no_inbound, methods=["GET"]),
    Route("/api/olist/adicionar-manual", adicionar_produto_olist_manual, methods=["POST"]),
    # Memória de vínculos (de-para fornecedor -> Olist)
    Route("/api/olist/sugestao-vinculo", olist_sugestao_vinculo, methods=["GET"]),
    Route("/api/olist/vinculos", olist_listar_vinculos, methods=["GET"]),
    Route("/api/olist/vinculos/deletar", olist_deletar_vinculo, methods=["POST"]),
    # Inbound / Lista de Separação para FU
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
    Route("/api/embaldes/{embale_id}/itens/{item_id}/baixar-kit", baixar_kit_componentes_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/historico-full", listar_historico_full_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/historico-completo", listar_historico_completo_embale, methods=["GET"]),
    Route("/api/embaldes/{embale_id}/posicao-separacao", salvar_posicao_separacao, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/itens/{item_id}/em-espera", marcar_em_espera_embale, methods=["POST"]),
    Route("/api/embaldes/{embale_id}/encerrar", encerrar_embale, methods=["POST"]),
]

async def _on_startup():
    """Inicia o scheduler de jobs (encerramento de inbounds, notificações)."""
    try:
        iniciar_scheduler()
    except Exception as e:
        print(f"[ERRO] Falha ao iniciar scheduler: {e}")


# Serve o frontend compilado (dist) como SPA na raiz "/", se existir.
# Fica DEPOIS de todas as rotas /api, entao a API tem prioridade.
from starlette.staticfiles import StaticFiles
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(STATIC_DIR):
    routes.append(Mount("/", app=StaticFiles(directory=STATIC_DIR, html=True), name="frontend"))

app = Starlette(routes=routes, on_startup=[_on_startup])

# Add CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5176",
        "http://localhost:5177",
        "http://127.0.0.1:5177",
        "http://localhost:5178",
        "http://127.0.0.1:5178",
        "http://localhost:5179",
        "http://127.0.0.1:5179",
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5181",
        "http://127.0.0.1:5181",
        "http://localhost:5182",
        "http://127.0.0.1:5182",
        "http://localhost:5183",
        "http://127.0.0.1:5183",
        "http://localhost:5184",
        "http://127.0.0.1:5184",
        "http://localhost:5185",
        "http://127.0.0.1:5185",
        "http://localhost:5186",
        "http://127.0.0.1:5186",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
