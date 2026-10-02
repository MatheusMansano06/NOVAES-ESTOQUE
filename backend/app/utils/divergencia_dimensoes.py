"""Compara a embalagem declarada pelo vendedor (SELLER_PACKAGE_*) com a medida
pelo Mercado Livre (PACKAGE_*), a partir dos atributos crus do anúncio.

Os lados são comparados ordenados: o ML troca altura/largura/comprimento de
lugar, então 25x10x4 e 4x25x10 são a mesma caixa.
"""
import json
from typing import Any, Dict, List, Optional, Tuple

LADOS = ("menor lado", "lado médio", "maior lado")


def _num(attr: Dict[str, Any]) -> Optional[float]:
    number = (attr.get("value_struct") or {}).get("number")
    if number is not None:
        try:
            return float(number)
        except (TypeError, ValueError):
            pass
    try:
        return float(str(attr.get("value_name")).replace(",", ".").split()[0])
    except (TypeError, ValueError, IndexError):
        return None


def _medidas(attrs: Dict[str, Dict], prefixo: str) -> Tuple[Optional[List[float]], Optional[float]]:
    v = {k: _num(attrs[prefixo + k]) for k in ("HEIGHT", "WIDTH", "LENGTH", "WEIGHT") if prefixo + k in attrs}
    lados = [v.get("HEIGHT"), v.get("WIDTH"), v.get("LENGTH")]
    return (sorted(lados) if None not in lados else None), v.get("WEIGHT")


def _difere(a: float, b: float, minimo: float) -> bool:
    # Tolerância: 15% OU o mínimo absoluto (1 cm / 50 g), o que for maior.
    return abs(a - b) > max(minimo, 0.15 * max(a, b))


def comparar(attributes_json: Optional[str]) -> Optional[Dict[str, Any]]:
    """Retorna a divergência do anúncio, ou None se bate (ou faltar medida)."""
    try:
        lista = json.loads(attributes_json or "[]")
    except ValueError:
        return None
    attrs = {a.get("id"): a for a in lista if isinstance(a, dict)}
    (lados_d, peso_d), (lados_m, peso_m) = _medidas(attrs, "SELLER_PACKAGE_"), _medidas(attrs, "PACKAGE_")

    motivos, pior = [], 0.0
    if lados_d and lados_m:
        for nome, x, y in zip(LADOS, lados_d, lados_m):
            if _difere(x, y, 1):
                motivos.append(nome)
                pior = max(pior, abs(x - y) / max(x, y))
    if peso_d and peso_m and _difere(peso_d, peso_m, 50):
        motivos.append("peso")
        pior = max(pior, abs(peso_d - peso_m) / max(peso_d, peso_m))
    if not motivos:
        return None
    return {
        "declarado_cm": lados_d, "medido_cm": lados_m,
        "peso_declarado_g": peso_d, "peso_medido_g": peso_m,
        "motivos": motivos, "maior_dif_pct": round(pior * 100),
    }


_PARA_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0}
_PARA_KG = {"g": 0.001, "kg": 1.0}


def _com_unidade(attr: Dict[str, Any], fatores: Dict[str, float], padrao: str) -> Optional[float]:
    n = _num(attr)
    if n is None or n <= 0:
        return None
    unidade = ((attr.get("value_struct") or {}).get("unit") or "").strip().lower()
    if not unidade:
        partes = str(attr.get("value_name") or "").split()
        unidade = partes[1].lower() if len(partes) > 1 else padrao
    fator = fatores.get(unidade)
    return round(n * fator, 3) if fator else None


def medidas_embalagem(attributes_json: Optional[str]) -> Optional[Dict[str, Any]]:
    """Embalagem do anúncio em cm/kg para cadastro na Olist: prefere a medida
    pelo ML (PACKAGE_*), que é a real; cai na declarada (SELLER_PACKAGE_*)."""
    try:
        lista = json.loads(attributes_json or "[]")
    except ValueError:
        return None
    attrs = {a.get("id"): a for a in lista if isinstance(a, dict)}
    for prefixo, origem in (("PACKAGE_", "medido_ml"), ("SELLER_PACKAGE_", "declarado")):
        if not all(prefixo + k in attrs for k in ("HEIGHT", "WIDTH", "LENGTH")):
            continue
        m = {
            "altura": _com_unidade(attrs[prefixo + "HEIGHT"], _PARA_CM, "cm"),
            "largura": _com_unidade(attrs[prefixo + "WIDTH"], _PARA_CM, "cm"),
            "comprimento": _com_unidade(attrs[prefixo + "LENGTH"], _PARA_CM, "cm"),
            "peso_kg": _com_unidade(attrs[prefixo + "WEIGHT"], _PARA_KG, "g") if prefixo + "WEIGHT" in attrs else None,
        }
        if None not in (m["altura"], m["largura"], m["comprimento"]):
            return {**m, "origem": origem}
    return None


