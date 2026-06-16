# 🗺️ Roadmap Mercado Livre - Features Futuras

**Baseado em**: Documentação Oficial API ML | **Status**: Planejamento | **Data**: 16/06/2026

---

## 📍 Mapa de Features

### Phase 1 ✅ COMPLETA (15 de junho)
**Integração e Leitura de Anúncios**

- [x] OAuth2 com token persistence
- [x] Listar anúncios com paginação
- [x] Obter detalhe completo (descrição, atributos, imagens, frete)
- [x] Precificação real (Clássico × Premium)
- [x] Parse de dimensões
- [x] Modal Precificador com 2 tiers
- [x] Rate limiting (240 req/min)

**Endpoints**: 8 GET, 4 POST

---

### Phase 2 🔄 PRÓXIMA (Estimar: 1-2 semanas)
**Edição Avançada de Anúncios**

#### 2.1 Edição de Descrição Enriquecida
```
Priority: HIGH
Complexity: LOW (já temos o endpoint)

POST /api/ml/anuncios/{id}/description/rich
{
  "plain_text": "...",
  "html": "<p>...</p>",
  "images": [...]
}

Validação:
- Máximo 50.000 caracteres
- Sem conteúdo proibido (links, telefones, etc)
```

#### 2.2 Edição em Lote (Bulk Edit)
```
Priority: HIGH
Complexity: MEDIUM

POST /api/ml/anuncios/atualizar-lote
{
  "ids": ["MLB123", "MLB456", ...],
  "mudancas": {
    "preco": 99.99,
    "desconto_atacado": true
  }
}

Respeitar rate limit: 240 req/min
Implementar fila de processamento
```

#### 2.3 Histórico de Edições
```
Priority: MEDIUM
Complexity: HIGH

GET /api/ml/anuncios/{id}/historico
GET /api/ml/anuncios/minhas-edicoes?desde=2026-06-01

Campos:
- O que foi alterado
- Quem alterou (user_id)
- Quando foi alterado
- Valor anterior vs novo
```

---

### Phase 3 💰 PRECIFICAÇÃO INTELIGENTE (Semana 3-4)
**Dinâmica de Preços com Base em Margem**

#### 3.1 Sugestão Automática de Preço
```
Priority: HIGH
Complexity: MEDIUM

Lógica:
1. Custo do produto (de NF)
2. Frete da NF (rateado)
3. Imposto% (configurável, padrão 9%)
4. Tarifa ML (buscar em tempo real)
5. Margem desejada (configurável, padrão 30%)

Fórmula:
preço_sugerido = (custo + frete + imposto) / (1 - margem% - tarifa%)

POST /api/ml/precificacao-sugerida
{
  "custo": 30.00,
  "frete": 5.00,
  "imposto_pct": 9,
  "margem_desejada_pct": 30,
  "categoria_id": "MLB46678"
}

Resposta:
{
  "preco_sugerido": 65.50,
  "margem_real_classico": 31.2%,
  "margem_real_premium": 28.5%,
  "recomendacao": "premium (melhor conversão)"
}
```

#### 3.2 Monitorar Concorrentes
```
Priority: MEDIUM
Complexity: HIGH

GET /api/ml/anuncios/{id}/concorrentes
{
  "categoria": "MLB46678",
  "produto": "Viseira Fume",
  "preco_seu": 42.99,
  "preco_concorrentes": [
    {
      "vendedor": "Loja XYZ",
      "preco": 39.90,
      "avaliacao": 4.8,
      "frete_gratis": true
    },
    ...
  ],
  "preco_minimo": 35.00,
  "preco_medio": 42.50,
  "posicao": "acima da media"
}
```

---

### Phase 4 📦 LOGÍSTICA AVANÇADA (Semana 5-6)
**Integração com Fulfillment e Shipping**

#### 4.1 Calculadora de Frete
```
Priority: MEDIUM
Complexity: MEDIUM

POST /api/ml/calcular-frete-simples
{
  "item_id": "MLB1039363055",
  "cep_destino": "01310100",
  "quantidade": 1
}

Resposta:
{
  "opcoes": [
    {
      "transportadora": "Sedex",
      "custo": 15.00,
      "dias": 3,
      "id": "73328"
    }
  ],
  "frete_ml_gratis": true,
  "custo_ml": 6.95
}
```

#### 4.2 Otimizar Dimensions para Frete
```
Priority: LOW
Complexity: MEDIUM

POST /api/ml/anuncios/{id}/otimizar-dimensoes
{
  "sugerir_embalagem": true
}

Resposta:
{
  "dimensoes_atuais": { "altura": 13.3, "largura": 22.2, ... },
  "dimensoes_otimizadas": { "altura": 12, "largura": 20, ... },
  "economia": {
    "peso_faturado_antes": 500,
    "peso_faturado_depois": 450,
    "reducao_custo_frete": "5-10%"
  }
}
```

---

### Phase 5 📊 ANALYTICS & REPORTING (Semana 7-8)
**Dashboard de Performance**

