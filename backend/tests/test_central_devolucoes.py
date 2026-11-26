"""Encanamento da Central de Devoluções dentro do estoque: rotas /api/central, banco próprio, conferência e
evidência. Plataformas não são chamadas (Olist fora do ar aparece como erro na tela, não quebra a conferência)."""

import os
import tempfile
from datetime import datetime

_tmp = tempfile.mkdtemp()
os.environ["CENTRAL_DATABASE_URL"] = f"sqlite:///{_tmp}/central.db"
os.environ["CENTRAL_UPLOADS_DIR"] = _tmp
os.environ.update(OLIST_DEPOSITO_VENDAVEL="1", OLIST_DEPOSITO_AVARIA_MERCADO_LIVRE="2", OLIST_DEPOSITO_AVARIA_SHOPEE="3")

import pytest  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.central import routes  # noqa: E402
from app.central.devolucoes import servico as devolucoes  # noqa: E402
from app.central.olist import servico as olist  # noqa: E402

cliente = TestClient(Starlette(routes=routes.rotas))


def _registro(**extra) -> dict:
    agora = datetime(2026, 9, 20, 12)
    return {
        "plataforma": "mercado_livre", "id_externo": "C1", "pedido": "2000001", "pacote": None, "rastreio": "BR123456789BR",
        "etapa": "entregue", "status_plataforma": "delivered", "em_mediacao": False, "pode_contestar": True,
        "motivo": "defeito", "motivo_plataforma": "PDD", "responsavel": "vendedor", "destino": "vendedor",
        "valor_reembolso": 99.9, "custo_plataforma": 20.0, "afeta_reputacao": False, "condicao_produto": None,
        "resultado_mediacao": None, "cobertura_aplicada": None, "prazo_vendedor": agora,
        "itens": [{"sku": "SKU-1", "quantidade": 1}], "aberta_em": agora, "atualizada_em": agora, "bruto": {},
        "codigos": ["BR123456789BR", "2000001"], **extra,
    }


@pytest.fixture(autouse=True)
def sem_olist(monkeypatch):
    def fora(*_a, **_k):
        raise RuntimeError("Olist fora do ar")
    monkeypatch.setattr(olist, "pedidos_do_marketplace", fora)


def test_fluxo_conferencia():
    devolucoes.salvar([_registro()])
    lista = cliente.get("/api/central/devolucoes").json()
    assert [d["id_externo"] for d in lista] == ["C1"]
    dev_id = lista[0]["id"]

    tela = cliente.get("/api/central/conferencia/BR123456789BR").json()
    assert tela[0]["devolucao"]["id"] == dev_id and tela[0]["olist"]["erro"] == "Olist fora do ar"

    # Produto voltou avariado (nosso, não revendável) → classe B, entra na avaria do ML e vale contestar.
    r = cliente.post(f"/api/central/conferencia/{dev_id}", json={
        "produto_correto": True, "completo": True, "sem_uso": False, "revendavel": False})
    assert r.status_code == 200, r.text
    assert r.json()["classe"] == "B" and r.json()["contestar"] is True
    assert r.json()["lancamentos"][0]["deposito_olist"] == 2

    assert cliente.post(f"/api/central/conferencia/{dev_id}", json={"produto_correto": True}).status_code == 422
    assert cliente.post("/api/central/conferencia/999", json={
        "produto_correto": True, "completo": True, "sem_uso": True, "revendavel": True}).status_code == 404

    up = cliente.post(f"/api/central/conferencia/{dev_id}/evidencias",
                      files={"arquivo": ("x.png", b"\x89PNG fake", "image/png")})
    assert up.status_code == 200, up.text
    assert cliente.get(f"/api/central/conferencia/evidencias/{up.json()['id']}").content == b"\x89PNG fake"
    assert cliente.post(f"/api/central/conferencia/{dev_id}/evidencias",
                        files={"arquivo": ("x.exe", b"MZ", "application/x-msdownload")}).status_code == 422

    assert cliente.get("/api/central/operacao?destino=vendedor").status_code == 200
    reg = cliente.get("/api/central/operacao?mediacao=ganha,perdida,parcial").json()
    assert reg["total"] == 0 and reg["mediacoes"] == {"ganha": 0, "perdida": 0, "parcial": 0}
    assert cliente.get("/api/central/operacao/atencao").status_code == 200
    assert cliente.get("/api/central/bi/resumo?dias=30").status_code == 200
    assert cliente.get("/api/central/bi/resumo?dias=0").status_code == 422


