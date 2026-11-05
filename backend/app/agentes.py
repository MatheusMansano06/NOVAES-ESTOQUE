"""Leitura para os agentes do Escritório: pacotes que ainda precisam sair.

Só consulta os marketplaces e devolve o mínimo: nada de nome, endereço ou apelido do comprador.
Se uma consulta falha, o problema vai em `erros`: um número a menos sem aviso seria pior que erro.
"""
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import or_

from app.central.shopee import client as shopee_client
from app.integracoes.mercado_livre import ml
from app.models import MercadoLivreItemCache, MercadoLivreVendaCache
from database import SessionLocal

# ponytail: fuso fixo, o Brasil não tem horário de verão desde 2019; se voltar, usar ZoneInfo.
BRASILIA = timezone(timedelta(hours=-3))

STATUS_ML_PENDENTE = {"handling", "ready_to_ship"}
# O Mercado Livre mantém esses como ready_to_ship, mas o pacote já saiu das mãos do vendedor.
SUBSTATUS_ML_JA_SAIU = {"picked_up", "authorized_by_carrier", "in_hub", "dropped_off"}
STATUS_SHOPEE_PENDENTE = ("READY_TO_SHIP", "PROCESSED")  # a lista recusa RETRY_SHIP como filtro
DIAS_ML = 7  # cada venda recente vira uma consulta ao vivo do envio
JANELA_SHOPEE = 15 * 86400  # limite de intervalo por consulta na Shopee
ENVIOS_EM_PARALELO = 8


def _iso_para_brasilia(valor: Optional[str]) -> Optional[str]:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")).astimezone(BRASILIA).isoformat(timespec="seconds")
    except ValueError:
        return None


def _unix_para_brasilia(valor: Optional[int]) -> Optional[str]:
    return datetime.fromtimestamp(valor, BRASILIA).isoformat(timespec="seconds") if valor else None


def pacotes_ml(ids_envio: Iterable[str], envios: Dict[str, Optional[dict]]) -> Tuple[List[dict], List[str]]:
    """Filtra os envios do Mercado Livre que esperam despacho do vendedor. Full fica de fora."""
    pacotes, erros = [], []
    for envio_id in dict.fromkeys(ids_envio):  # dois itens no mesmo envio são um pacote só
        envio = envios.get(envio_id)
        if not envio:
            erros.append(f"mercado_livre: envio {envio_id} sem resposta")
            continue
        if (envio.get("status") not in STATUS_ML_PENDENTE or envio.get("logistic_type") == "fulfillment"
                or envio.get("substatus") in SUBSTATUS_ML_JA_SAIU):
            continue
        historico = envio.get("status_history") or {}
        limite = ((envio.get("lead_time") or {}).get("estimated_handling_limit") or {}).get("date")
        pacotes.append({
            "plataforma": "mercado_livre",
            "pacote_id": str(envio_id),
            "data_venda": _iso_para_brasilia(historico.get("date_handling") or envio.get("date_created")),
            "limite_envio": _iso_para_brasilia(limite),
            "logistica": envio.get("logistic_type"),
            "situacao": envio.get("substatus") or envio.get("status"),
        })
    return pacotes, erros


def pacotes_shopee(pedidos: Iterable[dict]) -> List[dict]:
    """Um registro por pacote da Shopee. O que a própria Shopee envia fica de fora."""
    pacotes = []
    for pedido in pedidos:
        if pedido.get("fulfillment_flag") == "fulfilled_by_shopee":
            continue
        numeros = [p.get("package_number") for p in pedido.get("package_list") or [] if p.get("package_number")]
        for numero in numeros or [pedido.get("order_sn")]:
            pacotes.append({
                "plataforma": "shopee",
                "pacote_id": str(numero),
                "data_venda": _unix_para_brasilia(pedido.get("pay_time") or pedido.get("create_time")),
                "limite_envio": _unix_para_brasilia(pedido.get("ship_by_date")),
                "logistica": pedido.get("shipping_carrier"),
                "situacao": pedido.get("order_status"),
            })
    return pacotes


def _buscar_envio_ml(envio_id: str, token: str) -> Tuple[str, Optional[dict]]:
    for tentativa in range(2):  # sob paralelismo o Mercado Livre pode devolver 429 ou timeout
        envio = ml._get_raw(f"/shipments/{envio_id}", None, token)
        if envio:
            return envio_id, envio
        if tentativa == 0:
            time.sleep(0.4)
    return envio_id, None


def _coletar_ml() -> Tuple[List[dict], List[str]]:
    sincronia = ml.sync_vendas(incremental=True)
    erros = [f"mercado_livre: {sincronia['erro']}"] if sincronia.get("erro") else []
    token = ml.get_access_token()
    if not token:
        return [], erros + ["mercado_livre: sem autorização"]
    desde = datetime.utcnow() - timedelta(days=DIAS_ML)
    db = SessionLocal()
    try:
        linhas = (db.query(MercadoLivreVendaCache.shipment_id)
                  .filter(MercadoLivreVendaCache.status == "paid",
                          MercadoLivreVendaCache.shipment_id.isnot(None),
                          MercadoLivreVendaCache.date_created >= desde,
                          or_(MercadoLivreVendaCache.logistic_type.is_(None),
                              MercadoLivreVendaCache.logistic_type != "fulfillment"))
                  .distinct().all())
    finally:
        db.close()
    ids = [envio_id for (envio_id,) in linhas]
    with ThreadPoolExecutor(max_workers=ENVIOS_EM_PARALELO) as grupo:
        envios = dict(grupo.map(lambda envio_id: _buscar_envio_ml(envio_id, token), ids))
        # O prazo de despacho fica em outro recurso; só os pendentes precisam dele.
        pendentes = [i for i, envio in envios.items() if envio and envio.get("status") in STATUS_ML_PENDENTE]
        prazos = grupo.map(lambda envio_id: ml._get_raw(f"/shipments/{envio_id}/lead_time", None, token), pendentes)
        for envio_id, prazo in zip(pendentes, prazos):
            envios[envio_id]["lead_time"] = prazo
    pacotes, problemas = pacotes_ml(ids, envios)
    return pacotes, erros + problemas


