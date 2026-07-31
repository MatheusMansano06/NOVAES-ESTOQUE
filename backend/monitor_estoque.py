"""
Monitor de estoque — roda em background (cron do OpenClaw) e avisa no Telegram.

Checa três coisas, todas lendo dos endpoints que o painel já usa (sem regra nova):
  1. Produto INATIVO na Olist mas com anúncio ATIVO no ML  -> vende sem ter produto
  2. Produto ATIVO na Olist mas anúncio PAUSADO no ML       -> pausa provavelmente indevida
  3. Margem de contribuição abaixo do mínimo                -> mesma fórmula da tela de Anúncios ML

Uso:  python monitor_estoque.py            (a partir de backend/)
Env:  BACKEND_URL (default http://localhost:8000), MARGEM_MINIMA_PCT (default 10),
      MONITOR_MAX_ALERTAS (default 10) + as variáveis do canal em notificacoes.py
"""

import os
import json
import urllib.request
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

from app.notificacoes import enviar_alerta

load_dotenv()

BACKEND_URL = (os.getenv("BACKEND_URL") or "http://localhost:8000").rstrip("/")
MARGEM_MINIMA_PCT = float(os.getenv("MARGEM_MINIMA_PCT") or 10)
MAX_ALERTAS = int(os.getenv("MONITOR_MAX_ALERTAS") or 10)

# A Olist devolve a situação como letra (A/I/E) ou por extenso, dependendo da
# versão da API. Só tratamos o que reconhecemos: situação desconhecida NÃO vira
# alerta, senão o primeiro formato inesperado viraria uma enxurrada de aviso.
OLIST_ATIVO = {"A", "ATIVO", "ACTIVE"}
OLIST_INATIVO = {"I", "E", "INATIVO", "EXCLUIDO", "EXCLUÍDO"}


