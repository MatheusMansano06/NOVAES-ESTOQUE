"""
Gera o fixture golden_classificacao.json a partir da classificação vigente.

RODAR SÓ quando uma mudança nas regras for APROVADA (ver docs/devolucoes/
REGRAS_CONGELADAS.md). Regerar o golden para "consertar" um teste que quebrou
é justamente o que o congelamento existe para impedir.

    python -m tests.gerar_golden_classificacao   (a partir de backend/)
"""
import itertools
import json
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import devolucoes_ml as d

# Espaço de entrada: escolhido para atingir as 16 regras da bíblia.
ACTIONS = [
    [], ["return_review_unified_ok"], ["return_review_unified_fail"],
    ["return_review_ok"], ["send_message_to_mediator"],
    ["return_review_unified_ok", "send_message_to_mediator"], ["outra_acao"],
]
RETURN_STATUS = ["", "delivered", "shipped", "label_generated", "expired", "failed", "cancelled", "in_return"]
SHIPMENT_STATUS = ["", "delivered", "shipped", "ready_to_ship", "cancelled"]
DESTINATION = ["", "warehouse", "seller_address"]
CLAIM_TYPE = ["returns", "mediations"]
CLAIM_STAGE = ["claim", "dispute"]
CLAIM_STATUS = ["opened", "closed"]
RELATED = [[], ["reviews"]]
TITLES = ["", "retirar na correios", "devolucao com data atualizada", "devolucao em revisao",
          "mediacao em espera de resposta do mercado livre"]
RESPONSIBLES = ["", "respondent", "seller", "mediator", "complainant"]

# Datas fixas: o golden não pode depender de "agora", senão quebra sozinho amanhã.
BASE = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)


def monta_claim(acts, ctype, cstage, cstatus, com_resolucao, com_due):
    return {
        "id": "c-golden",
        "status": cstatus,
        "stage": cstage,
        "type": ctype,
        "last_updated": (BASE - timedelta(hours=2)).isoformat(),
        "resolution": ({"reason": "item_returned", "benefited": ["complainant"],
                        "date_created": (BASE - timedelta(days=5)).isoformat()}
                       if com_resolucao else {}),
        "players": [{"type": "respondent", "available_actions": [
            {"action": a, "mandatory": True,
             **({"due_date": (BASE + timedelta(days=3)).isoformat()} if com_due else {})}
            for a in acts
        ]}],
    }


def gerar() -> list[dict]:
    casos = []
    for acts, ctype, cstage, cstatus in itertools.product(ACTIONS, CLAIM_TYPE, CLAIM_STAGE, CLAIM_STATUS):
        for rs, ss, dest in itertools.product(RETURN_STATUS, SHIPMENT_STATUS, DESTINATION):
            for rel, titulo, resp, com_res, com_due in itertools.product(
                    RELATED, TITLES, RESPONSIBLES, [True, False], [True, False]):
                # claim_attention_detail bate na API do ML; aqui é fixado.
                d.claim_attention_detail = (
                    lambda cid, lu="", _t=titulo, _r=resp: {
                        "title": _t, "action_responsible": _r, "due_date": "", "problem": ""})
                claim = monta_claim(acts, ctype, cstage, cstatus, com_res, com_due)
                info = {"status": rs, "shipment_status": ss,
                        "shipment_destination": dest, "related_entities": rel}
                bucket, regra = d.classify_ml_live_queue_claim(claim, dict(info))
                casos.append({
                    "entrada": {"acoes": acts, "claim_type": ctype, "stage": cstage,
                                "claim_status": cstatus, "return_status": rs,
                                "shipment_status": ss, "destination": dest,
                                "related": rel, "title": titulo, "responsible": resp,
                                "com_resolucao": com_res, "com_due": com_due},
                    "bucket": bucket, "regra": regra,
                })
    return casos


MAX_POR_REGRA = 12


def compactar(casos: list[dict]) -> dict:
    """
    O espaço completo tem >1M casos (~570MB em JSON) — não cabe no repo.

    Guardamos duas coisas:
    - `amostras`: até MAX_POR_REGRA casos por `regra` COMPLETA (com os sufixos
      `:status:shipment:dest`), o que dá cobertura das 16 regras e das variações
      que elas reportam;
    - `hash_total`: sha256 de TODAS as saídas do espaço, em ordem determinística.
      É ele que pega uma alteração numa combinação que não virou amostra.
    """
    import hashlib
    from collections import defaultdict

    por_regra = defaultdict(list)
    for c in casos:
        # Agrupa pela regra-base (antes do sufixo ":status:shipment:dest"): são 16.
        # As variações de sufixo ficam cobertas pelo hash_total.
        por_regra[c["regra"].split(":")[0]].append(c)

    amostras = []
    for regra in sorted(por_regra):
        amostras.extend(por_regra[regra][:MAX_POR_REGRA])

    h = hashlib.sha256()
    for c in casos:
        h.update(f"{c['bucket']}|{c['regra']}\n".encode())

    return {
        "_leia_me": ("Golden das regras CONGELADAS de classificação de devoluções ML. "
                     "Ver docs/devolucoes/REGRAS_CONGELADAS.md. Se este arquivo mudou "
                     "num diff, as regras congeladas mudaram — isso exige aprovação."),
        "total_casos": len(casos),
        "hash_total": h.hexdigest(),
        "regras_distintas": sorted({c["regra"].split(":")[0] for c in casos}),
        "amostras": amostras,
    }


if __name__ == "__main__":
    casos = gerar()
    golden = compactar(casos)
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden_classificacao.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(golden, f, ensure_ascii=False, indent=1)
    from collections import Counter
    print(f"espaço total: {len(casos)} casos")
    print(f"golden:       {len(golden['amostras'])} amostras -> {destino}")
    print(f"hash_total:   {golden['hash_total']}")
    print("buckets:", dict(Counter(c["bucket"] for c in casos)))
    print("regras distintas:", len(golden["regras_distintas"]))
