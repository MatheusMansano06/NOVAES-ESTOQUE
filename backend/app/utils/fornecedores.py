"""
Utilitários para gerenciamento de fornecedores
"""

from sqlalchemy.orm import Session
from app.models import Fornecedor


def garantir_fornecedor(db: Session, nome: str, cnpj: str = None, endereco: str = None) -> Fornecedor:
    """
    Garante que um fornecedor existe no banco.
    Se não existir, cria automaticamente.

    Retorna a instância do fornecedor.
    """
    if not nome or not nome.strip():
        return None

    nome = nome.strip()

    # Buscar fornecedor existente
    fornecedor = db.query(Fornecedor).filter(Fornecedor.nome == nome).first()

    if fornecedor:
        return fornecedor

    # Criar novo fornecedor
    fornecedor = Fornecedor(
        nome=nome,
        cnpj=cnpj.strip() if cnpj else None,
        endereco=endereco.strip() if endereco else None,
        ativo=1
    )

    db.add(fornecedor)
    db.flush()  # Para obter o ID

    return fornecedor
