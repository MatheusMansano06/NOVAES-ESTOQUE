"""
Monitor de estoque — roda em horário de expediente e avisa no Telegram.

Quem agenda é o scheduler de app/jobs.py (jobs 'monitor_estoque' e
'monitor_estoque_sabado'): seg-sex de hora em hora das 8h às 18h, sábado às
8h/12h/18h, domingo não roda. Fica na produção, sem depender de máquina ligada.
Continua executável na mão (`python monitor_estoque.py`) para conferir uma rodada.

Checa cinco coisas — as quatro primeiras lendo dos endpoints que o painel já usa:
  1. Produto INATIVO na Olist mas com anúncio ATIVO no ML  -> vende sem ter produto
  2. Anúncio PAUSADO no ML com saldo > 0 na Olist          -> pausa provavelmente indevida
  3. Estoque do DEPÓSITO do ML diferente do saldo da Olist -> divergência de quantidade
  4. Margem de contribuição abaixo do mínimo               -> mesma fórmula da tela de Anúncios ML
  5. VENDA recente fechada abaixo da margem mínima de venda -> tarifa e frete reais
     do pedido, lendo o espelho ml_venda_cache direto do banco

Anúncio FULL não entra na conferência de quantidade: o saldo dele fica no galpão
do Mercado Livre, então divergir do barracão é o esperado.

Uso:  python monitor_estoque.py            (a partir de backend/)
Env:  BACKEND_URL (default http://localhost:8000), MARGEM_MINIMA_PCT (default 10),
      MONITOR_MAX_ALERTAS (default 10) + as variáveis do canal em notificacoes.py
"""

import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

from app.notificacoes import enviar_alerta

load_dotenv()

BACKEND_URL = (os.getenv("BACKEND_URL") or "http://localhost:8000").rstrip("/")
MARGEM_MINIMA_PCT = float(os.getenv("MARGEM_MINIMA_PCT") or 10)
# Venda já feita tem régua própria: o anúncio é aviso preventivo (10%), a venda
# é dinheiro que já saiu. Abaixo disso o pedido praticamente não pagou nada.
MARGEM_VENDA_MINIMA_PCT = float(os.getenv("MARGEM_VENDA_MINIMA_PCT") or 5)
# Janela de vendas olhada a cada rodada. Maior que um dia de propósito: sem
# rodada no domingo, uma venda ruim de sábado à noite só seria vista na segunda.
VENDAS_JANELA_HORAS = float(os.getenv("VENDAS_JANELA_HORAS") or 48)
# Venda é fato consumado: anuncia uma vez e cala. Tem que cobrir a janela acima,
# senão a mesma venda reaparece enquanto continuar dentro dela.
DEDUP_VENDA_MIN = float(os.getenv("DEDUP_VENDA_MIN") or 96 * 60)
# Piso do frete grátis no ML: abaixo dele quem paga o frete é o COMPRADOR, e o
# vendedor não tem esse custo. Usado só quando o frete real do pedido ainda não
# foi enriquecido — sem isso, um anúncio de R$ 19 levava o frete estimado de
# R$ 26 e virava "prejuízo" que nunca existiu.
FRETE_GRATIS_MINIMO = float(os.getenv("FRETE_GRATIS_MINIMO") or 79)
MAX_ALERTAS = int(os.getenv("MONITOR_MAX_ALERTAS") or 10)
# Piso de sanidade da listagem da Olist (a base real tem ~1200 SKUs). Serve pra
# barrar coleta truncada, não pra exigir a base exata. Ver monitorar().
OLIST_MINIMO = int(os.getenv("OLIST_MINIMO") or 500)

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
    """Produtos da Olist indexados por SKU.

    O mesmo código costuma ter DOIS registros na Olist — o ativo e uma cópia
    excluída (é o caso dos kits). Se o excluído vencesse, um produto normal
    viraria alerta de "vendendo sem produto": por isso o ativo tem prioridade.
    """
    resp = _req("/api/olist/produtos-todos")
    produtos = (resp or {}).get("produtos") or []
    por_sku: Dict[str, Dict] = {}
    for p in produtos:
        sku = str(p.get("sku") or "").strip().upper()
        if not sku:
            continue
        atual = por_sku.get(sku)
        if atual is None or (_situacao(p) in OLIST_ATIVO and _situacao(atual) not in OLIST_ATIVO):
            por_sku[sku] = p
    return por_sku


