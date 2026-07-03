# Graphify - Guia de Uso para NOVAES-ESTOQUE

Graphify mapeia todo seu projeto (código, docs, imagens) em um **grafo de conhecimento** que permite consultas estruturadas sem precisar grepar arquivos.

## 📊 Arquivos Gerados

Após executar `graphify .`, três arquivos principais são criados em `graphify-out/`:

1. **`graph.html`** (787 KB) - Visualização interativa
   - Abra em qualquer navegador
   - Clique em nodes para explorar
   - Filtre por comunidades
   - Busque componentes em tempo real

2. **`graph.json`** (886 KB) - Grafo completo para consultas programáticas
   - 913 nodes (componentes: funções, classes, modelos, endpoints)
   - 1492 edges (relacionamentos entre componentes)
   - 82 comunidades (módulos lógicos)

3. **`GRAPH_REPORT.md`** (24 KB) - Análise automática de arquitetura
   - God Nodes (abstrações mais conectadas)
   - Surprising Connections (relacionamentos não óbvios)
   - Community Hubs (navegação por módulo)
   - Security Issues detectadas

## 🔍 God Nodes - Suas Abstrações-Chave

Top 10 componentes mais conectados (núcleo da arquitetura):

1. **MLIntegration** (71 conexões) - Integração Mercado Livre
2. **OlistIntegration** (33) - Integração Olist
3. **_registrar_log_operacao()** (23) - Auditoria/Logging central
4. **compilerOptions** (21) - Configuração TypeScript frontend
5. **Mercado Livre Integration Module** (17) - OAuth2 ML
6. **FastAPI Backend** (16) - Servidor Python
7. **_quantidade_planejada_full()** (13) - Cálculo de demanda
8. **Estoque Virtual System** (12) - Modelo central
9. **React 18 + TypeScript Frontend** (12) - App web
10. **_extrair_items_shopee_pagina_v2()** (11) - Parser Shopee

## 🎯 Principais Módulos (Communities)

### Backend
- **Olist Integration** - OAuth2, rate limiting, cache de produtos
- **Mercado Livre Integration** - Anúncios, preços, frete, promoções
- **NFe Parser** - Leitura de XML/PDF de notas fiscais
- **FastAPI Main App** - Endpoints RESTful, uploads, validações

### Frontend
- **AnunciosML.tsx** - Gerenciador de anúncios ML
- **EmbaldesManager.tsx** - Gestão de embalagens e separação
- **HistoricoFull.tsx** - Histórico de movimentações
- **ListaCompra.tsx** - Análise de recompra (curva ABC)
- **App.tsx** - Root component
- **api.ts** - HTTP client (Axios)

### Data Models
- **NotaFiscal** - Documento de entrada
- **ItemEstoque** - Itens em estoque (com divergência)
- **Anuncio** - Anúncio no marketplace
- **CustoProduto** - Tabela de custos oficiais

## 💾 Como Usar o Grafo

### 1. Visualizar no Navegador (Recomendado)
```bash
# Abrir a visualização interativa
start graphify-out/graph.html
# ou no terminal:
open graphify-out/graph.html  # macOS
xdg-open graphify-out/graph.html  # Linux
```

**Funcionalidades:**
- 🔍 Busca por nome (Ctrl+F dentro do grafo)
- 🎯 Clique em nodes para ver conectados
- 📊 Filtra por comunidade/tipo
- 🔗 Zoom, pan, repositório de layout

### 2. Consultar via Python (Para IA)

```python
import json

# Carregar grafo
with open('graphify-out/graph.json') as f:
    graph = json.load(f)

# Explorar nodes
nodes = graph['nodes']
edges = graph['edges']

# Exemplo: Encontrar tudo relacionado a "MLIntegration"
ml_nodes = [n for n in nodes if 'ML' in n.get('name', '')]
print(f"Componentes relacionados a ML: {len(ml_nodes)}")

# Encontrar que chama uma função específica
ml_integration = next((n for n in nodes if n['id'] == 'backend_app_integracoes_ml'), None)
if ml_integration:
    callers = [e['source'] for e in edges if e['target'] == ml_integration['id']]
    print(f"Funções que usam ML: {callers}")
```

