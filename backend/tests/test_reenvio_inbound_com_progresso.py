"""Caso real (frete #82413159, 18/11/2026): reenviar o PDF apagou 59 baixas e 69 itens em espera.
Inbound com trabalho feito não pode ser substituído; sem trabalho, pode."""

from types import SimpleNamespace

from app.rotas.inbound import _tem_progresso


def _item(**campos):
    base = dict(baixa_aplicada=0, foi_balanceado=0, em_espera=0, nao_enviar=0, quantidade_baixada=None)
    return SimpleNamespace(**{**base, **campos})


def _inbound(*itens):
    return SimpleNamespace(itens=list(itens))


def test_inbound_sem_trabalho_pode_ser_substituido():
    assert not _tem_progresso(_inbound(_item(), _item(quantidade_baixada=0)))


def test_qualquer_trabalho_feito_trava_a_substituicao():
    for campos in ({"baixa_aplicada": 1}, {"foi_balanceado": 1}, {"em_espera": 1},
                   {"nao_enviar": 1}, {"quantidade_baixada": 5.0}):
        assert _tem_progresso(_inbound(_item(), _item(**campos))), campos
