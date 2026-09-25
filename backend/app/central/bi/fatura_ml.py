"""Tarifas de devolução como estão na fatura do ML (fonte oficial do que foi cobrado). A fatura fecha no dia 12:
o ciclo de uma fatura vai do dia 13 do mês anterior ao dia 12 do mês dela (chave "AAAA-MM-01")."""

import time
from datetime import date

from sqlalchemy import Column, Date, Float, String, select

from app.central.db import Base, Sessao

# Cobranças (C…) e estornos/cancelamentos (B…) de tarifa de devolução. Frete de ida (CFFI, CXDI…) fica de fora.
COBRANCAS = {"CXDID": "Devolução por envio interno no município", "CXDED": "Devolução por envio externo ou intermunicipal",
             "CDSDB": "Tarifa de devolução"}
ESTORNOS = {"BXDID", "BXDED", "BDSDB"}
RELEITURA_ABERTA_S = 3 * 3600
_lida_em: dict[str, float] = {}


class TarifaDevolucaoML(Base):
    __tablename__ = "fatura_ml_devolucao"

    detalhe_id = Column(String(20), primary_key=True)
    fatura = Column(String(10), index=True, nullable=False)  # chave da fatura, ex.: 2026-09-01
    tipo = Column(String(10), nullable=False)
    pedido = Column(String(40))
    valor = Column(Float, nullable=False)  # cobrança positiva, estorno negativo
    data = Column(Date)


def ciclo(chave: str) -> tuple[date, date]:
    """'2026-09-01' → 13/ago a 12/set."""
    ano, mes = int(chave[:4]), int(chave[5:7])
    ini = date(ano - 1, 12, 13) if mes == 1 else date(ano, mes - 1, 13)
    return ini, date(ano, mes, 12)


def chave_do_dia(d: date) -> str:
    ano, mes = (d.year, d.month) if d.day <= 12 else (d.year + (d.month == 12), d.month % 12 + 1)
    return f"{ano}-{mes:02d}-01"


def _baixar(chave: str) -> list[TarifaDevolucaoML]:
    from app.central.mercado_livre import client
    linhas, offset = [], 0
    while True:
        r = client.get(f"/billing/integration/periods/key/{chave}/group/ML/details",
                       {"document_type": "BILL", "detail_sub_types": ",".join([*COBRANCAS, *ESTORNOS]),
                        "limit": 150, "offset": offset}) or {}
        res = r.get("results") or []
        for x in res:
            ci, vendas = x["charge_info"], x.get("sales_info") or [{}]
            sinal = 1 if ci["detail_type"] == "CHARGE" else -1
            dia = date.fromisoformat(ci["creation_date_time"][:10])
            # A API repete lançamentos em faturas vizinhas (o período dela começa um mês antes): vale a data.
            linhas.append(TarifaDevolucaoML(
                detalhe_id=str(ci["detail_id"]), fatura=chave_do_dia(dia), tipo=ci["detail_sub_type"],
                pedido=str(vendas[0].get("order_id") or "") or None, valor=round(sinal * ci["detail_amount"], 2),
                data=dia))
        offset += len(res)
        if not res or offset >= r.get("total", 0):
            return linhas
        time.sleep(1.5)  # a API de faturamento corta rajadas com 429


def sincronizar(meses: int = 3) -> dict:
    """Fatura fechada é lida uma vez; a aberta é relida de 3 em 3 h."""
    hoje = date.today()
    chaves, d = [], hoje
    for _ in range(meses):
        chaves.append(chave_do_dia(d))
        d = ciclo(chaves[-1])[0].replace(day=1)
    with Sessao() as s:
        ja_tem = set(s.scalars(select(TarifaDevolucaoML.fatura).distinct()))
    feitas = {}
    for chave in chaves:
        aberta = ciclo(chave)[1] >= hoje
        if (chave in ja_tem and not aberta) or time.time() - _lida_em.get(chave, 0) < RELEITURA_ABERTA_S:
            continue
        try:
            linhas = _baixar(chave)
        except RuntimeError as e:  # 429 da API de faturamento: este mês fica para a próxima rodada, os outros seguem
            feitas[chave] = f"erro: {e}"[:120]
            continue
        with Sessao.begin() as s:
            for l in linhas:
                s.merge(l)
        _lida_em[chave] = time.time()
        feitas[chave] = len(linhas)
    return feitas


def refazer(chave: str) -> int:
    """Apaga e baixa de novo os lançamentos de devolução de uma fatura (releitura pesada do fechamento)."""
    linhas = _baixar(chave)
    with Sessao.begin() as s:
        s.query(TarifaDevolucaoML).filter(TarifaDevolucaoML.fatura == chave).delete()
        for l in linhas:
            s.merge(l)
    _lida_em[chave] = time.time()
    return len(linhas)


def por_fatura() -> dict[str, dict]:
    """chave → {cobrado, estornado, liquido, por_tipo}."""
    saida: dict[str, dict] = {}
    with Sessao() as s:
        for t in s.scalars(select(TarifaDevolucaoML)):
            f = saida.setdefault(t.fatura, {"cobrado": 0.0, "estornado": 0.0, "por_tipo": {}})
            if t.valor >= 0:
                f["cobrado"] += t.valor
                f["por_tipo"][t.tipo] = f["por_tipo"].get(t.tipo, 0.0) + t.valor
            else:
                f["estornado"] -= t.valor
    return {k: {"cobrado": round(v["cobrado"], 2), "estornado": round(v["estornado"], 2),
                "liquido": round(v["cobrado"] - v["estornado"], 2),
                "por_tipo": [{"tipo": COBRANCAS.get(t, t), "valor": round(x, 2)} for t, x in v["por_tipo"].items()]}
            for k, v in saida.items()}


if __name__ == "__main__":
    assert ciclo("2026-09-01") == (date(2026, 8, 13), date(2026, 9, 12))
    assert ciclo("2026-01-01") == (date(2025, 12, 13), date(2026, 1, 12))
    assert chave_do_dia(date(2026, 9, 12)) == "2026-09-01" and chave_do_dia(date(2026, 9, 13)) == "2026-10-01"
    assert chave_do_dia(date(2026, 12, 20)) == "2027-01-01"
    print("ok")