def _req(path: str, metodo: str = "GET", corpo: Optional[Dict] = None) -> Optional[Any]:
    """GET/POST no próprio backend. Devolve None em qualquer falha (é monitor:
    não pode derrubar o job por causa de uma chamada)."""
    url = f"{BACKEND_URL}{path}"
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    headers = {"Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=metodo)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"[MONITOR] Falha em {metodo} {path}: {e}")
        return None


def _sku(item: Dict) -> str:
    return str(item.get("sku") or item.get("seller_custom_field") or "").strip().upper()


def anuncios_ml(status: str) -> Dict[str, Dict]:
    """Anúncios do ML por status, do cache local (não bate na API do ML)."""
    por_sku: Dict[str, Dict] = {}
    offset = 0
    while True:
        resp = _req(f"/api/ml/anuncios?status={status}&limit=50&offset={offset}")
        if not resp or resp.get("erro"):
            break
        lote = resp.get("anuncios") or []
        for item in lote:
            sku = _sku(item)
            if sku:
                por_sku.setdefault(sku, item)
        offset += len(lote)
        if not lote or offset >= int(resp.get("total") or 0):
            break
    return por_sku


def produtos_olist() -> Dict[str, Dict]:
    resp = _req("/api/olist/produtos-todos")
    produtos = (resp or {}).get("produtos") or []
    return {str(p.get("sku") or "").strip().upper(): p for p in produtos if p.get("sku")}


def _situacao(produto: Dict) -> str:
    return str(produto.get("situacao") or "").strip().upper()


def desconto_tarifa(item_id: str) -> Optional[float]:
    """Bônus de tarifa de promoção ativa (o ML banca parte do desconto).
    Buscado só para os candidatos a alerta — é uma chamada por item."""
    resp = _req(f"/api/ml/anuncios/{urllib.parse.quote(str(item_id))}/preco-resumo")
    if not resp or resp.get("erro"):
        return None
    valor = resp.get("desconto_tarifa")
    return float(valor) if isinstance(valor, (int, float)) else None


def margem_pct(dados: Dict, custo_info: Dict) -> Optional[float]:
    """Mesma fórmula da tela de Anúncios ML (AnunciosML.tsx: montarResumoMargem):
    MC = preço promocional - frete - tarifa efetiva - custo - imposto.
    Sem frete/tarifa/custo não há margem — devolve None em vez de chutar."""
    preco = dados.get("promocional") or dados.get("preco")
    frete = dados.get("frete")
    tarifa = dados.get("tarifa")
    custo = custo_info.get("custo")
    if not preco or preco <= 0 or frete is None or tarifa is None or custo is None:
        return None
    imposto_pct = custo_info.get("imposto_pct")
    if imposto_pct is None:
        imposto_pct = 9  # mesmo default do painel quando não há imposto salvo
    tarifa_efetiva = tarifa - (dados.get("_desconto_tarifa") or 0)
    imposto = preco * float(imposto_pct) / 100
    return ((preco - frete - tarifa_efetiva - float(custo) - imposto) / preco) * 100


def monitorar() -> Dict[str, Any]:
    print(f"[MONITOR] {datetime.now():%d/%m/%Y %H:%M} — checando {BACKEND_URL}")

    ml_ativos = anuncios_ml("active")
    ml_pausados = anuncios_ml("paused")
    olist = produtos_olist()
    custos = (_req("/api/custos") or {}).get("custos") or {}
    margens = (_req("/api/ml/margens", "POST", {}) or {}).get("margens") or {}

    if not ml_ativos and not ml_pausados and not olist:
        print("[MONITOR] Nada retornado (backend fora do ar?) — abortando sem alertar")
        return {"erro": "sem dados"}

    situacoes = {_situacao(p) for p in olist.values()}
    print(f"[MONITOR] ML ativos={len(ml_ativos)} pausados={len(ml_pausados)} | "
          f"Olist={len(olist)} situações={sorted(s for s in situacoes if s)}")

    # Sem a Olist não dá pra comparar status: avisa em vez de deixar a rodada
    # passar como "nenhuma divergência" (falso negativo silencioso).
    if not olist and (ml_ativos or ml_pausados):
        print("[MONITOR] Olist não respondeu — checagem de divergência PULADA nesta rodada")

    alertas: List[str] = []

    # 1 e 2 — divergência de status entre Olist e ML
    for sku, produto in olist.items():
        sit = _situacao(produto)
        nome = (produto.get("nome") or "")[:40]
        if sit in OLIST_INATIVO and sku in ml_ativos:
            alertas.append(
                f"🔴 VENDENDO SEM PRODUTO\nSKU {sku} — {nome}\n"
                f"Olist: inativo ({sit}) | ML: ATIVO\n{ml_ativos[sku].get('permalink') or ''}".strip()
            )
        elif sit in OLIST_ATIVO and sku in ml_pausados:
            alertas.append(
                f"🟡 PAUSA SUSPEITA\nSKU {sku} — {nome}\n"
                f"Olist: ativo | ML: PAUSADO — conferir se acabou mesmo\n"
                f"{ml_pausados[sku].get('permalink') or ''}".strip()
            )

    # 3 — margem abaixo do mínimo (só anúncio ativo e com custo cadastrado)
    candidatos = []
    for sku, dados in margens.items():
        custo_info = custos.get(sku)
        if not custo_info:
            continue  # sem custo oficial não dá pra afirmar margem
        pct = margem_pct(dados, custo_info)
        if pct is not None and pct < MARGEM_MINIMA_PCT:
            candidatos.append((sku, dados, custo_info))

    # Só agora buscamos o bônus de tarifa: ele só melhora a margem, então
    # basta reconferir quem já está abaixo do limite (evita falso positivo).
    for sku, dados, custo_info in candidatos:
        bonus = desconto_tarifa(dados.get("item_id"))
        if bonus:
            dados["_desconto_tarifa"] = bonus
        pct = margem_pct(dados, custo_info)
        if pct is None or pct >= MARGEM_MINIMA_PCT:
            continue
        alertas.append(
            f"📉 MARGEM BAIXA\nSKU {sku} — {(dados.get('titulo') or '')[:40]}\n"
            f"MC {pct:.1f}% (mínimo {MARGEM_MINIMA_PCT:.0f}%) | preço "
            f"R$ {dados.get('promocional') or dados.get('preco'):.2f}\n"
            f"{dados.get('permalink') or ''}".strip()
        )

    # Envio: uma mensagem por alerta, para a deduplicação valer por problema
    # (um alerta novo não reenvia os antigos). Teto por rodada evita inundar.
    enviados = 0
    for alerta in alertas[:MAX_ALERTAS]:
        if enviar_alerta(alerta):
            enviados += 1
    if len(alertas) > MAX_ALERTAS:
        enviar_alerta(f"… e mais {len(alertas) - MAX_ALERTAS} alerta(s) nesta rodada. "
                      f"Abra o painel para ver todos.")

    resumo = {
        "quando": datetime.now().isoformat(timespec="seconds"),
        "ml_ativos": len(ml_ativos),
        "ml_pausados": len(ml_pausados),
        "olist": len(olist),
        "alertas": len(alertas),
        "enviados": enviados,
    }
    print(f"[MONITOR] {json.dumps(resumo, ensure_ascii=False)}")
    return resumo


if __name__ == "__main__":
    monitorar()
