"""Painel 1:1 com o ML: cada situação real (levantada em 450 reclamações) vira um painel com os botões do ML."""
import pytest

from app.central.mercado_livre import acoes


def _claim(acoes_ml, stage="claim", status="opened", obrig=()):
    return {"stage": stage, "status": status, "players": [
        {"type": "buyer", "available_actions": [{"action": "x"}]},
        {"type": "seller", "available_actions": [{"action": a, "mandatory": a in obrig, "due_date": "2026-11-30"}
                                                 for a in acoes_ml]}]}


@pytest.mark.parametrize("claim, esperado, botoes", [
    (_claim(["open_dispute", "refund", "send_message_to_complainant"]), ("a_caminho", 1),
     ["refund", "open_dispute", "send_message_to_complainant"]),
    (_claim(["return_review_fail", "return_review_ok", "return_review_unified_fail", "return_review_unified_ok"],
            status="closed", obrig=("return_review_ok",)), ("revisar", 2), ["return_review_ok", "return_review_fail"]),
    (_claim(["recontact", "return_review_fail", "return_review_ok"], status="closed"), ("revisar", 2),
     ["return_review_ok", "return_review_fail", "recontact"]),
    (_claim(["return_review_fail"], status="closed"), ("so_reportar", 3), ["return_review_fail"]),
    (_claim([], stage="dispute"), ("mediacao", 4), []),
    (_claim(["send_message_to_mediator"], stage="dispute"), ("mediacao", 4), ["send_message_to_mediator"]),
    (_claim([], status="closed"), ("encerrada", 5), []),
    (_claim(["acao_nova_do_ml"]), ("outra", 0), ["acao_nova_do_ml"]),
])
def test_cada_situacao_real_tem_seu_painel(monkeypatch, claim, esperado, botoes):
    monkeypatch.setattr(acoes.client, "get", lambda *_a, **_k: claim)
    s = acoes.situacao("1")
    assert (s["situacao"], s["numero"]) == esperado
    assert [b["acao"] for b in s["acoes"]] == botoes


def test_botao_desconhecido_aparece_mas_manda_ao_painel(monkeypatch):
    monkeypatch.setattr(acoes.client, "get", lambda *_a, **_k: _claim(["recontact", "return_review_ok"]))
    recontato = next(b for b in acoes.situacao("1")["acoes"] if b["acao"] == "recontact")
    assert recontato["nome"] == "Recontato" and not recontato["executavel"]


def test_revisao_unificada_e_obrigatoria_viram_um_botao(monkeypatch):
    claim = _claim(["return_review_ok", "return_review_unified_ok"], obrig=("return_review_unified_ok",))
    monkeypatch.setattr(acoes.client, "get", lambda *_a, **_k: claim)
    (ok,) = acoes.situacao("1")["acoes"]
    assert ok["nome"] == "Chegou como esperado" and ok["obrigatoria"]


def _executar(monkeypatch, liberadas, falha_em=None):
    chamadas = []
    monkeypatch.setattr(acoes, "acoes_vendedor", lambda _c: set(liberadas))
    monkeypatch.setattr(acoes.client, "get", lambda *_a, **_k: {"id": 7})

    def post(path, json=None, files=None):
        chamadas.append((path, json))
        if falha_em and falha_em in path:
            raise RuntimeError("Mercado Livre: HTTP 400")
        return {}

    monkeypatch.setattr(acoes.client, "post", post)
    return chamadas


def test_devolver_dinheiro(monkeypatch):
    chamadas = _executar(monkeypatch, {"refund"})
    assert acoes.executar("9", "refund", "", "", [])["caminho"] == "reembolso"
    assert chamadas == [("/post-purchase/v1/claims/9/expected-resolutions/refund", None)]


def test_acao_que_o_ml_nao_libera_mais_nao_chama_o_ml(monkeypatch):
    chamadas = _executar(monkeypatch, {"open_dispute"})
    with pytest.raises(RuntimeError, match="não libera mais"):
        acoes.executar("9", "refund", "", "", [])
    assert chamadas == []


def test_acao_so_do_painel_nao_executa(monkeypatch):
    _executar(monkeypatch, {"recontact"})
    with pytest.raises(RuntimeError, match="painel do ML"):
        acoes.executar("9", "recontact", "", "", [])


def test_revisao_unificada_liberada_aceita(monkeypatch):
    chamadas = _executar(monkeypatch, {"return_review_unified_ok"})
    assert acoes.executar("9", "return_review_ok", "", "", [])["caminho"] == "aceite"
    assert chamadas == [("/post-purchase/v1/returns/7/return-review", {})]


def test_mensagem_ao_comprador(monkeypatch):
    chamadas = _executar(monkeypatch, {"send_message_to_complainant"})
    acoes.executar("9", "send_message_to_complainant", "", "Pode postar até sexta?", [])
    assert chamadas[0][1] == {"receiver_role": "complainant", "message": "Pode postar até sexta?", "attachments": []}


def test_mediacao_aberta_mesmo_se_a_mensagem_falhar(monkeypatch):
    _executar(monkeypatch, {"open_dispute"}, falha_em="send-message")
    r = acoes.executar("9", "open_dispute", "", "Produto voltou perfeito.", [])
    assert r["caminho"] == "mediacao" and "Mensagem ao mediador" in r["aviso"]
