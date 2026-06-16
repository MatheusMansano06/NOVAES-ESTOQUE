import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const SHARED_SYNC_INTERVAL_MS = 5000

async function fetchJsonNoCache(url: string) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
  })
  if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`)
  return res.json()
}

interface ItemEstoque {
  id: number
  codigo_produto: string
  descricao: string
  quantidade_nf: number
  preco_unitario: number
  data_criacao?: string
  olist_produto_id?: string | null
  olist_sku?: string | null
  olist_nome?: string | null
}

interface NotaFiscal {
  id: number
  numero_nf: string
  fornecedor: string
  data_emissao?: string
  valor_frete?: number
  itens?: ItemEstoque[]
}

interface Fornecedor {
  nome: string
  quantidadeProdutos: number
}

// ---- Catálogo: produto -> fornecedores -> compras ----
interface Compra {
  nf_id: number
  numero_nf: string
  fornecedor: string
  data_compra?: string
  data_entrada?: string
  quantidade: number
  preco_unitario: number
  valor_frete_nota: number
  frete_unit: number
  custo_efetivo_unit: number
}
interface FornecedorCat {
  nome: string
  codigo: string
  descricao: string
  compras: Compra[]
  qtdTotal: number
  custoMedio: number
  ultimoPreco: number
  ultimaData?: string
}
interface ProdutoCatalogo {
  chave: string
  titulo: string
  olist_sku?: string
  vinculado: boolean
  fornecedores: FornecedorCat[]
  custoMedioGeral: number
  qtdTotal: number
}

// ---- Taxas dos marketplaces (editáveis, persistidas em localStorage) ----
interface Taxas {
  ml_comissao: number
  ml_custo_fixo: number
  shopee_com_baixo: number
  shopee_com_alto: number
  shopee_fix_1: number
  shopee_fix_2: number
  shopee_fix_3: number
  shopee_fix_4: number
}
const TAXAS_DEFAULT: Taxas = {
  ml_comissao: 14,
  ml_custo_fixo: 6.75,
  shopee_com_baixo: 20,
  shopee_com_alto: 14,
  shopee_fix_1: 4,
  shopee_fix_2: 16,
  shopee_fix_3: 20,
  shopee_fix_4: 26,
}
function carregarTaxas(): Taxas {
  try {
    const raw = localStorage.getItem('nvs_taxas_marketplace')
    if (raw) return { ...TAXAS_DEFAULT, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...TAXAS_DEFAULT }
}
function taxaShopee(preco: number, t: Taxas): number {
  if (preco <= 79.99) return preco * t.shopee_com_baixo / 100 + t.shopee_fix_1
  if (preco <= 99.99) return preco * t.shopee_com_alto / 100 + t.shopee_fix_2
  if (preco <= 199.99) return preco * t.shopee_com_alto / 100 + t.shopee_fix_3
  return preco * t.shopee_com_alto / 100 + t.shopee_fix_4
}
function taxaML(preco: number, t: Taxas): number {
  const fixo = preco < 79 ? t.ml_custo_fixo : 0
  return preco * t.ml_comissao / 100 + fixo
}

// ---- Margem vinda do nosso anúncio no Mercado Livre (cruzada por SKU) ----
interface MargemML {
  item_id: string
  titulo: string
  preco: number | null
  promocional: number | null
  frete: number | null
  tarifa: number | null
  tarifa_pct: number | null
  tipo_anuncio?: string
  permalink?: string
}
function carregarImpostoPct(): number {
  try {
    const v = parseFloat(localStorage.getItem('nvs_imposto_pct') || '')
    if (Number.isFinite(v) && v >= 0) return v
  } catch { /* ignore */ }
  return 9
}

const brl = (v: number) => 'R$ ' + (Number.isFinite(v) ? v : 0).toFixed(2).replace('.', ',')
const dataBR = (iso?: string) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '—' }
}

interface FornecedoresManagerProps {
  onVoltar: () => void
}

export function FornecedoresManager({ onVoltar }: FornecedoresManagerProps) {
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [view, setView] = useState<'suppliers' | 'catalogo'>('suppliers')

  const [nomesFornecedores, setNomesFornecedores] = useState<{ [key: string]: string }>({})
  const [precosVenda, setPrecosVenda] = useState<{ [chave: string]: number }>({})
  const [taxas, setTaxas] = useState<Taxas>(carregarTaxas())
  const [mostrarTaxas, setMostrarTaxas] = useState(false)

  // Modal de produtos do fornecedor
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<string | null>(null)
  const [produtosSelecionados, setProdutosSelecionados] = useState<{ codigo_produto: string; descricao: string; frequencia: number; olist_sku?: string }[]>([])
  const [showModal, setShowModal] = useState(false)

  // Edição de nome do fornecedor
  const [showModalNome, setShowModalNome] = useState(false)
  const [fornecedorParaEditar, setFornecedorParaEditar] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState('')
  const [salvandoNome, setSalvandoNome] = useState(false)

  // Catálogo: busca + margens reais dos nossos anúncios do ML (por SKU)
  const [termoBusca, setTermoBusca] = useState('')
  const [margensML, setMargensML] = useState<Record<string, MargemML>>({})
  const [loadingMargens, setLoadingMargens] = useState(false)
  const [impostoPct, setImpostoPct] = useState<number>(carregarImpostoPct())

  useEffect(() => { loadTudo() }, [])

  useEffect(() => {
    const sincronizar = () => { loadNotas(true); loadApelidos(); loadPrecos() }
    const aoVoltar = () => { if (document.visibilityState !== 'hidden') sincronizar() }
    const id = setInterval(sincronizar, SHARED_SYNC_INTERVAL_MS)
    window.addEventListener('focus', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  // Busca as margens reais dos nossos anúncios do ML (cruza por SKU) ao abrir o Catálogo
  useEffect(() => {
    if (view !== 'catalogo') return
    const skus = new Set<string>()
    notas.forEach(n => (n.itens || []).forEach(it => {
      if (it.olist_sku) skus.add(String(it.olist_sku).trim().toUpperCase())
    }))
    if (skus.size === 0) return
    let ativo = true
    setLoadingMargens(true)
    fetch(API_BASE + '/api/ml/margens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus: Array.from(skus) }),
    })
      .then(r => r.json())
      .then(d => { if (ativo && d && d.margens) setMargensML(d.margens) })
      .catch(() => { /* mantém o que já tem */ })
      .finally(() => { if (ativo) setLoadingMargens(false) })
    return () => { ativo = false }
  }, [view, notas])

  const loadTudo = async () => {
    setCarregando(true)
    await Promise.allSettled([loadNotas(), loadApelidos(), loadPrecos()])
    setCarregando(false)
  }

  const loadNotas = async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    try {
      const response = await fetchJsonNoCache(API_BASE + '/api/notas-fiscais')
      const data: NotaFiscal[] = response.items || response
      setNotas(data)
      groupByFornecedor(data)
    } catch (err) {
      console.error('Erro ao carregar notas:', err)
    } finally {
      if (!silencioso) setCarregando(false)
    }
  }

  const loadApelidos = async () => {
    try {
      const r = await fetchJsonNoCache(API_BASE + '/api/apelidos-fornecedores')
      setNomesFornecedores(r.apelidos || {})
    } catch (err) { console.error('Erro apelidos:', err) }
  }

  const loadPrecos = async () => {
    try {
      const r = await fetchJsonNoCache(API_BASE + '/api/precos-venda')
      setPrecosVenda(r.precos || {})
    } catch (err) { console.error('Erro precos-venda:', err) }
  }

  const groupByFornecedor = (notasData: NotaFiscal[]) => {
    const m = new Map<string, number>()
    notasData.forEach(n => {
      const count = n.itens?.length || 0
      if (n.fornecedor && count > 0) m.set(n.fornecedor, (m.get(n.fornecedor) || 0) + count)
    })
    setFornecedores(Array.from(m.entries()).map(([nome, q]) => ({ nome, quantidadeProdutos: q })).sort((a, b) => a.nome.localeCompare(b.nome)))
  }

  const getNomeExibicao = (nome: string) => nomesFornecedores[nome] || nome

  const salvarNomeFornecedor = async () => {
    if (!fornecedorParaEditar) return
    setSalvandoNome(true)
    try {
      const res = await fetch(API_BASE + '/api/apelidos-fornecedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({ nome_fornecedor: fornecedorParaEditar, apelido: novoNome.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.erro) throw new Error(data.erro || 'Falha')
      await loadApelidos()
      setShowModalNome(false); setFornecedorParaEditar(null); setNovoNome('')
    } catch { alert('Erro ao salvar nome do fornecedor') } finally { setSalvandoNome(false) }
  }

  const salvarPrecoVenda = async (chave: string, valorStr: string) => {
    const valor = parseFloat((valorStr || '').replace(',', '.')) || 0
    setPrecosVenda(prev => ({ ...prev, [chave]: valor }))
    try {
      await fetch(API_BASE + '/api/precos-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_chave: chave, preco_venda: valor }),
      })
    } catch { alert('Erro ao salvar preço de venda') }
  }

  const salvarFrete = async (nf_id: number, numero_nf: string) => {
    const atual = notas.find(n => n.id === nf_id)?.valor_frete || 0
    const entrada = window.prompt(`Frete da NF #${numero_nf} (R$):`, String(atual))
    if (entrada === null) return
    const valor = parseFloat(entrada.replace(',', '.')) || 0
    try {
      await fetch(`${API_BASE}/api/notas-fiscais/${nf_id}/frete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor_frete: valor }),
      })
      await loadNotas(true)
    } catch { alert('Erro ao salvar frete') }
  }

  const atualizarTaxa = (campo: keyof Taxas, valor: string) => {
    const novo = { ...taxas, [campo]: parseFloat(valor.replace(',', '.')) || 0 }
    setTaxas(novo)
    try { localStorage.setItem('nvs_taxas_marketplace', JSON.stringify(novo)) } catch { /* ignore */ }
  }

  const handleFornecedorClick = (nome: string) => {
    const m = new Map<string, { codigo_produto: string; descricao: string; frequencia: number; olist_sku?: string }>()
    notas.forEach(n => {
      if (n.fornecedor === nome) n.itens?.forEach(it => {
        const k = `${it.codigo_produto}|${it.descricao}`
        const ex = m.get(k)
        if (ex) ex.frequencia += 1
        else m.set(k, { codigo_produto: it.codigo_produto, descricao: it.descricao, frequencia: 1, olist_sku: it.olist_sku || undefined })
      })
    })
    setFornecedorSelecionado(nome)
    setProdutosSelecionados(Array.from(m.values()).sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto)))
    setShowModal(true)
  }

  // ---- Monta o catálogo: produto -> fornecedores -> compras (com custo médio ponderado + frete) ----
  const montarCatalogo = (): ProdutoCatalogo[] => {
    const produtos = new Map<string, ProdutoCatalogo>()

    notas.forEach(nota => {
      const itens = nota.itens || []
      const notaTotalValor = itens.reduce((s, i) => s + (i.preco_unitario || 0) * (i.quantidade_nf || 0), 0)
      const frete = nota.valor_frete || 0

      itens.forEach(item => {
        const chave = item.olist_sku || `${item.codigo_produto}|${item.descricao}`
        const valorItem = (item.preco_unitario || 0) * (item.quantidade_nf || 0)
        const freteShare = notaTotalValor > 0 ? frete * (valorItem / notaTotalValor) : 0
        const qtd = item.quantidade_nf || 0
        const freteUnit = qtd > 0 ? freteShare / qtd : 0
        const custoEfetivoUnit = (item.preco_unitario || 0) + freteUnit

        const compra: Compra = {
          nf_id: nota.id,
          numero_nf: nota.numero_nf,
          fornecedor: nota.fornecedor,
          data_compra: nota.data_emissao,
          data_entrada: item.data_criacao,
          quantidade: qtd,
          preco_unitario: item.preco_unitario || 0,
          valor_frete_nota: frete,
          frete_unit: freteUnit,
          custo_efetivo_unit: custoEfetivoUnit,
        }

        let prod = produtos.get(chave)
        if (!prod) {
          prod = {
            chave,
            titulo: item.olist_nome || item.descricao,
            olist_sku: item.olist_sku || undefined,
            vinculado: !!item.olist_sku,
            fornecedores: [],
            custoMedioGeral: 0,
            qtdTotal: 0,
          }
          produtos.set(chave, prod)
        }

        let forn = prod.fornecedores.find(f => f.nome === nota.fornecedor)
        if (!forn) {
          forn = { nome: nota.fornecedor, codigo: item.codigo_produto, descricao: item.descricao, compras: [], qtdTotal: 0, custoMedio: 0, ultimoPreco: 0, ultimaData: undefined }
          prod.fornecedores.push(forn)
        }
        forn.compras.push(compra)
      })
    })

    // Calcula custos médios ponderados (incluindo frete rateado)
    produtos.forEach(prod => {
      let somaCustoGeral = 0, somaQtdGeral = 0
      prod.fornecedores.forEach(forn => {
        let somaCusto = 0, somaQtd = 0
        let ultimaData = ''
        forn.compras.forEach(c => {
          somaCusto += c.custo_efetivo_unit * c.quantidade
          somaQtd += c.quantidade
          if (!ultimaData || (c.data_compra && c.data_compra > ultimaData)) {
            ultimaData = c.data_compra || ultimaData
            forn.ultimoPreco = c.preco_unitario
          }
        })
        forn.qtdTotal = somaQtd
        forn.custoMedio = somaQtd > 0 ? somaCusto / somaQtd : 0
        forn.ultimaData = ultimaData || undefined
        forn.compras.sort((a, b) => (b.data_compra || '').localeCompare(a.data_compra || ''))
        somaCustoGeral += somaCusto
        somaQtdGeral += somaQtd
      })
      prod.qtdTotal = somaQtdGeral
      prod.custoMedioGeral = somaQtdGeral > 0 ? somaCustoGeral / somaQtdGeral : 0
      prod.fornecedores.sort((a, b) => a.custoMedio - b.custoMedio)
    })

    return Array.from(produtos.values()).sort((a, b) => b.fornecedores.length - a.fornecedores.length || a.titulo.localeCompare(b.titulo))
  }

  const catalogo = view === 'catalogo' ? montarCatalogo() : []
  const termo = termoBusca.trim().toLowerCase()
  const catalogoFiltrado = termo === '' ? catalogo : catalogo.filter(p =>
    p.titulo.toLowerCase().includes(termo) ||
    (p.olist_sku || '').toLowerCase().includes(termo) ||
    p.fornecedores.some(f => f.codigo.toLowerCase().includes(termo) || f.descricao.toLowerCase().includes(termo) || getNomeExibicao(f.nome).toLowerCase().includes(termo))
  )

  const totalProdutos = catalogo.length
  const totalMulti = catalogo.filter(p => p.fornecedores.length > 1).length
  const totalVinculados = catalogo.filter(p => p.vinculado).length
  const pctVinculado = totalProdutos > 0 ? Math.round((totalVinculados / totalProdutos) * 100) : 0

  if (carregando) {
    return (
      <div className="app" style={{ background: '#ffffff' }}>
        <header className="header"><div className="container"><h1>NVS TECH</h1><p>Sistema de Gestão Inteligente de Estoque</p></div></header>
        <main className="container main-content"><p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Carregando...</p></main>
      </div>
    )
  }

  return (
    <div className="app" style={{ background: '#ffffff' }}>
      <header className="header"><div className="container"><h1>NVS TECH</h1><p>Sistema de Gestão Inteligente de Estoque para Operações de Logística e Marketplace</p></div></header>

      <main className="container main-content">
        <button onClick={onVoltar} style={{ marginBottom: '2rem', padding: '0.75rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>← Voltar</button>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '2px solid #e0e0e0' }}>
          {(['suppliers', 'catalogo'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '1rem 1.5rem', background: view === v ? '#007acc' : 'transparent', color: view === v ? 'white' : '#333', border: 'none', cursor: 'pointer', fontWeight: 600, borderBottom: view === v ? '3px solid #005a96' : 'none' }}>
              {v === 'suppliers' ? 'Fornecedores' : 'Catálogo (Produto × Fornecedor)'}
            </button>
          ))}
        </div>

        {/* ===== VIEW FORNECEDORES ===== */}
        {view === 'suppliers' && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Fornecedores</h2>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>Selecione um fornecedor para ver seus produtos</p>
            {fornecedores.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Nenhum fornecedor encontrado. Faça upload de notas fiscais primeiro.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                {fornecedores.map(f => (
                  <div key={f.nome} style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px', background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleFornecedorClick(f.nome)}>
                        <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem', color: '#1a1a1a' }}>{getNomeExibicao(f.nome)}</div>
                        <div style={{ fontSize: '0.9rem', color: '#666' }}>{f.quantidadeProdutos} produto{f.quantidadeProdutos !== 1 ? 's' : ''}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFornecedorParaEditar(f.nome); setNovoNome(nomesFornecedores[f.nome] || f.nome); setShowModalNome(true) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#999' }} title="Editar nome">✏️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== VIEW CATÁLOGO ===== */}
        {view === 'catalogo' && (
          <div>
            {/* Métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
              {[
                { l: 'Produtos', v: totalProdutos },
                { l: 'Fornecedores', v: fornecedores.length },
                { l: 'Multi-fornecedor', v: totalMulti },
                { l: 'Vinculados Olist', v: pctVinculado + '%' },
              ].map(m => (
                <div key={m.l} style={{ background: '#f7f9fa', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>{m.l}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a' }}>{m.v}</div>
                </div>
              ))}
            </div>

            {/* Busca + imposto */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" placeholder="Buscar produto, descrição, código ou SKU Olist..." value={termoBusca} onChange={e => setTermoBusca(e.target.value)}
                style={{ flex: 1, minWidth: '260px', padding: '0.75rem 1rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#666', whiteSpace: 'nowrap' }}>
                Imposto %
                <input type="number" step="0.01" min="0" value={impostoPct}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    const novo = Number.isFinite(v) && v >= 0 ? v : 0
                    setImpostoPct(novo)
                    try { localStorage.setItem('nvs_imposto_pct', String(novo)) } catch { /* ignore */ }
                  }}
                  style={{ width: '72px', padding: '0.5rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontWeight: 600 }} />
              </label>
              {loadingMargens && <span style={{ fontSize: '0.8rem', color: '#999' }}>carregando margens do ML…</span>}
            </div>

            {/* Lista de produtos */}
            {catalogoFiltrado.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Nenhum produto encontrado.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {catalogoFiltrado.map(prod => {
                  const custo = prod.custoMedioGeral
                  const skuML = (prod.olist_sku || '').trim().toUpperCase()
                  const anuncio = skuML ? margensML[skuML] : undefined
                  const precoML = anuncio ? (anuncio.promocional ?? anuncio.preco ?? 0) : 0
                  const freteML = anuncio?.frete ?? 0
                  const tarifaML = anuncio?.tarifa ?? 0
                  const impostoML = precoML > 0 ? precoML * impostoPct / 100 : 0
                  const margemML = anuncio && precoML > 0 ? precoML - freteML - tarifaML - impostoML - custo : null
                  const margemPctML = margemML != null && precoML > 0 ? Math.round((margemML / precoML) * 100) : 0
                  const corMargem = (l: number | null) => l === null ? '#999' : l > 0 ? '#2e7d32' : '#c62828'

                  return (
                    <div key={prod.chave} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '12px', overflow: 'hidden' }}>
                      {/* Header do produto */}
                      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{prod.titulo}</div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {prod.vinculado
                              ? <span style={{ fontSize: '0.75rem', background: '#e1f5ee', color: '#0f6e56', padding: '2px 8px', borderRadius: '6px' }}>🔗 {prod.olist_sku}</span>
                              : <span style={{ fontSize: '0.75rem', background: '#fff3e0', color: '#854f0b', padding: '2px 8px', borderRadius: '6px' }}>sem vínculo Olist</span>}
                            <span style={{ fontSize: '0.75rem', color: '#999' }}>{prod.fornecedores.length} fornecedor{prod.fornecedores.length !== 1 ? 'es' : ''} · {Math.round(prod.qtdTotal)} un compradas</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.75rem', color: '#666' }}>Custo médio (c/ frete)</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a1a1a' }}>{brl(custo)}</div>
                        </div>
                      </div>

                      {/* Margem direto do nosso anúncio no Mercado Livre (cruza por SKU) */}
                      <div style={{ padding: '0.85rem 1.25rem', background: '#f9fbfc', borderBottom: '1px solid #eee' }}>
                        {anuncio ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '0.72rem', color: '#666' }}>Preço no ML{anuncio.tipo_anuncio ? ` · ${anuncio.tipo_anuncio}` : ''}</div>
                              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a1a1a' }}>{brl(precoML)}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.74rem', color: '#666', flexWrap: 'wrap' }}>
                              <span>Frete <strong style={{ color: '#b42318' }}>{anuncio.frete != null ? `-${brl(freteML)}` : '—'}</strong></span>
                              <span>Tarifa <strong style={{ color: '#b42318' }}>{anuncio.tarifa != null ? `-${brl(tarifaML)}` : '—'}</strong></span>
                              <span>Imposto <strong style={{ color: '#b42318' }}>-{brl(impostoML)}</strong></span>
                              <span>Custo <strong style={{ color: '#b42318' }}>-{brl(custo)}</strong></span>
                            </div>
                            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                              <div style={{ fontSize: '0.72rem', color: '#666' }}>Margem de contribuição</div>
                              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: corMargem(margemML) }}>
                                {margemML === null ? '—' : `${brl(margemML)} (${margemPctML}%)`}
                              </div>
                            </div>
                            {anuncio.permalink && (
                              <a href={anuncio.permalink} target="_blank" rel="noreferrer"
                                style={{ fontSize: '0.78rem', color: '#3483fa', textDecoration: 'none', whiteSpace: 'nowrap' }}>ver no ML ↗</a>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.82rem', color: '#999' }}>
                            {prod.olist_sku
                              ? `Sem anúncio ativo no ML para o SKU ${prod.olist_sku}.`
                              : 'Produto sem SKU Olist — vincule para puxar a margem do anúncio.'}
                          </div>
                        )}
                      </div>

                      {/* Fornecedores e compras */}
                      <div>
                        {prod.fornecedores.map((forn, fi) => {
                          const inicial = getNomeExibicao(forn.nome).slice(0, 2).toUpperCase()
                          const ehMaisBarato = fi === 0 && prod.fornecedores.length > 1
                          return (
                            <div key={forn.nome} style={{ padding: '0.85rem 1.25rem', borderBottom: fi < prod.fornecedores.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#e6f1fb', color: '#0c447c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 600 }}>{inicial}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                                    {getNomeExibicao(forn.nome)}
                                    {ehMaisBarato && <span style={{ marginLeft: '8px', fontSize: '0.7rem', background: '#e1f5ee', color: '#0f6e56', padding: '1px 6px', borderRadius: '6px' }}>menor custo</span>}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: '#666' }}>cód {forn.codigo} · "{forn.descricao}"</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: ehMaisBarato ? '#0f6e56' : '#1a1a1a' }}>{brl(forn.custoMedio)}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#999' }}>custo médio · {Math.round(forn.qtdTotal)} un</div>
                                </div>
                              </div>
                              {/* Compras (NFs) */}
                              <div style={{ marginTop: '0.5rem', marginLeft: '42px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                {forn.compras.map((c, ci) => (
                                  <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.76rem', color: '#777', flexWrap: 'wrap' }}>
                                    <span style={{ color: '#555' }}>NF #{c.numero_nf}</span>
                                    <span>compra {dataBR(c.data_compra)}</span>
                                    <span>entrada {dataBR(c.data_entrada)}</span>
                                    <span>{Math.round(c.quantidade)} un × {brl(c.preco_unitario)}</span>
                                    <span style={{ cursor: 'pointer', color: '#007acc' }} onClick={() => salvarFrete(c.nf_id, c.numero_nf)}>
                                      frete {brl(c.valor_frete_nota)} ✏️
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL PRODUTOS DO FORNECEDOR */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'white', borderRadius: '8px', maxWidth: '700px', width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f7f9fa' }}>
              <h3 style={{ margin: 0 }}>{getNomeExibicao(fornecedorSelecionado || '')} - Produtos</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#999' }}>×</button>
            </div>
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {produtosSelecionados.map((p, i) => (
                <div key={i} style={{ padding: '1rem', border: '1px solid #e0e0e0', borderRadius: '6px', background: '#f9f9f9' }}>
                  <div style={{ fontWeight: 600 }}>{p.codigo_produto}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>{p.descricao}</div>
                  <span style={{ padding: '0.25rem 0.75rem', background: '#e0e0e0', borderRadius: '4px', fontSize: '0.85rem' }}>Comprado {p.frequencia}x</span>
                  {p.olist_sku && <span style={{ marginLeft: '0.5rem', padding: '0.25rem 0.75rem', background: '#c8e6c9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' }}>✅ {p.olist_sku}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR NOME */}
      {showModalNome && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}
          onClick={() => { setShowModalNome(false); setFornecedorParaEditar(null); setNovoNome('') }}>
          <div style={{ background: 'white', borderRadius: '8px', maxWidth: '500px', width: '90%', padding: '2rem' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Editar Nome do Fornecedor</h3>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }}>Nome Oficial:</label>
              <div style={{ padding: '0.75rem', background: '#f5f5f5', borderRadius: '4px', color: '#999' }}>{fornecedorParaEditar}</div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }}>Nome Customizado:</label>
              <input type="text" value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex: Augusto, Cordoaria..."
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #cfd8dc', borderRadius: '6px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { if (!salvandoNome) { setShowModalNome(false); setFornecedorParaEditar(null); setNovoNome('') } }}
                style={{ padding: '0.75rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
              <button onClick={salvarNomeFornecedor} disabled={salvandoNome || !novoNome.trim()}
                style={{ padding: '0.75rem 1.5rem', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, opacity: salvandoNome || !novoNome.trim() ? 0.7 : 1 }}>
                {salvandoNome ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default FornecedoresManager
