"""Rede de proteção da arquitetura: nenhuma rota some, muda de método ou de função ao reorganizar o código.

Se uma rota for criada/removida de propósito, regenere o retrato:
    python -m tests.test_rotas_registradas
"""
import json
from pathlib import Path

from starlette.routing import Route

from app.main import app

RETRATO = Path(__file__).parent / "fixtures" / "rotas_api.json"


def tabela_atual() -> list:
    return [[r.path, sorted(r.methods - {"HEAD"}), r.endpoint.__name__]
            for r in app.routes if isinstance(r, Route)]


def _area(caminho: str) -> str:
    return caminho.split("/")[2] if caminho.startswith("/api/") else caminho


def test_nenhuma_rota_sumiu_ou_mudou():
    esperado = json.loads(RETRATO.read_text(encoding="utf-8"))
    atual = tabela_atual()
    assert sorted(map(json.dumps, atual)) == sorted(map(json.dumps, esperado))


def test_ordem_dentro_de_cada_area_preservada():
    """A 1ª rota que casa vence: dentro da mesma área a ordem não pode mudar."""
    esperado = json.loads(RETRATO.read_text(encoding="utf-8"))
    por_area = lambda tabela, a: [r[0] + str(r[1]) for r in tabela if _area(r[0]) == a]  # noqa: E731
    atual = tabela_atual()
    for area in {_area(r[0]) for r in esperado}:
        assert por_area(atual, area) == por_area(esperado, area), area


if __name__ == "__main__":
    RETRATO.write_text(json.dumps(tabela_atual(), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"retrato salvo: {len(tabela_atual())} rotas")
