"""Rota async com código bloqueante não pode travar as outras requisições."""
import asyncio
import time

import httpx
from starlette.applications import Starlette
from starlette.responses import JSONResponse

from app.rotas.comum import Route


async def _lenta(request):
    time.sleep(0.5)  # simula urllib/SQLite bloqueante dentro de rota async
    return JSONResponse({"ok": True})


async def _eco(request):
    return JSONResponse(await request.json())


app = Starlette(routes=[Route("/lenta", _lenta), Route("/eco", _eco, methods=["POST"])])


async def _disparar():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        inicio = time.perf_counter()
        r = await asyncio.gather(*[c.get("/lenta") for _ in range(4)])
        decorrido = time.perf_counter() - inicio
        eco = await c.post("/eco", json={"a": 1})
    return r, decorrido, eco


def test_rotas_lentas_rodam_em_paralelo_e_corpo_chega():
    r, decorrido, eco = asyncio.run(_disparar())
    assert all(x.status_code == 200 for x in r)
    assert decorrido < 1.2, f"rotas serializadas: {decorrido:.2f}s para 4 x 0,5s"
    assert eco.json() == {"a": 1}
