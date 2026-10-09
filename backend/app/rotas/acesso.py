"""Rotas de acesso: login por PIN, sessão, cadastro e histórico de operadores."""
from starlette.responses import JSONResponse
from starlette.requests import Request
from database import SessionLocal
import json
from app.models import Operador, LogOperacao
from app import seguranca

from app.rotas.comum import (
    Route,
    _registrar_log_operacao,
    _request_eh_master,
)


async def root(request: Request):
    return JSONResponse({"message": "Estoque Virtual API - Phase 1"})


async def listar_operadores(request: Request):
    db = SessionLocal()
    try:
        operadores = (db.query(Operador)
                      .filter(Operador.ativo == 1)
                      .order_by(Operador.nome.asc())
                      .all())
        return JSONResponse({
            "operadores": [
                {
                    "id": op.id,
                    "nome": op.nome,
                    "ativo": op.ativo,
                    "criado_em": op.criado_em.isoformat() if op.criado_em else None,
                }
                for op in operadores
            ]
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


def _sessao_publica(sessao: dict) -> dict:
    return {"operadorId": sessao.get("id"), "operadorNome": sessao.get("nome"), "role": sessao.get("papel"),
            "trocarPin": bool(sessao.get("trocar"))}


def _responder_com_sessao(request: Request, operador_id, nome: str, papel: str, trocar_pin: bool = False):
    token = seguranca.criar_sessao(operador_id, nome, papel, trocar_pin=trocar_pin)
    resposta = JSONResponse(_sessao_publica({"id": operador_id, "nome": nome, "papel": papel, "trocar": trocar_pin}))
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    seguranca.gravar_cookie(resposta, token, https)
    return resposta


async def sessao_entrar(request: Request):
    """POST {operador_id} (sem PIN, acesso livre) ou {master: true, pin} → grava o cookie de sessão."""
    ip = seguranca.ip_cliente(request.headers)
    if seguranca.login_bloqueado(ip):
        return JSONResponse({"erro": "Muitas tentativas erradas. Aguarde 15 minutos."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body.get("master"):
        if not seguranca.pin_confere(str(body.get("pin") or "").strip(), seguranca.PIN_MASTER):
            seguranca.registrar_falha(ip)
            return JSONResponse({"erro": "PIN inválido"}, status_code=401)
        seguranca.limpar_falhas(ip)
        return _responder_com_sessao(request, None, "MASTER", "master")

    db = SessionLocal()
    try:
        operador = db.query(Operador).filter(Operador.id == body.get("operador_id"), Operador.ativo == 1).first()
        dados = (operador.id, operador.nome) if operador else None
    finally:
        db.close()
    if not dados:
        return JSONResponse({"erro": "Operador inválido"}, status_code=401)
    return _responder_com_sessao(request, dados[0], dados[1], "operador")


async def sessao_trocar_pin(request: Request):
    """POST {pin_novo, pin_atual?} — operador define o PIN pessoal (pin_atual dispensado no 1º acesso)."""
    sessao = request.scope.get("sessao") or {}
    if sessao.get("papel") != "operador" or sessao.get("id") is None:
        return JSONResponse({"erro": "Só operadores têm PIN pessoal."}, status_code=400)
    ip = seguranca.ip_cliente(request.headers)
    if seguranca.login_bloqueado(ip):
        return JSONResponse({"erro": "Muitas tentativas erradas. Aguarde 15 minutos."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        body = {}
    pin_novo = str(body.get("pin_novo") or "").strip()
    problema = seguranca.problema_no_pin_novo(pin_novo)
    if problema:
        return JSONResponse({"erro": problema}, status_code=400)
    db = SessionLocal()
    try:
        operador = db.query(Operador).filter(Operador.id == sessao["id"], Operador.ativo == 1).first()
        if not operador:
            return JSONResponse({"erro": "Operador não encontrado"}, status_code=404)
        if not sessao.get("trocar") and not seguranca.pin_confere_hash(str(body.get("pin_atual") or ""), operador.pin_hash):
            seguranca.registrar_falha(ip)
            return JSONResponse({"erro": "PIN atual incorreto"}, status_code=401)
        operador.pin_hash = seguranca.hash_pin(pin_novo)
        db.commit()
        operador_id, nome = operador.id, operador.nome
    finally:
        db.close()
    _registrar_log_operacao(request, "pin_definido", "operador", operador_id, f"{nome} definiu o PIN pessoal")
    return _responder_com_sessao(request, operador_id, nome, "operador")


async def resetar_pin_operador(request: Request):
    """Master: operador esqueceu o PIN → volta ao PIN inicial e troca no próximo acesso."""
    if not _request_eh_master(request):
        return JSONResponse({"erro": "Acesso restrito ao master"}, status_code=403)
    db = SessionLocal()
    try:
        operador = db.query(Operador).filter(Operador.id == int(request.path_params["operador_id"])).first()
        if not operador:
            return JSONResponse({"erro": "Operador não encontrado"}, status_code=404)
        operador.pin_hash = None
        db.commit()
        nome = operador.nome
    finally:
        db.close()
    _registrar_log_operacao(request, "pin_resetado", "operador", request.path_params["operador_id"], f"PIN de {nome} resetado")
    return JSONResponse({"sucesso": True, "mensagem": f"PIN de {nome} resetado"})


async def sessao_sair(request: Request):
    resposta = JSONResponse({"sucesso": True})
    seguranca.apagar_cookie(resposta)
    return resposta


async def sessao_atual(request: Request):
    sessao = request.scope.get("sessao")
    if not sessao:
        return JSONResponse({"erro": "Sem sessão"}, status_code=401)
    return JSONResponse(_sessao_publica(sessao))


async def criar_operador(request: Request):
    if not _request_eh_master(request):
        return JSONResponse({"erro": "Acesso restrito ao master"}, status_code=403)

    db = SessionLocal()
    try:
        body = await request.json()
        nome = str(body.get("nome") or "").strip()
        if not nome:
            return JSONResponse({"erro": "Nome do operador é obrigatório"}, status_code=400)

        existente = db.query(Operador).filter(Operador.nome.ilike(nome)).first()
        if existente:
            if existente.ativo != 1:
                existente.ativo = 1
                db.add(existente)
                db.commit()
            _registrar_log_operacao(request, "operador_reativado", "operador", existente.id, f"Operador reativado: {existente.nome}", {"nome": existente.nome})
            return JSONResponse({"id": existente.id, "nome": existente.nome, "ativo": existente.ativo, "mensagem": "Operador reativado"})

        operador = Operador(nome=nome, ativo=1)
        db.add(operador)
        db.commit()
        db.refresh(operador)
        _registrar_log_operacao(request, "operador_criado", "operador", operador.id, f"Operador criado: {operador.nome}", {"nome": operador.nome})
        return JSONResponse({"id": operador.id, "nome": operador.nome, "ativo": operador.ativo, "mensagem": "Operador criado"})
    except Exception as e:
        db.rollback()
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


async def historico_operadores(request: Request):
    if not _request_eh_master(request):
        return JSONResponse({"erro": "Acesso restrito ao master"}, status_code=403)

    db = SessionLocal()
    try:
        operador = str(request.query_params.get("operador") or "").strip()
        limit = min(int(request.query_params.get("limit", 500)), 1000)

        query = db.query(LogOperacao)
        if operador:
            query = query.filter(LogOperacao.operador_nome == operador)
        logs = query.order_by(LogOperacao.criado_em.desc()).limit(limit).all()

        agrupado = {}
        for log in logs:
            chave = log.operador_nome or "Nao identificado"
            bucket = agrupado.setdefault(chave, {
                "operador_nome": chave,
                "operador_role": log.operador_role or "operador",
                "total_acoes": 0,
                "ultima_acao": None,
                "acoes": [],
            })
            bucket["total_acoes"] += 1
            if not bucket["ultima_acao"]:
                bucket["ultima_acao"] = log.criado_em.isoformat() if log.criado_em else None
            bucket["acoes"].append({
                "id": log.id,
                "acao": log.acao,
                "entidade_tipo": log.entidade_tipo,
                "entidade_id": log.entidade_id,
                "descricao": log.descricao,
                "detalhes": json.loads(log.detalhes_json) if log.detalhes_json else None,
                "criado_em": log.criado_em.isoformat() if log.criado_em else None,
            })

        return JSONResponse({
            "total_logs": len(logs),
            "operadores": sorted(agrupado.values(), key=lambda item: item["operador_nome"].lower()),
        })
    except Exception as e:
        return JSONResponse({"erro": str(e)}, status_code=500)
    finally:
        db.close()


rotas = [
    Route("/api/health", root, methods=["GET"]),
    Route("/api/operadores", listar_operadores, methods=["GET"]),
    Route("/api/operadores", criar_operador, methods=["POST"]),
    Route("/api/sessao", sessao_atual, methods=["GET"]),
    Route("/api/sessao/entrar", sessao_entrar, methods=["POST"]),
    Route("/api/sessao/sair", sessao_sair, methods=["POST"]),
    Route("/api/sessao/trocar-pin", sessao_trocar_pin, methods=["POST"]),
    Route("/api/operadores/{operador_id:int}/resetar-pin", resetar_pin_operador, methods=["POST"]),
    Route("/api/operadores/historico", historico_operadores, methods=["GET"]),
]
