"""
Integração com a Shopee Open Platform (API v2).

Credenciais vêm do .env (SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY). Os tokens
rotativos ficam em shopee_token.json, fora do repositório. Em produção,
SHOPEE_DATA_DIR=/data e SHOPEE_TOKEN_JSON semeia o arquivo no primeiro boot,
igual ao que já é feito para Olist e Mercado Livre.

Sobre o refresh: o refresh_token da Shopee é de uso único — cada renovação
devolve outro. Duas renovações concorrentes queimam a cadeia e derrubam a
integração até alguém reautorizar à mão (foi o que aconteceu com a Olist).
Por isso get_access_token() renova sob lock, com dupla checagem.
"""

import hashlib
import re
import hmac
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()

_BASE_DIR = os.path.abspath(os.path.dirname(__file__))
_DEFAULT_DATA_DIR = os.path.abspath(os.path.join(_BASE_DIR, ".."))
_DATA_DIR = os.path.abspath(os.getenv("SHOPEE_DATA_DIR") or _DEFAULT_DATA_DIR)
os.makedirs(_DATA_DIR, exist_ok=True)
TOKEN_FILE = os.path.abspath(os.path.join(_DATA_DIR, "shopee_token.json"))

_token_seed = os.getenv("SHOPEE_TOKEN_JSON")
if _token_seed and not os.path.exists(TOKEN_FILE):
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as _f:
            _f.write(_token_seed)
        os.chmod(TOKEN_FILE, 0o600)
        print(f"[SHOPEE] Token inicial gravado em {TOKEN_FILE}")
    except Exception as _e:
        print(f"[SHOPEE] Falha ao gravar token inicial: {_e}")

# O access_token dura 4h; renova com folga para não usar um já vencido.
MARGEM_RENOVACAO_S = 600


def assinar(partner_key: str, base: str) -> str:
    """HMAC-SHA256 em hex, o formato que a Shopee espera no campo `sign`."""
    return hmac.new(partner_key.encode(), base.encode(), hashlib.sha256).hexdigest()


# Nomes que a Shopee usa em inglês, do jeito que o operador entende.
NOME_METRICA = {
    "late_shipment_rate": "Envio atrasado",
    "non_fulfillment_rate": "Pedidos não atendidos",
    "cancellation_rate": "Cancelamentos",
    "return_refund_rate": "Devoluções e reembolsos",
    "saturday_shipment_rate": "Envio aos sábados",
    "avg_preparation_time_ps": "Tempo médio de preparo",
    "otdr_dd_rate": "Entrega no prazo",
    "response_rate": "Taxa de resposta ao comprador",
    "shop_rating": "Nota da loja",
    "pre_order_listing_rate": "Anúncios em pré-venda",
    "the_amount_of_pre_order_listing": "Quantidade de anúncios em pré-venda",
    "severe_listing_violations": "Violações graves de anúncio",
    "other_listing_violations": "Outras violações de anúncio",
    "prohibited_listings": "Anúncios proibidos",
    "counterfeit_ip_infringement": "Falsificação ou uso indevido de marca",
    "spam_listings": "Anúncios de spam",
    "pqr_products": "Produtos com reclamação de qualidade",
}

DIMENSAO = {1: "envio", 2: "anuncios", 3: "atendimento"}
UNIDADE = {1: "", 2: "%", 4: " dias"}


