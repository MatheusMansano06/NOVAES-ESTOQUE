from datetime import datetime, timedelta, timezone

from app.central import progresso
from app.central.devolucoes import servico as devolucoes

from . import client
from .normalizar import normalizar, normalizar_nao_entregue

_triagem: dict[str, str | None] = {}


def _triagem_do_motivo(reason_id: str) -> str | None:
    if reason_id not in _triagem:
        motivo = client.get(f"/post-purchase/v1/claims/reasons/{reason_id}") or {}
        _triagem[reason_id] = next(iter(motivo.get("settings", {}).get("rules_engine_triage") or []), None)
    return _triagem[reason_id]


def sincronizar(dias: float = 30, todas_abertas: bool = False):
    """Traz reclamações com devolução atualizadas nos últimos `dias` e grava no formato único.
    `todas_abertas`: traz também toda reclamação ainda aberta, de qualquer data — as antigas sem movimento
    não aparecem na janela de datas e sumiriam da operação."""
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    salvas, falhas, reclamacoes = 0, [], 0
    # O ML não aceita só vendedor+data: exige um filtro "de verdade", então busca por status.
    for parte, status in enumerate(("opened", "closed")):
        filtro_data = {} if status == "opened" and todas_abertas else {"range": f"last_updated:after:{desde}"}
        offset, total = 0, 1
        # ponytail: sequencial, ~4 chamadas por reclamação; paralelizar ou usar webhook quando o volume pesar.
        while offset < min(total, 9900):
            busca = client.get("/post-purchase/v1/claims/search", {
                "players.user_id": client.USER_ID, "players.role": "respondent", "status": status,
                **filtro_data, "sort": "last_updated:desc", "limit": 100, "offset": offset,
            })
            total = busca["paging"]["total"]
            offset += 100
            registros = []  # grava a cada página: uma carga longa que cair no meio não perde o que já veio
            for n, claim in enumerate(busca["data"]):
                progresso.parcial((parte + min(offset - 100 + n, total) / max(total, 1)) / 2)
                try:
                    dev = client.get(f"/post-purchase/v2/claims/{claim['id']}/returns")
                    if not dev:
                        continue  # reclamação sem devolução física é assunto da trilha de Mediações
                    registros.append(normalizar(
                        claim, dev,
                        client.get(f"/post-purchase/v1/claims/{claim['id']}/charges/return-cost"),
                        client.get(f"/post-purchase/v1/claims/{claim['id']}/affects-reputation"),
                        _triagem_do_motivo(claim["reason_id"]),
                        client.get(f"/orders/{claim['resource_id']}") if claim.get("resource") == "order" else None,
                        # Revisão (vendável / sem condição / descarte) só existe depois que o produto chegou.
                        client.get(f"/post-purchase/v1/returns/{dev['id']}/reviews") if dev.get("status") == "delivered" else None,
                    ))
                except Exception as e:
                    # Uma reclamação inacessível ou fora do padrão não pode travar as outras; fica registrada.
                    falhas.append({"claim_id": claim["id"], "tipo": claim["type"], "erro": f"{type(e).__name__}: {e}"[:200]})
            salvas += devolucoes.salvar(registros)
            progresso.parcial((parte + min(offset, total) / max(total, 1)) / 2)
        reclamacoes += total
    salvas += _nao_entregues()
    return {"reclamacoes": reclamacoes, "devolucoes_salvas": salvas, "falhas": falhas}


def _nao_entregues() -> int:
    """Pacote não entregue que voltou para a Novaes: não abre reclamação, então a busca acima não vê.
    ponytail: janela fixa de 60 dias numa página (~30 pedidos/mês); paginar se passar de 50."""
    desde = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    busca = client.get("/orders/search", {"seller": client.USER_ID, "shipping.substatus": "returned",
                                          "order.date_created.from": desde, "sort": "date_desc", "limit": 50})
    return devolucoes.salvar([normalizar_nao_entregue(p) for p in (busca or {}).get("results") or []
                              if (p.get("shipping") or {}).get("id")])
