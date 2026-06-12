"""
Utilitários para gerenciamento de fornecedores
"""

from sqlalchemy.orm import Session
from app.models import Fornecedor, NotaFiscal


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


def linkar_fornecedor_nf(db: Session, nf: NotaFiscal) -> bool:
    """
    Garante que uma nota fiscal está linkada a um fornecedor.
    Se não tiver fornecedor_id, cria/busca o fornecedor baseado no nome da NF
    e atualiza a nota fiscal.

    Retorna True se sucesso, False caso contrário.
    """
    if not nf:
        return False

    # Se já tem fornecedor_id, nada a fazer
    if nf.fornecedor_id:
        return True

    # Garantir que fornecedor existe
    fornecedor = garantir_fornecedor(
        db,
        nome=nf.fornecedor,
        cnpj=nf.cnpj,
        endereco=nf.endereco
    )

    if fornecedor:
        nf.fornecedor_id = fornecedor.id
        return True

    return False