def avaliar_metrica(m: Dict[str, Any]) -> Dict[str, Any]:
    """Compara a métrica com a meta e com o período anterior.

    A direção depende do comparador: em `<5` menor é melhor, em `>=60` maior é
    melhor. Sem isso, uma queda em "taxa de resposta" seria lida como melhora.
    """
    nome_api = str(m.get("metric_name") or "")
    valor = m.get("current_period")
    anterior = m.get("last_period")
    alvo_bruto = m.get("target") or {}
    comparador = str(alvo_bruto.get("comparator") or "")
    alvo = alvo_bruto.get("value")

    menor_e_melhor = comparador.startswith("<")

    fora_da_meta = False
    if valor is not None and alvo is not None and comparador:
        if comparador == "<":
            fora_da_meta = valor >= alvo
        elif comparador == "<=":
            fora_da_meta = valor > alvo
        elif comparador == ">":
            fora_da_meta = valor <= alvo
        elif comparador == ">=":
            fora_da_meta = valor < alvo

    tendencia = "estavel"
    if valor is not None and anterior is not None and valor != anterior:
        melhorou = valor < anterior if menor_e_melhor else valor > anterior
        tendencia = "melhorou" if melhorou else "piorou"

    # Fração da meta já consumida. Acima de 1 significa meta estourada em
    # limite superior; abaixo de 1, piso não alcançado.
    uso = None
    if valor is not None and alvo:
        uso = round(float(valor) / float(alvo), 3)
    elif valor is not None and alvo == 0:
        uso = 0.0 if valor == 0 else 2.0

    return {
        "chave": nome_api,
        "nome": NOME_METRICA.get(nome_api, nome_api.replace("_", " ").capitalize()),
        "dimensao": DIMENSAO.get(m.get("metric_type"), "outros"),
        "valor": valor,
        "anterior": anterior,
        "unidade": UNIDADE.get(m.get("unit"), ""),
        "alvo": alvo,
        "comparador": comparador,
        "menor_e_melhor": menor_e_melhor,
        "fora_da_meta": fora_da_meta,
        "tendencia": tendencia,
        "uso_da_meta": uso,
    }


