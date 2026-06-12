"""
Script para popular banco com dados de teste
Útil para demonstração e testes
"""

from datetime import datetime, timedelta
from database import SessionLocal
from app.models import (
    NotaFiscal, ItemEstoque, StatusEstoque, VinculoOlist, ConfirmacaoEstoque
)

def seed_data():
    """Popula banco com dados de teste"""
    db = SessionLocal()

    try:
        # Limpar dados antigos
        db.query(ConfirmacaoEstoque).delete()
        db.query(ItemEstoque).delete()
        db.query(NotaFiscal).delete()
        db.query(VinculoOlist).delete()
        db.commit()
        print("[OK] Banco limpado")

        # Criar 3 notas fiscais de teste
        notas = [
            {
                "numero_nf": "226346",
                "serie": "20",
                "fornecedor": "STARPLAST INDUSTRIA",
                "cnpj": "54649470000100",
                "endereco": "AV. BENEDITO FRANCO, 100",
            },
            {
                "numero_nf": "226347",
                "serie": "20",
                "fornecedor": "PEELS ACESSORIOS LTDA",
                "cnpj": "12345678000100",
                "endereco": "RUA PRINCIPAL, 500",
            },
            {
                "numero_nf": "226348",
                "serie": "20",
                "fornecedor": "CAPACETES BRASIL S.A.",
                "cnpj": "98765432000100",
                "endereco": "AVENIDA CENTRAL, 1000",
            },
        ]

        nf_objects = []
        for i, nf_data in enumerate(notas):
            nf = NotaFiscal(
                numero_nf=nf_data["numero_nf"],
                serie=nf_data["serie"],
                fornecedor=nf_data["fornecedor"],
                cnpj=nf_data["cnpj"],
                endereco=nf_data["endereco"],
                data_emissao=datetime.utcnow() - timedelta(days=5-i),
                arquivo_original=f"nf_{i}.xml",
                tipo_documento="nfe",
                status="processado"
            )
            db.add(nf)
            db.flush()
            nf_objects.append(nf)
            print(f"[OK] NF-e #{nf.numero_nf} criada")

        db.commit()

        # Criar itens de estoque
        produtos = [
            {"codigo": "A16520160ZZ54", "desc": "VISEIRA FUME SPIKE II", "preco": 37.98, "qtd": 10},
            {"codigo": "A16520160ZZ55", "desc": "VISEIRA FUME SPIKE III", "preco": 45.00, "qtd": 5},
            {"codigo": "A16520160ZZ56", "desc": "CAPACETE SPIKE PRETO", "preco": 120.00, "qtd": 3},
            {"codigo": "A16520160ZZ57", "desc": "LUVA PROTEÇÃO COURO", "preco": 25.50, "qtd": 20},
        ]

        for nf in nf_objects:
            for i, prod in enumerate(produtos[:2]):  # 2 produtos por NF
                item = ItemEstoque(
                    nf_id=nf.id,
                    codigo_produto=prod["codigo"],
                    descricao=prod["desc"],
                    quantidade_nf=prod["qtd"],
                    quantidade_confirmada=prod["qtd"],
                    preco_unitario=prod["preco"],
                    status=StatusEstoque.CONFIRMADO,
                    data_criacao=datetime.utcnow()
                )
                db.add(item)
                print(f"  [OK] Item: {prod['desc']} ({prod['qtd']} un)")

        db.commit()
        print(f"\n[OK] {len(nf_objects)} notas fiscais criadas com sucesso!")
        print(f"[OK] {len(produtos) * len(nf_objects)} itens de estoque criados!")

        # Criar alguns vínculos Olist para exemplo
        vinculos_data = [
            {
                "nf_codigo": "A16520160ZZ54",
                "nf_descricao": "VISEIRA FUME SPIKE II",
                "olist_produto_id": "736997853",
                "olist_sku": "VFUMEPEELS2",
                "olist_nome": "Viseira Capacete Peels Spike 2 Fechado",
                "olist_preco": 45.00,
            }
        ]

        for vinc in vinculos_data:
            v = VinculoOlist(**vinc, vezes_usado=1)
            db.add(v)
            print(f"[OK] Vinculo: {vinc['olist_sku']}")

        db.commit()
        print("\n[OK] Dados de teste carregados com sucesso!")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Erro: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_data()