def _situacao(produto: Dict) -> str:
    return str(produto.get("situacao") or "").strip().upper()


def saldos_olist() -> Dict[str, float]:
    """Saldo da Olist por SKU. Vem do snapshot que a Lista de Compra já mantém
    atualizado em segundo plano — uma requisição em vez de uma por produto."""
    resp = _req("/api/lista-compra")
    itens = (resp or {}).get("itens") or []
    saldos: Dict[str, float] = {}
    for item in itens:
        if not item.get("tem_estoque_olist"):
            continue  # sem snapshot não dá pra afirmar saldo nenhum
        sku = str(item.get("sku") or "").strip().upper()
        if sku:
            saldos[sku] = float(item.get("estoque_organico") or 0)
    return saldos


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


def vendas_margem_baixa(custos: Dict[str, Dict], anuncios: Dict[str, Dict],
                        margens: Optional[Dict[str, Dict]] = None) -> List[str]:
    """Vendas recentes cuja margem ficou abaixo do mínimo.

    Lê o espelho de pedidos (ml_venda_cache) direto do banco: não existe endpoint
    de vendas por período, e criar um publicaria o financeiro numa API que hoje
    não exige credencial. A conta usa tarifa e frete REAIS do pedido — não a
    estimativa do anúncio — e desconta imposto, igual à margem da tela.

    O frete real só existe depois do enriquecimento do shipment, que cobre uma
    fração dos pedidos — exigi-lo calaria o alerta na maioria das vendas. Quando
    falta, cai no frete estimado do anúncio, que é exatamente o que a tela de
    margem usa. O erro possível aí é subestimar o frete, ou seja, alertar de
    menos: melhor calar sobre uma venda ruim do que acusar uma venda boa.
    """
    try:
        from database import SessionLocal
        from app.models import MercadoLivreVendaCache
    except Exception as e:
        print(f"[MONITOR] vendas: banco indisponível ({e})")
        return []

    # date_created guarda a hora do ML sem fuso (o parser descarta o offset), e o
    # servidor roda em UTC — a diferença de ~3h é irrelevante numa janela de dias.
    corte = datetime.utcnow() - timedelta(hours=VENDAS_JANELA_HORAS)
    alertas: List[str] = []
    por_sku: Dict[str, Dict[str, Any]] = {}
    sem_frete = 0
    sem_custo = 0

    db = SessionLocal()
    try:
        vendas = (db.query(MercadoLivreVendaCache)
                    .filter(MercadoLivreVendaCache.date_created >= corte)
                    .order_by(MercadoLivreVendaCache.date_created.desc())
                    .all())
        for v in vendas:
            if (v.status or "").lower() in {"cancelled", "invalid"}:
                continue
            qtd = int(v.quantity or 0)
            receita = float(v.unit_price or 0) * qtd
            if receita <= 0:
                continue
            sku = str(v.sku or "").strip().upper()
            custo_info = custos.get(sku)
            if not custo_info or custo_info.get("custo") is None:
                sem_custo += 1
                continue
            tarifa = float(v.sale_fee or 0) * (qtd or 1)

            # O `shipping_cost` do espelho NÃO entra aqui: ele guarda
            # shipping_option.cost, que é o que o COMPRADOR pagou de frete — zero
            # justamente nas vendas de frete grátis, onde quem paga é o vendedor.
            # Usá-lo inverteria a conta nos dois sentidos (custo fantasma no item
            # barato, custo invisível no caro). Enquanto o espelho não guardar o
            # custo do remetente (/shipments/{id}/costs), vale a regra do ML:
            # abaixo do piso de frete grátis o comprador paga o frete; acima dele,
            # e no FULL, o vendedor paga — e aí usamos o frete estimado do
            # anúncio, o mesmo número que a tela de margem mostra.
            preco_unit = float(v.unit_price or 0)
            logistica = (v.logistic_type or "") or (anuncios.get(sku) or {}).get("logistica") or ""
            if preco_unit < FRETE_GRATIS_MINIMO and logistica != "fulfillment":
                frete = 0.0
            else:
                estimado = (margens or {}).get(sku, {}).get("frete")
                if estimado is None:
                    sem_frete += 1
                    continue  # sem frete estimado não dá pra afirmar margem
                frete = float(estimado) * (qtd or 1)
            custo = float(custo_info["custo"]) * qtd
            imposto_pct = custo_info.get("imposto_pct")
            imposto = receita * float(9 if imposto_pct is None else imposto_pct) / 100
            lucro = receita - tarifa - frete - custo - imposto
            pct = lucro / receita * 100
            if pct >= MARGEM_VENDA_MINIMA_PCT:
                continue

            # Agrupado por SKU: o mesmo anúncio mal precificado vende várias vezes
            # no dia, e a ação é uma só (corrigir o preço). Uma mensagem por
            # pedido só gastaria o teto da rodada repetindo o mesmo recado.
            g = por_sku.setdefault(sku, {
                "titulo": (v.item_title or "")[:40], "pedidos": 0, "unidades": 0,
                "receita": 0.0, "lucro": 0.0, "pior_pct": pct, "ultima": v.date_created,
            })
            g["pedidos"] += 1
            g["unidades"] += qtd
            g["receita"] += receita
            g["lucro"] += lucro
            g["pior_pct"] = min(g["pior_pct"], pct)
            if v.date_created and (not g["ultima"] or v.date_created > g["ultima"]):
                g["ultima"] = v.date_created
        # Pior margem primeiro: se o teto da rodada cortar, corta o menos grave.
        for sku, g in sorted(por_sku.items(), key=lambda kv: kv[1]["pior_pct"]):
            media_pct = g["lucro"] / g["receita"] * 100 if g["receita"] else 0
            quando = g["ultima"].strftime("%a, %d/%m/%Y às %H:%M") if g["ultima"] else "?"
            plural = "vendas" if g["pedidos"] > 1 else "venda"
            alertas.append(
                f"💸 VENDEU COM MARGEM BAIXA\nSKU {sku} — {g['titulo']}\n"
                f"MC {media_pct:.1f}% (mínimo {MARGEM_VENDA_MINIMA_PCT:.0f}%) | "
                f"pior {g['pior_pct']:.1f}%\n"
                f"{g['pedidos']} {plural}, {g['unidades']} un | "
                f"receita R$ {g['receita']:.2f} | lucro R$ {g['lucro']:.2f}\n"
                f"{quando}\n"
                f"{(anuncios.get(sku) or {}).get('permalink') or ''}".strip()
            )
    except Exception as e:
        print(f"[MONITOR] vendas: falha ao conferir ({e})")
        return alertas
    finally:
        db.close()

    print(f"[MONITOR] vendas em {VENDAS_JANELA_HORAS:g}h: {len(alertas)} abaixo de "
          f"{MARGEM_VENDA_MINIMA_PCT:g}% | sem custo cadastrado: {sem_custo} | "
          f"sem frete estimado: {sem_frete}")
    return alertas


