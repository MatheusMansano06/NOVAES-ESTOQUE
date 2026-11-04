"""Rotas de leitura para os agentes do Escritório. Abertas pela chave de serviço (seguranca.py)."""
from starlette.requests import Request
from starlette.responses import JSONResponse

from app import agentes
from app.rotas.comum import Route


async def envios_pendentes(request: Request):
    return JSONResponse(agentes.listar_envios_pendentes())


rotas = [
    Route("/api/agentes/envios-pendentes", envios_pendentes, methods=["GET"]),
]
