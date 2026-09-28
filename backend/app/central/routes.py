"""Rotas da Central de Devoluções, montadas em /api/central no app do estoque.

Erro vira JSON que a tela entende: {"detail": ...} (404 não existe, 409 já feito na Olist, 422 dado inválido) ou
{"erro": ...} com 502 quando a falha é da plataforma (ML/Shopee/Olist fora do ar ou recusando)."""

import json
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, Response
from starlette.routing import Route

from app.central import agenda, progresso
from app.central.bi import servico as bi
from app.central.conferencia import servico as conferencia
from app.central.db import Base, Sessao, engine
from app.central.devolucoes.modelo import Devolucao
from app.central.devolucoes.servico import publico
from app.central.financeiro import custos
from app.central.mediacoes import servico as mediacoes
from app.central.mercado_livre.sincronizar import sincronizar as sincronizar_ml
from app.central.olist import servico as olist
from app.central.operacao import servico as operacao
from app.central import respostas_prontas
from app.central import retirada_full
from app.central.shopee.sincronizar import sincronizar as sincronizar_shopee
from app.central.shopee.sincronizar import sincronizar_falha_entrega

# ponytail: create_all só cria tabela nova; coluna nova em tabela existente exige migração à mão.
Base.metadata.create_all(engine)


def _serializar(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(f"{type(o).__name__} não é serializável")


def _json(dados, status: int = 200) -> Response:
    return Response(json.dumps(dados, default=_serializar, ensure_ascii=False), status_code=status,
                    media_type="application/json")


def _rota(caminho: str, fn, metodo: str = "GET") -> Route:
    """fn(request) é async e devolve os dados (ou uma Response pronta)."""
    async def handler(request: Request) -> Response:
        try:
            dados = await fn(request)
        except conferencia.Travada as e:
            return _json({"detail": str(e)}, 409)
        except LookupError as e:
            return _json({"detail": str(e)}, 404)
        except ValueError as e:
            return _json({"detail": str(e)}, 422)
        except RuntimeError as e:
            return _json({"erro": str(e)}, 502)
        return dados if isinstance(dados, Response) else _json(dados)
    return Route(f"/api/central{caminho}", handler, methods=[metodo])


def _q(request: Request, nome: str, padrao=None, tipo=str, minimo=None, maximo=None):
    bruto = request.query_params.get(nome)
    if bruto in (None, ""):
        return padrao
    try:
        valor = (bruto.lower() in ("1", "true", "sim")) if tipo is bool else tipo(bruto)
    except ValueError:
        raise ValueError(f"Parâmetro {nome} inválido: {bruto!r}")
    if (minimo is not None and valor < minimo) or (maximo is not None and valor > maximo):
        raise ValueError(f"Parâmetro {nome} fora do intervalo [{minimo}, {maximo}]")
    return valor


async def _corpo(request: Request) -> dict:
    try:
        dados = await request.json()
    except ValueError:
        raise ValueError("Corpo JSON inválido")
    if not isinstance(dados, dict):
        raise ValueError("Corpo JSON deve ser um objeto")
    return dados


def _id(request: Request) -> int:
    return request.path_params["id"]


def _texto_opcional(dados: dict, campo: str) -> str | None:
    valor = dados.get(campo)
    if valor is not None and not isinstance(valor, str):
        raise ValueError(f"{campo} deve ser texto")
    return valor


# ---------- Devoluções ----------

def _listar_devolucoes(plataforma, etapa, destino, limit) -> list[dict]:
    q = select(Devolucao).order_by(Devolucao.atualizada_em.desc()).limit(limit)
    if plataforma:
        q = q.where(Devolucao.plataforma == plataforma)
    if etapa:
        q = q.where(Devolucao.etapa == etapa)
    if destino:
        q = q.where(Devolucao.destino == destino)
    with Sessao() as s:
        return [publico(d) for d in s.scalars(q)]


async def listar_devolucoes(request: Request):
    return await run_in_threadpool(_listar_devolucoes, _q(request, "plataforma"), _q(request, "etapa"),
                                   _q(request, "destino"), _q(request, "limit", 100, int, 1, 1000))


def _por_rastreio(codigo: str) -> list[dict]:
    with Sessao() as s:
        return [publico(d) for d in s.scalars(select(Devolucao).where(Devolucao.rastreio == codigo.strip()))]


async def por_rastreio(request: Request):
    """O que o leitor de código de barras chama: acha a devolução pela etiqueta."""
    return await run_in_threadpool(_por_rastreio, request.path_params["codigo"])


# ---------- Conferência ----------

BOOLEANOS_CONSTATACAO = ("produto_correto", "completo", "sem_uso", "revendavel")


def _constatacao(dados: dict) -> dict:
    for campo in BOOLEANOS_CONSTATACAO:
        if not isinstance(dados.get(campo), bool):
            raise ValueError(f"{campo} é obrigatório (true/false)")
    erro_nosso = dados.get("erro_nosso", False)
    if not isinstance(erro_nosso, bool):
        raise ValueError("erro_nosso deve ser true/false")
    return {
        **{c: dados[c] for c in BOOLEANOS_CONSTATACAO},
        "erro_nosso": erro_nosso,
        "sku_recebido": _texto_opcional(dados, "sku_recebido"),
        "observacao": _texto_opcional(dados, "observacao"),
    }


async def conferencia_buscar(request: Request):
    """Bipou a etiqueta: devolução + pedido/NF/custo na Olist + conferência e evidências já registradas."""
    return await run_in_threadpool(conferencia.buscar, request.path_params["codigo"], _q(request, "etiqueta"))


async def conferencia_registrar(request: Request):
    resultado = await run_in_threadpool(conferencia.registrar, _id(request), _constatacao(await _corpo(request)))
    from app.main import _registrar_log_operacao  # import tardio: main.py importa este módulo, evita ciclo
    await run_in_threadpool(
        _registrar_log_operacao, request, "conferencia_devolucao", "devolucao", _id(request),
        f"{resultado['plataforma']} · classe {resultado['classe']}",
        {"plataforma": resultado["plataforma"], "pedido": resultado["pedido"], "classe": resultado["classe"],
         "contestar": resultado["contestar"], "chamado_manual": resultado["chamado_manual"]})
    return resultado


async def conferencia_lancar_estoque(request: Request):
    """Clique do operador. via_olist: já fez o "devolver produtos" na Olist (estoque no Geral + NF)."""
    via_olist = (await _corpo(request)).get("via_olist") is True
    return await run_in_threadpool(conferencia.lancar_estoque, _id(request), via_olist)


async def conferencia_chamado_manual(request: Request):
    """Guarda a devolução na lista de chamados a abrir à mão (a plataforma não deixou pela API)."""
    await run_in_threadpool(conferencia.enviar_para_chamado_manual, _id(request))
    return None


async def conferencia_chamado_aberto(request: Request):
    dados = await _corpo(request)
    return await run_in_threadpool(conferencia.registrar_chamado_aberto, _id(request),
                                   _texto_opcional(dados, "protocolo"), _texto_opcional(dados, "observacao"))


async def conferencia_evidencia(request: Request):
    form = await request.form()
    arquivo = form.get("arquivo")
    if arquivo is None or not hasattr(arquivo, "file"):
        raise ValueError("Envie o arquivo no campo 'arquivo'")
    try:
        return await run_in_threadpool(conferencia.salvar_evidencia, _id(request), arquivo.content_type, arquivo.file)
    finally:
        await arquivo.close()


async def conferencia_ver_evidencia(request: Request):
    return FileResponse(await run_in_threadpool(conferencia.arquivo_evidencia, _id(request)))


# ---------- Mediações ----------

async def mediacoes_motivos(request: Request):
    """Motivos oficiais da plataforma para contestar esta devolução."""
    return await run_in_threadpool(mediacoes.motivos, _id(request))


async def shopee_campos_disputa(request: Request):
    from app.central.shopee.acoes import campos_disputa
    return await run_in_threadpool(campos_disputa, request.path_params["return_sn"])


async def mediacoes_aceitar(request: Request):
    return await run_in_threadpool(mediacoes.aceitar, _id(request))


async def mediacoes_contestar(request: Request):
    dados = await _corpo(request)
    motivo = dados.get("motivo") or ""  # vazio quando a plataforma não pede motivo (ML, produto voltou perfeito)
    texto = dados.get("texto")
    if not isinstance(motivo, str) or not isinstance(texto, str) or not 10 <= len(texto) <= 2000:
        raise ValueError("texto deve ter entre 10 e 2000 caracteres")
    return await run_in_threadpool(mediacoes.contestar, _id(request), motivo, texto)


async def mediacoes_historico(request: Request):
    return await run_in_threadpool(mediacoes.historico, _id(request))


# ---------- Plataformas ----------

async def ml_sincronizar(request: Request):
    return await run_in_threadpool(sincronizar_ml, _q(request, "dias", 30.0, float, 0), _q(request, "todas_abertas", False, bool))


async def shopee_sincronizar(request: Request):
    return await run_in_threadpool(sincronizar_shopee, _q(request, "dias", 15.0, float, 0))


# ponytail: diagnóstico temporário — de onde vem o código da etiqueta amarela da retirada do Full. Remover depois.
async def ml_debug_full(request: Request):
    from app.central.mercado_livre import client as mlc

    def tenta(path, params=None, headers=None):
        try:
            return mlc.get(path, params, headers)
        except RuntimeError as e:
            return {"erro": str(e)[:300]}

    def rodar():
        pedido, codigo = request.path_params["pedido"], request.query_params.get("codigo", "")
        saida = {"pedido": tenta(f"/orders/{pedido}")}
        itens = ((saida["pedido"] or {}).get("order_items") or []) if isinstance(saida["pedido"], dict) else []
        for oi in itens[:2]:
            item_id = (oi.get("item") or {}).get("id")
            item = tenta(f"/items/{item_id}", {"attributes": "id,inventory_id,variations"}) or {}
            invs = {item.get("inventory_id")} | {v.get("inventory_id") for v in item.get("variations") or []}
            for inv in [i for i in invs if i][:3]:
                saida[f"ops_{inv}"] = tenta("/stock/fulfillment/operations/search",
                                            {"seller_id": mlc.USER_ID, "inventory_id": inv, "limit": 50})
        for rotulo, path, h in (("shipment", f"/shipments/{codigo}", {"x-format-new": "true"}),
                                ("order", f"/orders/{codigo}", None),
                                ("claim", f"/post-purchase/v1/claims/{codigo}", None),
                                ("return", f"/post-purchase/v2/returns/{codigo}", None)):
            if codigo:
                saida[f"sonda_{rotulo}"] = tenta(path, None, h)
        return saida

    return await run_in_threadpool(rodar)


async def shopee_sincronizar_falha_entrega(request: Request):
    return await run_in_threadpool(sincronizar_falha_entrega, _q(request, "dias", 15.0, float, 0))


async def olist_pedido(request: Request):
    return await run_in_threadpool(olist.pedidos_do_marketplace, request.path_params["numero"])


async def olist_sincronizar_notas(request: Request):
    return await run_in_threadpool(olist.sincronizar_notas_devolucao, _q(request, "dias", 30, int, 1, 365))


async def olist_depositos(request: Request):
    return await run_in_threadpool(olist.depositos)


# ---------- Operação / B.I. ----------

async def operacao_listar(request: Request):
    destino = request.query_params.get("destino", "vendedor")
    return await run_in_threadpool(
        operacao.listar, _q(request, "status"), _q(request, "plataforma"), _q(request, "motivo"), destino or None,
        _q(request, "pagina", 1, int, 1), _q(request, "por_pagina", 8, int, 1, 100), _q(request, "envio"))


async def operacao_atencao(request: Request):
    return await run_in_threadpool(operacao.atencao)


async def operacao_ultimas(request: Request):
    return await run_in_threadpool(operacao.ultimas, _q(request, "limite", 6, int, 1, 50))


_BRT = ZoneInfo("America/Sao_Paulo")


def _hoje_brt() -> date:
    return datetime.now(_BRT).date()


def _inicio_do_dia_brt(dia: str) -> datetime:
    """Meia-noite de Brasília do dia `YYYY-MM-DD`, em UTC sem fuso (como o banco grava)."""
    return datetime.fromisoformat(dia).replace(tzinfo=_BRT).astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def _dia_valido(texto: str, nome: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto or ""):
        raise ValueError(f"Parâmetro {nome} inválido: {texto!r}")
    if not date(2000, 1, 2) <= date.fromisoformat(texto) <= _hoje_brt():
        raise ValueError(f"{nome} precisa ser uma data entre 2000 e hoje")
    return texto


def _operadores_atividade(dia: str) -> dict:
    """Log de conferências do dia: quem fez, quando, de qual plataforma. O status vem buscado ao vivo da
    central (não do log) porque o resultado muda depois — vira mediação, aceite etc."""
    from database import SessionLocal
    from app.models import LogOperacao
    # o log grava UTC sem fuso; "o dia" é o de Brasília (senão o que foi feito depois das 21h cai no dia seguinte)
    inicio = _inicio_do_dia_brt(dia)
    db = SessionLocal()
    try:
        logs = db.query(LogOperacao).filter(
            LogOperacao.acao == "conferencia_devolucao",
            LogOperacao.criado_em >= inicio, LogOperacao.criado_em < inicio + timedelta(days=1),
        ).order_by(LogOperacao.criado_em.desc()).all()
        dados = [(l.operador_nome, l.criado_em, l.entidade_id, l.detalhes_json) for l in logs]
    finally:
        db.close()

    status_atual = {l["id"]: l["status"] for l in operacao.linhas()} if dados else {}
    itens, resumo = [], {}
    for operador_nome, criado_em, entidade_id, detalhes_json in dados:
        det = json.loads(detalhes_json) if detalhes_json else {}
        devolucao_id = int(entidade_id) if entidade_id and entidade_id.isdigit() else None
        plataforma = det.get("plataforma") or "desconhecida"
        itens.append({
            "operador": operador_nome, "horario": criado_em, "plataforma": plataforma, "pedido": det.get("pedido"),
            "classe": det.get("classe"), "contestar": det.get("contestar"),
            "status": status_atual.get(devolucao_id, det.get("classe")),
        })
        r = resumo.setdefault(operador_nome, {"total": 0, "por_plataforma": {}})
        r["total"] += 1
        r["por_plataforma"][plataforma] = r["por_plataforma"].get(plataforma, 0) + 1
    return {"dia": dia, "total": len(itens), "por_operador": resumo, "itens": itens}


async def operadores_atividade(request: Request):
    dia = _dia_valido(_q(request, "dia") or _hoje_brt().isoformat(), "dia")
    return await run_in_threadpool(_operadores_atividade, dia)


async def produtos_quebrados(request: Request):
    fatura = _q(request, "fatura")
    if fatura and not re.fullmatch(r"\d{4}-\d{2}-01", fatura):
        raise ValueError(f"Parâmetro fatura inválido: {fatura!r}")
    return await run_in_threadpool(bi.produtos_quebrados, _q(request, "dias", 30, int, 1, 365), fatura)


async def custo_historico(request: Request):
    return await run_in_threadpool(custos.historico_do_sku, request.path_params["sku"])


def _registrar_custo(sku: str, custo: float, desde: datetime, quem: str | None) -> dict:
    from database import SessionLocal
    db = SessionLocal()
    try:
        atual = custos.registrar_custo(db, sku, custo, desde, quem)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    custos.limpar_cache()
    return {"sku": sku, "custo_atual": atual, "conferencias_recalculadas": conferencia.reprecificar(sku, desde)}


async def custo_registrar(request: Request):
    """Custo novo do SKU valendo a partir de `desde` (dia de Brasília, padrão hoje): quebras de antes mantêm o custo
    antigo, as de depois são recalculadas."""
    sku = request.path_params["sku"].strip()
    corpo = await _corpo(request)
    try:
        custo = float(corpo.get("custo"))
    except (TypeError, ValueError):
        raise ValueError("custo inválido")
    if not 0 < custo < 1_000_000:
        raise ValueError("custo deve ser maior que zero")
    desde = _inicio_do_dia_brt(_dia_valido(corpo.get("desde") or _hoje_brt().isoformat(), "desde"))
    quem = (request.headers.get("x-operator-name") or "").strip() or None
    return await run_in_threadpool(_registrar_custo, sku, round(custo, 2), desde, quem)


async def respostas_prontas_listar(request: Request):
    return await run_in_threadpool(respostas_prontas.listar)


async def respostas_prontas_criar(request: Request):
    return await run_in_threadpool(respostas_prontas.criar, (await _corpo(request)).get("texto", ""))


async def respostas_prontas_editar(request: Request):
    return await run_in_threadpool(respostas_prontas.editar, request.path_params["id"], (await _corpo(request)).get("texto", ""))


async def respostas_prontas_excluir(request: Request):
    await run_in_threadpool(respostas_prontas.excluir, request.path_params["id"])
    return {"ok": True}


async def bi_resumo(request: Request):
    fatura = _q(request, "fatura")
    if fatura and not re.fullmatch(r"\d{4}-\d{2}-01", fatura):
        raise ValueError(f"Parâmetro fatura inválido: {fatura!r}")
    return await run_in_threadpool(bi.resumo, _q(request, "dias", 30, int, 1, 365), fatura)


async def bi_mensal(request: Request):
    return await run_in_threadpool(bi.mensal, _q(request, "meses", 3, int, 1, 12))


async def bi_refazer_mes(request: Request):
    """Botão "Refazer leitura" de um mês fechado: começa em segundo plano; a barra de progresso acompanha."""
    fatura = request.path_params["fatura"]
    if not re.fullmatch(r"\d{4}-\d{2}-01", fatura):
        raise ValueError(f"Fatura inválida: {fatura!r}")
    await run_in_threadpool(agenda.refazer_mes, fatura)
    return {"iniciado": True, "fatura": fatura}


async def full_identificar(request: Request):
    """Bipou etiqueta do Full: anúncio, SKU e produto na Olist."""
    return await run_in_threadpool(retirada_full.identificar, request.path_params["codigo"])


async def full_entrada(request: Request):
    """Clique do operador: entrada no depósito vendável da Olist do que voltou do Full."""
    corpo = await _corpo(request)
    operador = (request.headers.get("x-operator-name") or "").strip() or None
    return await run_in_threadpool(retirada_full.dar_entrada, request.path_params["codigo"], corpo.get("quantidade"), operador)


async def full_historico(request: Request):
    fatura = _q(request, "fatura")
    if fatura and not re.fullmatch(r"\d{4}-\d{2}-01", fatura):
        raise ValueError(f"Parâmetro fatura inválido: {fatura!r}")
    return await run_in_threadpool(retirada_full.historico, _q(request, "dias", 30, int, 1, 365), fatura)


async def sincronizacao(request: Request):
    """Última rodada de cada tarefa automática (a tela mostra se alguma plataforma está falhando)."""
    return agenda.estado


async def sincronizacao_progresso(request: Request):
    """Barra da tela: % da rodada em andamento e o que ainda falta consultar para o BI ficar completo."""
    return {**progresso.estado, "percentual": progresso.percentual(),
            "pendentes": {nome: (agenda.estado.get(nome, {}).get("resultado") or {}).get("faltam", 0)
                          for nome in ("mediacao_origem", "mediacao_atuacao")}}


rotas = [
    _rota("/devolucoes", listar_devolucoes),
    _rota("/devolucoes/rastreio/{codigo}", por_rastreio),
    _rota("/conferencia/evidencias/{id:int}", conferencia_ver_evidencia),
    _rota("/conferencia/{codigo}", conferencia_buscar),
    _rota("/conferencia/{id:int}", conferencia_registrar, "POST"),
    _rota("/conferencia/{id:int}/lancar-estoque", conferencia_lancar_estoque, "POST"),
    _rota("/conferencia/{id:int}/chamado-manual", conferencia_chamado_manual, "POST"),
    _rota("/conferencia/{id:int}/chamado-manual/aberto", conferencia_chamado_aberto, "POST"),
    _rota("/conferencia/{id:int}/evidencias", conferencia_evidencia, "POST"),
    _rota("/mediacoes/{id:int}/motivos", mediacoes_motivos),
    _rota("/shopee/disputa/{return_sn}", shopee_campos_disputa),
    _rota("/mediacoes/{id:int}/contestar", mediacoes_contestar, "POST"),
    _rota("/mediacoes/{id:int}/aceitar", mediacoes_aceitar, "POST"),
    _rota("/mediacoes/{id:int}", mediacoes_historico),
    _rota("/mercado-livre/sincronizar", ml_sincronizar, "POST"),
    _rota("/shopee/sincronizar", shopee_sincronizar, "POST"),
    _rota("/shopee/sincronizar-falha-entrega", shopee_sincronizar_falha_entrega, "POST"),
    _rota("/ml/debug/full/{pedido}", ml_debug_full),
    _rota("/olist/pedidos/{numero}", olist_pedido),
    _rota("/olist/sincronizar-notas-devolucao", olist_sincronizar_notas, "POST"),
    _rota("/olist/depositos", olist_depositos),
    _rota("/operacao", operacao_listar),
    _rota("/operacao/atencao", operacao_atencao),
    _rota("/operacao/ultimas", operacao_ultimas),
    _rota("/operadores/atividade", operadores_atividade),
    _rota("/produtos-quebrados", produtos_quebrados),
    _rota("/custos/{sku}/historico", custo_historico),
    _rota("/custos/{sku}", custo_registrar, "POST"),
    _rota("/respostas-prontas", respostas_prontas_listar),
    _rota("/respostas-prontas", respostas_prontas_criar, "POST"),
    _rota("/respostas-prontas/{id:int}", respostas_prontas_editar, "PUT"),
    _rota("/respostas-prontas/{id:int}", respostas_prontas_excluir, "DELETE"),
    _rota("/bi/resumo", bi_resumo),
    _rota("/bi/mensal", bi_mensal),
    _rota("/bi/mensal/{fatura}/refazer", bi_refazer_mes, "POST"),
    _rota("/sincronizacao", sincronizacao),
    _rota("/sincronizacao/progresso", sincronizacao_progresso),
    _rota("/retiradas-full", full_historico),
    _rota("/retirada-full/{codigo}", full_identificar),
    _rota("/retirada-full/{codigo}/entrada", full_entrada, "POST"),
]
