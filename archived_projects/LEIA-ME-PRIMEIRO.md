# 📋 Leia-me Primeiro

## 🎯 O que aconteceu?

Em **15/07/2026**, duas funcionalidades foram **pausadas** (não deletadas):

1. **Estoque de Embalagens** - Aba em Ferramentas
2. **Radar de Envio FULL** - Aba em FULL

## 📁 Estrutura

```
archived_projects/
├── README.md ........................ Visão geral completa
├── CONSOLIDATION_SUMMARY.md ......... O que foi removido do código ativo
├── LEIA-ME-PRIMEIRO.md (você está aqui)
│
├── estoque_embalagens/
│   ├── EstoqueEmbalagens.tsx ........ Componente React (salvo)
│   └── RESTORATION_GUIDE.md ......... Passo-a-passo para retomar
│
└── radar_full/
    ├── RadarFull.tsx ............... Componente React (salvo)
    └── RESTORATION_GUIDE.md ......... Passo-a-passo para retomar
```

## ⚡ Comece por aqui

### Se quer **retomar agora**
1. Abra `estoque_embalagens/RESTORATION_GUIDE.md` ou `radar_full/RESTORATION_GUIDE.md`
2. Siga os passos (copy-paste, 5 min)
3. Teste no navegador

### Se quer **entender o que foi feito**
1. Leia `CONSOLIDATION_SUMMARY.md` (2 min)
2. Veja a lista de mudanças em `frontend/src/App.tsx`
3. Confirme que as tabelas SQL ainda existem

### Se quer **saber por que foi pausado**
- Leia `README.md` para contexto completo
- Verifique a memória em `../../.claude/projects/*/memory/`

## ✅ O que foi preservado

- ✓ Código-fonte completo (ambos os componentes)
- ✓ Tabelas do banco de dados (nada foi deletado)
- ✓ Histórico no git (git log mostra tudo)
- ✓ Utilitários backend (embalagens.py, radar_full.py)

## ❌ O que foi removido

- ❌ Imports em `App.tsx`
- ❌ Menu items do sidebar
- ❌ Páginas renderizadas
- ❌ useEffect que carregava dados
- ❌ Variáveis de estado não usadas

## 🔄 Fluxo de Retomada Típico (5 min)

```bash
# 1. Copiar arquivos de volta
cp archived_projects/estoque_embalagens/EstoqueEmbalagens.tsx frontend/src/components/
cp archived_projects/estoque_embalagens/embalagens.py backend/app/utils/

# 2. Restaurar imports em App.tsx (Edit manualmente)
#    Procure por "// ===== PÁGINA DO GARIMPADOR =====" 
#    e adicione antes:
#    if (pagina === 'estoque-embalagens') { ... }

# 3. Reiniciar backend e frontend
python -m uvicorn app.main:app --reload
npm run dev

# 4. Testar no navegador
# http://localhost:5173 → Menu → Ferramentas → Estoque de Embalagens
```

## 🆘 Problemas Comuns

| Problema | Solução |
|----------|---------|
| "Componente não encontrado" | Verifique que copiou EstoqueEmbalagens.tsx para `frontend/src/components/` |
| "API 404" | Restaure os endpoints em `main.py` (veja RESTORATION_GUIDE.md) |
| "Sem dados no banco" | Tabelas existem, mas estão vazias — é normal, dados históricos ficam |
| "Menu não aparece" | Restaure o item em `ShellNavGroup` dentro de App.tsx |

## 📞 Precisa de Ajuda?

1. Consulte o `RESTORATION_GUIDE.md` do projeto específico
2. Verifique `CONSOLIDATION_SUMMARY.md` para entender as mudanças
3. Leia `README.md` para contexto completo

## 🎓 Aprendizados

Este padrão de "pausar" funcionalidades (ao invés de deletar):
- ✅ Preserva o trabalho realizado
- ✅ Mantém histórico completo
- ✅ Permite retomar fácil (copy-paste)
- ✅ Documenta o motivo
- ✅ Não quebra integrações (endpoints ainda existem)

## 🚀 Próximo Passo

Qual nova funcionalidade você quer implementar?

---

**Tempo de leitura:** 2-3 minutos  
**Tempo de retomada:** ~5 minutos por funcionalidade  
**Complexidade:** Baixa (copy-paste + linhas de código)