def test_limpar_evidencias_apaga_arquivo_e_linha():
    from app.central.conferencia import servico as conferencia
    devolucoes.salvar([_registro(id_externo="C9", codigos=["C9"])])
    dev_id = next(d["id"] for d in cliente.get("/api/central/devolucoes").json() if d["id_externo"] == "C9")
    up = cliente.post(f"/api/central/conferencia/{dev_id}/evidencias", files={"arquivo": ("x.png", b"PNG fake", "image/png")}).json()
    arquivo = conferencia.arquivo_evidencia(up["id"])
    assert arquivo.exists()
    assert conferencia.limpar_evidencias(dev_id) == 1
    assert not arquivo.exists()
    assert cliente.get(f"/api/central/conferencia/evidencias/{up['id']}").status_code == 404


def test_prova_so_fica_enquanto_pode_servir():
    from datetime import timedelta
    from app.central.conferencia.servico import DIAS_APOS_MEDIACAO, DIAS_GUARDA, vencimento_provas
    dia = datetime(2026, 11, 1)

    def vence(status="resolvida", mediacao=None, conf=None, marca=False, contestada=False, etapa="entregue"):
        return vencimento_provas({"status": status, "mediacao": mediacao, "conferencia": conf, "em_mediacao": marca,
                                  "contestada": contestada, "etapa": etapa, "atualizada_em": dia})

    apos_resultado = dia + timedelta(days=DIAS_APOS_MEDIACAO)
    assert vence("em_mediacao") is None
    assert vence(mediacao="em_andamento") is None
    assert vence("precisa_acao", marca=True) is None  # estoque pendente não esconde a mediação aberta
    assert vence("precisa_acao", contestada=True) is None  # contestada, resultado ainda não veio
    assert vence(mediacao="ganha") == datetime.min
    assert vence(mediacao="perdida") == apos_resultado
    assert vence(mediacao="parcial") == apos_resultado
    assert vence("finalizada", contestada=True, etapa="encerrada") == apos_resultado
    assert vence(conf={"chamado_manual": True, "chamado_aberto_em": dia}) == apos_resultado
    assert vence(conf={"contestar": True, "conferida_em": dia}) == dia + timedelta(days=DIAS_GUARDA)
    assert vence(conf={"contestar": False, "chamado_manual": False}) == datetime.min  # sem mediação


def test_conferencia_sem_mediacao_apaga_prova_e_varredura_poupa_mediacao_aberta():
    from app.central.conferencia import servico as conferencia
    devolucoes.salvar([_registro(id_externo="C20", codigos=["C20"], responsavel="comprador", motivo="arrependimento"),
                       _registro(id_externo="C21", codigos=["C21"], em_mediacao=True),
                       _registro(id_externo="C22", codigos=["C22"], resultado_mediacao="ganha")])
    ids = {d["id_externo"]: d["id"] for d in cliente.get("/api/central/devolucoes").json()}
    enviar = lambda i: cliente.post(f"/api/central/conferencia/{i}/evidencias", files={"arquivo": ("x.png", b"PNG fake", "image/png")}).json()
    existe = lambda ev: cliente.get(f"/api/central/conferencia/evidencias/{ev['id']}").status_code == 200

    sem_mediacao = enviar(ids["C20"])
    decisao = conferencia.registrar(ids["C20"], {"produto_correto": True, "completo": True, "sem_uso": True, "revendavel": True, "erro_nosso": False})
    assert not decisao["contestar"] and not decisao["chamado_manual"]
    assert not existe(sem_mediacao)

    aberta, ganha = enviar(ids["C21"]), enviar(ids["C22"])
    conferencia.varrer_evidencias()
    assert existe(aberta) and not existe(ganha)


