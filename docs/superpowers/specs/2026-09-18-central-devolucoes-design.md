# Central de Devoluções Novaes — Design

## Contexto

Documento-base: `Central_Devolucoes_Novaes_Arquitetura.docx` (fornecido pelo usuário,
20 seções — escopo, arquitetura, modelo de dados, trilhas de cenário, mediação,
integração Olist, financeiro, BI, segurança, roadmap). Este spec traduz aquele
documento de arquitetura (que sugeria uma stack Java/Spring separada) para um
módulo novo **dentro do repositório NOVAES-ESTOQUE já existente** (FastAPI/Python
+ SQLAlchemy/SQLite + React/TypeScript).

O módulo de devoluções anterior (ML-only, portado de `DEVOLUCOES-ML-main`) foi
**removido por completo** a pedido do usuário — vamos recomeçar do zero. Ficam
como referência de consulta (não como código reaproveitado):
- `docs/devolucoes/BIBLIA_POS_VENDA_ML.md` e `REGRAS_CONGELADAS.md` — quirks
  reais da API do ML descobertos com esforço (ex.: `lead_time` vem `null` no
  endpoint principal de return, bipagem casa por `shipment_id` de 11 dígitos,
  fuso -03/-04 exige ajuste manual pro SQLite).
- Memórias `projeto-devolucoes`, `devolucoes-chegando-hoje` no sistema de
  memória do Claude.

## Objetivo do projeto (visão completa)

Centralizar o ciclo completo de devolução — Mercado Livre e Shopee, integrado à
Olist — como um processo rastreável, auditável e financeiramente mensurável.
Uma devolução só é considerada encerrada quando o produto tem **destino físico**
definido (A-Recuperado / B-Avaria / C-Divergente) **e** o financeiro está
conciliado. Estado físico e estado financeiro/mediação são trilhas
independentes: um item pode estar fisicamente em Avaria e financeiramente ainda
em Mediação aguardando compensação.

Fontes de verdade, cada uma dona do seu domínio:
- **Marketplace** (ML/Shopee) → a devolução/mediação em si
- **Olist** → pedido interno, SKU, CMV, NF-e, estoque operacional
- **Este sistema** → acompanhamento, conferência, evidências, classificação,
  cálculo financeiro e auditoria

## Arquitetura

**Hexagonal (Ports & Adapters) + Domain-Driven Design (Bounded Contexts),
organizada como Monólito Modular** dentro do backend FastAPI existente.

Justificativa (requisito explícito do usuário: alterar um módulo não pode
quebrar outro): o núcleo de regras de negócio nunca importa código de
Mercado Livre, Shopee ou Olist diretamente. Cada integração externa é um
adapter que implementa um contrato (`Protocol`) definido pelo núcleo. Trocar a
Shopee de API amanhã, ou consertar um bug do adapter ML, não toca no núcleo
nem no outro adapter. Cada domínio (devolução física, mediação, financeiro,
estoque/Olist, BI) é um bounded context com seu próprio modelo — eles
conversam por ID/evento, nunca lendo tabela interna um do outro.

Um único backend/deploy (não microserviços) porque o time é pequeno — o
isolamento vem das fronteiras de módulo/pacote Python, não de processos
separados.

## Roadmap (do documento-base, mantido como referência — cada fase é desenhada
## em detalhe só quando chegar a vez, adaptando conforme a necessidade)

1. **Leitura e vínculo** — ingestão ML/Shopee, retorno em trânsito, vínculo
   Olist, tela de detalhe. Sem ações externas. **← Fase atual, detalhada abaixo.**
2. **Recebimento** — conferência física, evidências, destinos A/B/C, histórico.
3. **Financeiro** — frete reverso, CMV, custos previstos e conciliação.
4. **Mediação** — abertura/ação via API onde permitido, provas, prazos.
5. **Olist write-back** — movimentações de depósito e fila de sincronização.
6. **BI avançado** — dashboards, rankings de custo, análise histórica.

As Fases 2-6 não estão detalhadas neste spec de propósito — o usuário optou por
desenhar cada fase quando for implementá-la, em vez de especificar tudo
upfront.

## Fase 1 — Leitura e vínculo (detalhada)

