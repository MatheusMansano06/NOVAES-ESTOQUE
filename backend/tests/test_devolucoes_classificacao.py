"""
Trava as regras CONGELADAS de classificação de devoluções ML.

Ver docs/devolucoes/REGRAS_CONGELADAS.md. Se um destes testes quebrar, você
alterou o comportamento das regras canônicas — o que exige aprovação explícita
e atualização da bíblia. Regerar o golden para calar o teste anula o propósito
dele.

Contexto do port (15/07/2026): a lógica veio de DEVOLUCOES-ML-main/app.py e foi
portada verbatim. A equivalência foi provada por teste diferencial rodando o
original e o port sobre 1.728.000 combinações, com 0 divergências. Este golden
congela aquele comportamento sem depender do projeto original estar por perto.

    cd backend && python -m unittest tests.test_devolucoes_classificacao -v
"""
import hashlib
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import devolucoes_ml as d
from tests.gerar_golden_classificacao import gerar, monta_claim

GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden_classificacao.json")


class ClassificacaoCongeladaTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(GOLDEN, encoding="utf-8") as f:
            cls.golden = json.load(f)

    def _classificar(self, e: dict) -> tuple[str, str]:
        # claim_attention_detail bate na API do ML; fixado a partir da entrada.
        d.claim_attention_detail = (
            lambda cid, lu="", _t=e["title"], _r=e["responsible"]: {
                "title": _t, "action_responsible": _r, "due_date": "", "problem": ""})
        claim = monta_claim(e["acoes"], e["claim_type"], e["stage"], e["claim_status"],
                            e["com_resolucao"], e["com_due"])
        return d.classify_ml_live_queue_claim(claim, {
            "status": e["return_status"], "shipment_status": e["shipment_status"],
            "shipment_destination": e["destination"], "related_entities": e["related"],
        })

    def test_amostras_batem_com_o_golden(self):
        """Cada amostra gravada continua caindo no mesmo bucket, pela mesma regra."""
        for caso in self.golden["amostras"]:
            with self.subTest(regra=caso["regra"]):
                bucket, regra = self._classificar(caso["entrada"])
                self.assertEqual(bucket, caso["bucket"])
                self.assertEqual(regra, caso["regra"])

    def test_espaco_completo_tem_o_mesmo_hash(self):
        """
        Reclassifica o espaço inteiro (~1.3M casos) e compara o hash das saídas.
        É o que pega uma mudança numa combinação que não virou amostra.
        """
        casos = gerar()
        self.assertEqual(len(casos), self.golden["total_casos"])
        h = hashlib.sha256()
        for c in casos:
            h.update(f"{c['bucket']}|{c['regra']}\n".encode())
        self.assertEqual(h.hexdigest(), self.golden["hash_total"],
                         "As regras congeladas mudaram de comportamento. Isso exige "
                         "aprovação + atualização de docs/devolucoes/REGRAS_CONGELADAS.md.")

    def test_as_16_regras_seguem_alcancaveis(self):
        """Nenhuma regra virou código morto (ex.: um if novo sombreando outro)."""
        alcancadas = {c["regra"].split(":")[0] for c in gerar()}
        self.assertEqual(sorted(alcancadas), self.golden["regras_distintas"])

    def test_buckets_sao_apenas_os_quatro_canonicos(self):
        buckets = {c["bucket"] for c in self.golden["amostras"]}
        self.assertTrue(
            buckets <= {"para_revisao", "para_retirar", "outros_problemas", "fora_da_fila"},
            f"bucket fora dos 4 canônicos da bíblia: {buckets}")

    def test_para_revisao_exige_nao_ter_sido_revisado(self):
        """
        Regra 1 da bíblia, escrita à mão (não derivada do golden).

        Equivale ao test_para_revisao_requires_no_prior_reviews do projeto de
        origem — um dos testes que passavam lá.
        """
        claim = {
            "id": "c-rev", "status": "opened", "stage": "claim", "type": "returns",
            "players": [{"type": "respondent", "available_actions": [
                {"action": "return_review_unified_ok", "mandatory": True,
                 "due_date": "2026-06-01T00:00:00Z"},
            ]}],
        }
        d.claim_attention_detail = lambda cid, lu="": {
            "title": "", "action_responsible": "", "due_date": "", "problem": ""}

        bucket, _ = d.classify_ml_live_queue_claim(
            claim, {"status": "delivered", "shipment_status": "", "related_entities": []})
        self.assertEqual(bucket, "para_revisao")

        # Já revisado (related_entities tem "reviews") => sai da fila de revisão.
        bucket_revisado, _ = d.classify_ml_live_queue_claim(
            claim, {"status": "delivered", "shipment_status": "", "related_entities": ["reviews"]})
        self.assertNotEqual(bucket_revisado, "para_revisao")


if __name__ == "__main__":
    unittest.main(verbosity=2)
