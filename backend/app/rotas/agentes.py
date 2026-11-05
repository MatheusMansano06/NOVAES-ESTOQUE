"""Rotas de leitura para os agentes do Escritório. Abertas pela chave de serviço (seguranca.py)."""
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse

from app import agentes
from app.rotas.comum import Route


async def envios_pendentes(request: Request):
    return JSONResponse(await run_in_threadpool(agentes.listar_envios_pendentes))


async def anuncios_sem_promocao(request: Request):
    return JSONResponse(await run_in_threadpool(agentes.listar_anuncios_sem_promocao))


rotas = [
    Route("/api/agentes/envios-pendentes", envios_pendentes, methods=["GET"]),
    Route("/api/agentes/anuncios-sem-promocao", anuncios_sem_promocao, methods=["GET"]),
]