### Objetivo
Enxergar toda devolução (ML + Shopee) em um único lugar, com vínculo ao pedido
Olist, sem executar nenhuma ação nas plataformas externas.

### Estrutura de módulo
```
backend/app/devolucoes/
  models.py       # tabelas SQLAlchemy — só deste bounded context
  ports.py        # Protocol que cada adapter de marketplace deve implementar
  adapters/
    mercado_livre.py
    shopee.py
    olist.py
  service.py      # orquestra: busca no adapter → normaliza → persiste → vincula Olist
  routes.py       # endpoints da Fase 1
```
`service.py` só depende de `ports.py`. Nunca importa `adapters/mercado_livre.py`
nem `adapters/shopee.py` diretamente — recebe a implementação por injeção
(um dict `{"mercado_livre": ..., "shopee": ...}` resolvido em `routes.py`).

### Modelo de dados (só o necessário para a Fase 1)
- `return_case` — id, marketplace, conta, order_id/order_sn, claim_id/return_id,
  status_marketplace (bruto), motivo, prazo_resolucao, ultima_sincronizacao,
  correlation_id
- `return_item` — FK return_case; sku_esperado, produto_nome, quantidade,
  cmv_unitario (puxado da Olist). Tabela própria desde já (não JSON solto)
  porque um caso pode ter mais de um item, e a Fase 2 estende esta mesma tabela
  com condição recebida e destino A/B/C — evita migração maior depois.
- `olist_link` — FK única return_case; pedido_id_olist, produto_id_olist,
  deposito_atual, sincronizado_em
- `tracking_event` — FK return_case; status normalizado, descrição, origem
  (marketplace/olist), data_hora, payload_raw (JSON cru, auditoria/debug)

Fora de escopo na Fase 1 (entram nas fases correspondentes): `evidence`,
`mediation_case`, `financial_event`.

### Contrato do adapter (`ports.py`)
```python
class ReturnsPort(Protocol):
    def listar_pendentes(self) -> list[ReturnCaseDTO]: ...
    def buscar(self, id_externo: str) -> ReturnCaseDTO: ...
    def eventos_rastreio(self, id_externo: str) -> list[TrackingEventDTO]: ...
```
`adapters/mercado_livre.py` traduz Claim/Return da API ML; `adapters/shopee.py`
traduz `GetReturnList`/`GetReturnDetail` da Shopee Open Platform (endpoints já
documentados em `docs/shopee-api-reference.md`, seção Returns). Ambos devolvem
o mesmo formato de DTO — o service nunca sabe qual dos dois está falando.
`adapters/olist.py` resolve o vínculo pedido→SKU→CMV→depósito.

### Endpoints
- `GET /api/devolucoes` — lista consolidada ML+Shopee
- `GET /api/devolucoes/{id}` — detalhe (itens + vínculo Olist + rastreio)
- `POST /api/devolucoes/sincronizar` — ingestão manual (job automático agendado
  fica para quando o volume justificar, seguindo o padrão do `jobs.py` existente)

### Frontend
Página nova `CentralDevolucoes.tsx` (nome novo — não reaproveita o componente
antigo removido). Só lista e tela de detalhe, somente leitura, sem nenhum botão
de ação.

### Teste (mínimo, conforme convenção do projeto)
`backend/tests/test_devolucoes_normalizacao.py` — dado um payload fake de ML e
um de Shopee, cada adapter deve produzir o mesmo formato de DTO. Este é o teste
que valida o isolamento que motivou a arquitetura inteira.

## Decisões já fechadas com o usuário
- Fica dentro do NOVAES-ESTOQUE (não é serviço separado).
- Stack: a do repositório atual (Python/FastAPI/SQLAlchemy/SQLite, React/TS) —
  não a stack Java/Spring sugerida no documento-base, que era referência de
  implementação, não dependência conceitual.
- Módulo antigo apagado por completo (não roda em paralelo); BIBLIA/REGRAS
  ficam só como referência de consulta.
- Fase 1 cobre ML **e** Shopee juntos (não ML-first) — o adapter Shopee de
  devolução parte do zero, mas o OAuth/assinatura de chamada já existe em
  `integracoes_shopee.py`, e os endpoints de return já estão documentados.
