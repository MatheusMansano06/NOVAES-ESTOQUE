from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os
import shutil

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./estoque_virtual.db")

# Seed automático (Railway/produção): se for SQLite e o arquivo do banco ainda
# não existe (ex.: primeiro boot num volume vazio), copiamos o seed.db que vem
# junto na imagem — assim os dados reais já aparecem sem migração manual.
if DATABASE_URL.startswith("sqlite"):
    db_path = DATABASE_URL.replace("sqlite:///", "", 1)  # serve p/ ./x e //data/x
    if db_path and not os.path.exists(db_path):
        seed = os.path.join(os.path.dirname(__file__), "seed.db")
        if os.path.exists(seed):
            destino = os.path.dirname(os.path.abspath(db_path))
            os.makedirs(destino, exist_ok=True)
            shutil.copy(seed, db_path)
            print(f"[DB] Banco inicializado a partir do seed.db -> {db_path}")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

# WAL + busy_timeout: em SQLite o modo padrão (rollback journal) faz uma escrita
# longa BLOQUEAR todas as leituras. Com a sincronização de vendas do ML (que
# grava milhares de linhas), isso congelaria o app. WAL permite ler enquanto
# escreve; busy_timeout faz o writer aguardar em vez de dar "database is locked".
if "sqlite" in DATABASE_URL:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=10000")
            cur.execute("PRAGMA synchronous=NORMAL")
        finally:
            cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
