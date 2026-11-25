"""Aceite de devolução no ML: o {} da doc passou a dar 400 de corpo; repete com lista."""
import pytest

from app.central.mercado_livre import acoes


def _preparar(monkeypatch, respostas):
    enviados = []
    monkeypatch.setattr(acoes, "acoes_vendedor", lambda _c: {"return_review_ok"})
    monkeypatch.setattr(acoes.client, "get", lambda *_a, **_k: {"id": 99})

    def post(path, json=None, files=None):
        enviados.append(json)
        r = respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(acoes.client, "post", post)
    return enviados


def test_aceite_repete_com_lista_quando_ml_recusa_corpo(monkeypatch):
    erro = RuntimeError('Mercado Livre /x: HTTP 400 {"message":"Required request body is missing or incorrect"}')
    enviados = _preparar(monkeypatch, [erro, {}])
    assert acoes.aceitar("1")["caminho"] == "aceite"
    assert enviados == [{}, []]


def test_aceite_nao_repete_outro_erro(monkeypatch):
    enviados = _preparar(monkeypatch, [RuntimeError("Mercado Livre /x: HTTP 400 Not valid action return_review_ok")])
    with pytest.raises(RuntimeError):
        acoes.aceitar("1")
    assert enviados == [{}]