def diverge_olist(dim_olist: Dict[str, Any], medidas: Dict[str, Any]) -> List[str]:
    """Motivos pelos quais o cadastro Olist (cm/kg) difere da embalagem do ML.
    Lados ordenados e mesma tolerância de comparar(); campo vazio na Olist diverge."""
    lo = sorted(float(dim_olist.get(k) or 0) for k in ("altura", "largura", "comprimento"))
    lm = sorted(float(medidas[k]) for k in ("altura", "largura", "comprimento"))
    motivos = [nome for nome, x, y in zip(LADOS, lo, lm) if _difere(x, y, 1)]
    pb, pm = float(dim_olist.get("pesoBruto") or 0), medidas.get("peso_kg")
    if pm and _difere(pb, pm, 0.05):
        motivos.append("peso")
    return motivos


if __name__ == "__main__":
    ml = {"altura": 3.0, "largura": 9.8, "comprimento": 30.1, "peso_kg": 0.98}
    assert diverge_olist({"altura": 1, "largura": 1, "comprimento": 1, "pesoBruto": 0.4}, ml) == list(LADOS) + ["peso"]
    # Eixos trocados e diferença dentro da tolerância -> bate.
    assert diverge_olist({"altura": 30, "largura": 3, "comprimento": 10, "pesoBruto": 1.0}, ml) == []
    assert diverge_olist({"altura": 30, "largura": 3, "comprimento": 10, "pesoBruto": 0}, ml) == ["peso"]

    def attrs(pre, h, w, l, p):
        return [{"id": pre + k, "value_name": f"{v} x"} for k, v in (("HEIGHT", h), ("WIDTH", w), ("LENGTH", l), ("WEIGHT", p))]

    def attrs_u(pre, h, w, l, p, ud="cm", up="g"):
        return [{"id": pre + k, "value_name": f"{v} {u}"} for k, v, u in (("HEIGHT", h, ud), ("WIDTH", w, ud), ("LENGTH", l, ud), ("WEIGHT", p, up))]

    # Medido pelo ML tem prioridade; peso em g vira kg.
    m = medidas_embalagem(json.dumps(attrs_u("SELLER_PACKAGE_", 5, 10, 20, 300) + attrs_u("PACKAGE_", 6, 11, 21, 450)))
    assert m == {"altura": 6, "largura": 11, "comprimento": 21, "peso_kg": 0.45, "origem": "medido_ml"}, m
    # Só declarado, em mm/kg.
    m = medidas_embalagem(json.dumps(attrs_u("SELLER_PACKAGE_", 50, 100, 200, 1.2, "mm", "kg")))
    assert m == {"altura": 5, "largura": 10, "comprimento": 20, "peso_kg": 1.2, "origem": "declarado"}, m
    # Unidade desconhecida ou medida faltando -> None.
    assert medidas_embalagem(json.dumps(attrs_u("PACKAGE_", 5, 10, 20, 300, "pol"))) is None
    assert medidas_embalagem("lixo") is None

    # Mesma caixa com eixos trocados -> não diverge.
    assert comparar(json.dumps(attrs("SELLER_PACKAGE_", 25, 10, 4, 500) + attrs("PACKAGE_", 4.4, 25.3, 9.9, 520))) is None
    # Peso bem diferente -> diverge só no peso.
    r = comparar(json.dumps(attrs("SELLER_PACKAGE_", 25, 10, 4, 520) + attrs("PACKAGE_", 4, 25, 10, 320)))
    assert r and r["motivos"] == ["peso"] and r["maior_dif_pct"] == 38, r
    # Lado maior diferente (lado médio 10->11 fica dentro da tolerância de 1 cm).
    r = comparar(json.dumps(attrs("SELLER_PACKAGE_", 4, 10, 25, 300) + attrs("PACKAGE_", 4.5, 11, 31.1, 300)))
    assert r and r["motivos"] == ["maior lado"], r
    # Sem medida do ML -> ignora.
    assert comparar(json.dumps(attrs("SELLER_PACKAGE_", 4, 10, 25, 300))) is None
    assert comparar("lixo") is None
    print("ok")
