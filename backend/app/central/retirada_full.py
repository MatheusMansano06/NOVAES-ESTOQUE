"""Retirada do Full: produto que voltou do Full do ML. A etiqueta Full traz o inventory_id do anúncio;
bipou, identifica o SKU e dá entrada no orgânico (depósito vendável da Olist)."""

import json
import re

from database import SessionLocal
from app.central.financeiro.custos import custo_do_sku
from app.central.olist import servico as olist
from app.integracoes_ml import ml
from app.models import MercadoLivreItemCache

ETIQUETA = re.compile(r"^[A-Z]{4}\d{5}$")


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


def dar_entrada(codigo: str, quantidade) -> dict:
    """Clique do operador. Kit entra por componente (a Olist não aceita lançamento em kit)."""
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
    return {**p, "quantidade": quantidade, "lancados": feitos}