#### 5.1 Métrica de Performance por Anúncio
```
GET /api/ml/anuncios/{id}/metrics
{
  "visualizacoes": 1523,
  "cliques": 156,
  "ctr": 10.2,  // Click-through rate
  "conversao": 3.8,  // % vendas / cliques
  "preco_medio_venda": 42.99,
  "margem_media": 28.5,
  "receita_mes": 5200.00,
  "lucro_mes": 1482.50,
  "posicao_ranking": 5  // Posição na categoria
}
```

#### 5.2 Relatório de Margem por Categoria
```
GET /api/ml/report/margem-categoria
{
  "categorias": [
    {
      "categoria_id": "MLB46678",
      "nome": "Capacetes",
      "total_anuncios": 45,
      "receita": 15200,
      "lucro": 4182,
      "margem_media": 27.5,
      "produtos": [...]
    }
  ]
}
```

---

### Phase 6 🤖 AUTOMAÇÃO (Semana 9+)
**Regras de Automação**

#### 6.1 Regras de Reprecificação Automática
```
Priority: LOW
Complexity: HIGH

POST /api/ml/regras-precificacao
{
  "nome": "Reprecificar se margem < 20%",
  "condicoes": {
    "margem_atual_pct": { "menor_que": 20 }
  },
  "acoes": [
    {
      "tipo": "aumentar_preco",
      "valor": 5.00,
      "minimo": 35.00,
      "maximo": 150.00
    }
  ],
  "frequencia": "diaria",
  "ativo": true
}

Trigger: Cron job que roda de noite
```

#### 6.2 Alertas de Anomalia
```
Priority: MEDIUM
Complexity: MEDIUM

GET /api/ml/alertas
[
  {
    "tipo": "estoque_zerou",
    "item_id": "MLB123",
    "titulo": "Viseira Fume",
    "acao_sugerida": "Aumentar quantidade com fornecedor"
  },
  {
    "tipo": "margem_baixa",
    "item_id": "MLB456",
    "margem": 15.2,
    "acao_sugerida": "Aumentar preço ou negociar custo"
  }
]
```

---

## 🛑 Limitações (Não é possível implementar)

### ❌ Impossível via API ML
- **Mudar tipo de listing** (Clássico → Premium): Requer ação manual no painel ML
- **Editar preço por quantidade**: Apenas visualizar dados
- **Ativar/desativar Fulfillment**: Requer setup manual
- **Criar mercado livre**: Necessário autorização legal
- **Bulk edit de categorias**: Cada categoria pode ter atributos diferentes

### ✋ Requer Cuidado
- **Edições muito frequentes**: ML pode throttle ou marcar como spam
- **Mudanças de preço em massa**: Monitorar concorrentes automaticamente = pode ser visto como dumping de preço
- **Deletar anúncios**: Histórico de vendas será perdido

---

## 🎓 Aprendizados do Projeto

### ✓ O que Funcionou Bem
1. **Separação clara de responsabilidades**
   - `integracoes_ml.py` = Comunicação pura com ML
   - `main.py` = Endpoints e orquestração
   - Frontend = Apresentação

2. **Persistência de Token Segura**
   - Arquivo com permissões `0o600`
   - Refresh automático com novo refresh_token
   - Seed em produção via env var

3. **Rate Limiting Preventivo**
   - Throttle de 250ms antes de cada requisição
   - Respeita 240 req/min do ML
   - Retry automático em 429

### ⚠️ Pitfalls a Evitar
1. **Assumir que edições são idempotentes** → Não são. Última escrita vence.
2. **Ignorar atributos obrigatórios** → Categorias diferentes exigem atributos diferentes
3. **Cache agressivo** → Dados do ML mudam frequentemente (preços, estoque)
4. **Não validar dimensões** → Frete fica muito mais caro com dimensões erradas

---

## 📋 Checklist para Próximas Features

### Antes de Implementar Qualquer Feature
- [ ] Consultar docs oficiais em https://developers.mercadolibre.com
- [ ] Testar endpoint em sandbox/postman
- [ ] Validar rate limit impact
- [ ] Implementar retry logic
- [ ] Adicionar logs estruturados
- [ ] Testar com múltiplos tipos de anúncio
- [ ] Documentar limitações
- [ ] Criar testes unitários

### Deploy para Railway
- [ ] Secrets configurados em env vars
- [ ] Teste E2E com dados reais
- [ ] Monitoramento de erros (Sentry/LogRocket)
- [ ] Alertas para rate limit exceeded
- [ ] Backup automático de tokens

---

## 📞 Contato & Suporte

- **Portal Desenvolvedor**: https://developers.mercadolibre.com
- **Status da API**: https://status.mercadolibre.com
- **Comunidade**: Fórum ML Developers
- **Email Suporte**: devs@mercadolibre.com

---

**Última atualização**: 16/06/2026 | **Mantido por**: Equipe Novaes Estoque
