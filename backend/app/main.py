"""Aplicação Starlette: junta as rotas de cada área, middlewares e o frontend compilado."""
import os

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from app import seguranca
from app.central.routes import rotas as rotas_central
from app.jobs import iniciar_scheduler
from app.rotas import acesso, compras, embalagens, inbound, mercado_livre, notas_fiscais, olist, shopee

routes = [
    *acesso.rotas,
    *notas_fiscais.rotas,
    *inbound.rotas,
    *mercado_livre.rotas,
    *olist.rotas,
    *shopee.rotas,
    *embalagens.rotas,
    *compras.rotas,
    *rotas_central,  # /api/central/* — Central de Devoluções
]

# Frontend compilado servido como SPA na raiz, depois de todas as rotas /api (a API tem prioridade).
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(STATIC_DIR):
    routes.append(Mount("/", app=StaticFiles(directory=STATIC_DIR, html=True), name="frontend"))


async def _on_startup():
    """Inicia o scheduler de jobs (syncs, encerramento de inbounds, monitor)."""
    try:
        iniciar_scheduler()
    except Exception as e:
        print(f"[ERRO] Falha ao iniciar scheduler: {e}")


app = Starlette(routes=routes, on_startup=[_on_startup])

# Ordem: o último adicionado é o mais externo. A proteção fica por dentro para o 401 ainda passar por CORS e gzip.
app.add_middleware(seguranca.ProtecaoApi)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",  # só o frontend em dev; produção é mesma origem
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