def _coletar_shopee() -> Tuple[List[dict], List[str]]:
    fim = int(time.time())
    pedidos_sn: List[str] = []
    for status in STATUS_SHOPEE_PENDENTE:
        cursor, mais = "", True
        while mais:
            lista = shopee_client.get("/api/v2/order/get_order_list", {
                "time_range_field": "create_time", "time_from": fim - JANELA_SHOPEE, "time_to": fim,
                "order_status": status, "page_size": 100, "cursor": cursor,
            })
            pedidos_sn += [o["order_sn"] for o in lista.get("order_list") or []]
            mais, cursor = lista.get("more"), lista.get("next_cursor") or ""
    detalhes: List[dict] = []
    for i in range(0, len(pedidos_sn), 50):  # get_order_detail aceita até 50 pedidos por chamada
        resposta = shopee_client.get("/api/v2/order/get_order_detail", {
            "order_sn_list": ",".join(pedidos_sn[i:i + 50]),
            "response_optional_fields": "pay_time,package_list,fulfillment_flag,shipping_carrier",
        })
        detalhes += resposta.get("order_list") or []
    return pacotes_shopee(detalhes), []


def _descrever_falha(erro: Exception) -> str:
    """RuntimeError é a mensagem da própria plataforma. Outros tipos só pelo nome, porque podem trazer a URL com o token."""
    if isinstance(erro, RuntimeError):
        return re.sub(r"(access_token|sign|partner_key)=[^&\s]+", r"\1=***", str(erro))[:300]
    return f"falha na consulta ({type(erro).__name__})"


def listar_envios_pendentes() -> Dict[str, Any]:
    pacotes: List[dict] = []
    erros: List[str] = []
    for nome, coletar in (("mercado_livre", _coletar_ml), ("shopee", _coletar_shopee)):
        try:
            novos, problemas = coletar()
            pacotes += novos
            erros += problemas
        except Exception as e:  # uma plataforma fora do ar não pode esconder a outra
            descricao = _descrever_falha(e)
            print(f"[agentes] {nome}: {descricao}")
            erros.append(f"{nome}: {descricao}")
    pacotes.sort(key=lambda p: p.get("data_venda") or "")
    return {"gerado_em": datetime.now(BRASILIA).isoformat(timespec="seconds"), "pacotes": pacotes, "erros": erros}


# --- Anúncios sem promoção ------------------------------------------------------------
TIPOS_QUE_NAO_SAO_PROMOCAO = {"PRICE_DISCOUNT"}  # o desconto próprio do vendedor não conta como promoção
STATUS_PROMOCAO_VALIDA = {"started", "pending"}  # candidate é só elegível; finished já acabou


def _tem_promocao(resposta: Any) -> bool:
    promocoes = resposta if isinstance(resposta, list) else (resposta or {}).get("results") or []
    return any(
        isinstance(p, dict)
        and str(p.get("status") or "").lower() in STATUS_PROMOCAO_VALIDA
        and str(p.get("type") or "").upper() not in TIPOS_QUE_NAO_SAO_PROMOCAO
        for p in promocoes
    )


def anuncios_sem_promocao(itens: Iterable[Tuple[str, Optional[str]]], respostas: Dict[str, Any]) -> Tuple[List[dict], List[str]]:
    """Só o SKU e o MLB de quem está sem promoção. Sem resposta não é o mesmo que sem promoção: vira aviso."""
    anuncios: List[dict] = []
    sem_resposta = 0
    for mlb, sku in itens:
        resposta = respostas.get(mlb)
        if resposta is None:
            sem_resposta += 1
        elif not _tem_promocao(resposta):
            anuncios.append({"sku": sku, "mlb": mlb})
    anuncios.sort(key=lambda a: (a["sku"] or "", a["mlb"]))
    return anuncios, [f"mercado_livre: {sem_resposta} anúncio(s) sem resposta"] if sem_resposta else []


def _buscar_promocoes_ml(mlb: str, token: str) -> Tuple[str, Any]:
    for tentativa in range(2):
        resposta = ml._get_raw(f"/seller-promotions/items/{mlb}", {"app_version": "v2"}, token)
        if resposta is not None:
            return mlb, resposta
        if tentativa == 0:
            time.sleep(0.4)
    return mlb, None


def listar_anuncios_sem_promocao() -> Dict[str, Any]:
    agora = datetime.now(BRASILIA).isoformat(timespec="seconds")
    token = ml.get_access_token()
    if not token:
        return {"gerado_em": agora, "total_ativos": 0, "anuncios": [], "erros": ["mercado_livre: sem autorização"]}
    db = SessionLocal()
    try:
        itens = (db.query(MercadoLivreItemCache.item_id, MercadoLivreItemCache.sku)
                 .filter(MercadoLivreItemCache.status == "active").all())
    finally:
        db.close()
    with ThreadPoolExecutor(max_workers=ENVIOS_EM_PARALELO) as grupo:
        respostas = dict(grupo.map(lambda item: _buscar_promocoes_ml(item[0], token), itens))
    anuncios, erros = anuncios_sem_promocao(itens, respostas)
    return {"gerado_em": agora, "total_ativos": len(itens), "anuncios": anuncios, "erros": erros}
