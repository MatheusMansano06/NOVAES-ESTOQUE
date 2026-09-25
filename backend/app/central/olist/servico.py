"""O que a conferência precisa saber da Olist sobre um pedido de marketplace."""

import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.central.db import Sessao

from . import client
from .modelo import NotaDevolucao, PedidoCache

VALIDADE_CACHE = timedelta(hours=6)

CHAVE_REFERENCIADA = re.compile(r"Chave de acesso da NF-e referenciada:\s*(\d{44})")
FINALIDADE_DEVOLUCAO = "4"

SITUACAO_PEDIDO = {0: "Aberta", 1: "Faturada", 2: "Cancelada", 3: "Aprovada", 4: "Preparando envio",
                   5: "Enviada", 6: "Entregue", 7: "Pronto envio", 8: "Dados incompletos", 9: "Não entregue"}
SITUACAO_NOTA = {1: "Pendente", 2: "Emitida", 3: "Cancelada", 4: "Enviada aguardando recibo", 5: "Rejeitada",
                 6: "Autorizada", 7: "Emitida DANFE", 8: "Registrada", 9: "Enviada aguardando protocolo", 10: "Denegada"}


def _nota(id_nota: int | None) -> dict | None:
    n = client.get(f"/notas/{id_nota}") if id_nota else None
    return n and {"id": n["id"], "numero": n.get("numero"), "serie": n.get("serie"), "chave": n.get("chaveAcesso"),
                  "situacao": SITUACAO_NOTA.get(int(n.get("situacao") or 0), n.get("situacao")),
                  "emitida_em": n.get("dataEmissao")}


def _item(i: dict) -> dict:
    produto = client.get(f"/produtos/{i['produto']['id']}") or {}
    return {
        "produto_id": i["produto"]["id"],
        "sku": i["produto"].get("sku"),
        "descricao": i["produto"].get("descricao"),
        "tipo": i["produto"].get("tipo"),
        "quantidade": i.get("quantidade"),
        "valor_unitario": i.get("valorUnitario"),
        # Custo da última compra: decisão do usuário (o custo médio da base está errado).
        "preco_custo": (produto.get("precos") or {}).get("precoCusto"),
    }


def _pedido(id_pedido: int) -> dict:
    p = client.get(f"/pedidos/{id_pedido}")
    with ThreadPoolExecutor(4) as pool:  # a janela de 100/min do client segura o ritmo; aqui só corta a latência
        nota = pool.submit(_nota, p.get("idNotaFiscal"))
        itens = list(pool.map(_item, p.get("itens") or []))
    return {
        "id": p["id"],
        "numero": p.get("numeroPedido"),
        "situacao": SITUACAO_PEDIDO.get(p.get("situacao"), p.get("situacao")),
        "data": p.get("data"),
        "canal": (p.get("ecommerce") or {}).get("nome"),
        "numero_marketplace": (p.get("ecommerce") or {}).get("numeroPedidoEcommerce"),
        "deposito": p.get("deposito"),
        "nota": nota.result(),
        "itens": itens,
    }


def pedidos_do_marketplace(numero: str, fresco: bool = False) -> list[dict]:
    """Pedido(s) da Olist com esse número de marketplace (order_id do ML / order_sn da Shopee).
    Usa o cache de até 6 h; a situação da NF de devolução vem sempre do índice (muda depois da venda)."""
    with Sessao() as s:
        cache = s.get(PedidoCache, numero)
        pedidos = cache.pedidos if cache and not fresco and datetime.now() - cache.atualizado_em < VALIDADE_CACHE else None
    if pedidos is None:
        achados = (client.get("/pedidos", {"numeroPedidoEcommerce": numero}) or {}).get("itens") or []
        pedidos = [_pedido(r["id"]) for r in achados]
        # Pedido inexistente não fica no cache: a venda pode ainda não ter sido importada na Olist.
        if pedidos:
            with Sessao.begin() as s:
                s.merge(PedidoCache(numero_marketplace=numero, pedidos=pedidos, atualizado_em=datetime.now()))
    return [{**p, "nota_devolucao": nota_devolucao_da_venda(p["nota"] and p["nota"]["chave"])} for p in pedidos]