class ShopeeAPI:
    def __init__(self) -> None:
        self.partner_id = str(os.getenv("SHOPEE_PARTNER_ID", "")).strip()
        self.partner_key = str(os.getenv("SHOPEE_PARTNER_KEY", "")).strip()
        self.redirect_uri = str(os.getenv("SHOPEE_REDIRECT_URI", "")).strip()
        self.host = str(
            os.getenv("SHOPEE_HOST") or "https://openplatform.shopee.com.br"
        ).rstrip("/")
        self._token_lock = threading.Lock()
        self._ultimo_erro_refresh = ""

    # ---------------------------------------------------------------- infra

    @property
    def configurado(self) -> bool:
        return bool(self.partner_id and self.partner_key)

    def _sign_publico(self, path: str, timestamp: int) -> str:
        """Endpoints que ainda não têm loja autorizada (auth, refresh)."""
        return assinar(self.partner_key, f"{self.partner_id}{path}{timestamp}")

    def _sign_loja(self, path: str, timestamp: int, access_token: str, shop_id: str) -> str:
        """Endpoints de loja: o token e o shop_id entram na string base."""
        return assinar(
            self.partner_key,
            f"{self.partner_id}{path}{timestamp}{access_token}{shop_id}",
        )

    def _ler_token(self) -> Dict[str, Any]:
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        except Exception as e:
            print(f"[SHOPEE] Falha ao ler token: {e}")
            return {}

    def _gravar_token(self, dados: Dict[str, Any]) -> None:
        try:
            with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=2)
            os.chmod(TOKEN_FILE, 0o600)
        except Exception as e:
            print(f"[SHOPEE] Falha ao gravar token: {e}")

    def _post(self, path: str, corpo: Dict[str, Any], query: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.host}{path}?{urllib.parse.urlencode(query)}"
        req = urllib.request.Request(
            url,
            data=json.dumps(corpo).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                # Sem User-Agent explícito o urllib se anuncia como Python-urllib,
                # que parte da borda da Shopee rejeita com 403 antes da API.
                "User-Agent": "NVS-Estoque/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # A Shopee costuma explicar o motivo no corpo mesmo em 4xx —
            # engolir isso deixa a falha impossível de diagnosticar.
            bruto = ""
            try:
                bruto = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            try:
                return json.loads(bruto)
            except (json.JSONDecodeError, ValueError):
                return {"error": f"http_{e.code}", "message": bruto or str(e)}

    # ----------------------------------------------------------- autorização

    def url_autorizacao(self) -> str:
        """Link que o lojista abre para autorizar o app na conta dele."""
        path = "/api/v2/shop/auth_partner"
        ts = int(time.time())
        query = {
            "partner_id": self.partner_id,
            "timestamp": ts,
            "sign": self._sign_publico(path, ts),
            "redirect": self.redirect_uri,
        }
        return f"{self.host}{path}?{urllib.parse.urlencode(query)}"

    def trocar_code(self, code: str, shop_id: str) -> Dict[str, Any]:
        """Troca o code do callback pelo par de tokens. O code vale uma vez só."""
        path = "/api/v2/auth/token/get"
        ts = int(time.time())
        resposta = self._post(
            path,
            {"code": code, "shop_id": int(shop_id), "partner_id": int(self.partner_id)},
            {"partner_id": self.partner_id, "timestamp": ts, "sign": self._sign_publico(path, ts)},
        )

        if resposta.get("error"):
            print(f"[SHOPEE] Erro ao trocar code: {resposta.get('error')} {resposta.get('message')}")
            return resposta

        self._gravar_token({
            "access_token": resposta.get("access_token"),
            "refresh_token": resposta.get("refresh_token"),
            "shop_id": str(shop_id),
            "expires_at": int(time.time()) + int(resposta.get("expire_in") or 14400),
        })
        print(f"[SHOPEE] Loja {shop_id} autorizada")
        return resposta

    def _renovar(self, dados: Dict[str, Any]) -> Optional[str]:
        path = "/api/v2/auth/access_token/get"
        ts = int(time.time())
        try:
            resposta = self._post(
                path,
                {
                    "refresh_token": dados.get("refresh_token"),
                    "shop_id": int(dados.get("shop_id")),
                    "partner_id": int(self.partner_id),
                },
                {"partner_id": self.partner_id, "timestamp": ts, "sign": self._sign_publico(path, ts)},
            )
        except Exception as e:
            print(f"[SHOPEE] Falha na renovação: {type(e).__name__}: {e}")
            return None

        if resposta.get("error") or not resposta.get("access_token"):
            print(f"[SHOPEE] Renovação recusada: {resposta.get('error')} | {resposta.get('message')}")
            # Guarda o motivo para o status conseguir explicar a falha sem
            # obrigar a caçar log de produção.
            self._ultimo_erro_refresh = (
                f"{resposta.get('error')}: {resposta.get('message')}"
            )
            return None

        self._gravar_token({
            "access_token": resposta.get("access_token"),
            # A resposta traz um refresh_token novo; o anterior morre aqui.
            "refresh_token": resposta.get("refresh_token") or dados.get("refresh_token"),
            "shop_id": str(dados.get("shop_id")),
            "expires_at": int(time.time()) + int(resposta.get("expire_in") or 14400),
        })
        print("[SHOPEE] Token renovado")
        return resposta.get("access_token")

    def get_access_token(self) -> Optional[str]:
        dados = self._ler_token()
        if not dados.get("access_token") or not dados.get("refresh_token"):
            return None

        agora = int(time.time())
        if agora < int(dados.get("expires_at") or 0) - MARGEM_RENOVACAO_S:
            return dados["access_token"]

        # Uma renovação por vez: o refresh_token é de uso único e duas chamadas
        # concorrentes invalidam a cadeia inteira.
        with self._token_lock:
            dados = self._ler_token()
            agora = int(time.time())
            if agora < int(dados.get("expires_at") or 0) - MARGEM_RENOVACAO_S:
                return dados.get("access_token")
            return self._renovar(dados)

    # ----------------------------------------------------------- uso da API

    def chamar(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """GET assinado em endpoint de loja. Devolve o corpo já em dict."""
        token = self.get_access_token()
        dados = self._ler_token()
        shop_id = str(dados.get("shop_id") or "")
        if not token or not shop_id:
            return {"error": "nao_autorizado", "message": "Loja Shopee não autorizada"}

        ts = int(time.time())
        query = {
            "partner_id": self.partner_id,
            "timestamp": ts,
            "access_token": token,
            "shop_id": shop_id,
            "sign": self._sign_loja(path, ts, token, shop_id),
            **(params or {}),
        }
        # doseq=True: parâmetro tipo lista (ex.: item_status) vira chave repetida
        # (item_status=UNLIST&item_status=NORMAL), do jeito que a doc da Shopee pede.
        url = f"{self.host}{path}?{urllib.parse.urlencode(query, doseq=True)}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": "falha_requisicao", "message": str(e)}

    def chamar_post(self, path: str, corpo: Dict[str, Any]) -> Dict[str, Any]:
        """POST assinado em endpoint de loja (ex.: update_item). Devolve o corpo já em dict."""
        token = self.get_access_token()
        dados = self._ler_token()
        shop_id = str(dados.get("shop_id") or "")
        if not token or not shop_id:
            return {"error": "nao_autorizado", "message": "Loja Shopee não autorizada"}

        ts = int(time.time())
        query = {
            "partner_id": self.partner_id,
            "timestamp": ts,
            "access_token": token,
            "shop_id": shop_id,
            "sign": self._sign_loja(path, ts, token, shop_id),
        }
        url = f"{self.host}{path}?{urllib.parse.urlencode(query)}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(corpo).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "NVS-Estoque/1.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            bruto = ""
            try:
                bruto = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            try:
                return json.loads(bruto)
            except (json.JSONDecodeError, ValueError):
                return {"error": f"http_{e.code}", "message": bruto or str(e)}
        except Exception as e:
            return {"error": "falha_requisicao", "message": str(e)}

    def listar_todos_itens_fiscais(self) -> list:
        """item_id/sku/nome/tax_info (NCM/CEST) de todo item ativo ou pausado —
        mesma paginação de listar_todos_skus, só que devolve o tax_info também
        em vez de só o SKU normalizado."""
        itens = []
        for status in ("NORMAL", "UNLIST"):
            offset = 0
            while True:
                resp = self.chamar("/api/v2/product/get_item_list", {
                    "offset": offset,
                    "page_size": 100,
                    "item_status": [status],
                })
                if resp.get("error"):
                    print(f"[SHOPEE] Erro ao listar itens {status}: {resp.get('error')} {resp.get('message')}")
                    break
                corpo = resp.get("response") or {}
                item_ids = [it.get("item_id") for it in (corpo.get("item") or []) if it.get("item_id")]

                for i in range(0, len(item_ids), 50):
                    lote = item_ids[i:i + 50]
                    r2 = self.chamar("/api/v2/product/get_item_base_info", {
                        "item_id_list": ",".join(str(x) for x in lote),
                        "need_tax_info": True,
                    })
                    if r2.get("error"):
                        print(f"[SHOPEE] Erro ao buscar tax_info do lote {lote}: {r2.get('error')} {r2.get('message')}")
                        continue
                    for item in (r2.get("response") or {}).get("item_list") or []:
                        tax = item.get("tax_info") or {}
                        itens.append({
                            "item_id": str(item.get("item_id")),
                            "sku": item.get("item_sku") or "",
                            "nome": item.get("item_name") or "",
                            "ncm": tax.get("ncm") or "",
                            "cest": tax.get("cest") or "",
                        })

                if not corpo.get("has_next_page") or not item_ids:
                    break
                offset = corpo.get("next_offset", offset + len(item_ids))
        return itens

    def atualizar_ncm(self, item_id: str, ncm: str, cest: Optional[str] = None) -> Dict[str, Any]:
        """Atualiza NCM (e opcionalmente CEST) de um anúncio via update_item.
        tax_info aceita atualização parcial — não precisa reenviar o produto inteiro."""
        tax_info: Dict[str, Any] = {"ncm": ncm}
        if cest:
            tax_info["cest"] = cest
        resp = self.chamar_post("/api/v2/product/update_item", {
            "item_id": int(item_id),
            "tax_info": tax_info,
        })
        if resp.get("error"):
            return {"sucesso": False, "erro": f"{resp.get('error')}: {resp.get('message')}"}
        return {"sucesso": True}

    def info_loja(self) -> Dict[str, Any]:
        """Dados da loja autorizada. Primeira chamada assinada com token."""
        dados = self.chamar("/api/v2/shop/get_shop_info")
        # get_shop_info não repete o shop_id no corpo: ele vai na query.
        if not dados.get("error"):
            dados.setdefault("shop_id", self._ler_token().get("shop_id"))
        return dados

    def dashboard(self) -> Dict[str, Any]:
        """Saúde da conta Shopee: cada métrica contra a meta e contra o período
        anterior, mais o dinheiro que entrou na quinzena.

        Na Shopee, métrica fora da meta vira penalidade e anúncio
        despriorizado — por isso o painel gira em torno disso, e não do
        estoque como o do Mercado Livre.
        """
        perf = self.chamar("/api/v2/account_health/get_shop_performance")
        if perf.get("error"):
            return {"erro": perf.get("error"), "mensagem": perf.get("message")}

        corpo = perf.get("response") or {}
        geral = corpo.get("overall_performance") or {}

        metricas = [
            avaliar_metrica(m) for m in (corpo.get("metric_list") or [])
        ]
        metricas = [m for m in metricas if m["valor"] is not None]

        agora = int(time.time())
        repasses = self.chamar(
            "/api/v2/payment/get_escrow_list",
            {"release_time_from": agora - 14 * 86400, "release_time_to": agora,
             "page_size": 100},
        )
        lista_repasses = ((repasses.get("response") or {}).get("escrow_list") or []) \
            if not repasses.get("error") else []

        return {
            "rating": geral.get("rating"),
            "falhas": {
                "envio": geral.get("fulfillment_failed") or 0,
                "anuncios": geral.get("listing_failed") or 0,
                "atendimento": geral.get("custom_service_failed") or 0,
            },
            "metricas": metricas,
            "repasses": {
                "quantidade": len(lista_repasses),
                "total": round(sum(float(r.get("payout_amount") or 0) for r in lista_repasses), 2),
                "ultimos": sorted(
                    lista_repasses,
                    key=lambda r: r.get("escrow_release_time") or 0,
                    reverse=True,
                )[:5],
            },
        }

    def forma_do_token(self) -> Dict[str, Any]:
        """Formato do token salvo, sem devolver os valores.

        Serve para separar "refresh_token gravado errado" de "refresh_token
        recusado pela Shopee" — que dão o mesmo erro na renovação.
        """
        d = self._ler_token()
        at = str(d.get("access_token") or "")
        rt = str(d.get("refresh_token") or "")
        return {
            "tem_access_token": bool(at),
            "tam_access_token": len(at),
            "tem_refresh_token": bool(rt),
            "tam_refresh_token": len(rt),
            "shop_id": d.get("shop_id"),
            "shop_id_tipo": type(d.get("shop_id")).__name__,
            "expires_at": d.get("expires_at"),
            "campos": sorted(d.keys()),
        }

    def renovar_agora(self) -> Dict[str, Any]:
        """Força a renovação, para conferir a cadeia sem esperar 4h.

        Consome o refresh_token atual — só use quando quiser justamente
        testar se a próxima renovação vai funcionar.
        """
        with self._token_lock:
            antes = self._ler_token()
            novo = self._renovar(antes)
            depois = self._ler_token()
            return {
                "renovou": bool(novo),
                "erro": None if novo else (self._ultimo_erro_refresh or "falha na chamada"),
                "refresh_token_mudou": bool(
                    novo and antes.get("refresh_token") != depois.get("refresh_token")
                ),
                "expires_at": depois.get("expires_at"),
            }

    def diagnostico(self) -> Dict[str, Any]:
        """Sonda os endpoints que interessam e devolve o formato cru de cada um.

        Serve para descobrir o que esta loja realmente expõe antes de construir
        em cima — e depois, para saber onde a integração quebrou.
        """
        agora = int(time.time())
        sondas = [
            ("produtos", "/api/v2/product/get_item_list",
             {"offset": 0, "page_size": 5, "item_status": "NORMAL"}),
            ("pedidos_15d", "/api/v2/order/get_order_list",
             {"time_range_field": "create_time", "time_from": agora - 14 * 86400,
              "time_to": agora, "page_size": 5}),
            ("performance", "/api/v2/account_health/get_shop_performance", {}),
            ("repasses", "/api/v2/payment/get_escrow_list",
             {"release_time_from": agora - 14 * 86400, "release_time_to": agora,
              "page_size": 5}),
        ]

        saida: Dict[str, Any] = {}
        for nome, path, params in sondas:
            resposta = self.chamar(path, params)
            erro = resposta.get("error")
            saida[nome] = {
                "ok": not erro,
                "erro": erro or None,
                "mensagem": resposta.get("message") if erro else None,
                "amostra": None if erro else resposta.get("response"),
            }
        return saida

    def listar_pausados_sem_estoque(self) -> list:
        """
        Itens pausados (UNLIST) e sem estoque disponível — para a lista de compra.

        1) get_item_list pagina os item_id com status UNLIST.
        2) get_item_base_info traz sku/nome/estoque em lotes de até 50 ids.
        Filtra por total_available_stock == 0 (pausado por outro motivo, com
        estoque ainda disponível, não entra na lista).
        """
        item_ids = []
        offset = 0
        while True:
            resp = self.chamar("/api/v2/product/get_item_list", {
                "offset": offset,
                "page_size": 100,
                "item_status": ["UNLIST"],
            })
            if resp.get("error"):
                print(f"[SHOPEE] Erro ao listar itens UNLIST: {resp.get('error')} {resp.get('message')}")
                break
            corpo = resp.get("response") or {}
            pagina = [it.get("item_id") for it in (corpo.get("item") or []) if it.get("item_id")]
            item_ids.extend(pagina)
            if not corpo.get("has_next_page") or not pagina:
                break
            offset = corpo.get("next_offset", offset + len(pagina))

        parados = []
        for i in range(0, len(item_ids), 50):
            lote = item_ids[i:i + 50]
            resp = self.chamar("/api/v2/product/get_item_base_info", {
                "item_id_list": ",".join(str(x) for x in lote),
            })
            if resp.get("error"):
                print(f"[SHOPEE] Erro ao buscar base_info do lote {lote}: {resp.get('error')} {resp.get('message')}")
                continue
            for item in (resp.get("response") or {}).get("item_list") or []:
                estoque = ((item.get("stock_info_v2") or {}).get("summary_info") or {}).get("total_available_stock")
                if estoque == 0:
                    parados.append({
                        "item_id": str(item.get("item_id")),
                        "sku": item.get("item_sku") or "",
                        "nome": item.get("item_name") or "",
                        "estoque": 0,
                    })
        return parados

    def listar_todos_skus(self) -> set:
        """SKUs (normalizados) de todo item ativo ou pausado na Shopee — usado
        para saber se um produto da Olist tem anúncio na Shopee, já que a
        Shopee não expõe isso no cadastro do produto (é por item_id próprio).
        """
        skus = set()
        for status in ("NORMAL", "UNLIST"):
            offset = 0
            while True:
                resp = self.chamar("/api/v2/product/get_item_list", {
                    "offset": offset,
                    "page_size": 100,
                    "item_status": [status],
                })
                if resp.get("error"):
                    print(f"[SHOPEE] Erro ao listar itens {status}: {resp.get('error')} {resp.get('message')}")
                    break
                corpo = resp.get("response") or {}
                item_ids = [it.get("item_id") for it in (corpo.get("item") or []) if it.get("item_id")]

                for i in range(0, len(item_ids), 50):
                    lote = item_ids[i:i + 50]
                    r2 = self.chamar("/api/v2/product/get_item_base_info", {
                        "item_id_list": ",".join(str(x) for x in lote),
                    })
                    if r2.get("error"):
                        continue
                    for item in (r2.get("response") or {}).get("item_list") or []:
                        sku = re.sub(r"[^a-z0-9]", "", (item.get("item_sku") or "").lower())
                        if sku:
                            skus.add(sku)

                if not corpo.get("has_next_page") or not item_ids:
                    break
                offset = corpo.get("next_offset", offset + len(item_ids))
        return skus

    def status(self) -> Dict[str, Any]:
        """Campos em português, no mesmo formato de /api/ml|olist/status."""
        if not self.configurado:
            return {
                "autorizado": False,
                "configurado": False,
                "mensagem": "Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no .env",
            }

        dados = self._ler_token()
        autorizado = bool(dados.get("access_token") and dados.get("shop_id"))
        expira = int(dados.get("expires_at") or 0)
        return {
            "autorizado": autorizado,
            "configurado": True,
            "shop_id": dados.get("shop_id"),
            "expira_em": dados.get("expires_at"),
            "expirado": autorizado and expira and int(time.time()) >= expira,
            "erro_refresh": self._ultimo_erro_refresh or None,
            "url_autorizacao": self.url_autorizacao(),
        }


shopee = ShopeeAPI()


if __name__ == "__main__":
    # Self-check da assinatura, que é o ponto onde um erro silencioso faria
    # toda chamada voltar 403 sem explicação.
    chave = "chave_de_teste"
    esperado = hmac.new(
        chave.encode(), b"123/api/v2/shop/get_shop_info1700000000", hashlib.sha256
    ).hexdigest()
    assert assinar(chave, "123/api/v2/shop/get_shop_info1700000000") == esperado

    api = ShopeeAPI()
    api.partner_id, api.partner_key = "123", chave
    assert api._sign_publico("/api/v2/shop/get_shop_info", 1700000000) == esperado

    com_loja = api._sign_loja("/api/v2/shop/get_shop_info", 1700000000, "tok", "999")
    assert com_loja == hmac.new(
        chave.encode(), b"123/api/v2/shop/get_shop_info1700000000tok999", hashlib.sha256
    ).hexdigest()
    assert com_loja != esperado, "sign de loja tem que diferir do público"

    print("ok: assinatura pública e de loja conferem")

    # Avaliação das métricas: a direção do comparador é o que separa
    # "melhorou" de "piorou". Casos tirados da conta real.
    def met(nome, atual, ant, comp, alvo, tipo=1, unit=2):
        return {"metric_name": nome, "current_period": atual, "last_period": ant,
                "target": {"comparator": comp, "value": alvo},
                "metric_type": tipo, "unit": unit}

    # Limite superior: 0.88% de atraso com meta <5% está dentro e melhorou.
    r = avaliar_metrica(met("late_shipment_rate", 0.88, 1.72, "<", 5))
    assert r["fora_da_meta"] is False and r["tendencia"] == "melhorou"
    assert r["nome"] == "Envio atrasado"

    # Piso: taxa de resposta caindo é piora, mesmo continuando acima da meta.
    r = avaliar_metrica(met("response_rate", 70.0, 85.9, ">=", 60, tipo=3))
    assert r["fora_da_meta"] is False and r["tendencia"] == "piorou"

    # Piso furado.
    assert avaliar_metrica(met("response_rate", 55.0, 85.9, ">=", 60))["fora_da_meta"] is True

    # Meta zero: uma violação já estoura, ainda que tenha caído de 2 para 1.
    r = avaliar_metrica(met("severe_listing_violations", 1, 2, "<=", 0, tipo=2, unit=1))
    assert r["fora_da_meta"] is True and r["tendencia"] == "melhorou"
    assert r["dimensao"] == "anuncios"

    # Zerada é o único jeito de cumprir meta zero.
    assert avaliar_metrica(met("spam_listings", 0, 2, "<=", 0, tipo=2, unit=1))["fora_da_meta"] is False

    # Fronteira do "<": igual ao alvo já está fora.
    assert avaliar_metrica(met("x", 5, 4, "<", 5))["fora_da_meta"] is True
    assert avaliar_metrica(met("x", 5, 4, "<=", 5))["fora_da_meta"] is False

    # Métrica sem leitura no período não pode ser tratada como zero.
    assert avaliar_metrica(met("the_amount_of_pre_order_listing", None, None, "<", 6))["valor"] is None

    print("ok: metricas avaliadas contra meta e periodo anterior")
