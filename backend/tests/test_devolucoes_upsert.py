"""
Trava o comportamento do upsert de devoluções vindas do ML.

O que está em jogo: o upsert NÃO pode desfazer a decisão do operador. Se ele já
conferiu e fechou a devolução, um re-sync não pode reabrir. Estes testes fixam
as regras de preservação portadas de DEVOLUCOES-ML-main.

    cd backend && python -m unittest tests.test_devolucoes_upsert -v
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class UpsertDevolucoesTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Banco isolado ANTES de importar os módulos (o engine é criado no import).
        cls._tmp = tempfile.mkdtemp()
        cls._db = os.path.join(cls._tmp, "t.db").replace("\\", "/")
        os.environ["DATABASE_URL"] = f"sqlite:///{cls._db}"

        from sqlalchemy import create_engine
        from database import Base
        from app import models  # noqa: F401  (registra as tabelas)

        cls.engine = create_engine(f"sqlite:///{cls._db}")
        Base.metadata.create_all(bind=cls.engine)

        import app.devolucoes_sync as s
        from sqlalchemy.orm import sessionmaker
        # Aponta o módulo para o banco de teste.
        s.SessionLocal = sessionmaker(bind=cls.engine)
        cls.s = s

        # Corta a rede: quando a tarifa vem zerada, resolved_return_fee consulta
        # /charges/return-cost no ML de verdade. Teste não pode depender disso.
        cls._chamadas_ml = []
        s.ml_claim_return_cost = lambda cid: (cls._chamadas_ml.append(cid), 0.0)[1]

    def setUp(self):
        with self.engine.begin() as c:
            c.exec_driver_sql("DELETE FROM devolucoes")
        self._chamadas_ml.clear()

    def _base_item(self, **kw):
        item = {
            "marketplace": "Mercado Livre", "pedido_id": "P1", "cliente_nome": "Fulano",
            "produto_nome": "Produto", "motivo_devolucao": "arrependimento",
            "valor_produto": 100.0, "status": "aguardando_produto",
            "data_solicitacao": "2026-07-01T00:00:00+00:00", "codigo_rastreio": "",
            "valor_recuperado": 0.0, "valor_perdido": 0.0, "observacao_final": "",
            "ml_claim_id": "C1", "ml_status": "opened", "ml_stage": "claim",
            "ml_return_status": "shipped", "ml_destino_devolucao": "seller_address",
            "ml_tipo_logistica": "seller_address", "prazo_resolucao": None,
            "prioridade_prazo": "", "requer_acao": 1, "acao_recomendada": "",
            "produto_imagem": "", "chegada_status": "", "mediacao_mensagem": "",
            "ml_ativo": 1, "ml_valor_pago": 100.0, "ml_valor_reembolsado": 0.0,
            "ml_taxa_venda": 10.0, "ml_custo_envio": 0.0, "ml_status_pagamento": "paid",
            "ml_return_id": "R1", "ml_return_subtype": "", "ml_status_money": "",
            "ml_refund_at": "", "ml_seller_status": "", "ml_seller_reason": "",
            "ml_product_condition": "", "ml_return_reviews": "[]",
            "ml_tarifa_devolucao": 0.0,
        }
        item.update(kw)
        return item

    def _linha(self, claim="C1"):
        return self.s._linha("SELECT * FROM devolucoes WHERE ml_claim_id = :c", {"c": claim})

    # ---------------------------------------------------------------- básico

    def test_primeira_sync_cria_e_segunda_atualiza(self):
        self.assertEqual(self.s.upsert_ml_devolucao(self._base_item()), "created")
        self.assertEqual(self.s.upsert_ml_devolucao(self._base_item(ml_status="closed")), "updated")
        with self.engine.begin() as c:
            self.assertEqual(c.exec_driver_sql("SELECT COUNT(*) FROM devolucoes").scalar(), 1)
        self.assertEqual(self._linha()["ml_status"], "closed")

    def test_claims_diferentes_no_mesmo_pedido_nao_se_fundem(self):
        """Dois claims distintos do mesmo pedido são devoluções distintas."""
        self.s.upsert_ml_devolucao(self._base_item(ml_claim_id="C1"))
        self.s.upsert_ml_devolucao(self._base_item(ml_claim_id="C2"))
        with self.engine.begin() as c:
            self.assertEqual(c.exec_driver_sql("SELECT COUNT(*) FROM devolucoes").scalar(), 2)

    def test_devolucao_manual_sem_claim_e_adotada_pelo_sync(self):
        """Criada à mão para o pedido, o sync assume ela em vez de duplicar."""
        self.s.upsert_ml_devolucao(self._base_item(ml_claim_id=None))
        self.assertEqual(self.s.upsert_ml_devolucao(self._base_item(ml_claim_id="C1")), "updated")
        with self.engine.begin() as c:
            self.assertEqual(c.exec_driver_sql("SELECT COUNT(*) FROM devolucoes").scalar(), 1)

    # ------------------------------------- preservação da decisão do operador

    def test_sem_divergencia_sobrevive_ao_resync(self):
        """Operador conferiu e fechou: re-sync não reabre."""
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='sem_divergencia', chegada_status='esperado' "
                              "WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(status="aguardando_produto", requer_acao=0))
        row = self._linha()
        self.assertEqual(row["status"], "sem_divergencia")
        self.assertEqual(row["ml_ativo"], 0)

    def test_ml_pedindo_acao_reabre_mesmo_fechado_localmente(self):
        """Se o ML ainda exige ação, o fechamento local não vale."""
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='sem_divergencia', chegada_status='esperado' "
                              "WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(status="em_analise", requer_acao=1))
        self.assertEqual(self._linha()["status"], "em_analise")

    def test_apelo_pendente_do_full_vence_o_fechamento_local(self):
        """Review do Full com apelo pendente força reabrir e pedir ação."""
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='sem_divergencia', chegada_status='esperado' "
                              "WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            requer_acao=0,
            ml_return_reviews='[{"resource_reviews":[{"seller_status":"pending"}]}]'))
        row = self._linha()
        self.assertEqual(row["status"], "produto_recebido")
        self.assertEqual(row["requer_acao"], 1)
        self.assertEqual(row["ml_ativo"], 1)

    # ---------------------------------------------------------- mediação

    def test_mediacao_fechada_a_favor_do_vendedor_recupera_o_valor(self):
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0, ml_tarifa_devolucao=5.0,
            _claim_resolution={"benefited": ["respondent"], "reason": "item_returned"}))
        row = self._linha()
        self.assertEqual(row["status"], "aprovado")
        self.assertEqual(row["valor_recuperado"], 100.0)
        self.assertEqual(row["valor_perdido"], 0.0)
        self.assertEqual(row["ml_ativo"], 0)

    def test_mediacao_fechada_a_favor_do_comprador_perde_o_valor(self):
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0, ml_tarifa_devolucao=1.0,
            _claim_resolution={"benefited": ["complainant"], "reason": "item_returned"}))
        row = self._linha()
        self.assertEqual(row["status"], "reprovado")
        self.assertEqual(row["valor_recuperado"], 0.0)
        self.assertEqual(row["valor_perdido"], 100.0)

    def test_mediacao_parcial_reparte_pelo_reembolsado(self):
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0, ml_tarifa_devolucao=1.0,
            ml_valor_pago=100.0, ml_valor_reembolsado=30.0,
            _claim_resolution={"benefited": ["respondent", "complainant"], "reason": "x"}))
        row = self._linha()
        self.assertEqual(row["status"], "parcial")
        self.assertEqual(row["valor_recuperado"], 70.0)
        self.assertEqual(row["valor_perdido"], 30.0)

    def test_decisao_final_ja_registrada_vence_a_recalculada(self):
        """Se já havia veredito local, o sync não o sobrescreve."""
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='parcial', valor_recuperado=42.0, "
                              "valor_perdido=58.0, observacao_final='decidido na mao', "
                              "ml_tarifa_devolucao=7.0 WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0,
            _claim_resolution={"benefited": ["respondent"], "reason": "item_returned"}))
        row = self._linha()
        self.assertEqual(row["status"], "parcial")
        self.assertEqual(row["valor_recuperado"], 42.0)
        self.assertEqual(row["valor_perdido"], 58.0)
        self.assertEqual(row["observacao_final"], "decidido na mao")

    def test_tarifa_zerada_busca_o_custo_no_ml(self):
        """
        Com a tarifa zerada, o fechamento da mediação consulta
        /charges/return-cost. Fixa esse contrato (aqui o ML está mockado).
        """
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0, ml_tarifa_devolucao=0.0,
            _claim_resolution={"benefited": ["respondent"], "reason": "item_returned"}))
        self.assertEqual(self._chamadas_ml, ["C1"])

    def test_tarifa_ja_conhecida_nao_consulta_o_ml(self):
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(
            ml_status="closed", requer_acao=0, ml_tarifa_devolucao=5.0,
            _claim_resolution={"benefited": ["respondent"], "reason": "item_returned"}))
        self.assertEqual(self._chamadas_ml, [])
        self.assertEqual(self._linha()["ml_tarifa_devolucao"], 5.0)

    def test_mediacao_aberta_fica_aguardando_plataforma(self):
        self.s.upsert_ml_devolucao(self._base_item())
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE devolucoes SET status='contestacao_aberta' WHERE ml_claim_id='C1'")
        self.s.upsert_ml_devolucao(self._base_item(ml_status="opened", requer_acao=0))
        row = self._linha()
        self.assertEqual(row["status"], "aguardando_plataforma")
        self.assertEqual(row["ml_ativo"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
