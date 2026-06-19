"""
Integracao Profissional com Olist/Tiny ERP - API v3 (OAuth2 Authorization Code)
Endpoints de PRODUCAO corretos.

Fluxo:
1. Usuario acessa /api/olist/conectar -> redireciona para login Olist
2. Usuario autoriza no navegador
3. Olist redireciona de volta para /api/olist/callback com 'code'
4. Trocamos 'code' por access_token + refresh_token
5. Token e salvo em arquivo e renovado automaticamente
"""

import os
import json
import base64
import time
import threading
import re
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from dotenv import load_dotenv

load_dotenv()

# Diretório de dados persistentes. Em produção (Railway) aponta para o volume
# (OLIST_DATA_DIR=/data) p/ o token OAuth sobreviver a redeploys; local usa
# a própria pasta backend/.
_DATA_DIR = os.getenv("OLIST_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..")
os.makedirs(_DATA_DIR, exist_ok=True)

# Caminho para armazenar o token de forma persistente
TOKEN_FILE = os.path.join(_DATA_DIR, "olist_token.json")

# Caminho para o cache de produtos (sobrevive a restart do servidor)
CACHE_FILE = os.path.join(_DATA_DIR, "produtos_cache.json")

# Seed do token OAuth em produção: se OLIST_TOKEN_JSON estiver definida e ainda
# não houver token salvo, grava o token (já autorizado) no volume. Assim a Olist
# funciona após o deploy sem precisar refazer o login OAuth no navegador.
_token_seed = os.getenv("OLIST_TOKEN_JSON")
if _token_seed and not os.path.exists(TOKEN_FILE):
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as _f:
            _f.write(_token_seed)
        os.chmod(TOKEN_FILE, 0o600)
        print(f"[OLIST] Token inicial gravado em {TOKEN_FILE}")
    except Exception as _e:
        print(f"[OLIST] Falha ao gravar token inicial: {_e}")