### 3. Consultar via CLI (Sem API Key)

```bash
# Atualizar grafo após mudanças no código (grátis)
graphify update .

# Regenerar relatório
graphify cluster-only .

# Exportar fluxogramas em Mermaid
graphify export callflow-html
```

## 🔒 Vulnerabilidades Detectadas

Graphify encontrou **conexões semânticas** entre módulos e documentação de segurança:

- **OAuth Credentials Hardcoded** - `integracoes_ml.py` e `integracoes_olist.py`
  - Ver: `AUDITORIA_TECNICA_2025.md`
  
- **CORS Overly Permissive** - `backend/app/main.py`
  - Risco: Acesso de qualquer origem
  
- **No Authentication on API** - Endpoints sem JWT
  - Risco: Qualquer um pode chamar /api/*
  
- **Stack Traces Exposed** - Erros 500 mostram detalhes internos

## 🔄 Workflow Recomendado

### Antes de features complexas:
```bash
# 1. Atualize o grafo
graphify update .

# 2. Abra a visualização
start graphify-out/graph.html

# 3. Encontre God Nodes relacionados ao seu trabalho
# Exemplo: Antes de mexer em preços, estude:
#   - ml_anuncio_aplicar_preco()
#   - _registrar_log_operacao()
#   - Comunidade "Precificador.tsx"
```

### Após mudanças significativas:
```bash
# Atualize e regere relatório (0 tokens)
graphify update .
graphify cluster-only .

# Commit:
git add graphify-out/
git commit -m "docs: atualiza grafo de conhecimento"
```

## 📈 Estatísticas do Projeto

```
Tamanho:     913 componentes, 1492 relacionamentos
Coesão:      82 comunidades (módulos bem definidos)
Complexidade: Mercado Livre + Olist são os pontos centrais
Integração:  Forte dependência em APIs externas
```

## 🎓 Sugestões para Consultas

### "Como um novo anúncio no ML é processado?"
1. Clique em `MLIntegration` em `graph.html`
2. Siga edges para `ml_anuncios()`, `ml_anuncio_preco_resumo()`, `ml_sync_cache()`
3. Veja chamadores em `AnunciosML.tsx`

### "Qual é o fluxo completo de separação?"
1. Busque `EmbaldesManager.tsx` 
2. Siga para `_quantidade_planejada_full()` (cálculo)
3. Veja conexões com `atualizar_estoque_olist()` (baixa)

### "Onde os logs são registrados?"
1. Node `_registrar_log_operacao()` (23 conexões!)
2. Veja todas as 23 funções que usam auditoria
3. Configure nível de detalhe centralizadamente

### "Quais apis externas são chamadas?"
1. Busque "API" em `graph.html`
2. Principais: `olist_api`, `mercadolibre_api`, `nfelib`, `pytesseract`

## 🚀 Próximos Passos

1. **Security Audit** (Prioritário)
   - Resolver vulnerabilidades em `AUDITORIA_TECNICA_2025.md`
   - Especialmente: OAuth credentials e autenticação

2. **Documentation**
   - Usar `graph.html` como ferramenta interativa de onboarding
   - Gerar `callflow-html` para fluxogramas de features

3. **Testing**
   - Graphify identifica God Nodes que precisam de testes
   - MLIntegration e OlistIntegration: máxima prioridade

## 📚 Referências

- **Graphify Docs**: https://github.com/safishamsi/graphify
- **Seu Grafo**: `graphify-out/graph.html`
- **Relatório**: `graphify-out/GRAPH_REPORT.md`
- **Raw Data**: `graphify-out/graph.json`

---

**Última atualização**: 2026-07-01  
**Commit**: e902d09c  
**Comando para atualizar**: `graphify update .`
