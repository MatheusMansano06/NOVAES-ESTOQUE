"""Peças compartilhadas pelas rotas: banco, sessão do operador, integrações e utilitários."""
from starlette.routing import Route as _Route
from starlette.requests import Request
from starlette.concurrency import run_in_threadpool
from database import engine, Base, SessionLocal
import os
import json
import asyncio
import functools
import inspect
from datetime import datetime
from dotenv import load_dotenv
import unicodedata
from app.models import EmbaleFU, Operador, LogOperacao


def Route(path: str, endpoint, **kwargs) -> _Route:
    """Route das rotas da API. Os handlers async chamam código bloqueante (urllib,
    SQLite) sem await: no event loop único, cada chamada lenta ao ML/Olist travava
    o app inteiro. Aqui cada um roda numa thread com loop próprio; o corpo é lido
    antes, no loop principal (request.json()/form() reusam o corpo em cache)."""
    if inspect.iscoroutinefunction(endpoint):
        alvo = endpoint

        @functools.wraps(alvo)
        async def endpoint(request: Request):
            await request.body()
            return await run_in_threadpool(asyncio.run, alvo(request))
    return _Route(path, endpoint, **kwargs)


# Carregar variáveis de ambiente do arquivo .env
load_dotenv()

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
                ("nao_enviar", "INTEGER DEFAULT 0"),
                ("data_nao_enviar", "DATETIME"),
                ("olist_imagem", "TEXT"),
            ]
            for nome, tipo in migracoes_embale:
                if nome in {"foi_balanceado", "saldo_disponivel", "data_balanceamento", "em_espera", "data_em_espera", "nao_enviar", "data_nao_enviar", "olist_imagem"} and nome not in colunas_embale:
                    conn.exec_driver_sql(f"ALTER TABLE itens_embale_fu ADD COLUMN {nome} {tipo}")
                    print(f"[DB] Coluna itens_embale_fu.{nome} criada")

            colunas_hist = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(historico_full_embale)").fetchall()}
            for nome, tipo in (("status", "VARCHAR(20)"), ("solicitante", "VARCHAR(120)"),
                               ("decidido_por", "VARCHAR(120)"), ("decidido_em", "DATETIME")):
                if colunas_hist and nome not in colunas_hist:
                    conn.exec_driver_sql(f"ALTER TABLE historico_full_embale ADD COLUMN {nome} {tipo}")
                    print(f"[DB] Coluna historico_full_embale.{nome} criada")

            colunas_embale_header = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(embaldes_fu)").fetchall()}
            if "revisao_salva_em" not in colunas_embale_header:
                conn.exec_driver_sql("ALTER TABLE embaldes_fu ADD COLUMN revisao_salva_em DATETIME")
                print("[DB] Coluna embaldes_fu.revisao_salva_em criada")
            if "ultimo_item_separacao" not in colunas_embale_header:
                conn.exec_driver_sql("ALTER TABLE embaldes_fu ADD COLUMN ultimo_item_separacao INTEGER")
                print("[DB] Coluna embaldes_fu.ultimo_item_separacao criada")

            # Tarifa de venda do ML guardada no cache (margem sem chamada ao vivo)
            colunas_ml = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(ml_item_cache)").fetchall()}
            for nome, tipo in [("tarifa_valor", "FLOAT"), ("tarifa_pct", "FLOAT"), ("tarifa_fixo", "FLOAT"), ("date_created", "DATETIME"), ("inventory_ids_json", "TEXT"), ("embalagem_baixa_vendidos", "INTEGER"), ("catalog_listing", "INTEGER")]:
                if colunas_ml and nome not in colunas_ml:
                    conn.exec_driver_sql(f"ALTER TABLE ml_item_cache ADD COLUMN {nome} {tipo}")
                    print(f"[DB] Coluna ml_item_cache.{nome} criada")

            colunas_operadores = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(operadores)").fetchall()}
            if colunas_operadores and "pin_hash" not in colunas_operadores:
                conn.exec_driver_sql("ALTER TABLE operadores ADD COLUMN pin_hash TEXT")
                print("[DB] Coluna operadores.pin_hash criada")

    except Exception as e:
        print(f"[DB] Aviso ao garantir colunas SQLite: {e}")