def sincronizar_notas_devolucao(dias: int = 30) -> dict:
    """Indexa as NF de devolução (entrada, finalidade 4) pela chave da venda. Nota nova ou ainda pendente
    é relida (a pendente vira autorizada depois); as demais já indexadas não gastam chamada."""
    with Sessao() as s:
        conhecidas = {n.id: n.situacao for n in s.scalars(select(NotaDevolucao))}
    lidas = novas = atualizadas = 0
    # Um dia por consulta e gravação ao fim de cada dia: a Olist recusa intervalos longos ("consulta levou
    # muito tempo") e, se cair no meio, a próxima rodada pula o que já foi indexado.
    for dia in (date.today() - timedelta(days=n) for n in range(dias + 1)):
        registros, offset, total = [], 0, 1
        while offset < total:
            pagina = client.get("/notas", {"tipo": "E", "dataInicial": dia.isoformat(), "dataFinal": dia.isoformat(),
                                           "limit": 100, "offset": offset}) or {}
            total = (pagina.get("paginacao") or {}).get("total") or 0
            offset += 100
            for resumo in pagina.get("itens") or []:
                if conhecidas.get(resumo["id"]) not in (None, SITUACAO_NOTA[1]):
                    continue
                n = client.get(f"/notas/{resumo['id']}") or {}
                lidas += 1
                if str(n.get("finalidade")) != FINALIDADE_DEVOLUCAO:
                    continue
                chave = CHAVE_REFERENCIADA.search(n.get("observacoes") or "")
                if resumo["id"] in conhecidas:
                    atualizadas += 1
                else:
                    novas += 1
                registros.append(NotaDevolucao(
                    id=n["id"], numero=n.get("numero"), serie=n.get("serie"),
                    situacao=SITUACAO_NOTA.get(int(n.get("situacao") or 0), str(n.get("situacao"))),
                    emitida_em=date.fromisoformat(n["dataEmissao"][:10]) if n.get("dataEmissao") else None,
                    chave_venda=chave and chave.group(1),
                    itens=[{"codigo": i.get("codigo"), "quantidade": i.get("quantidade")} for i in n.get("itens") or []],
                ))
        with Sessao.begin() as s:
            for r in registros:
                s.merge(r)
    return {"notas_lidas": lidas, "devolucoes_novas": novas, "atualizadas": atualizadas}


def nota_devolucao_da_venda(chave_venda: str | None) -> dict | None:
    if not chave_venda:
        return None
    with Sessao() as s:
        n = s.scalar(select(NotaDevolucao).where(NotaDevolucao.chave_venda == chave_venda).order_by(NotaDevolucao.id.desc()))
        return n and {"id": n.id, "numero": n.numero, "serie": n.serie, "situacao": n.situacao,
                      "emitida_em": n.emitida_em, "itens": n.itens}


def descricao_em_cache(numero: str) -> str | None:
    """Nome do produto sem chamar a Olist (listas precisam ser instantâneas); None se ainda não está no cache."""
    with Sessao() as s:
        cache = s.get(PedidoCache, numero)
        itens = [i for p in (cache.pedidos if cache else []) for i in p["itens"]]
        return itens[0]["descricao"] if itens else None


def depositos() -> list[dict]:
    return (client.get("/depositos") or {}).get("itens") or []


def produto_por_sku(sku: str) -> int | None:
    itens = (client.get("/produtos", {"codigo": sku}) or {}).get("itens") or []
    exatos = [p for p in itens if (p.get("sku") or p.get("codigo")) == sku]
    return exatos[0]["id"] if exatos else None


def movimentar(produto_id: int, deposito: int, tipo: str, quantidade: float, custo: float | None, observacao: str) -> dict:
    """tipo E (entrada) | S (saída) num depósito. Custo vai junto para não derrubar o custo médio da Olist."""
    return client.post(f"/estoque/{produto_id}", {
        "deposito": {"id": deposito}, "tipo": tipo, "quantidade": quantidade,
        "precoUnitario": custo or 0, "observacoes": observacao,
    })


def pecas(produto_id: int, sku: str, quantidade: float) -> list[tuple[int, str, float]]:
    """Kit (tipo K) não aceita lançamento de estoque na Olist: devolve os componentes com a qtd proporcional."""
    p = client.get(f"/produtos/{produto_id}") or {}
    if p.get("tipo") != "K" or not p.get("kit"):
        return [(produto_id, sku, quantidade)]
    return [(c["produto"]["id"], c["produto"].get("sku") or "", quantidade * float(c.get("quantidade") or 1))
            for c in p["kit"]]


def deposito_id(tipo: str, plataforma: str) -> int:
    """tipo 'vendavel' | 'avaria'. Avaria é separada por plataforma, como a Novaes já organiza na Olist."""
    chave = "OLIST_DEPOSITO_VENDAVEL" if tipo == "vendavel" else f"OLIST_DEPOSITO_AVARIA_{plataforma.upper()}"
    if not os.getenv(chave):
        raise RuntimeError(f"Defina {chave} (id do depósito na Olist) nas variáveis de ambiente")
    return int(os.environ[chave])