class OlistIntegration:
    """Integracao com Olist/Tiny ERP - API v3 OAuth2 Authorization Code"""

    # Endpoints de PRODUCAO (Tiny ERP)
    AUTH_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth"
    TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token"
    API_BASE = "https://api.tiny.com.br/public-api/v3"

    def __init__(self):
        self.client_id = os.getenv("OLIST_CLIENT_ID", "")
        self.client_secret = os.getenv("OLIST_CLIENT_SECRET", "")
        self.redirect_uri = os.getenv(
            "OLIST_REDIRECT_URI",
            "http://localhost:8000/api/olist/callback"
        )
        self.enabled = bool(self.client_id and self.client_secret)

        # Token simples v2 (fallback legado)
        self.token_v2 = os.getenv("OLIST_API_TOKEN_SIMPLE", "")

        # Cache de produtos em memoria (evita recarregar a cada busca)
        self._cache_produtos: Optional[List[Dict]] = None
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl_segundos = 1800  # 30 minutos

        # Cache de estoque (produto_id -> (dados, timestamp_epoch))
        self._estoque_cache: Dict[str, tuple] = {}
        self._estoque_cache_ttl = 300  # 5 minutos

        # Rate limiter: Olist permite 120 req/min. Usamos margem de seguranca.
        # Garante intervalo minimo entre requisicoes (thread-safe).
        self._rate_lock = threading.Lock()
        self._ultima_req = 0.0
        self._intervalo_min = 60.0 / 100.0  # ~100 req/min (margem sob 120)

        # Lock do refresh de token. O refresh_token da Olist e de USO UNICO (rotativo):
        # cada renovacao invalida o anterior. Sem este lock, duas threads (ex.: job do
        # APScheduler + request HTTP) renovam ao mesmo tempo com o MESMO refresh_token,
        # uma rotaciona e a outra manda o token ja invalidado -> a Olist mata a cadeia
        # inteira e o usuario precisa reconectar na mao a cada poucas horas.
        self._token_lock = threading.Lock()

    def _throttle(self):
        """Garante o intervalo minimo entre requisicoes (rate limit global)."""
        with self._rate_lock:
            agora = time.monotonic()
            espera = self._intervalo_min - (agora - self._ultima_req)
            if espera > 0:
                time.sleep(espera)
            self._ultima_req = time.monotonic()

    # ========== PERSISTENCIA DE TOKEN ==========

    def _salvar_token(self, dados: Dict):
        """Salva token em arquivo JSON com permissões restritas"""
        try:
            with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                json.dump(dados, f, indent=2)
            # 🔒 SEGURANÇA: Restringir permissões do arquivo (apenas dono pode ler)
            os.chmod(TOKEN_FILE, 0o600)
            print("[OLIST] Token salvo com sucesso (permissões restritas)")
        except Exception as e:
            print(f"[OLIST] Erro ao salvar token: {e}")

    def _carregar_token(self) -> Optional[Dict]:
        """Carrega token do arquivo JSON"""
        try:
            if os.path.exists(TOKEN_FILE):
                with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[OLIST] Erro ao carregar token: {e}")
        return None

    # ========== FLUXO OAUTH2 ==========

    def get_authorization_url(self) -> str:
        """Gera a URL para o usuario autorizar o app no Olist"""
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": "openid"
        }
        query = urllib.parse.urlencode(params)
        return f"{self.AUTH_URL}?{query}"

    def _basic_auth_header(self) -> str:
        """Gera header Basic Auth: base64(client_id:client_secret)"""
        credentials = f"{self.client_id}:{self.client_secret}"
        encoded = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
        return f"Basic {encoded}"

    def trocar_code_por_token(self, code: str) -> bool:
        """
        Troca o authorization code por access_token + refresh_token
        Chamado pelo callback apos usuario autorizar
        """
        try:
            print("[OLIST] Trocando code por token...")

            data = {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri
            }

            post_data = urllib.parse.urlencode(data).encode("utf-8")
            headers = {
                "Authorization": self._basic_auth_header(),
                "Content-Type": "application/x-www-form-urlencoded"
            }

            req = urllib.request.Request(
                self.TOKEN_URL, data=post_data, headers=headers, method="POST"
            )

            with urllib.request.urlopen(req, timeout=15) as response:
                resposta = json.loads(response.read().decode("utf-8"))

                if "access_token" in resposta:
                    expires_in = resposta.get("expires_in", 3600)
                    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()

                    dados = {
                        "access_token": resposta["access_token"],
                        "refresh_token": resposta.get("refresh_token", ""),
                        "expires_at": expires_at,
                        "obtido_em": datetime.utcnow().isoformat()
                    }
                    self._salvar_token(dados)
                    print("[OLIST] Autorizacao concluida com sucesso!")
                    return True

                print(f"[OLIST] Resposta sem token: {resposta}")
                return False

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"[OLIST] Erro HTTP {e.code} ao trocar code: {error_body}")
            return False
        except Exception as e:
            print(f"[OLIST] Erro ao trocar code: {e}")
            return False

    def _renovar_token(self, refresh_token: str) -> Optional[str]:
        """Renova o access_token usando o refresh_token"""
        try:
            print("[OLIST] Renovando token...")

            data = {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token
            }

            post_data = urllib.parse.urlencode(data).encode("utf-8")
            headers = {
                "Authorization": self._basic_auth_header(),
                "Content-Type": "application/x-www-form-urlencoded"
            }

            req = urllib.request.Request(
                self.TOKEN_URL, data=post_data, headers=headers, method="POST"
            )

            with urllib.request.urlopen(req, timeout=15) as response:
                resposta = json.loads(response.read().decode("utf-8"))

                if "access_token" in resposta:
                    expires_in = resposta.get("expires_in", 3600)
                    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()

                    dados = {
                        "access_token": resposta["access_token"],
                        "refresh_token": resposta.get("refresh_token", refresh_token),
                        "expires_at": expires_at,
                        "obtido_em": datetime.utcnow().isoformat()
                    }
                    self._salvar_token(dados)
                    print("[OLIST] Token renovado com sucesso")
                    return dados["access_token"]

        except urllib.error.HTTPError as e:
            corpo = ""
            try:
                corpo = e.read().decode("utf-8")
            except Exception:
                pass
            if e.code in (400, 401) and "invalid_grant" in corpo:
                print(f"[OLIST] Refresh token invalido/expirado (invalid_grant) — RECONECTAR em /api/olist/conectar. Resposta: {corpo[:300]}")
            else:
                print(f"[OLIST] Erro HTTP {e.code} ao renovar token: {corpo[:300]}")
        except Exception as e:
            print(f"[OLIST] Erro ao renovar token: {e}")

        return None

    def _token_valido(self, dados: Optional[Dict]) -> Optional[str]:
        """Retorna o access_token se ainda valido (com margem de 60s), senao None."""
        if not dados:
            return None
        expires_at = dados.get("expires_at")
        if expires_at:
            try:
                if datetime.utcnow() < (datetime.fromisoformat(expires_at) - timedelta(seconds=60)):
                    return dados.get("access_token")
            except (TypeError, ValueError):
                return None
        return None

    def get_access_token(self) -> Optional[str]:
        """
        Obtem um access_token valido.
        - Carrega do arquivo
        - Renova se expirado (com lock: so UMA renovacao por vez, ver _token_lock)
        - Retorna None se nunca foi autorizado
        Nota: Em caso de falha, retorna None para permitir fallback ao token simples
        """
        try:
            # Caminho rapido (sem lock): token ainda valido.
            token = self._token_valido(self._carregar_token())
            if token:
                return token

            # Token expirado/expirando: serializa a renovacao. O refresh_token e
            # rotativo (uso unico) — sem lock, renovacoes concorrentes matam a cadeia.
            with self._token_lock:
                # Double-check: outra thread pode ter renovado enquanto esperavamos.
                dados = self._carregar_token()
                token = self._token_valido(dados)
                if token:
                    return token

                if not dados:
                    return None

                refresh_token = dados.get("refresh_token")
                if refresh_token:
                    return self._renovar_token(refresh_token)  # salva e retorna o novo, ou None
                return None
        except Exception as e:
            print(f"[OLIST] Erro ao obter token: {e}")
            return None

    # ========== CACHE DE PRODUTOS ==========

    def _cache_valido(self) -> bool:
        """Verifica se o cache em memoria ainda esta dentro do TTL"""
        if self._cache_produtos is None or self._cache_timestamp is None:
            return False
        idade = (datetime.utcnow() - self._cache_timestamp).total_seconds()
        return idade < self._cache_ttl_segundos

    def _carregar_cache_arquivo(self) -> bool:
        """Carrega cache do arquivo para a memoria. Retorna True se valido."""
        try:
            if not os.path.exists(CACHE_FILE):
                return False
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                dados = json.load(f)
            ts = datetime.fromisoformat(dados["timestamp"])
            idade = (datetime.utcnow() - ts).total_seconds()
            if idade < self._cache_ttl_segundos and dados.get("produtos"):
                self._cache_produtos = dados["produtos"]
                self._cache_timestamp = ts
                print(f"[OLIST] Cache carregado do arquivo: {len(self._cache_produtos)} produtos ({int(idade)}s atras)")
                return True
        except Exception as e:
            print(f"[OLIST] Erro ao carregar cache do arquivo: {e}")
        return False

    def _salvar_cache(self, produtos: List[Dict]):
        """Salva produtos no cache (memoria + arquivo)"""
        self._cache_produtos = produtos
        self._cache_timestamp = datetime.utcnow()
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "timestamp": self._cache_timestamp.isoformat(),
                    "produtos": produtos
                }, f, ensure_ascii=False)
            print(f"[OLIST] Cache salvo: {len(produtos)} produtos")
        except Exception as e:
            print(f"[OLIST] Erro ao salvar cache: {e}")

    def invalidar_cache(self):
        """Forca a proxima busca a recarregar da API"""
        self._cache_produtos = None
        self._cache_timestamp = None
        try:
            if os.path.exists(CACHE_FILE):
                os.remove(CACHE_FILE)
        except Exception:
            pass
        print("[OLIST] Cache invalidado")

    # ========== OPERACOES NA API ==========

    def listar_todos_produtos(self, limite: int = 2000, forcar_refresh: bool = False) -> List[Dict]:
        """
        Lista TODOS os produtos com cache.
        - Se cache valido (memoria ou arquivo), retorna instantaneo.
        - Senao, carrega da API (paginado) e salva no cache.
        """
        # 1) Cache em memoria
        if not forcar_refresh and self._cache_valido():
            print(f"[OLIST] Cache HIT (memoria): {len(self._cache_produtos)} produtos")
            return self._cache_produtos

        # 2) Cache em arquivo
        if not forcar_refresh and self._carregar_cache_arquivo():
            return self._cache_produtos

        # 3) Cache miss -> carregar da API
        print(f"[OLIST] Cache MISS -> carregando da API...")
        produtos = self._buscar_produtos_api(limite=limite)
        if produtos:
            self._salvar_cache(produtos)
        return produtos

    def _buscar_produtos_api(self, limite: int = 2000) -> List[Dict]:
        """Lista TODOS os produtos da API com paginação (sem cache)"""
        resultado = []
        pagina = 1
        total_recuperado = 0
        MAX_PAGES = 20  # Aumentado para 20 páginas = até 2000 produtos
        page_size = 100  # Aumentar para 100 por página para ser mais rápido

        print(f"[OLIST] === Listando TODOS produtos (até {limite}) ===")

        # ESTRATÉGIA 1: Usar OAuth2 token (PRIORIDADE MÁXIMA - é sempre válido)
        token = self.get_access_token()
        if token:
            print(f"[OLIST] Usando OAuth2 com paginação (página {page_size} itens)...")
            try:
                while pagina <= MAX_PAGES and total_recuperado < limite:
                    url = f"{self.API_BASE}/produtos?pageSize={page_size}&page={pagina}"

                    print(f"[OLIST] Carregando página {pagina}... (total: {total_recuperado})")

                    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
                    req = urllib.request.Request(url, headers=headers, method="GET")

                    try:
                        with urllib.request.urlopen(req, timeout=15) as response:
                            resposta = json.loads(response.read().decode("utf-8"))

                            produtos = resposta.get("itens") or resposta.get("data") or resposta.get("results") or (resposta if isinstance(resposta, list) else [])

                            if not produtos or len(produtos) == 0:
                                print(f"[OLIST] Fim! Página {pagina} vazia. Total: {total_recuperado}")
                                break

                            print(f"[OLIST] Página {pagina}: {len(produtos)} produtos | Total: {total_recuperado + len(produtos)}")

                            for prod in produtos:
                                resultado.append({
                                    "id": prod.get("id", ""),
                                    "sku": prod.get("sku", ""),
                                    "nome": prod.get("descricao") or prod.get("nome", ""),
                                    "preco": float(prod.get("precos", {}).get("preco", 0) if isinstance(prod.get("precos"), dict) else prod.get("preco", 0) or 0),
                                    "codigo_produto": prod.get("sku", ""),
                                })
                                total_recuperado += 1

                                if total_recuperado >= limite:
                                    print(f"[OLIST] Limite atingido: {total_recuperado}")
                                    break

                            pagina += 1

                            if total_recuperado >= limite:
                                break
                    except Exception as page_error:
                        print(f"[OLIST] Erro na página {pagina}: {page_error}")
                        break

                if resultado:
                    print(f"[OLIST] OK: {len(resultado)} produtos retornados (total: {total_recuperado} de {limite})")
                    return resultado
            except Exception as e:
                print(f"[OLIST] OAuth2 falhou: {e}")

        # ESTRATÉGIA 2: Fallback para token simples (pode estar expirado)
        if self.token_v2 and not resultado:
            print(f"[OLIST] Tentando fallback: API v2 com token simples...")
            try:
                url = f"https://api.tiny.com.br/v2/produtos.json?token={self.token_v2}&formato=json"
                headers = {"Accept": "application/json"}
                req = urllib.request.Request(url, headers=headers, method="GET")

                with urllib.request.urlopen(req, timeout=15) as response:
                    resposta = json.loads(response.read().decode("utf-8"))

                    if "retorno" in resposta:
                        produtos = resposta["retorno"].get("produtos", [])
                        print(f"[OLIST] API v2 encontrou {len(produtos)} produtos")

                        for prod in produtos[:limite]:
                            resultado.append({
                                "id": prod.get("id", ""),
                                "sku": prod.get("codigo", ""),
                                "nome": prod.get("nome", ""),
                                "preco": float(prod.get("preco", 0) or 0),
                                "codigo_produto": prod.get("codigo", ""),
                            })

                        if resultado:
                            print(f"[OLIST] OK: {len(resultado)} produtos retornados via token simples")
                            return resultado
            except Exception as e:
                print(f"[OLIST] Token simples falhou (provavelmente expirado): {e}")

        print(f"[OLIST] ERRO: Nenhum produto listado")
        return resultado

    def _buscar_por_codigo_api(self, codigo: str) -> List[Dict]:
        """
        Busca um produto por SKU EXATO direto na API (parametro ?codigo=).
        Essencial para achar VARIACOES, que nao aparecem na listagem /produtos.
        """
        token = self.get_access_token()
        if not token:
            return []
        try:
            url = f"{self.API_BASE}/produtos?codigo={urllib.parse.quote(codigo)}&limit=20"
            self._throttle()  # respeita o rate limit (120/min)
            req = urllib.request.Request(
                url, headers={"Accept": "application/json", "Authorization": f"Bearer {token}"}
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                dados = json.loads(r.read().decode("utf-8"))

            itens = dados.get("itens", []) or []
            out = []
            for prod in itens:
                out.append({
                    "id": prod.get("id", ""),
                    "sku": prod.get("sku", ""),
                    "nome": prod.get("descricao") or prod.get("nome", ""),
                    "preco": float(prod.get("precos", {}).get("preco", 0) if isinstance(prod.get("precos"), dict) else prod.get("preco", 0) or 0),
                    "codigo_produto": prod.get("sku", ""),
                })
            if out:
                print(f"[OLIST] Busca por codigo '{codigo}': {len(out)} resultado(s) via API")
            return out
        except Exception as e:
            print(f"[OLIST] Busca por codigo '{codigo}' falhou: {e}")
            return []

    def _normalizar_sku_busca(self, valor: str) -> str:
        return re.sub(r'[^a-z0-9]', '', (valor or '').lower())

    def _termo_parece_sku(self, termo: str) -> bool:
        termo = (termo or '').strip()
        return bool(termo) and ' ' not in termo and len(self._normalizar_sku_busca(termo)) >= 3

    def _score_busca_produto(self, produto: Dict, termo: str, sku_like: bool) -> int:
        termo_norm = self._normalizar_sku_busca(termo)
        termo_lower = (termo or '').lower().strip()
        sku = produto.get('sku', '') or produto.get('codigo_produto', '')
        nome = produto.get('nome', '') or produto.get('descricao', '')
        sku_norm = self._normalizar_sku_busca(sku)
        nome_lower = nome.lower()
        score = 0

        if termo_norm and sku_norm == termo_norm:
            score = max(score, 1000)
        elif termo_norm and sku_norm.startswith(termo_norm):
            score = max(score, 850)
        elif termo_norm and termo_norm in sku_norm:
            score = max(score, 700)

        if not sku_like:
            if nome_lower == termo_lower:
                score = max(score, 650)
            elif termo_lower and nome_lower.startswith(termo_lower):
                score = max(score, 560)
            elif termo_lower and termo_lower in nome_lower:
                score = max(score, 420)

        return score

    def _deduplicar_produtos(self, produtos: List[Dict]) -> List[Dict]:
        vistos = set()
        saida = []
        for p in produtos:
            sku_norm = self._normalizar_sku_busca(p.get('sku') or p.get('codigo_produto') or '')
            nome_norm = re.sub(r'\s+', ' ', (p.get('nome') or p.get('descricao') or '').strip().lower())
            chave = (sku_norm, nome_norm)
            if chave in vistos:
                continue
            vistos.add(chave)
            saida.append(p)
        return saida

    def buscar_produtos(self, termo: str, limite_resultados: int = 30) -> List[Dict]:
        """
        Busca hibrida:
        1. Cache local (rapido) - cobre busca por NOME e SKUs da listagem.
        2. API ?codigo= (1 req) - acha SKU EXATO incluindo VARIACOES que nao
           aparecem na listagem /produtos.
        O estoque NAO e carregado aqui (seria lento) - e buscado sob demanda
        quando o usuario seleciona um produto.
        """
        if not termo or len(termo) < 1:
            return []

        termo = termo.strip()
        termo_lower = termo.lower()
        termo_norm = self._normalizar_sku_busca(termo)
        sku_like = self._termo_parece_sku(termo)

        # 1) Cache local (instantaneo apos a 1a vez)
        todos = self.listar_todos_produtos(limite=3000)

        matches = []
        achou_sku_exato = False
        for p in todos:
            sku = p.get('sku', '') or p.get('codigo_produto', '')
            sku_norm = self._normalizar_sku_busca(sku)

            if termo_norm and sku_norm == termo_norm:
                achou_sku_exato = True

            score = self._score_busca_produto(p, termo, sku_like)
            if score > 0:
                item = dict(p)
                item['_score'] = score
                matches.append(item)

        # 2) Busca na API por codigo (1 req) SOMENTE quando parece um SKU
        #    especifico que o cache nao cobriu bem:
        #    - sem match exato no cache, E
        #    - cache trouxe poucos resultados (nao e um nome amplo tipo "viseira"), E
        #    - termo sem espaco com >=3 chars (formato de SKU).
        #    Isso acha VARIACOES sem penalizar buscas por nome.
        if (not achou_sku_exato and len(matches) < 5
                and ' ' not in termo and len(termo_lower) >= 3):
            via_api = self._buscar_por_codigo_api(termo.strip())
            for p in via_api:
                item = dict(p)
                item['_score'] = max(1100, self._score_busca_produto(item, termo, sku_like))
                matches.append(item)

        matches.sort(
            key=lambda p: (
                -int(p.get('_score', 0)),
                len((p.get('sku') or p.get('codigo_produto') or '')),
                len(p.get('nome') or ''),
            )
        )
        resultado = self._deduplicar_produtos(matches)

        if sku_like:
            exatos = [
                p for p in resultado
                if self._normalizar_sku_busca(p.get('sku') or p.get('codigo_produto') or '') == termo_norm
            ]
            if exatos:
                resultado = exatos
            else:
                fortes = [p for p in resultado if int(p.get('_score', 0)) >= 700]
                if fortes:
                    resultado = fortes

        for p in resultado:
            p.pop('_score', None)

        resultado = resultado[:limite_resultados]
        print(f"[OLIST] Busca '{termo}': {len(resultado)} resultados (cache={len(todos)})")
        return resultado

    def obter_detalhes_completo(self, produto_id: str) -> Optional[Dict]:
        """Obtém os detalhes COMPLETOS de um produto incluindo composição de kit"""
        token = self.get_access_token()
        if not token:
            token = self.token_v2
            if not token:
                return None

        try:
            url = f"{self.API_BASE}/produtos/{produto_id}"
            headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
            req = urllib.request.Request(url, headers=headers, method="GET")

            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as e:
            print(f"[OLIST] Erro ao obter detalhes de {produto_id}: {e}")
            return None

    def detectar_e_buscar_kit(self, termo: str) -> Optional[Dict]:
        """
        Detecta se um produto é um KIT e retorna seus componentes
        Retorna: {
            "eh_kit": bool,
            "produto_principal": {...},
            "componentes": [
                {"sku": "...", "descricao": "...", "id": "...", "preco": ..., "estoque": ...},
                ...
            ]
        }
        """
        # Primeiro, busca o produto
        produtos = self.buscar_produtos(termo)

        if not produtos or len(produtos) == 0:
            return {"eh_kit": False, "erro": "Produto não encontrado"}

        # Pega o primeiro resultado
        produto = produtos[0]
        produto_id = produto.get("id")

        if not produto_id:
            return {"eh_kit": False, "erro": "Produto inválido"}

        # Busca detalhes completos para ver se é kit
        detalhes = self.obter_detalhes_completo(str(produto_id))

        if not detalhes:
            return {"eh_kit": False, "erro": "Não conseguiu buscar detalhes do produto"}

        # Verifica se é kit (tipo = "K")
        tipo = detalhes.get("tipo", "")

        if tipo != "K":
            # Não é kit
            return {"eh_kit": False, "tipo": tipo, "produto": produto}

        # É um kit! Busca componentes
        kit_data = detalhes.get("kit", [])

        if not kit_data:
            return {"eh_kit": True, "produto_principal": produto, "componentes": [], "erro": "Kit sem componentes configurados"}

        # Processa componentes
        componentes = []
        for comp in kit_data:
            comp_produto = comp.get("produto", {})
            sku_comp = comp_produto.get("sku", "")
            id_comp = comp_produto.get("id", "")

            # Busca estoque do componente
            estoque_comp = self.obter_estoque(str(id_comp)) if id_comp else None

            # Busca dados mais recentes do componente
            comp_dados = self.buscar_produtos(sku_comp)
            if comp_dados:
                comp_produto_data = comp_dados[0]
            else:
                comp_produto_data = {
                    "id": id_comp,
                    "sku": sku_comp,
                    "nome": comp_produto.get("descricao", ""),
                    "preco": 0,
                    "estoque_atual": estoque_comp.get("disponivel", 0) if estoque_comp else 0
                }

            componentes.append({
                "sku": sku_comp,
                "id": id_comp,
                "descricao": comp_produto.get("descricao", ""),
                "nome": comp_produto_data.get("nome", ""),
                "preco": comp_produto_data.get("preco", 0),
                "estoque_atual": comp_produto_data.get("estoque_atual", estoque_comp.get("disponivel", 0) if estoque_comp else 0),
                "quantidade_no_kit": comp.get("quantidade", 1)
            })

        return {
            "eh_kit": True,
            "sku_principal": produto.get("sku", ""),
            "nome_kit": detalhes.get("descricao", ""),
            "preco_kit": detalhes.get("precos", {}).get("preco", 0),
            "id_principal": produto_id,
            "componentes": componentes
        }

    def obter_estoque(self, produto_id: str, usar_cache: bool = True,
                      max_retries: int = 3) -> Optional[Dict]:
        """
        Obtem o estoque atual de um produto (saldo, reservado, disponivel).
        - Usa cache de 5 min (usar_cache=True) para evitar repetir requisicoes.
        - Aplica throttle (rate limit 120/min da Olist).
        - Em caso de HTTP 429, espera o tempo indicado e tenta de novo.
        """
        # 1) Cache
        if usar_cache:
            cached = self._estoque_cache.get(str(produto_id))
            if cached and (time.time() - cached[1]) < self._estoque_cache_ttl:
                return cached[0]

        token = self.get_access_token()
        if not token:
            # Fallback para token simples (legado v2)
            token = self.token_v2
            if not token:
                return None

        url = f"{self.API_BASE}/estoque/{produto_id}"
        headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}

        for tentativa in range(max_retries):
            self._throttle()  # respeita o rate limit antes de cada requisicao
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=15) as response:
                    dados = json.loads(response.read().decode("utf-8"))
                    resultado = {
                        "saldo": int(dados.get("saldo", 0) or 0),
                        "reservado": int(dados.get("reservado", 0) or 0),
                        "disponivel": int(dados.get("disponivel", 0) or 0),
                    }
                    self._estoque_cache[str(produto_id)] = (resultado, time.time())
                    return resultado
            except urllib.error.HTTPError as e:
                if e.code == 429 and tentativa < max_retries - 1:
                    # Rate limit: espera o tempo indicado (ou um default crescente)
                    reset = e.headers.get("x-ratelimit-reset") or e.headers.get("Retry-After")
                    try:
                        espera = float(reset)
                    except (TypeError, ValueError):
                        espera = 2.0 * (tentativa + 1)
                    espera = min(espera, 15.0)  # nunca espera mais que 15s
                    print(f"[OLIST] 429 em {produto_id}, aguardando {espera:.1f}s (tentativa {tentativa+1})")
                    time.sleep(espera)
                    continue
                print(f"[OLIST] Erro HTTP {e.code} ao obter estoque de {produto_id}")
                return None
            except Exception as e:
                print(f"[OLIST] Erro ao obter estoque de {produto_id}: {e}")
                return None

        return None

    def _buscar_por_campo(self, token: str, campo: str, termo: str) -> List[Dict]:
        """Busca produtos por um campo especifico"""
        try:
            # Mapear nomes de campos para o que a API espera
            campo_map = {
                "sku": "sku",
                "codigo": "codigo",
                "nome": "nome",
                "descricao": "descricao"
            }
            campo_api = campo_map.get(campo, campo)

            # Tentar busca com filtro - token como header Bearer
            params = {campo_api: termo, "limit": 100}
            query = urllib.parse.urlencode(params)
            url = f"{self.API_BASE}/produtos?{query}"

            headers = {
                "Accept": "application/json",
                "Authorization": f"Bearer {token}"
            }

            print(f"[OLIST] GET {url[:100]}...")
            req = urllib.request.Request(url, headers=headers, method="GET")

            with urllib.request.urlopen(req, timeout=15) as response:
                resposta = json.loads(response.read().decode("utf-8"))

                # API v3 retorna {"itens": [...]} ou {"data": [...]} ou lista direta
                produtos = []
                if isinstance(resposta, dict):
                    produtos = (resposta.get("itens") or resposta.get("data")
                                or resposta.get("results") or [])
                elif isinstance(resposta, list):
                    produtos = resposta

                resultado = []
                for prod in produtos:
                    resultado.append({
                        "id": prod.get("id", ""),
                        "sku": prod.get("sku") or prod.get("codigo", ""),
                        "codigo_produto": prod.get("sku") or prod.get("codigo", ""),
                        "nome": prod.get("descricao") or prod.get("nome", ""),
                        "descricao": prod.get("descricao") or prod.get("nome", ""),
                        "preco": float(prod.get("precos", {}).get("preco", 0) if isinstance(prod.get("precos"), dict) else prod.get("preco", 0) or 0),
                        "estoque_atual": int(prod.get("estoque", {}).get("quantidade", 0) if isinstance(prod.get("estoque"), dict) else prod.get("estoque", 0) or 0),
                    })

                if resultado:
                    print(f"[OLIST] ✓ {len(resultado)} resultado(s) encontrado(s)")
                else:
                    print(f"[OLIST] ✗ Nenhum resultado para {campo}='{termo}'")
                return resultado

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"[OLIST] HTTP {e.code}: {error_body[:150]}")
            return []
        except Exception as e:
            print(f"[OLIST] ✗ Erro: {str(e)[:150]}")
            return []

    def atualizar_estoque(self, produto_id: str, quantidade: float,
                          tipo: str = "E", preco_unitario: float = 0,
                          observacao: str = "Entrada via Estoque Virtual (NF-e)") -> bool:
        """
        Atualiza o estoque de um produto na Olist
        tipo: 'E' = Entrada (soma), 'S' = Saida (subtrai), 'B' = Balanco (absoluto)
        """
        token = self.get_access_token()
        if not token:
            # Fallback para token simples (legado v2)
            token = self.token_v2
            if not token:
                return False

        url = f"{self.API_BASE}/estoque/{produto_id}"
        data = {
            "tipo": tipo,
            "quantidade": float(quantidade),
            "precoUnitario": float(preco_unitario),
            "observacoes": observacao
        }
        post_data = json.dumps(data).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }

        for tentativa in range(3):
            self._throttle()  # respeita o rate limit
            try:
                req = urllib.request.Request(url, data=post_data, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=15) as response:
                    print(f"[OLIST] Estoque ({tipo}) atualizado: produto {produto_id} qtd {quantidade}")
                    # Invalida o cache de estoque deste produto (mudou)
                    self._estoque_cache.pop(str(produto_id), None)
                    return True
            except urllib.error.HTTPError as e:
                if e.code == 429 and tentativa < 2:
                    reset = e.headers.get("x-ratelimit-reset") or e.headers.get("Retry-After")
                    try:
                        espera = min(float(reset), 15.0)
                    except (TypeError, ValueError):
                        espera = 2.0 * (tentativa + 1)
                    print(f"[OLIST] 429 ao baixar {produto_id}, aguardando {espera:.1f}s")
                    time.sleep(espera)
                    continue
                error_body = e.read().decode("utf-8")
                print(f"[OLIST] Erro HTTP {e.code} ao atualizar estoque: {error_body[:300]}")
                return False
            except Exception as e:
                print(f"[OLIST] Erro ao atualizar estoque: {e}")
                return False

        return False

    def sincronizar_historico_vendas(self, db, dias: int = 30) -> int:
        """
        Sincroniza histórico de vendas/pedidos da Olist para HistoricoVendas.
        Retorna número de vendas sincronizadas.
        """
        from app.models import HistoricoVendas
        from datetime import datetime, timedelta

        try:
            token = self.get_access_token()
            if not token:
                print("[OLIST] Token não disponível para sincronizar histórico")
                return 0

            # Data limite: últimos N dias
            data_limite = (datetime.utcnow() - timedelta(days=dias)).isoformat()

            # GET /pedidos com filtro de data
            url = f"{self.API_BASE}/pedidos?dataInicio={data_limite}"
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=15) as response:
                dados = json.loads(response.read().decode("utf-8"))
                pedidos = dados.get("data", [])

                vendas_count = 0

                for pedido in pedidos:
                    pedido_id = pedido.get("numero", "")
                    data_venda_str = pedido.get("dataPedido", "")
                    itens_pedido = pedido.get("itens", [])

                    # Converter data
                    try:
                        data_venda = datetime.fromisoformat(data_venda_str.replace("Z", "+00:00"))
                    except:
                        data_venda = datetime.utcnow()

                    # Para cada item do pedido
                    for item in itens_pedido:
                        sku = item.get("sku", "")
                        produto_id = item.get("idProduto", "")
                        quantidade = int(item.get("quantidade", 0))
                        preco_unitario = float(item.get("precoUnitario", 0))
                        receita = quantidade * preco_unitario

                        # Verificar se já existe
                        existente = db.query(HistoricoVendas).filter(
                            HistoricoVendas.pedido_id == pedido_id,
                            HistoricoVendas.olist_sku == sku
                        ).first()

                        if not existente:
                            venda = HistoricoVendas(
                                olist_sku=sku,
                                olist_produto_id=produto_id,
                                data_venda=data_venda,
                                quantidade=quantidade,
                                preco_unitario=preco_unitario,
                                receita=receita,
                                marketplace="olist",
                                pedido_id=pedido_id
                            )
                            db.add(venda)
                            vendas_count += 1

                db.commit()
                print(f"[OLIST] {vendas_count} vendas sincronizadas")
                return vendas_count

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"[OLIST] Erro HTTP {e.code} ao sincronizar vendas: {error_body[:300]}")
            return 0
        except Exception as e:
            print(f"[OLIST] Erro ao sincronizar histórico de vendas: {e}")
            return 0

    def status(self) -> Dict:
        """Retorna status da integracao"""
        token = self.get_access_token()
        autorizado = token is not None

        return {
            "integrado": autorizado,
            "credenciais_configuradas": self.enabled,
            "autorizado": autorizado,
            "status": "OK Pronto" if autorizado else "PRECISA AUTORIZAR",
            "url_autorizacao": self.get_authorization_url() if (self.enabled and not autorizado) else None,
            "mensagem": (
                "Integracao ativa e funcionando!" if autorizado
                else "Acesse /api/olist/conectar para autorizar o aplicativo"
            )
        }

    def obter_produto_por_id(self, produto_id: str) -> Optional[Dict]:
        """Obtém um produto específico pela ID"""
        token = self.get_access_token()
        if not token:
            return None

        try:
            url = f"{self.API_BASE}/produtos/{produto_id}"
            headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
            req = urllib.request.Request(url, headers=headers, method="GET")

            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))

                return {
                    "id": data.get("id", ""),
                    "sku": data.get("sku", ""),
                    "nome": data.get("descricao", ""),
                    "preco": float(data.get("precos", {}).get("preco", 0) if isinstance(data.get("precos"), dict) else 0),
                    "codigo_produto": data.get("sku", ""),
                    "estoque_atual": int(data.get("estoque", {}).get("quantidade", 0) if isinstance(data.get("estoque"), dict) else 0),
                }
        except Exception as e:
            print(f"[OLIST] Erro ao obter produto {produto_id}: {e}")
            return None


# Instancia global
olist = OlistIntegration()
