"""Comparativo de margem por SKU entre Mercado Livre, Shopee e TikTok Shop.
Casa pelo SKU (normalizado); o título pode ser diferente em cada plataforma."""
import re
import threading
import time
from typing import Any, Dict, List, Optional

from app.integracoes.shopee import shopee
from app.models import CalculoTikTok, CustoProduto, MercadoLivreItemCache

# Tabela Shopee BR (CNPJ) por faixa de preço — vigente desde 01/10/2026, sem teto de comissão.
# (preço até, comissão %, taxa fixa R$). CPF paga R$3 a mais por item (não se aplica à NOVAES).
SHOPEE_FAIXAS = [(79.99, 20.0, 4.50), (99.99, 14.0, 16.0), (199.99, 14.0, 20.0), (float("inf"), 14.0, 26.0)]
SHOPEE_DEVOLUCAO_FACIL = 0.49  # por item, em toda venda


def regra_shopee(preco: float):
    for limite, pct, fixa in SHOPEE_FAIXAS:
        if preco <= limite:
            return pct, fixa


def _brl(v: float) -> str:
    return f"R${v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

_TTL = 30 * 60
_cache: Dict[str, Any] = {"ts": 0.0, "itens": {}}
_lock = threading.Lock()


def norm(sku: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (sku or "").lower())


def _preco_info(obj: dict):
    pi = (obj.get("price_info") or [{}])[0]
    return pi.get("original_price") or pi.get("current_price")


def _catalogo_shopee() -> Dict[str, dict]:
    """sku normalizado -> {titulo, preco, foto, item_id, model_id, preco_promo, promo_nome}.
    Nível model (como a planilha do gerente de contas): anúncio com variação entra uma vez por
    model_sku via get_model_list; sem variação, pelo item_sku. Varre a loja a cada 30 min."""
    with _lock:
        if time.time() - _cache["ts"] < _TTL and _cache["itens"]:
            return _cache["itens"]
        itens: Dict[str, dict] = {}
        for status in ("NORMAL", "UNLIST"):
            offset = 0
            while True:
                resp = shopee.chamar("/api/v2/product/get_item_list",
                                     {"offset": offset, "page_size": 100, "item_status": [status]})
                if resp.get("error"):
                    break
                corpo = resp.get("response") or {}
                ids = [i.get("item_id") for i in (corpo.get("item") or []) if i.get("item_id")]
                for k in range(0, len(ids), 50):
                    r2 = shopee.chamar("/api/v2/product/get_item_base_info",
                                       {"item_id_list": ",".join(str(x) for x in ids[k:k + 50])})
                    for it in (r2.get("response") or {}).get("item_list") or []:
                        fotos = (it.get("image") or {}).get("image_url_list") or []
                        base = {"titulo": it.get("item_name") or "", "foto": fotos[0] if fotos else None,
                                "item_id": str(it.get("item_id")), "model_id": ""}
                        if it.get("has_model"):
                            r3 = shopee.chamar("/api/v2/product/get_model_list", {"item_id": int(it["item_id"])})
                            for m in (r3.get("response") or {}).get("model") or []:
                                chave = norm(m.get("model_sku") or "")
                                if chave:
                                    itens[chave] = {**base, "model_id": str(m.get("model_id")), "preco": _preco_info(m)}
                        chave = norm(it.get("item_sku") or "")
                        if chave and chave not in itens:
                            itens[chave] = {**base, "preco": _preco_info(it)}
                if not corpo.get("has_next_page") or not ids:
                    break
                offset = corpo.get("next_offset", offset + len(ids))
        # Preço da "Minha Promoção": mesma coleta da planilha do gerente de contas (campanhas source 0,
        # chave model_id com fallback item_id, menor preço quando o model está em mais de uma).
        try:
            from app.negociacao_shopee import coletar_precos, resolver
            precos = coletar_precos(shopee)
        except Exception:
            precos = {}
        for info in itens.values():
            promo = resolver(precos, info["item_id"], info["model_id"]) if precos else None
            if promo and promo.get("preco"):
                info["preco_promo"] = float(promo["preco"])
                info["promo_nome"] = (promo.get("campanha_nome") or "Minha Promoção")
        _cache.update(ts=time.time(), itens=itens)
        return itens


_TIPOS_PROMO_ML = {"custom": "desconto próprio", "price_discount": "desconto", "deal": "campanha",
                   "marketplace_campaign": "campanha ML", "seller_campaign": "campanha do vendedor",
                   "lightning": "relâmpago", "dod": "oferta do dia", "smart": "co-participação",
                   "pre_negotiated": "pré-negociada", "volume": "desconto por volume"}


def _preco_ml(item_id: str) -> Optional[dict]:
    """Preço que o comprador paga agora (inclui Central de Promoções) via /items/{id}/sale_price."""
    try:
        from app.integracoes.mercado_livre import ml
        sp = ml._get(f"/items/{item_id}/sale_price", {"quantity": 1}) or {}
    except Exception:
        return None
    if not isinstance(sp, dict) or sp.get("amount") is None:
        return None
    meta = sp.get("metadata") or {}
    return {"amount": float(sp["amount"]), "regular": float(sp.get("regular_amount") or sp["amount"]),
            "promo_tipo": _TIPOS_PROMO_ML.get((meta.get("promotion_type") or "").lower(), meta.get("promotion_type") or "")}


