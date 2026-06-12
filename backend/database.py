from sqlalchemy import create_engine
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

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
