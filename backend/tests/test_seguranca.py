"""A API só responde com sessão assinada; header não dá identidade nem acesso."""
import uuid

import pytest
from starlette.testclient import TestClient

from app import seguranca
from app.main import app
from app.models import Operador
from database import SessionLocal


@pytest.fixture(autouse=True)
def _zerar_tentativas():
    seguranca._falhas.clear()
    yield
    seguranca._falhas.clear()


def _cliente():
    return TestClient(app)


def _entrar_master(c):
    return c.post("/api/sessao/entrar", json={"master": True, "pin": seguranca.PIN_MASTER})


def test_rota_protegida_sem_sessao_da_401():
    assert _cliente().get("/api/embaldes?limit=1").status_code == 401


def test_header_master_forjado_nao_abre_nada():
    c = _cliente()
    falso = {"x-operator-role": "master", "x-operator-name": "MASTER"}
    assert c.get("/api/embaldes?limit=1", headers=falso).status_code == 401
    assert c.post("/api/operadores", json={"nome": "Invasor"}, headers=falso).status_code == 401


def test_rotas_publicas_continuam_abertas():
    c = _cliente()
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/operadores").status_code == 200
    for metodo, caminho in [("POST", "/api/ml/notificacoes"), ("GET", "/api/ml/callback"),
                            ("POST", "/api/shopee/webhook"), ("GET", "/api/imagem-quadrada/ABC.jpg")]:
        assert seguranca.rota_publica(metodo, caminho), caminho
    assert not seguranca.rota_publica("GET", "/api/ml/notificacoes")  # lista interna


def test_login_master_grava_cookie_e_libera_api():
    c = _cliente()
    r = _entrar_master(c)
    assert r.status_code == 200 and r.json()["role"] == "master"
    assert seguranca.COOKIE in r.cookies
    assert c.get("/api/sessao").json()["role"] == "master"
    assert c.get("/api/embaldes?limit=1").status_code == 200
    c.post("/api/sessao/sair")
    c.cookies.clear()
    assert c.get("/api/embaldes?limit=1").status_code == 401



@pytest.fixture
def operador_temp():
    db = SessionLocal()
    op = Operador(nome=f"teste-{uuid.uuid4().hex[:8]}", ativo=1)
    db.add(op)
    db.commit()
    oid = op.id
    db.close()
    yield oid
    db = SessionLocal()
    db.query(Operador).filter(Operador.id == oid).delete()
    db.commit()
    db.close()




def test_token_adulterado_ou_vencido_e_recusado():
    token = seguranca.criar_sessao(1, "Ana", "operador")
    assert seguranca.ler_sessao(token)["nome"] == "Ana"
    dados, assinatura = token.rsplit(".", 1)
    assert seguranca.ler_sessao(dados.replace("A", "B", 1) + "." + assinatura) is None
    assert seguranca.ler_sessao(token[:-2] + "xx") is None
    assert seguranca.ler_sessao(seguranca.criar_sessao(1, "Ana", "operador", validade=-1)) is None