def test_envio_a_caminho():
    from app.central.operacao.regras import envio
    ml = lambda st: {"devolucao": {"status": st}}  # noqa: E731
    assert envio("mercado_livre", ml("label_generated")) == "aguardando_postagem"
    assert envio("mercado_livre", ml("shipped")) == "postado"
    sp = lambda st, rl=None: {"devolucao": {"status": st, "rastreio_reverso": rl and {"reverse_logistics_status": rl}}}  # noqa: E731
    assert envio("shopee", sp("PROCESSING")) == "aguardando_postagem"
    assert envio("shopee", sp("ACCEPTED", "LOGISTICS_PICKUP_DONE")) == "postado"
    assert envio("shopee", sp("ACCEPTED", "LOGISTICS_PENDING_ARRANGE")) == "aguardando_postagem"
    assert envio("shopee", sp("ACCEPTED")) == "sem_info"

    devolucoes.salvar([_registro(id_externo="C2", etapa="em_transito", rastreio="BR999999999BR", codigos=[],
                                 bruto={"devolucao": {"status": "shipped"}})])
    r = cliente.get("/api/central/operacao?status=a_caminho&envio=postado").json()
    assert r["a_caminho"]["mercado_livre"]["postado"] == 1 and [l["id_externo"] for l in r["itens"]] == ["C2"]


def test_busca_por_pedido():
    devolucoes.salvar([_registro(id_externo="C3", pedido="2000015866105565", rastreio=None, codigos=[]),
                       _registro(id_externo="C4", pedido="261101752WQJ5W", rastreio=None, codigos=[], plataforma="shopee")])
    ids = lambda q: [l["id_externo"] for l in cliente.get(f"/api/central/operacao?destino=&busca={q}&por_pagina=50").json()["itens"]]  # noqa: E731
    assert ids("105565") == ["C3"]  # últimos dígitos bastam
    assert ids("wqj5w") == ["C4"]  # sem diferenciar maiúscula
    assert ids("C3") == ["C3"]  # id da reclamação/mediação também acha
    assert ids("nada-disso") == []


def test_mercadoria_quebrada_bancada_e_motivo():
    """Duas origens: bancada (conferiu e não vende) e motivo (já veio como danificado/defeito).
    Revisão do ML não conta; conferência que diz 'voltou bom' derruba o motivo."""
    from app.central.bi import servico as bi
    base = {"etapa": "entregue", "motivo": "arrependimento", "plataforma": "mercado_livre", "conferencia": None,
            "condicao_produto": None, "itens": []}
    assert bi.perda({**base, "condicao_produto": "unsaleable"}) == (None, 0.0)  # revisão do ML sozinha: não conta
    assert bi.perda({**base, "motivo": "danificado"})[0] == "motivo"
    assert bi.perda({**base, "motivo": "defeito", "etapa": "cancelada"}) == (None, 0.0)
    assert bi.perda({**base, "motivo": "danificado", "conferencia": {"classe": "A", "perda_produto": 0.0}}) == (None, 0.0)
    assert bi.perda({**base, "conferencia": {"classe": "B", "perda_produto": 50.0}}) == ("bancada", 50.0)

    ls = [{**base, "conferencia": {"classe": "B", "perda_produto": 50.0}},
          {**base, "plataforma": "shopee", "motivo": "danificado"},
          {**base, "plataforma": "shopee", "motivo": "danificado"}]
    q = bi.quebrados(ls)
    seg = {(s["origem"], s["tipo"]): s for s in q["segmentos"]}
    assert seg[("bancada", "B")]["por_plataforma"]["mercado_livre"] == {"quantidade": 1, "valor": 50.0, "sem_custo": 0}
    assert seg[("motivo", "danificado")]["por_plataforma"]["shopee"]["quantidade"] == 2
    assert q["por_origem"]["bancada"]["quantidade"] == 1 and q["por_origem"]["motivo"]["quantidade"] == 2
    assert q["total"]["quantidade"] == 3