_garantir_colunas_sqlite()

OPERADORES_PADRAO = ["Rafael", "Wellington", "Cris", "Cristofer", "Nathan", "Luisa"]


def _seed_operadores_padrao():
    db = SessionLocal()
    try:
        existentes = {str(nome).strip().lower() for (nome,) in db.query(Operador.nome).all()}
        alterou = False
        for nome in OPERADORES_PADRAO:
            chave = nome.strip().lower()
            if chave in existentes:
                continue
            db.add(Operador(nome=nome.strip(), ativo=1))
            alterou = True
        if alterou:
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"[OPERADORES] Falha ao seedar operadores padrão: {e}")
    finally:
        db.close()


def _operador_contexto(request: Request) -> dict:
    """Identidade vem só da sessão assinada (seguranca.ProtecaoApi), nunca de header."""
    sessao = request.scope.get("sessao") or {}
    return {
        "operador_id": str(sessao["id"]) if sessao.get("id") is not None else None,
        "operador_nome": sessao.get("nome") or "Nao identificado",
        "operador_role": sessao.get("papel") or "operador",
    }


def _request_eh_master(request: Request) -> bool:
    return _operador_contexto(request).get("operador_role") == "master"


def _registrar_log_operacao(
    request: Request,
    acao: str,
    entidade_tipo: str | None = None,
    entidade_id: str | int | None = None,
    descricao: str | None = None,
    detalhes: dict | None = None,
):
    ctx = _operador_contexto(request)
    db = SessionLocal()
    try:
        operador_id = None
        if ctx["operador_id"]:
            try:
                operador_id = int(ctx["operador_id"])
            except (TypeError, ValueError):
                operador_id = None

        if operador_id is None and ctx["operador_role"] != "master" and ctx["operador_nome"]:
            operador = db.query(Operador).filter(Operador.nome == ctx["operador_nome"]).first()
            operador_id = operador.id if operador else None

        db.add(LogOperacao(
            operador_id=operador_id,
            operador_nome=ctx["operador_nome"],
            operador_role=ctx["operador_role"],
            acao=acao,
            entidade_tipo=entidade_tipo,
            entidade_id=None if entidade_id is None else str(entidade_id),
            descricao=descricao,
            detalhes_json=json.dumps(detalhes, ensure_ascii=False) if detalhes else None,
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[AUDITORIA] Falha ao registrar log '{acao}': {e}")
    finally:
        db.close()


_seed_operadores_padrao()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_PAGINATION_LIMIT = 1000  # Limite máximo de itens por página


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


def _itens_full_reduzidos(db, olist_produto_id, olist_sku):
    """Itens ainda sem baixa, em inbound ativo, deste produto, cujo Vai pro FULL está
    ABAIXO do original do PDF (ex.: zerado por falta de estoque). A conferência da NF
    pergunta se quer segurar o original — nunca restaura sozinha."""
    pid = str(olist_produto_id) if olist_produto_id else None
    sku = (olist_sku or "").strip().lower()
    if not pid and not sku:
        return []
    saida = []
    for emb in db.query(EmbaleFU).filter(EmbaleFU.status != "encerrado").all():
        for it in emb.itens:
            if it.baixa_aplicada == 1 or (it.nao_enviar or 0) == 1:
                continue
            casa = (pid and it.olist_produto_id and str(it.olist_produto_id) == pid) or \
                   (sku and it.sku_inbound and it.sku_inbound.strip().lower() == sku)
            if not casa:
                continue
            original = float(it.quantidade_separada or 0)
            atual = _quantidade_planejada_full(it)
            if atual < original:
                saida.append({"inbound_id": emb.id, "numero_inbound": emb.numero_inbound,
                              "nome_inbound": emb.nome_embalde, "item_id": it.id,
                              "titulo": it.titulo_anuncio, "original": original, "atual": atual})
    return saida


def _quantidade_planejada_full(item) -> float:
    """Quantidade planejada para este item ir ao FULL."""
    if item.quantidade_baixar is None:
        return float(item.quantidade_separada or 0)
    return max(0.0, float(item.quantidade_baixar or 0))
