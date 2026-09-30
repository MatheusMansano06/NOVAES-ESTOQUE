"""Progresso da rodada de sincronização, para a barra da tela. A agenda marca a tarefa; a tarefa longa informa
quanto já andou dela (0 a 1) com `parcial`."""

from datetime import datetime, timezone

# Peso de cada tarefa na barra: a varredura do ML é a que demora (4 chamadas por reclamação).
PESOS = {"mercado_livre": 12, "refazer_ml": 12, "refazer_shopee": 4, "refazer_fatura": 2, "logistica_venda": 3, "mediacao_origem": 3, "mediacao_atuacao": 3, "fatura_ml": 2}
estado: dict = {"refazendo": None, "varredura": False, "rodando": False, "tarefa": None, "tarefas": [], "feitas": 0, "fracao": 0.0,
                "iniciada_em": None, "terminada_em": None}


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def iniciar(tarefas: list[str], varredura: bool = False, refazendo: str | None = None) -> None:
    estado.update(refazendo=refazendo, varredura=varredura, rodando=True, tarefas=tarefas, feitas=0, tarefa=None, fracao=0.0, iniciada_em=_agora())


def tarefa(nome: str, feitas: int) -> None:
    estado.update(tarefa=nome, feitas=feitas, fracao=0.0)


def parcial(fracao: float) -> None:
    estado["fracao"] = max(0.0, min(1.0, fracao))


def terminar() -> None:
    estado.update(rodando=False, tarefa=None, feitas=len(estado["tarefas"]), fracao=0.0, terminada_em=_agora())


def percentual() -> float:
    tarefas = estado["tarefas"]
    if not tarefas:
        return 0.0
    if not estado["rodando"]:
        return 100.0
    pesos = [PESOS.get(t, 1) for t in tarefas]
    feito = sum(pesos[:estado["feitas"]])
    if estado["feitas"] < len(tarefas):
        feito += pesos[estado["feitas"]] * estado["fracao"]
    return round(100 * feito / sum(pesos), 1)


if __name__ == "__main__":
    iniciar(["mercado_livre", "shopee"])
    assert percentual() == 0.0
    tarefa("mercado_livre", 0); parcial(0.5)
    assert percentual() == round(100 * 6 / 13, 1)
    tarefa("shopee", 1)
    assert percentual() == round(100 * 12 / 13, 1)
    terminar()
    assert percentual() == 100.0
    print("ok")