def test_401_do_ml_nao_forca_renovacao_do_token(monkeypatch):
    """O ML também responde 401 para recurso que a conta não enxerga. Renovar a cada 401 gastava o refresh_token
    de uso único (dezenas de renovações por hora em produção)."""
    from app.central.mercado_livre import client

    renovacoes = []
    monkeypatch.setattr(client._ml, "get_access_token", lambda invalidar=None: renovacoes.append(invalidar) or "tok")

    class Resposta:
        status_code, is_error, text, headers = 401, True, "unauthorized", {}

    monkeypatch.setattr(client._http, "get", lambda *a, **k: Resposta())
    with pytest.raises(RuntimeError, match="HTTP 401"):
        client.get("/post-purchase/v1/claims/1")
    assert all(inv is None for inv in renovacoes), "nenhuma chamada pode pedir renovação forçada"


def test_mediacao_perdida_de_produto_quebrado_pede_chamado_com_protocolo():
    import io
    from app.central.bi.servico import _recuperado
    from app.central.conferencia import servico as conferencia
    from app.central.devolucoes.modelo import Devolucao
    from app.central.db import Sessao
    from app.central.operacao.servico import linhas
    devolucoes.salvar([_registro(id_externo="P1", pedido="3000001", rastreio=None, codigos=["P1"], resultado_mediacao="perdida",
                                 etapa="encerrada", bruto={"claim": {"resolution": {"date_created": "2026-09-25T10:00:00.000-04:00"}}}),
                       _registro(id_externo="P2", pedido="3000002", rastreio=None, codigos=["P2"], resultado_mediacao="perdida",
                                 etapa="encerrada")])
    with Sessao() as s:
        ids = {d.id_externo: d.id for d in s.query(Devolucao).filter(Devolucao.id_externo.in_(["P1", "P2"]))}
    # P1 voltou quebrada (classe B); P2 voltou perfeita (classe A): perdida, mas não há o que recuperar por chamado.
    assert cliente.post(f"/api/central/conferencia/{ids['P1']}", json={
        "produto_correto": True, "completo": True, "sem_uso": False, "revendavel": False}).status_code == 200
    assert cliente.post(f"/api/central/conferencia/{ids['P2']}", json={
        "produto_correto": True, "completo": True, "sem_uso": True, "revendavel": True}).status_code == 200
    conferencia.salvar_evidencia(ids["P1"], "video/mp4", io.BytesIO(b"x" * 1000))
    conferencia.salvar_evidencia(ids["P1"], "image/jpeg", io.BytesIO(b"y" * 10))

    pendentes = cliente.get("/api/central/operacao/chamados-pendentes").json()
    assert [p["id_externo"] for p in pendentes["abrir"]] == ["P1"] and pendentes["aguardando"] == []
    assert pendentes["abrir"][0]["perdida_em"].startswith("2026-09-25T14:00")  # data da resolução do ML, em UTC
    p1 = next(l for l in linhas() if l["id"] == ids["P1"])
    assert conferencia.vencimento_provas(p1) is None  # o vídeo espera o chamado
    assert cliente.get("/api/central/operacao?por_pagina=1").json()["armazenamento"] == {"videos": 1, "bytes": 1000}

    url = f"/api/central/conferencia/{ids['P1']}/chamado-manual"
    assert cliente.post(f"{url}/aberto", json={}).status_code == 422  # sem protocolo não fecha
    r = cliente.post(f"{url}/aberto", json={"protocolo": "ML-778899"})
    assert r.status_code == 200 and r.json()["videos_apagados"] == 1
    assert cliente.get("/api/central/operacao?por_pagina=1").json()["armazenamento"]["videos"] == 0
    pendentes = cliente.get("/api/central/operacao/chamados-pendentes").json()
    assert pendentes["abrir"] == [] and [p["id_externo"] for p in pendentes["aguardando"]] == ["P1"]

    assert cliente.post(f"{url}/resultado", json={"recuperado": True, "valor": 150}).status_code == 200
    assert cliente.get("/api/central/operacao/chamados-pendentes").json()["aguardando"] == []
    p1 = next(l for l in linhas() if l["id"] == ids["P1"])
    assert _recuperado(p1) == 150.0  # entra no B.I. como recuperado

    assert cliente.post(f"{url}/resultado", json={"recuperado": False}).status_code == 200
    p1 = next(l for l in linhas() if l["id"] == ids["P1"])
    assert _recuperado(p1) == 0.0  # não recebeu: continua perda
