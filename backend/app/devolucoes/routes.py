# backend/app/devolucoes/routes.py
from starlette.requests import Request
from starlette.responses import JSONResponse
from app.devolucoes import service
from app.devolucoes.adapters.mercado_livre import MercadoLivreReturnsAdapter
from app.devolucoes.adapters.shopee import ShopeeReturnsAdapter

_ADAPTERS = {
    "mercado_livre": MercadoLivreReturnsAdapter(),
    "shopee": ShopeeReturnsAdapter(),
}


async def listar_devolucoes(request: Request) -> JSONResponse:
    """GET /api/devolucoes — lista consolidada ML+Shopee, sem ação externa."""
    return JSONResponse(service.listar())


async def detalhe_devolucao(request: Request) -> JSONResponse:
    """GET /api/devolucoes/{id} — detalhe com itens, rastreio e vínculo Olist."""
    return_case_id = int(request.path_params["id"])
    resultado = service.detalhe(return_case_id)
    if resultado is None:
        return JSONResponse({"erro": "devolução não encontrada"}, status_code=404)
    return JSONResponse(resultado)


async def sincronizar_devolucoes(request: Request) -> JSONResponse:
    """POST /api/devolucoes/sincronizar — ingestão manual (ML + Shopee)."""
    return JSONResponse(service.sincronizar(_ADAPTERS))
