"""Retirada do Full: produto que voltou do Full do ML. A etiqueta Full traz o inventory_id do anúncio;
bipou, identifica o SKU e dá entrada no orgânico (depósito vendável da Olist)."""

import json
import re
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, String, select

from database import SessionLocal
from app.central.db import Base, Sessao
from app.central.financeiro.custos import custo_do_sku
from app.central.olist import servico as olist
from app.integracoes_ml import ml
from app.models import MercadoLivreItemCache

ETIQUETA = re.compile(r"^[A-Z]{4}\d{5}$")


class RetiradaFull(Base):
    """Cada bipe de retorno do Full que deu entrada no orgânico: o que voltou, quanto, quem e quando.
    Custo é o do dia (fica gravado: mudar o custo depois não reescreve o retorno)."""
    __tablename__ = "retiradas_full"

    id = Column(Integer, primary_key=True)
    codigo = Column(String(20), nullable=False, index=True)
    item_id = Column(String(40), index=True)
    titulo = Column(String(255))
    thumbnail = Column(String(500))
    sku = Column(String(150), index=True, nullable=False)
    quantidade = Column(Integer, nullable=False)
    custo_unitario = Column(Float)
    operador = Column(String(120))
    criado_em = Column(DateTime, nullable=False, index=True)


def _custo(sku: str) -> float | None:
    try:
        return custo_do_sku(sku)
    except RuntimeError:
        return None


def _sku_da_variacao(item_id: str, codigo: str) -> str:
    """O cache não guarda as variações: o SKU de cada uma vem ao vivo do ML."""
    token = ml.get_access_token()
    if not token:
        raise RuntimeError("Mercado Livre não autorizado: reconecte a conta para ler o SKU da variação")
    body = ml._get_raw(f"/items/{item_id}", {"include_attributes": "all"}, token) or {}
    for v in body.get("variations") or []:
        if str(v.get("inventory_id")) == codigo:
            attrs = {a.get("id"): a.get("value_name") for a in v.get("attributes") or []}
            return v.get("seller_custom_field") or attrs.get("SELLER_SKU") or ""
    return ""


def identificar(codigo: str) -> dict:
    codigo = codigo.strip().upper()
    if not ETIQUETA.match(codigo):
        raise ValueError(f"{codigo!r} não é uma etiqueta do Full (4 letras + 5 números).")
    db = SessionLocal()
    try:
        r = (db.query(MercadoLivreItemCache)
             .filter(MercadoLivreItemCache.inventory_ids_json.like(f'%"{codigo}"%')).first())
    finally:
        db.close()
    if not r:
        raise LookupError(f"Etiqueta {codigo} não bate com nenhum anúncio Full. "
                          "Sincronize os anúncios do ML e bipe de novo.")
    variacoes = len(json.loads(r.inventory_ids_json)) > 1
    sku = (None if variacoes else r.sku) or _sku_da_variacao(r.item_id, codigo)
    if not sku:
        raise ValueError(f"O anúncio {r.item_id} não tem SKU cadastrado no ML: cadastre para dar entrada.")
    produto_id = olist.produto_por_sku(sku)
    if not produto_id:
        raise LookupError(f"SKU {sku} (anúncio {r.item_id}) não existe na Olist.")
    return {"codigo": codigo, "item_id": r.item_id, "titulo": r.titulo, "thumbnail": r.thumbnail,
            "sku": sku, "produto_id": produto_id, "custo": _custo(sku)}


def dar_entrada(codigo: str, quantidade, operador: str | None = None) -> dict:
    """Clique do operador. Kit entra por componente (a Olist não aceita lançamento em kit).
    Só registra na aba Retorno do Full se tudo entrou (kit pela metade já avisa pra lançar o resto à mão)."""
    if isinstance(quantidade, bool) or not isinstance(quantidade, int) or not 1 <= quantidade <= 999:
        raise ValueError("Quantidade deve ser um número inteiro entre 1 e 999.")
    p = identificar(codigo)
    deposito = olist.deposito_id("vendavel", "mercado_livre")
    feitos = []
    for pid, sku, qtd in olist.pecas(p["produto_id"], p["sku"], quantidade):
        try:
            olist.movimentar(pid, deposito, "E", qtd, _custo(sku),
                             f"Retirada do Full: etiqueta {p['codigo']} (anúncio {p['item_id']})")
        except RuntimeError as e:
            # Kit com parte lançada: o operador precisa saber o que já entrou para não lançar de novo.
            ja = ", ".join(f"{f['quantidade']:g}x {f['sku']}" for f in feitos)
            raise RuntimeError(f"{e}" + (f" — já lançado na Olist: {ja}. Lance o resto à mão." if ja else ""))
        feitos.append({"sku": sku, "quantidade": qtd})
    with Sessao.begin() as s:
        s.add(RetiradaFull(codigo=p["codigo"], item_id=p["item_id"], titulo=p["titulo"], thumbnail=p["thumbnail"],
                           sku=p["sku"], quantidade=quantidade, custo_unitario=p["custo"], operador=operador,
                           criado_em=datetime.now(timezone.utc).replace(tzinfo=None)))
    return {**p, "quantidade": quantidade, "lancados": feitos}


def historico(dias: int = 30, fatura: str | None = None) -> dict:
    """Aba Retorno do Full: o que voltou no período (dia de Brasília), por produto e bipe a bipe."""
    from zoneinfo import ZoneInfo
    from app.central.bi.servico import _periodo
    ini, fim, _, _ = _periodo(dias, fatura)
    brt, utc = ZoneInfo("America/Sao_Paulo"), ZoneInfo("UTC")
    de = datetime.combine(ini, datetime.min.time(), brt).astimezone(utc).replace(tzinfo=None)
    ate = datetime.combine(fim, datetime.max.time(), brt).astimezone(utc).replace(tzinfo=None)
    with Sessao() as s:
        linhas = s.scalars(select(RetiradaFull).where(RetiradaFull.criado_em >= de, RetiradaFull.criado_em <= ate)
                           .order_by(RetiradaFull.criado_em.desc())).all()
        bipes = [{"codigo": r.codigo, "item_id": r.item_id, "titulo": r.titulo, "thumbnail": r.thumbnail, "sku": r.sku,
                  "quantidade": r.quantidade, "custo_unitario": r.custo_unitario, "operador": r.operador,
                  "criado_em": r.criado_em} for r in linhas]
    produtos: dict = {}
    for b in bipes:  # mais recente primeiro: o primeiro de cada SKU é o último retorno
        p = produtos.setdefault(b["sku"], {"sku": b["sku"], "titulo": b["titulo"], "thumbnail": b["thumbnail"], "item_id": b["item_id"],
                                           "quantidade": 0, "bipes": 0, "valor": 0.0, "sem_custo": 0, "ultimo": b["criado_em"]})
        p["quantidade"] += b["quantidade"]
        p["bipes"] += 1
        if b["custo_unitario"] is None:
            p["sem_custo"] += b["quantidade"]
        else:
            p["valor"] = round(p["valor"] + b["custo_unitario"] * b["quantidade"], 2)
    lista = sorted(produtos.values(), key=lambda p: (-p["quantidade"], -p["valor"]))
    return {"inicio": ini.isoformat(), "fim": fim.isoformat(), "produtos": lista, "bipes": bipes[:200],
            "total": {"quantidade": sum(p["quantidade"] for p in lista), "bipes": len(bipes),
                      "valor": round(sum(p["valor"] for p in lista), 2), "skus": len(lista)}}
