"""Banco da Central de Devoluções: arquivo próprio, na mesma pasta do banco do estoque (volume /data no Railway).
Separado de propósito: tabelas com nomes genéricos (devolucoes, conferencias) não colidem com as do estoque, e o
central.db do projeto original pode ser copiado para cá sem migração."""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from database import DATABASE_URL

_PASTA_DADOS = (
    Path(DATABASE_URL.replace("sqlite:///", "", 1)).resolve().parent
    if DATABASE_URL.startswith("sqlite") else Path(__file__).resolve().parents[2]
)
URL = os.getenv("CENTRAL_DATABASE_URL") or f"sqlite:///{_PASTA_DADOS / 'central_devolucoes.db'}"
UPLOADS = Path(os.getenv("CENTRAL_UPLOADS_DIR") or _PASTA_DADOS / "central_uploads")

engine = create_engine(URL, connect_args={"check_same_thread": False} if URL.startswith("sqlite") else {})
Sessao = sessionmaker(engine)

if URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _wal(conexao, _):
        # WAL: a sincronização em segundo plano grava sem travar a leitura da tela de conferência.
        conexao.execute("PRAGMA journal_mode=WAL")
        conexao.execute("PRAGMA busy_timeout=5000")


Base = declarative_base()
