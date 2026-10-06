"""Auditoria de catálogo: lista a Shopee no nível do anúncio (item), inclusive sem SKU. Só leitura."""
from app.integracoes_shopee import shopee


def itens_shopee() -> list:
    saida = []
    for status in ("NORMAL", "UNLIST"):
        offset = 0
        while True:
            resp = shopee.chamar("/api/v2/product/get_item_list",
                                 {"offset": offset, "page_size": 100, "item_status": [status]})
            corpo = resp.get("response") or {}
            ids = [i.get("item_id") for i in (corpo.get("item") or []) if i.get("item_id")]
            for k in range(0, len(ids), 50):
                r2 = shopee.chamar("/api/v2/product/get_item_base_info",
                                   {"item_id_list": ",".join(str(x) for x in ids[k:k + 50])})
                for it in (r2.get("response") or {}).get("item_list") or []:
                    modelos = []
                    if it.get("has_model"):
                        r3 = shopee.chamar("/api/v2/product/get_model_list", {"item_id": int(it["item_id"])})
                        modelos = [{"model_id": str(m.get("model_id")), "sku": m.get("model_sku") or ""}
                                   for m in (r3.get("response") or {}).get("model") or []]
                    saida.append({"item_id": str(it["item_id"]), "status": status, "titulo": it.get("item_name") or "",
                                  "sku": it.get("item_sku") or "", "modelos": modelos})
            if not corpo.get("has_next_page") or not ids:
                break
            offset = corpo.get("next_offset", offset + len(ids))
    return saida