def monitorar() -> Dict[str, Any]:
    print(f"[MONITOR] {datetime.now():%d/%m/%Y %H:%M} — checando {BACKEND_URL}")

    ml_ativos = anuncios_ml("active")
    ml_pausados = anuncios_ml("paused")
    olist = produtos_olist()
    custos = (_req("/api/custos") or {}).get("custos") or {}
    margens = (_req("/api/ml/margens", "POST", {}) or {}).get("margens") or {}
    saldos = saldos_olist()

    if not ml_ativos and not ml_pausados and not olist:
        print("[MONITOR] Nada retornado (backend fora do ar?) — abortando sem alertar")
        return {"erro": "sem dados"}

    situacoes = {_situacao(p) for p in olist.values()}
    print(f"[MONITOR] ML ativos={len(ml_ativos)} pausados={len(ml_pausados)} | "
          f"Olist={len(olist)} situações={sorted(s for s in situacoes if s)}")

    alertas: List[str] = []

    # A listagem da Olist às vezes volta truncada (uma página só, quando uma
    # requisição da paginação falha). Comparar status com base parcial INVERTE
    # o alerta: um SKU cujo registro ativo ficou de fora aparece como "vendendo
    # sem produto". Por isso só comparamos com a base inteira na mão.
    olist_confiavel = len(olist) >= OLIST_MINIMO
    if not olist_confiavel:
        print(f"[MONITOR] Olist veio com {len(olist)} produtos (piso {OLIST_MINIMO}) — "
              f"checagem de divergência PULADA nesta rodada")

    # 1 e 2 — divergência de status entre Olist e ML
    if olist_confiavel:
        candidatos_pausa = []
        for sku, produto in olist.items():
            sit = _situacao(produto)
            nome = (produto.get("nome") or "")[:40]
            if sit in OLIST_INATIVO and sku in ml_ativos:
                alertas.append(
                    f"🔴 VENDENDO SEM PRODUTO\nSKU {sku} — {nome}\n"
                    f"Olist: inativo ({sit}) | ML: ATIVO\n{ml_ativos[sku].get('permalink') or ''}".strip()
                )
            elif sit in OLIST_ATIVO and sku in ml_pausados:
                candidatos_pausa.append((sku, produto, nome))

        # Anúncio pausado só é suspeito se AINDA HÁ ESTOQUE: aí "acabou" não
        # explica a pausa, e sobra o erro de quem deu baixa. Sem essa conferência,
        # todo anúncio pausado por preço ou sazonalidade viraria alerta — o
        # cadastro na Olist continua ativo mesmo com saldo zero.
        for sku, produto, nome in candidatos_pausa:
            saldo = saldos.get(sku)
            if saldo is None or saldo <= 0:
                continue
            alertas.append(
                f"🟡 PAUSA SUSPEITA\nSKU {sku} — {nome}\n"
                f"Olist: ativo, {saldo:g} em estoque | ML: PAUSADO\n"
                f"Tem saldo — conferir se a pausa foi engano\n"
                f"{ml_pausados[sku].get('permalink') or ''}".strip()
            )

    # 3 — quantidade: depósito do ML x Olist. Anúncio FULL fica de fora: o saldo
    # dele está no galpão do Mercado Livre, não no barracão, então divergir é o
    # esperado. Só compara o que é atendido pelo próprio estoque.
    for sku, anuncio in ml_ativos.items():
        if anuncio.get("full") or (anuncio.get("logistica") or "") == "fulfillment":
            continue
        saldo = saldos.get(sku)
        qtd_ml = anuncio.get("disponivel")
        if saldo is None or qtd_ml is None:
            continue
        if float(qtd_ml) == float(saldo):
            continue
        alertas.append(
            f"⚖️ ESTOQUE DIFERENTE\nSKU {sku} — {(anuncio.get('titulo') or '')[:40]}\n"
            f"ML (depósito): {float(qtd_ml):g} | Olist: {saldo:g}\n"
            f"{anuncio.get('permalink') or ''}".strip()
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

    # 4 — vendas recentes com margem abaixo do mínimo (fato consumado)
    alertas_venda = vendas_margem_baixa(custos, ml_ativos, margens)

    # Envio: uma mensagem por alerta, para a deduplicação valer por problema
    # (um alerta novo não reenvia os antigos). Teto por rodada evita inundar.
    #
    # Venda vai PRIMEIRO na fila: são poucas e só aparecem uma vez, enquanto os
    # alertas de estado são dezenas e reaparecem toda hora. Na ordem inversa, um
    # acúmulo de divergências consumiria o teto e a venda ruim nunca chegaria.
    fila = ([(t, DEDUP_VENDA_MIN) for t in alertas_venda] +
            [(t, None) for t in alertas])
    enviados = 0
    nao_enviados = 0
    for alerta, janela in fila:
        if enviados >= MAX_ALERTAS:
            nao_enviados += 1
            continue
        # O teto conta só o que REALMENTE saiu: alerta suprimido por dedup não
        # gasta vaga, senão os do fim da fila nunca chegariam.
        if enviar_alerta(alerta, janela_min=janela) == "enviado":
            enviados += 1
    if nao_enviados:
        enviar_alerta(f"… e mais {nao_enviados} alerta(s) nesta rodada. "
                      f"Abra o painel para ver todos.")

    resumo = {
        "quando": datetime.now().isoformat(timespec="seconds"),
        "ml_ativos": len(ml_ativos),
        "ml_pausados": len(ml_pausados),
        "olist": len(olist),
        "alertas": len(alertas) + len(alertas_venda),
        "vendas_margem_baixa": len(alertas_venda),
        "enviados": enviados,
    }
    print(f"[MONITOR] {json.dumps(resumo, ensure_ascii=False)}")
    return resumo


if __name__ == "__main__":
    monitorar()
