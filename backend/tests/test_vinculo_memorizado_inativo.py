"""Vínculo memorizado (VinculoOlist) apontando p/ produto excluído na Olist é solto na 1ª revisão."""

from types import SimpleNamespace

from app import main


class _Db:
    def __init__(self):
        self.apagados = 0

    def query(self, *_):
        return self

    def filter(self, *_):
        return self

    def delete(self):
        self.apagados += 1


def _item(msg="Vinculado via SKU X"):
    return SimpleNamespace(olist_produto_id="9", olist_sku="X", olist_nome="n", validado=1,
                           validacao_mensagem=msg, sku_inbound="X")


def test_solta_so_memorizado_inativo(monkeypatch):
    situacao = {"v": "E"}
    monkeypatch.setattr(main.olist, "obter_detalhes_completo", lambda pid: {"situacao": situacao["v"]})

    db, it = _Db(), _item()
    main._descartar_vinculo_memorizado_inativo(db, it)
    assert it.olist_produto_id is None and it.validado == 0 and db.apagados == 1

    situacao["v"] = "A"  # ativo: mantém
    db, it = _Db(), _item()
    main._descartar_vinculo_memorizado_inativo(db, it)
    assert it.olist_produto_id == "9" and db.apagados == 0

    situacao["v"] = "E"  # manual (sem a mensagem da memória): não reconfere
    db, it = _Db(), _item(msg=None)
    main._descartar_vinculo_memorizado_inativo(db, it)
    assert it.olist_produto_id == "9"
