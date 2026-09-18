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


if __name__ == "__main__":
    def attrs(pre, h, w, l, p):
        return [{"id": pre + k, "value_name": f"{v} x"} for k, v in (("HEIGHT", h), ("WIDTH", w), ("LENGTH", l), ("WEIGHT", p))]

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
