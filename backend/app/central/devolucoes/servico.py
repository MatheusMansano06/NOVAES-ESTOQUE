"""Contrato da trilha de Devoluções. Cada plataforma entrega dicts com as colunas de `Devolucao`;
esta trilha não importa nenhuma plataforma."""

import re
from datetime import datetime, timezone

from sqlalchemy import delete, select

from app.central.db import Sessao

from .modelo import CodigoDevolucao, Devolucao

ETAPAS = {"solicitada", "em_transito", "entregue", "encerrada", "cancelada"}
MOTIVOS = {"arrependimento", "nao_serviu", "diferente", "defeito", "incompleto", "danificado", "nao_recebido", "outro"}
# Quem a plataforma responsabiliza — é isso que decide quem paga o frete reverso.
RESPONSAVEIS = {"comprador", "vendedor", "a_definir"}
DESTINOS = {"vendedor", "cd_plataforma", "sem_retorno"}
_DOMINIOS = {"etapa": ETAPAS, "motivo": MOTIVOS, "responsavel": RESPONSAVEIS, "destino": DESTINOS}


def _utc(dt: datetime | None) -> datetime | None:
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt and dt.tzinfo else dt


def validar(r: dict) -> dict:
    for campo, dominio in _DOMINIOS.items():
        if r[campo] not in dominio:
            raise ValueError(f"{r['plataforma']} {r['id_externo']}: {campo}={r[campo]!r} fora de {sorted(dominio)}")
    for campo in ("aberta_em", "atualizada_em", "prazo_vendedor"):
        r[campo] = _utc(r[campo])
    return r


def normalizar_codigo(codigo: str) -> str:
    return re.sub(r"\s+", "", str(codigo)).upper()


def _trocar_codigos(s, devolucao_id: int, codigos, origem: str) -> None:
    s.execute(delete(CodigoDevolucao).where(CodigoDevolucao.devolucao_id == devolucao_id, CodigoDevolucao.origem == origem))
    for c in {normalizar_codigo(c) for c in codigos if c and str(c).strip()}:
        s.merge(CodigoDevolucao(codigo=c, devolucao_id=devolucao_id, origem=origem))


def salvar(registros: list[dict]) -> int:
    with Sessao.begin() as s:
        for r in map(validar, registros):
            codigos = r.pop("codigos", [])
            atual = s.scalar(select(Devolucao).filter_by(plataforma=r["plataforma"], id_externo=r["id_externo"]))
            if atual:
                for campo, valor in r.items():
                    setattr(atual, campo, valor)
            else:
                atual = Devolucao(**r)
                s.add(atual)
                s.flush()
            _trocar_codigos(s, atual.id, codigos, r["plataforma"])
    return len(registros)


def adicionar_codigos(devolucao_id: int, codigos, origem: str, substituir: bool = True) -> None:
    """Códigos que outra trilha descobriu (ex.: chave da NF de venda na Olist). substituir=False acumula
    (códigos aprendidos no bipe não somem na próxima sincronização)."""
    with Sessao.begin() as s:
        if substituir:
            _trocar_codigos(s, devolucao_id, codigos, origem)
        else:
            for c in {normalizar_codigo(c) for c in codigos if c}:
                s.merge(CodigoDevolucao(codigo=c, devolucao_id=devolucao_id, origem=origem))


def ids_por_codigos(candidatos) -> list[int]:
    alvos = {normalizar_codigo(c) for c in candidatos}
    if not alvos:
        return []
    with Sessao() as s:
        return sorted(set(s.scalars(select(CodigoDevolucao.devolucao_id).where(CodigoDevolucao.codigo.in_(alvos)))))


def publico(d: Devolucao) -> dict:
    return {c.name: getattr(d, c.name) for c in Devolucao.__table__.columns if c.name != "bruto"}