def _margem(preco: float, custo: float, embalagem: float, comissao: float, taxa_fixa: float,
            imposto_pct: float, frete: float, outros: float = 0.0, extra_pct: float = 0.0) -> dict:
    imposto = preco * imposto_pct / 100
    extra = preco * extra_pct / 100  # afiliado + ads (só TikTok)
    lucro = preco - custo - embalagem - comissao - taxa_fixa - imposto - frete - outros - extra
    return {"preco": preco, "custo": custo, "embalagem": embalagem, "comissao": comissao, "taxa_fixa": taxa_fixa,
            "imposto": imposto, "frete": frete, "afiliado_ads": extra, "outros": outros, "lucro": lucro,
            "margem_pct": lucro / preco * 100 if preco > 0 else 0}


def comparar(db, skus: List[str]) -> List[dict]:
    precisa_shopee = bool(skus) and shopee.configurado
    cat_shopee = _catalogo_shopee() if precisa_shopee else {}
    saida = []
    for sku in skus:
        calc: Optional[CalculoTikTok] = (db.query(CalculoTikTok).filter(CalculoTikTok.sku == sku)
                                         .order_by(CalculoTikTok.id.desc()).first())
        oficial = db.query(CustoProduto).filter(CustoProduto.produto_chave == sku).first()
        # O custo digitado na calculadora é o correto; o cadastrado (custos_produto) só entra se não houver cálculo.
        custo = calc.custo if calc else (oficial.custo if oficial and oficial.custo else 0.0)
        imposto_pct = calc.imposto_pct if calc else (oficial.imposto_pct if oficial else 9.0)
        custo_divergente = (oficial.custo if calc and oficial and oficial.custo
                            and abs(oficial.custo - calc.custo) > 0.009 else None)
        embalagem = calc.embalagem if calc else 0.0

        # Mercado Livre: prefere anúncio ativo, depois o mais vendido
        ml_row = (db.query(MercadoLivreItemCache).filter(MercadoLivreItemCache.sku == sku)
                  .order_by((MercadoLivreItemCache.status == "active").desc(),
                            MercadoLivreItemCache.vendidos.desc()).first())
        ml = {"achou": False}
        if ml_row:
            cheio = ml_row.preco_original or ml_row.preco or 0
            preco = ml_row.preco_promocional or ml_row.preco or 0
            vivo = _preco_ml(ml_row.item_id)
            promo_nome = ""
            if vivo:
                preco, cheio = vivo["amount"], max(vivo["regular"], vivo["amount"])
                promo_nome = vivo["promo_tipo"]
            # Tarifa real do ML (listing_prices) recalculada para o preço que está valendo agora (promo inclusa).
            tarifa = ml_row.tarifa_valor or 0
            if vivo:
                try:
                    from app.integracoes.mercado_livre import ml as ml_api
                    v, _, _ = ml_api._tarifa_para(preco, ml_row.categoria_id, ml_row.listing_type_id)
                    if v is not None:
                        tarifa = v
                except Exception:
                    pass
            # ponytail: não desconta o bônus de tarifa que o ML banca em algumas promoções (meli_percentage)
            tipo = "Premium" if (ml_row.listing_type_id or "") == "gold_pro" else "Clássico"
            regra = (f"{tipo}: tarifa do ML {ml_row.tarifa_pct:g}% + custo fixo da API" if ml_row.tarifa_pct
                     else f"{tipo}: tarifa do ML (API)") + " · frete do anúncio"
            em_promo = preco < cheio - 0.009
            ml = {"achou": True, "titulo": ml_row.titulo, "link": ml_row.permalink, "status": ml_row.status,
                  "tarifa_incompleta": ml_row.tarifa_valor is None, "regra": regra,
                  "preco_cheio": cheio if em_promo else None,
                  "promo": (f"Promoção ML{' · ' + promo_nome if promo_nome else ''}") if em_promo else None,
                  **_margem(preco, custo, embalagem, tarifa, 0, imposto_pct, ml_row.frete_custo or 0)}
        sh_row = cat_shopee.get(norm(sku))
        sh = {"achou": False}
        if sh_row and sh_row["preco"]:
            cheio = float(sh_row["preco"])
            p = float(sh_row.get("preco_promo") or cheio)
            em_promo = p < cheio - 0.009
            pct, fixa = regra_shopee(p)  # faixa da tabela segue o preço efetivamente vendido
            # Frete: coberto pelo Programa de Frete Grátis (já embutido na comissão), por isso 0 aqui.
            sh = {"achou": True, "titulo": sh_row["titulo"],
                  "regra": f"Shopee: {pct:g}% + {_brl(fixa)} por item + {_brl(SHOPEE_DEVOLUCAO_FACIL)} Devolução Fácil",
                  "preco_cheio": cheio if em_promo else None,
                  "promo": sh_row.get("promo_nome") if em_promo else None,
                  **_margem(p, custo, embalagem, p * pct / 100, fixa + SHOPEE_DEVOLUCAO_FACIL, imposto_pct, 0)}
        tt = {"achou": False}
        if calc:
            p = calc.preco_venda
            tt = {"achou": True, "titulo": calc.produto,
                  "regra": f"TikTok: {calc.comissao_pct:g}% + {_brl(calc.taxa_fixa)} por item",
                  **_margem(p, calc.custo, calc.embalagem, p * calc.comissao_pct / 100, calc.taxa_fixa,
                            calc.imposto_pct, calc.frete, calc.outros, calc.afiliado_pct + calc.ads_pct)}
        foto = (ml_row.imagem_principal or ml_row.thumbnail) if ml_row else None
        foto = foto or (sh_row or {}).get("foto")
        saida.append({"sku": sku, "foto": foto, "custo_cadastrado": custo_divergente,"ml": ml, "shopee": sh, "tiktok": tt,
                      "shopee_configurada": bool(shopee.configurado)})
    return saida
