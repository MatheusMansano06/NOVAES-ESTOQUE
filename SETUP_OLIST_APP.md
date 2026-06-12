# 🚀 Setup do App Estoque Virtual na Olist

## 📋 Pré-requisitos

- Conta Olist ativa
- Acesso ao painel administrativo da Olist
- Dados para configuração (Client ID e Client Secret)

---

## 🎯 Passo 1: Criar o Novo App na Olist

### 1.1 Acesse o painel administrativo:
- Vá para **Dashboard Olist** → **Extensões** ou **Integrações**
- Ou acesse diretamente: `https://olist.com/extensoes` ou `https://olist.com/integradores`

### 1.2 Clique em "Criar Nova Extensão" ou "Novo Aplicativo"

### 1.3 Preencha os dados:

**Nome:**
```
Estoque Virtual
```

**Descrição:**
```
Sincronização automática de estoque entre notas fiscais e anúncios Olist.
Permite importar estoque de NF-e e atualizar quantidades nos anúncios publicados.
```

**Categoria:** `Integração ERP` ou `Gerenciamento de Estoque`

**URL Base/Callback:**
```
http://localhost:8000
```
(Use `https://seu-dominio.com` em produção)

---

## 🔐 Passo 2: Configurar Permissões

Solicite as seguintes permissões:

✅ **Produtos**
- `produto:pesquisa` - Buscar produtos
- `produto:leitura` - Ler detalhes de produtos
- `produto:escrita` - Atualizar dados do produto

✅ **Estoque**
- `estoque:leitura` - Ler estoque
- `estoque:escrita` - Atualizar estoque

✅ **Anúncios**
- `anuncio:leitura` - Ler informações de anúncios

---

## 📝 Passo 3: Copiar as Credenciais

Após criar o app, a Olist fornecerá:

- **Client ID**: `xxxxxxxxxxxxxxxx`
- **Client Secret**: `xxxxxxxxxxxxxxxx`
- **Token URL**: `https://accounts.olist.com/api/v1/token`

---

## 🔧 Passo 4: Configurar no Estoque Virtual

### 4.1 Abra o arquivo `.env`:

```bash
C:\Users\mansa\OneDrive\Área de Trabalho\ESTOQUE_VIRTUAL\backend\.env
```

### 4.2 Adicione as variáveis:

```env
# Integração Olist OAuth2 - API v3
OLIST_CLIENT_ID=<seu_client_id>
OLIST_CLIENT_SECRET=<seu_client_secret>

# Exemplo:
# OLIST_CLIENT_ID=abc123def456ghi789
# OLIST_CLIENT_SECRET=xyz987uvw654tsr321
```

### 4.3 Salve o arquivo

---

## ✅ Passo 5: Verificar a Integração

### 5.1 Inicie o servidor backend:

```bash
cd backend
python -m uvicorn app.main:app --reload
```

### 5.2 Verifique o status da integração:

Abra no navegador:
```
http://localhost:8000/api/olist/status
```

Você deve ver:
```json
{
  "integrado": true,
  "cliente_configurado": true,
  "token_valido": true,
  "status": "✓ Pronto"
}
```

---

## 🧪 Teste: Buscar Produtos

### Via API:
```
GET http://localhost:8000/api/olist/produtos?q=577
```

Resposta esperada:
```json
{
  "produtos": [
    {
      "id": "12345",
      "sku": "577",
      "nome": "RET. MINI TITAN 2014 125/150 D/E",
      "preco": 150.00,
      "estoque_atual": 10,
      ...
    }
  ],
  "total": 1,
  "termo_busca": "577",
  "metodo": "oauth2"
}
```

---

## 📚 Endpoints Disponíveis

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/olist/status` | GET | Verifica status da integração |
| `/api/olist/produtos` | GET | Busca produtos por termo |
| `/api/olist/anuncios` | GET | Lista anúncios publicados |
| `/api/olist/vincular-produto` | POST | Vincula produto da NF com anúncio |
| `/api/olist/atualizar-estoque` | POST | Atualiza estoque na Olist |

---

## 🐛 Troubleshooting

### "Token inválido"
- [ ] Verifique se Client ID está correto
- [ ] Verifique se Client Secret está correto
- [ ] Verifique se o app foi ativado na Olist

### "Erro 401 Unauthorized"
- [ ] Token expirou, tente reiniciar o servidor
- [ ] Credenciais não têm permissão para o endpoint

### "Produto não encontrado"
- [ ] Verifique se o SKU existe na sua conta Olist
- [ ] Tente buscar por nome ao invés de SKU

### "CORS Error"
- [ ] Verifique se a URL base do app está correta

---

## 🎉 Próximos Passos

1. ✅ App criado e configurado
2. ✅ Integração testada
3. → Usar no Estoque Virtual para:
   - Buscar produtos cadastrados
   - Vincular itens da NF
   - Atualizar estoque automaticamente

---

## 📞 Suporte

- Documentação Olist: https://ajuda.olist.com
- API v3 Docs: https://api-docs.erp.olist.com
- Contato Olist: suporte@olist.com

