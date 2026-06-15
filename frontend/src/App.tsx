import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ModalDetalhes } from './ModalDetalhes'
import { ModalDetalhesNota } from './ModalDetalhesNota'
import { ModalDetalhesNotaFiscal } from './ModalDetalhesNotaFiscal'
import { FornecedoresManager } from './components/FornecedoresManager'
import { EmbaldesManager } from './components/EmbaldesManager'
import { AnunciosML } from './components/AnunciosML'
import { baixarMultiplosOuPdfs } from './services/api'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const SHARED_SYNC_INTERVAL_MS = 5000

async function fetchJsonNoCache(url: string) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  })
  if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`)
  return res.json()
}

interface NotaFiscal {
  id: number
  numero_nf: string
  serie: string
  fornecedor: string
  cnpj?: string | null
  endereco?: string | null
  status: string
  data_emissao?: string
  data_upload?: string
  arquivo_original?: string
  itens?: ItemNota[]
}

interface ItemNota {
  id: number
  codigo_produto: string
  descricao: string
  quantidade_nf: number
  quantidade_confirmada?: number
  preco_unitario: number
  status: string
  divergencia?: string
  olist_produto_id?: string | null
  olist_sku?: string | null
  estoque_olist_atualizado_em?: string | null
}

interface ProdutoEstoque {
  id_item: number
  descricao: string
  codigo_produto: string
  quantidade_total: number
  quantidade_confirmada: number
  quantidade_nf?: number
  preco_unitario: number
  notas_fiscais: Array<{
    numero_nf: string
    serie: string
    fornecedor: string
    quantidade: number
  }>
}

type Pagina = 'inicial' | 'conferencia' | 'produtos_nota' | 'relacionamento_produto' | 'fornecedores' | 'embaldes' | 'anuncios'

interface Divergencia {
  item_id: number
  numero_nf: string
  serie: string
  fornecedor: string
  produto: string
  codigo: string
  tipo_divergencia: string
  quantidade_nf: number
  quantidade_confirmada: number
  data_registro: string
}

function App() {
  // Estados de navegação
  const [pagina, setPagina] = useState<Pagina>('inicial')
  const [notaSelecionada, setNotaSelecionada] = useState<NotaFiscal | null>(null)
  const [produtosNota, setProdutosNota] = useState<ItemNota[]>([])

  // Estados da página inicial
  const [file, setFile] = useState<File | null>(null)
  const [freteNota, setFreteNota] = useState('')
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [estoque, setEstoque] = useState<ProdutoEstoque[]>([])
  const [divergencias, setDivergencias] = useState<Divergencia[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoEstoque | null>(null)
  const [itensSelecionadosMultiplos, setItensSelecionadosMultiplos] = useState<Set<number>>(new Set())
  // Grupos de produto expandidos manualmente (setinha). Grupos multi-registro
  // comecam colapsados; o usuario expande para ver todos os registros.
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<string>>(new Set())
  const [mostrarTodosEstoque, setMostrarTodosEstoque] = useState(false)
  const [modalDetalhesNFAberto, setModalDetalhesNFAberto] = useState(false)
  const [modalAdicionarProdutoAberto, setModalAdicionarProdutoAberto] = useState(false)
  const [novoProduto, setNovoProduto] = useState({
    codigo: '',
    descricao: '',
    quantidade: 1,
    preco: 0
  })
  const [produtoOlistSKU, setProdutoOlistSKU] = useState('')
  const [sugestoesSKU, setSugestoesSKU] = useState<Array<{sku: string, nome: string, preco: number}>>([])
  const [produtoOlistSelecionado, setProdutoOlistSelecionado] = useState({
    id: '',
    sku: '',
    nome: '',
    preco: 0,
    estoque: 0,
    estoque_saldo: 0,
    estoque_reservado: 0
  })
  const [produtoConferindoAtualmente, setProdutoConferindoAtualmente] = useState<ItemNota | null>(null)
  // Controla se o formulário de preenchimento manual está aberto (botão)
  const [mostrarManual, setMostrarManual] = useState(false)
  // Reserva de inbound ativo para o produto selecionado (regra do FULL)
  const [reservaInbound, setReservaInbound] = useState(0)
  const [reservaInboundInbs, setReservaInboundInbs] = useState('')
  // Balanço de estoque: corrige estoque fictício antigo antes de subir a NF
  const [balanceandoNF, setBalanceandoNF] = useState(false)
  const [estoqueRealNF, setEstoqueRealNF] = useState('')
  // Candidatos do inbound que podem ser este mesmo produto (p/ confirmar)
  const [inboundCandidatos, setInboundCandidatos] = useState<any[]>([])
  const [candidatoVinculado, setCandidatoVinculado] = useState<any>(null)
  const [vinculandoCandidato, setVinculandoCandidato] = useState(false)
  // Memória de vínculos (de-para fornecedor -> Olist)
  const [sugestaoVinculo, setSugestaoVinculo] = useState<any>(null)
  const [sugestaoDispensada, setSugestaoDispensada] = useState(false)
  const [modalVinculosAberto, setModalVinculosAberto] = useState(false)
  const [listaVinculos, setListaVinculos] = useState<any[]>([])
  // Kit detectado
  const [kitDetectado, setKitDetectado] = useState<any>(null)
  const [componentesKit, setComponentesKit] = useState<any[]>([])
  // Tela única: filtro + modal de detalhe com abas
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroData, setFiltroData] = useState('')
  const [notaDetalheAberta, setNotaDetalheAberta] = useState<NotaFiscal | null>(null)
  const [abaDetalhe, setAbaDetalhe] = useState<'detalhes' | 'conferencia' | 'divergencias'>('detalhes')
  const [notasSelecionadas, setNotasSelecionadas] = useState<Set<number>>(new Set())
  const [deletando, setDeletando] = useState(false)
  const [downloadandoPdf, setDownloadandoPdf] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Debounce da busca de produtos Olist (evita 1 request por tecla)
  const buscaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [buscandoSKU, setBuscandoSKU] = useState(false)
  // Inbounds ativos (diagnóstico em tempo real no topo das Notas)
  const [inboundsAtivos, setInboundsAtivos] = useState<Array<{ numero_inbound: string; data_limite: string | null; nome_embalde?: string }>>([])
  const [syncSaudavel, setSyncSaudavel] = useState(false)
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string | null>(null)

  // Formata data ISO -> dd/mm/aaaa (pt-BR)
  const fmtData = (d: string | null) => {
    if (!d) return 'sem data'
    const dt = new Date(d)
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('pt-BR')
  }

  const fmtHora = (d: string | null) => {
    if (!d) return '--:--'
    const dt = new Date(d)
    return isNaN(dt.getTime()) ? '--:--' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  // Carregar notas ao iniciar
  useEffect(() => {
    loadNotas(false)
    loadEstoque(false)
    loadDivergencias(false)
  }, [])

  // Diagnóstico de inbounds ATIVOS em tempo real (atualiza a cada 20s).
  // Some quando o inbound é encerrado; some todos => "SEM INBOUND ATIVO".
  useEffect(() => {
    const carregar = async () => {
      try {
        const data = await fetchJsonNoCache(`${API_BASE}/api/embaldes?limit=200`)
        setInboundsAtivos((data.items || []).filter((e: any) => e.status !== 'encerrado'))
        setSyncSaudavel(true)
        setUltimaSincronizacao(new Date().toISOString())
      } catch { /* silencioso — não quebra a tela */ }
    }
    carregar()
    const id = setInterval(carregar, SHARED_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const sincronizar = async () => {
      await Promise.allSettled([
        loadNotas(true),
        loadEstoque(true),
        loadDivergencias(true),
      ])
    }

    const aoVoltar = () => {
      if (document.visibilityState === 'hidden') return
      sincronizar()
    }

    const id = setInterval(sincronizar, SHARED_SYNC_INTERVAL_MS)
    window.addEventListener('focus', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)

    return () => {
      clearInterval(id)
      window.removeEventListener('focus', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  // Ao entrar na tela de vínculo, busca se esse produto já foi vinculado antes
  useEffect(() => {
    if (pagina === 'relacionamento_produto' && produtoSelecionado) {
      setSugestaoVinculo(null)
      setSugestaoDispensada(false)
      const codigo = (produtoSelecionado as any).codigo_produto || ''
      const descricao = (produtoSelecionado as any).descricao || ''
      fetch(`${API_BASE}/api/olist/sugestao-vinculo?codigo=${encodeURIComponent(codigo)}&descricao=${encodeURIComponent(descricao)}`)
        .then((r) => r.json())
        .then((d) => { if (d.encontrado) setSugestaoVinculo(d.vinculo) })
        .catch(() => {})
    }
  }, [pagina, produtoSelecionado])

  // Quando um anúncio Olist é selecionado, verifica se esse produto está
  // separado em algum inbound ATIVO (regra do FULL) para mostrar no preview.
  useEffect(() => {
    setCandidatoVinculado(null)
    setInboundCandidatos([])
    if (!produtoOlistSelecionado.sku && !produtoOlistSelecionado.id) {
      setReservaInbound(0)
      setReservaInboundInbs('')
      return
    }
    const params = new URLSearchParams({
      olist_produto_id: produtoOlistSelecionado.id || '',
      olist_sku: produtoOlistSelecionado.sku || ''
    })
    fetch(`${API_BASE}/api/embaldes/reserva-produto?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const reserva = Math.round(d.reservado_full || 0)
        setReservaInbound(reserva)
        setReservaInboundInbs((d.detalhes || []).map((x: any) => `#${x.numero_inbound}`).join(', '))
        // Se já casou direto (vínculo/SKU), não precisa pedir confirmação.
        if (reserva > 0) return
        // Senão, busca CANDIDATOS no inbound (por título/SKU) p/ o usuário confirmar.
        const p2 = new URLSearchParams({
          olist_produto_id: produtoOlistSelecionado.id || '',
          olist_sku: produtoOlistSelecionado.sku || '',
          olist_nome: produtoOlistSelecionado.nome || ''
        })
        fetch(`${API_BASE}/api/embaldes/buscar-no-inbound?${p2}`)
          .then((r) => r.json())
          .then((dc) => setInboundCandidatos(dc.candidatos || []))
          .catch(() => setInboundCandidatos([]))
      })
      .catch(() => { setReservaInbound(0); setReservaInboundInbs('') })
  }, [produtoOlistSelecionado.id, produtoOlistSelecionado.sku])

  // Confirma que um candidato do inbound é este produto: vincula o item do
  // inbound a este anúncio (de-para) e recalcula a reserva pro FULL.
  const confirmarCandidatoInbound = async (cand: any) => {
    if (!produtoOlistSelecionado.id) {
      alert('❌ Anúncio Olist sem ID — selecione o anúncio novamente.')
      return
    }
    setVinculandoCandidato(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/embaldes/${cand.inbound_id}/itens/${cand.item_id}/vincular`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            olist_produto_id: produtoOlistSelecionado.id,
            olist_sku: produtoOlistSelecionado.sku,
            olist_nome: produtoOlistSelecionado.nome,
            olist_preco: produtoOlistSelecionado.preco
          })
        }
      )
      if (!res.ok) {
        const e = await res.json()
        alert('❌ Erro ao vincular ao inbound: ' + (e.erro || 'desconhecido'))
        return
      }
      // Recalcula a reserva (agora casa por produto_id)
      const params = new URLSearchParams({
        olist_produto_id: produtoOlistSelecionado.id || '',
        olist_sku: produtoOlistSelecionado.sku || ''
      })
      const r = await fetch(`${API_BASE}/api/embaldes/reserva-produto?${params}`)
      const d = await r.json()
      setReservaInbound(Math.round(d.reservado_full || 0))
      setReservaInboundInbs((d.detalhes || []).map((x: any) => `#${x.numero_inbound}`).join(', '))
      setCandidatoVinculado(cand)
      setInboundCandidatos([])
    } catch (err) {
      alert('❌ Erro: ' + err)
    } finally {
      setVinculandoCandidato(false)
    }
  }

  // Usa a sugestão: busca dados frescos (estoque) do anúncio e seleciona
  const usarSugestao = async () => {
    if (!sugestaoVinculo) return
    const termo = sugestaoVinculo.olist_sku || sugestaoVinculo.nf_codigo || ''
    try {
      const res = await fetch(`${API_BASE}/api/olist/produtos?q=${encodeURIComponent(termo)}`)
      const data = await res.json()
      const lista = data.produtos || []
      const prod = lista.find((p: any) => String(p.id) === String(sugestaoVinculo.olist_produto_id)) || lista[0]
      if (prod) {
        handleSelecionarSKU(prod)
      } else {
        // fallback: usa os dados salvos (sem estoque ao vivo)
        handleSelecionarSKU({
          id: sugestaoVinculo.olist_produto_id,
          sku: sugestaoVinculo.olist_sku,
          nome: sugestaoVinculo.olist_nome,
          preco: sugestaoVinculo.olist_preco,
          estoque_atual: 0,
          estoque_saldo: 0,
        })
      }
    } catch {
      // fallback silencioso
    } finally {
      setSugestaoVinculo(null)
    }
  }

  const loadVinculos = async () => {
    try {
      const res = await fetch(API_BASE + '/api/olist/vinculos')
      const data = await res.json()
      setListaVinculos(data.vinculos || [])
    } catch (err) {
      console.error('Erro ao carregar vínculos:', err)
    }
  }

  const abrirModalVinculos = () => {
    loadVinculos()
    setModalVinculosAberto(true)
  }

  const deletarVinculo = async (id: number) => {
    if (!window.confirm('Remover este vínculo salvo? Ele não será mais sugerido automaticamente.')) return
    try {
      const res = await fetch(API_BASE + '/api/olist/vinculos/deletar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok || !data.sucesso) throw new Error(data.error || 'Falha ao remover vínculo')
      await loadVinculos()
      await loadNotas()
      await loadEstoque()
      await loadDivergencias()
      alert(data.mensagem || 'Vínculo removido com sucesso')
    } catch (err) {
      alert('Erro ao remover vínculo')
    }
  }

  const toggleSelecaoNota = (notaId: number) => {
    const novo = new Set(notasSelecionadas)
    if (novo.has(notaId)) {
      novo.delete(notaId)
    } else {
      novo.add(notaId)
    }
    setNotasSelecionadas(novo)
  }

  const selecionarTodasNotas = () => {
    if (notasSelecionadas.size === notasFiltradas.length) {
      setNotasSelecionadas(new Set())
    } else {
      setNotasSelecionadas(new Set(notasFiltradas.map(n => n.id)))
    }
  }

  const excluirNotasSelecionadas = async () => {
    if (!window.confirm(`Tem certeza que deseja excluir ${notasSelecionadas.size} nota(s)? Esta ação não pode ser desfeita.`)) {
      return
    }

    setDeletando(true)
    try {
      await fetch(API_BASE + '/api/notas-fiscais/deletar-multiplas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nf_ids: Array.from(notasSelecionadas) }),
      })
      await loadNotas()
      setNotasSelecionadas(new Set())
    } catch (err) {
      alert('Erro ao excluir notas')
    } finally {
      setDeletando(false)
    }
  }

  const baixarNotasSelecionadas = async (formato: 'original' | 'pdf' = 'pdf') => {
    try {
      setDownloadandoPdf(true)
      await baixarMultiplosOuPdfs(Array.from(notasSelecionadas), formato)
    } finally {
      setDownloadandoPdf(false)
    }
  }

  const loadNotas = async (preservarSelecao = true) => {
    try {
      const data = await fetchJsonNoCache(API_BASE + '/api/notas-fiscais')
      setNotas(data.items || [])
      if (!preservarSelecao) {
        setNotasSelecionadas(new Set())
      }
      setSyncSaudavel(true)
      setUltimaSincronizacao(new Date().toISOString())
    } catch (err) {
      setSyncSaudavel(false)
      console.error('Erro ao carregar notas:', err)
    }
  }

  const loadEstoque = async (_silencioso = true) => {
    try {
      const data = await fetchJsonNoCache(API_BASE + '/api/estoque-virtual')
      setEstoque(data.produtos || [])
      setSyncSaudavel(true)
      setUltimaSincronizacao(new Date().toISOString())
    } catch (err) {
      setSyncSaudavel(false)
      console.error('Erro ao carregar estoque:', err)
    }
  }

  const loadDivergencias = async (_silencioso = true) => {
    try {
      const data = await fetchJsonNoCache(API_BASE + '/api/divergencias')
      setDivergencias(data.divergencias || [])
      setSyncSaudavel(true)
      setUltimaSincronizacao(new Date().toISOString())
    } catch (err) {
      console.error('Erro ao carregar divergências:', err)
    }
  }

  const irParaProximaEtapa = (novaPagina: Pagina) => {
    setPagina(novaPagina)
    setModalOpen(false)
    loadNotas()
    loadDivergencias()
  }

  // Vai para a página de vínculo Olist usando a quantidade que REALMENTE chegou
  const irParaOlistSubirEstoque = (qtdConfirmada: number) => {
    setProdutoSelecionado((prev) =>
      prev ? ({ ...prev, quantidade_nf: qtdConfirmada } as any) : prev
    )
    // Limpa seleção anterior da Olist
    setProdutoOlistSelecionado({
      id: '', sku: '', nome: '', preco: 0,
      estoque: 0, estoque_saldo: 0, estoque_reservado: 0
    })
    setProdutoOlistSKU('')
    setSugestoesSKU([])
    setMostrarManual(false)
    setModalOpen(false)
    setNotaDetalheAberta(null)
    setPagina('relacionamento_produto')
    loadNotas()
    loadDivergencias()
  }

  // Calcula progresso de estoque subido na Olist (0-100%)
  const calcularProgresso = (itens?: ItemNota[]) => {
    const lista = itens || []
    const total = lista.length
    if (total === 0) return { conferidos: 0, total: 0, percentual: 0 }
    const conferidos = lista.filter(
      (i) => !!i.estoque_olist_atualizado_em
    ).length
    return { conferidos, total, percentual: Math.round((conferidos / total) * 100) }
  }

  // Status automático da nota (pelo % subido na Olist)
  const statusNota = (nota: NotaFiscal) => {
    const { percentual } = calcularProgresso(nota.itens)
    if (percentual >= 100) return { label: 'CONCLUÍDA', cor: '#2e7d32', bg: '#e8f5e9', icone: '✅' }
    if (percentual > 0) return { label: 'EM ANDAMENTO', cor: '#1565c0', bg: '#e3f2fd', icone: '🔄' }
    return { label: 'A CONFERIR', cor: '#e65100', bg: '#fff3e0', icone: '🆕' }
  }

  // Abre o modal de detalhe da nota (busca dados frescos)
  const abrirDetalheNota = async (notaId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/notas-fiscais/${notaId}`)
      const data: NotaFiscal = await res.json()
      setNotaDetalheAberta(data)
      setNotaSelecionada(data)
      setProdutosNota(data.itens || [])
      setAbaDetalhe('detalhes')
    } catch (err) {
      console.error('Erro ao abrir nota:', err)
    }
  }

  // Notas filtradas pela busca (nº, nome, CNPJ) e data
  const notasFiltradas = notas.filter((nota) => {
    const termo = filtroBusca.trim().toLowerCase()
    const casaTermo = !termo ||
      (nota.numero_nf || '').toLowerCase().includes(termo) ||
      (nota.fornecedor || '').toLowerCase().includes(termo) ||
      (nota.cnpj || '').toLowerCase().includes(termo)
    const casaData = !filtroData ||
      (nota.data_emissao || '').slice(0, 10) === filtroData
    return casaTermo && casaData
  })

  // Divergências apenas da nota aberta no detalhe
  const divergenciasDaNota = (nota: NotaFiscal | null) =>
    !nota ? [] : divergencias.filter((d) => String(d.numero_nf) === String(nota.numero_nf))

  const resolverDivergenciaItem = async (itemId: number) => {
    const res = await fetch(API_BASE + '/api/resolver-divergencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    })
    if (res.ok) { alert('✅ Divergência marcada como resolvida'); await loadDivergencias(); await loadNotas() }
    else alert('❌ Erro ao resolver')
  }

  const deletarDivergenciaItem = async (itemId: number) => {
    if (!window.confirm('Tem certeza que deseja deletar esta divergência?')) return
    const res = await fetch(API_BASE + '/api/deletar-divergencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    })
    if (res.ok) { alert('✅ Divergência deletada'); await loadDivergencias(); await loadNotas() }
    else alert('❌ Erro ao deletar')
  }

  // Da divergência -> tela de vincular Olist (sobe a quantidade recebida)
  const vincularDivergenciaOlist = (div: Divergencia) => {
    setProdutoSelecionado({
      id: div.item_id,
      descricao: div.produto,
      codigo_produto: div.codigo,
      quantidade_nf: div.quantidade_confirmada,
      preco_unitario: 0,
    } as any)
    setProdutoOlistSelecionado({ id: '', sku: '', nome: '', preco: 0, estoque: 0, estoque_saldo: 0, estoque_reservado: 0 })
    setProdutoOlistSKU('')
    setSugestoesSKU([])
    setMostrarManual(false)
    setNotaDetalheAberta(null)
    setPagina('relacionamento_produto')
  }

  // Abre conferência de um produto (a partir da aba Conferência)
  const conferirProduto = (item: ItemNota) => {
    if (!notaDetalheAberta) return
    const produtoEstoque: any = {
      id_item: item.id,
      descricao: item.descricao,
      codigo_produto: item.codigo_produto,
      quantidade_total: item.quantidade_nf,
      quantidade_nf: item.quantidade_nf,
      quantidade_confirmada: item.quantidade_confirmada ?? item.quantidade_nf,
      preco_unitario: item.preco_unitario,
      notas_fiscais: [{
        numero_nf: notaDetalheAberta.numero_nf || '', serie: notaDetalheAberta.serie || '',
        fornecedor: notaDetalheAberta.fornecedor || '', quantidade: item.quantidade_nf
      }]
    }
    setProdutoSelecionado(produtoEstoque)
    setModalOpen(true)
  }

  const toggleSelecaoMultipla = (itemId: number) => {
    const novo = new Set(itensSelecionadosMultiplos)
    if (novo.has(itemId)) {
      novo.delete(itemId)
    } else {
      novo.add(itemId)
    }
    setItensSelecionadosMultiplos(novo)
  }

  // Agrupa itens pela descrição
  const agruparItensPorDescricao = (itens: ItemNota[]) => {
    const grupos: { [key: string]: ItemNota[] } = {}
    itens.forEach((item) => {
      if (!grupos[item.descricao]) {
        grupos[item.descricao] = []
      }
      grupos[item.descricao].push(item)
    })
    return Object.entries(grupos).map(([descricao, items]) => ({
      descricao,
      items,
      totalQtd: items.reduce((s, i) => s + i.quantidade_nf, 0),
      selecionados: items.filter(i => itensSelecionadosMultiplos.has(i.id))
    }))
  }

  const enviarMultiplosEmMassa = async () => {
    if (!notaDetalheAberta || itensSelecionadosMultiplos.size === 0) return

    const notaSelecionada = notaDetalheAberta
    const itensArray = (notaSelecionada.itens || []).filter(i => itensSelecionadosMultiplos.has(i.id))

    if (itensArray.length === 0) return

    const primeiroItem = itensArray[0]
    const descricaoComum = primeiroItem.descricao
    const qtdTotal = itensArray.reduce((s, i) => s + i.quantidade_nf, 0)

    const msg = `Confirmar envio em massa?\n\n` +
      `Produto: ${descricaoComum}\n` +
      `Quantidade de registros: ${itensArray.length}\n` +
      `Quantidade total: ${Math.round(qtdTotal)} unidades\n\n` +
      `Os registros serão agrupados e enviados como uma única entrada para a Olist.`

    if (!window.confirm(msg)) return

    setProdutoSelecionado({
      id_item: itensArray[0].id,
      descricao: descricaoComum,
      codigo_produto: itensArray[0].codigo_produto,
      quantidade_total: qtdTotal,
      quantidade_nf: qtdTotal,
      quantidade_confirmada: qtdTotal,
      preco_unitario: itensArray[0].preco_unitario,
      notas_fiscais: itensArray.map(i => ({
        numero_nf: notaSelecionada.numero_nf || '',
        serie: notaSelecionada.serie || '',
        fornecedor: notaSelecionada.fornecedor || '',
        quantidade: i.quantidade_nf
      }))
    } as any)
    setItensSelecionadosMultiplos(new Set())
    setModalOpen(true)
  }

  // Componente de barra de progresso reutilizável
  const BarraProgresso = ({ itens, compacto = false }: { itens?: ItemNota[], compacto?: boolean }) => {
    const { conferidos, total, percentual } = calcularProgresso(itens)
    const cor = percentual === 100 ? '#4caf50' : percentual > 0 ? '#007acc' : '#bdbdbd'
    return (
      <div style={{ marginTop: compacto ? '0.5rem' : '0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: compacto ? '0.75rem' : '0.85rem', color: '#666', fontWeight: 600 }}>
            Subidos na Olist: {conferidos}/{total}
          </span>
          <span style={{ fontSize: compacto ? '0.75rem' : '0.85rem', color: cor, fontWeight: 700 }}>
            {percentual}%
          </span>
        </div>
        <div style={{ background: '#e0e0e0', borderRadius: '999px', height: compacto ? '6px' : '10px', overflow: 'hidden' }}>
          <div style={{
            width: `${percentual}%`,
            height: '100%',
            background: cor,
            borderRadius: '999px',
            transition: 'width 0.4s ease'
          }} />
        </div>
      </div>
    )
  }

  // Dados mock de produtos Olist (futuramente virá de uma API real)
  const produtosOlistMock = [
    { sku: '001', nome: 'Produto XYZ - Azul', preco: 49.90, estoque: 15 },
    { sku: '002', nome: 'Produto XYZ - Vermelho', preco: 49.90, estoque: 8 },
    { sku: '003', nome: 'Produto ABC - P', preco: 35.00, estoque: 12 },
    { sku: '004', nome: 'Produto ABC - M', preco: 35.00, estoque: 20 },
    { sku: '005', nome: 'Produto ABC - G', preco: 35.00, estoque: 5 },
    { sku: '006', nome: 'Camiseta Premium - Branco', preco: 79.90, estoque: 30 },
    { sku: '007', nome: 'Camiseta Premium - Preto', preco: 79.90, estoque: 25 },
    { sku: '008', nome: 'Bermuda Casual - Azul', preco: 89.90, estoque: 10 },
  ]

  const handleBuscarSKU = (busca: string) => {
    // Atualiza o input imediatamente (resposta instantanea ao digitar)
    setProdutoOlistSKU(busca)

    // Cancela a busca anterior agendada
    if (buscaTimeoutRef.current) {
      clearTimeout(buscaTimeoutRef.current)
    }

    if (busca.length < 2) {
      setSugestoesSKU([])
      setBuscandoSKU(false)
      return
    }

    // Debounce: so dispara a busca 300ms apos parar de digitar
    setBuscandoSKU(true)
    buscaTimeoutRef.current = setTimeout(() => {
      executarBuscaSKU(busca)
    }, 300)
  }

  const executarBuscaSKU = async (busca: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/olist/produtos?q=${encodeURIComponent(busca)}`)

      if (!response.ok && response.status === 503) {
        setSugestoesSKU([])
        setMessage('⚠️ Configure sua chave de API da Olist no arquivo .env para usar a busca em tempo real.')
        return
      }

      const data = await response.json()
      setSugestoesSKU(data.produtos && Array.isArray(data.produtos) ? data.produtos : [])
    } catch (err) {
      console.error('Erro ao buscar produtos Olist:', err)
      setSugestoesSKU([])
      setMessage('❌ Erro ao buscar produtos da Olist. Verifique se a API está disponível.')
    } finally {
      setBuscandoSKU(false)
    }
  }

  const handleSelecionarSKU = async (produto: any) => {
    // Tentar detectar kit automaticamente
    try {
      const resDeteccao = await fetch(`${API_BASE}/api/olist/detectar-kit?sku=${encodeURIComponent(produto.sku.toUpperCase())}`)
      const dataDeteccao = await resDeteccao.json()

      if (dataDeteccao.eh_kit) {
        // É um kit! Extrair componentes
        console.log('[KIT-DETECTADO]', dataDeteccao)
        setKitDetectado({
          eh_kit: true,
          sku_kit: dataDeteccao.sku_principal,
          nome_kit: dataDeteccao.nome_kit,
          skus_componentes: dataDeteccao.componentes.map((c: any) => c.sku),
          quantidade_componentes: dataDeteccao.componentes.length,
          id_kit: 0
        })
        setComponentesKit(dataDeteccao.componentes.map((c: any) => ({
          sku: c.sku,
          olist_produto_id: c.id,
          olist_nome: c.nome || c.descricao,
          olist_preco: c.preco
        })))
        setProdutoOlistSKU('')
        setSugestoesSKU([])
        return
      }
    } catch (err) {
      console.log('[KIT-AUTO] Detecção falhou, usando fluxo normal:', err)
    }

    // Não é kit ou detecção falhou - usar fluxo normal
    // Seleciona imediatamente (sem estoque ainda) para a UI responder rápido
    setProdutoOlistSelecionado({
      id: produto.id || '',
      sku: produto.sku || '',
      nome: produto.nome || '',
      preco: parseFloat(produto.preco) || 0,
      estoque: parseInt(produto.estoque_atual ?? produto.estoque) || 0,
      estoque_saldo: parseInt(produto.estoque_saldo ?? produto.estoque_atual) || 0,
      estoque_reservado: parseInt(produto.estoque_reservado) || 0
    })
    setProdutoOlistSKU('')
    setSugestoesSKU([])

    // Busca o estoque atual sob demanda (1 requisição rápida)
    if (produto.id && (produto.estoque_atual === undefined || produto.estoque_atual === null)) {
      try {
        const resEstoque = await fetch(`${API_BASE}/api/olist/estoque-produto?id=${encodeURIComponent(produto.id)}`)
        const estoque = await resEstoque.json()
        setProdutoOlistSelecionado((prev) => ({
          ...prev,
          estoque: parseInt(estoque.estoque_atual) || 0,
          estoque_saldo: parseInt(estoque.estoque_saldo) || 0,
          estoque_reservado: parseInt(estoque.estoque_reservado) || 0
        }))
      } catch (err) {
        console.error('Erro ao buscar estoque do produto:', err)
      }
    }
  }

  const handleVincularKit = async (kit: any, componentes: any[]) => {
    if (!produtoSelecionado) {
      alert('❌ Erro: nenhum produto selecionado')
      return
    }

    const itemId = (produtoSelecionado as any).id ?? (produtoSelecionado as any).id_item
    if (!itemId) {
      alert('❌ Erro: item sem identificador')
      return
    }

    const qtdNF = Math.round(produtoSelecionado.quantidade_nf)
    const mensagem = `Confirmar vinculação do KIT?\n\n` +
      `Kit: ${kit.nome_kit}\n` +
      `SKU: ${kit.sku_kit}\n` +
      `Componentes: ${componentes.length}\n\n` +
      `Cada componente será atualizado com: +${qtdNF} unidades\n\n` +
      `Deseja continuar?`

    if (!window.confirm(mensagem)) return

    try {
      // Vincular kit + atualizar estoque de cada componente
      const res = await fetch(API_BASE + '/api/olist/kits/vincular-com-componentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          sku_kit: kit.sku_kit,
          componentes: componentes
        })
      })

      const data = await res.json()
      if (res.ok && data.sucesso) {
        const sucessos = data.resultados_componentes.filter((r: any) => r.sucesso).length
        const falhas = data.resultados_componentes.filter((r: any) => !r.sucesso).length

        let detalhesMsg = `✅ Kit vinculado com sucesso!\n\n`
        detalhesMsg += `Kit: ${kit.nome_kit}\n`
        detalhesMsg += `Componentes atualizados: ${sucessos}/${componentes.length}\n\n`

        // Mostrar detalhes de cada componente
        data.resultados_componentes.forEach((comp: any) => {
          if (comp.sucesso) {
            detalhesMsg += `✅ ${comp.sku}\n`
            detalhesMsg += `   ${comp.estoque_anterior} + ${comp.quantidade_adicionada} = ${comp.novo_estoque} un\n`
          } else {
            detalhesMsg += `❌ ${comp.sku} - Erro: ${comp.erro}\n`
          }
        })

        alert(detalhesMsg)

        // Recarregar nota para atualizar status do item
        const nfId = notaDetalheAberta?.id ?? notaSelecionada?.id
        if (nfId) {
          try {
            const resNota = await fetch(`${API_BASE}/api/notas-fiscais/${nfId}`)
            const dataNota = await resNota.json()
            setProdutosNota(dataNota.itens || [])
            setNotaDetalheAberta(dataNota)
          } catch (err) {
            console.error('Erro ao recarregar nota:', err)
          }
        }

        await loadNotas()
        await loadDivergencias()
        setKitDetectado(null)
        setComponentesKit([])
        voltarParaInicial()
      } else {
        alert('❌ Erro ao vincular kit: ' + (data.erro || 'desconhecido'))
      }
    } catch (err) {
      alert('❌ Erro: ' + err)
    }
  }

  const handleVincular = async () => {
    if (!produtoOlistSelecionado.sku || !produtoSelecionado) {
      alert('❌ Selecione um anúncio da Olist primeiro!')
      return
    }

    // O item pode vir com 'id' (divergência) ou 'id_item' (conferência)
    const itemId = (produtoSelecionado as any).id ?? (produtoSelecionado as any).id_item
    if (!itemId) {
      alert('❌ Erro: item sem identificador. Volte e selecione o produto novamente.')
      return
    }

    const qtdNF = Math.round(produtoSelecionado.quantidade_nf)
    const saldoAtual = produtoOlistSelecionado.estoque_saldo

    // REGRA DO INBOUND: verifica se este produto está separado para FULL
    // em algum inbound ativo (que ainda não deu baixa). Se estiver, segura
    // essa quantidade — sobe na Olist só o restante.
    let reservaFull = 0
    let reservaInfo = ''
    try {
      const params = new URLSearchParams({
        olist_produto_id: produtoOlistSelecionado.id || '',
        olist_sku: produtoOlistSelecionado.sku || ''
      })
      const resR = await fetch(`${API_BASE}/api/embaldes/reserva-produto?${params}`)
      const dataR = await resR.json()
      reservaFull = Math.round(dataR.reservado_full || 0)
      if (reservaFull > 0) {
        const inbs = (dataR.detalhes || []).map((d: any) => `#${d.numero_inbound}`).join(', ')
        reservaInfo = `\n⚠️ ${reservaFull} un estão num inbound ativo (${inbs}) e serão SEGURADAS pro FULL.\n`
      }
    } catch { /* se falhar, segue sem reserva */ }

    const qtdSubir = Math.max(0, qtdNF - reservaFull)
    const novoSaldo = saldoAtual + qtdSubir

    const confirmar = window.confirm(
      `Confirmar atualização de estoque na Olist?\n\n` +
      `Produto: ${produtoOlistSelecionado.nome}\n` +
      `SKU: ${produtoOlistSelecionado.sku}\n\n` +
      `Estoque atual na Olist: ${saldoAtual} un\n` +
      `Quantidade da NF: ${qtdNF} un\n` +
      reservaInfo +
      `→ Vai subir na Olist: ${qtdSubir} un\n` +
      `= Novo estoque total: ${novoSaldo} un\n\n` +
      `Deseja continuar?`
    )
    if (!confirmar) return

    try {
      // 1. Vincular produto NF -> anúncio Olist
      const resVinc = await fetch(API_BASE + '/api/olist/vincular-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          olist_produto_id: produtoOlistSelecionado.id,
          olist_sku: produtoOlistSelecionado.sku,
          olist_nome: produtoOlistSelecionado.nome,
          olist_preco: produtoOlistSelecionado.preco
        })
      })
      if (!resVinc.ok) {
        const err = await resVinc.json()
        alert('❌ Erro ao vincular: ' + (err.error || 'desconhecido'))
        return
      }

      // 2. Atualizar estoque na Olist (ENTRADA da quantidade da NF)
      // Em subida em massa, envia todos os IDs do grupo para marcar todos como subidos
      const idsMassa = (produtoSelecionado as any).ids_massa as number[] | undefined
      const resEst = await fetch(API_BASE + '/api/olist/atualizar-estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          item_ids: idsMassa && idsMassa.length > 1 ? idsMassa : undefined,
          quantidade: qtdNF,
          tipo: 'E'
        })
      })

      const dataEst = await resEst.json()
      if (resEst.ok && dataEst.sucesso) {
        alert(`✅ Sucesso!\n\n${dataEst.mensagem || 'Produto vinculado e estoque atualizado na Olist.'}`)
        await recarregarAposSubida()
        return
      } else {
        alert('⚠️ Produto vinculado, mas falha ao atualizar estoque: ' + (dataEst.error || 'desconhecido'))
      }
    } catch (err) {
      alert('❌ Erro: ' + err)
    }
  }

  // Recarrega notas/divergências e volta pra home com o modal da nota atualizado.
  // Compartilhado entre a subida normal (handleVincular) e o balanço (handleBalancear).
  const recarregarAposSubida = async () => {
    await loadNotas()
    await loadDivergencias()
    setPagina('inicial')
    setModalDetalhesNFAberto(false)
    setAbaDetalhe('conferencia')
    // Reabrir o modal com a nota ATUALIZADA da API (nao a versao antiga em
    // memoria) - senao os itens recem-subidos continuam aparecendo "A conferir"
    const nfIdReabrir = notaDetalheAberta?.id ?? notaSelecionada?.id
    if (nfIdReabrir) {
      try {
        const resNota = await fetch(`${API_BASE}/api/notas-fiscais/${nfIdReabrir}`)
        const notaAtualizada = await resNota.json()
        setNotaSelecionada(notaAtualizada)
        setNotaDetalheAberta(notaAtualizada)
      } catch {
        if (notaSelecionada) setNotaDetalheAberta(notaSelecionada)
      }
    }
  }

  // Balanço: corrige o estoque fictício antigo. O usuário informa o estoque REAL
  // atual; o sistema escreve na Olist (real + qtd da NF) como valor ABSOLUTO.
  const handleBalancear = async () => {
    if (!produtoOlistSelecionado.sku || !produtoSelecionado) {
      alert('❌ Selecione um anúncio da Olist primeiro!')
      return
    }
    const itemId = (produtoSelecionado as any).id ?? (produtoSelecionado as any).id_item
    if (!itemId) {
      alert('❌ Erro: item sem identificador. Volte e selecione o produto novamente.')
      return
    }
    const real = Math.round(Number(estoqueRealNF))
    if (estoqueRealNF.trim() === '' || isNaN(real) || real < 0) {
      alert('❌ Informe o estoque REAL atual (número válido, 0 ou mais).')
      return
    }

    const qtdNF = Math.round(produtoSelecionado.quantidade_nf)
    const novoTotal = real + qtdNF

    const confirmar = window.confirm(
      `Confirmar BALANÇO de estoque na Olist?\n\n` +
      `Produto: ${produtoOlistSelecionado.nome}\n` +
      `SKU: ${produtoOlistSelecionado.sku}\n\n` +
      `⚠️ Isto IGNORA o estoque atual da Olist (${produtoOlistSelecionado.estoque_saldo} un) ` +
      `por estar incorreto.\n\n` +
      `Estoque real informado: ${real} un\n` +
      `Quantidade da NF: ${qtdNF} un\n` +
      `= Novo estoque total na Olist: ${novoTotal} un\n\n` +
      `Deseja continuar?`
    )
    if (!confirmar) return

    try {
      // 1. Vincular produto NF -> anúncio Olist
      const resVinc = await fetch(API_BASE + '/api/olist/vincular-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          olist_produto_id: produtoOlistSelecionado.id,
          olist_sku: produtoOlistSelecionado.sku,
          olist_nome: produtoOlistSelecionado.nome,
          olist_preco: produtoOlistSelecionado.preco
        })
      })
      if (!resVinc.ok) {
        const err = await resVinc.json()
        alert('❌ Erro ao vincular: ' + (err.error || 'desconhecido'))
        return
      }

      // 2. Balanço: escreve (real + NF) como valor ABSOLUTO na Olist
      const idsMassa = (produtoSelecionado as any).ids_massa as number[] | undefined
      const resEst = await fetch(API_BASE + '/api/olist/atualizar-estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          item_ids: idsMassa && idsMassa.length > 1 ? idsMassa : undefined,
          quantidade: qtdNF,
          estoque_real: real
        })
      })
      const dataEst = await resEst.json()
      if (resEst.ok && dataEst.sucesso) {
        alert(`✅ Balanço realizado!\n\n${dataEst.mensagem || ''}`)
        setBalanceandoNF(false)
        setEstoqueRealNF('')
        await recarregarAposSubida()
        return
      } else {
        alert('⚠️ Produto vinculado, mas falha no balanço: ' + (dataEst.error || 'desconhecido'))
      }
    } catch (err) {
      alert('❌ Erro: ' + err)
    }
  }

  const handleAdicionarProduto = async () => {
    if (!novoProduto.codigo || !novoProduto.descricao) {
      alert('❌ Preencha código e descrição!')
      return
    }

    try {
      const res = await fetch(API_BASE + '/api/produtos-manuais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nf_id: notaSelecionada?.id,
          codigo_recebido: novoProduto.codigo,
          descricao_recebida: novoProduto.descricao,
          quantidade: novoProduto.quantidade,
          preco: novoProduto.preco
        })
      })

      if (res.ok) {
        alert('✅ Produto adicionado ao estoque!')
        setModalAdicionarProdutoAberto(false)
        setNovoProduto({ codigo: '', descricao: '', quantidade: 1, preco: 0 })
        // Recarregar a nota para atualizar a lista/abas
        const nfId = notaDetalheAberta?.id ?? notaSelecionada?.id
        if (nfId) {
          const resNota = await fetch(`${API_BASE}/api/notas-fiscais/${nfId}`)
          const dataNota = await resNota.json()
          setProdutosNota(dataNota.itens || [])
          setNotaDetalheAberta(dataNota)
        }
        loadNotas()
      } else {
        alert('❌ Erro ao adicionar produto')
      }
    } catch (err) {
      alert('❌ Erro: ' + err)
    }
  }

  const abrirNotaSelecionada = async (notaId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/notas-fiscais/${notaId}`)
      const data: NotaFiscal = await res.json()
      setNotaSelecionada(data)
      setPagina('inicial') // Mantém na inicial mas mostra a nota selecionada
    } catch (err) {
      console.error('Erro ao buscar nota:', err)
    }
  }

  const irParaConferenciaProdutos = async () => {
    if (!notaSelecionada) return
    try {
      // Buscar dados frescos da nota para refletir conferências já feitas
      const res = await fetch(`${API_BASE}/api/notas-fiscais/${notaSelecionada.id}`)
      const data: NotaFiscal = await res.json()
      setNotaSelecionada(data)
      setProdutosNota(data.itens || [])
    } catch (err) {
      setProdutosNota(notaSelecionada.itens || [])
    }
    setPagina('produtos_nota')
  }

  const abrirConferencia = async (notaId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/notas-fiscais/${notaId}`)
      const data: NotaFiscal = await res.json()
      setNotaSelecionada(data)
      setPagina('conferencia')
      setMostrarTodosEstoque(false)
    } catch (err) {
      console.error('Erro ao buscar nota:', err)
    }
  }

  const voltarParaInicial = () => {
    setPagina('inicial')
    setNotaSelecionada(null)
  }

  const enviarWhatsApp = (produto: string, quantidadeEsperada: number, quantidadeRecebida: number, tipo: 'a_mais' | 'a_menos' | 'nao_veio') => {
    let mensagem = ''
    const telefone = '5519978149245' // WhatsApp sem formatação

    if (tipo === 'a_mais') {
      mensagem = `Produto ${produto}: Chegou com quantidade MAIOR. Esperado: ${quantidadeEsperada} | Recebido: ${quantidadeRecebida}`
    } else if (tipo === 'a_menos') {
      mensagem = `Produto ${produto}: Chegou com quantidade MENOR. Esperado: ${quantidadeEsperada} | Recebido: ${quantidadeRecebida}`
    } else {
      mensagem = `Produto ${produto}: NÃO CHEGOU. Esperado: ${quantidadeEsperada} | Recebido: 0`
    }

    const urlWhatsApp = `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`
    window.open(urlWhatsApp, '_blank')
  }

  const abrirDetalhes = (produto: ProdutoEstoque) => {
    setProdutoSelecionado(produto)
    setModalOpen(true)
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      setMessage('Selecione um arquivo!')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      const freteNum = parseFloat((freteNota || '').replace(',', '.')) || 0
      if (freteNum > 0) formData.append('valor_frete', String(freteNum))

      const res = await fetch(API_BASE + '/api/upload-nfe', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`NF #${data.numero_nf} - ${data.itens_encontrados} itens importados com sucesso`)
        setFile(null)
        setFreteNota('')
        loadNotas()
        loadEstoque()
      } else {
        setMessage(`Erro: ${data.error || 'Erro desconhecido'}`)
      }
    } catch (err) {
      setMessage(`Erro: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  // ===== PÁGINA INICIAL =====
  if (pagina === 'inicial') {
    return (
      <div className="app">
        <header className="header">
          <div className="container header-main-layout">
            <div className="header-copy">
              <h1 style={{ marginBottom: '0.35rem' }}>NVS TECH</h1>
            <p>Sistema de Gestão Inteligente de Estoque para Operações de Logística e Marketplace</p>
            </div>
            <div
              className="header-status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 0.9rem',
                borderRadius: '999px',
                border: `1px solid ${syncSaudavel ? '#8bd694' : '#f3b0b0'}`,
                background: syncSaudavel ? 'rgba(224, 255, 228, 0.12)' : 'rgba(255, 235, 235, 0.12)',
                color: syncSaudavel ? '#c8ffd0' : '#ffd2d2',
                fontSize: '0.78rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: syncSaudavel ? '#7CFC8A' : '#ff8a80',
                  display: 'inline-block'
                }}
              />
              {syncSaudavel ? 'Sincronizado' : 'Sincronizando'}
              <span style={{ opacity: 0.85, fontSize: '0.72rem' }}>{fmtHora(ultimaSincronizacao)}</span>
            </div>
          </div>
        </header>

        <main className="container main-content">
          {message && (
            <div className={`message ${message.includes('sucesso') ? 'success' : 'error'}`}>
              {message}
            </div>
          )}

          {/* ===== TELA ÚNICA: 2 colunas — Upload (esq.) | Notas (dir.) ===== */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: '1.5rem', alignItems: 'start' }}>

            {/* UPLOAD compacto */}
            <div className="card">
              <h2>Upload de Nota Fiscal</h2>
              <div className="card-body">
                <form onSubmit={handleUpload} style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{ flex: 1, minWidth: '260px', border: '2px dashed #cfd8dc', borderRadius: '8px', padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                  >
                    <span style={{ fontSize: '1.5rem' }}>⬆️</span>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1a1a1a' }}>{file ? file.name : 'Selecione um arquivo XML ou PDF'}</div>
                      <div style={{ fontSize: '0.8rem', color: '#90a4ae' }}>Clique para escolher</div>
                    </div>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".xml,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={loading} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <label style={{ fontSize: '0.72rem', color: '#90a4ae' }}>Frete (R$, opcional)</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={freteNota} onChange={(e) => setFreteNota(e.target.value)} disabled={loading}
                      style={{ width: '110px', padding: '0.6rem 0.75rem', border: '1px solid #cfd8dc', borderRadius: '8px', fontSize: '0.95rem' }} />
                  </div>
                  <button type="submit" disabled={!file || loading} className="upload-button" style={{ whiteSpace: 'nowrap' }}>
                    {loading ? 'Processando...' : 'Enviar NF-e'}
                  </button>
                </form>

                {/* Botão de Fornecedores e Embaldes */}
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <button
                    onClick={() => setPagina('fornecedores')}
                    translate="no"
                    className="notranslate"
                    aria-label="Fornecedores"
                    title="Fornecedores"
                    style={{
                      padding: '0.75rem 1rem',
                      background: '#fff',
                      color: '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#f5f5f5'
                      el.style.borderColor = '#999'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#fff'
                      el.style.borderColor = '#ddd'
                    }}
                  >
                    👥 Fornecedores
                  </button>
                  <button
                    onClick={() => setPagina('embaldes')}
                    style={{
                      padding: '0.75rem 1rem',
                      background: '#fff',
                      color: '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#f5f5f5'
                      el.style.borderColor = '#999'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#fff'
                      el.style.borderColor = '#ddd'
                    }}
                  >
                    Inbound
                  </button>
                  <button
                    onClick={() => setPagina('anuncios')}
                    style={{
                      padding: '0.75rem 1rem',
                      background: '#fff',
                      color: '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#f5f5f5'
                      el.style.borderColor = '#999'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = '#fff'
                      el.style.borderColor = '#ddd'
                    }}
                  >
                    🛒 Anúncios ML
                  </button>
                </div>
              </div>
            </div>

            {/* FILTRO + LISTA DE NOTAS */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ marginTop: 0 }}>Notas Fiscais ({notasFiltradas.length})</h2>

                {/* ===== DIAGNÓSTICO DE INBOUNDS ATIVOS (TEMPO REAL) ===== */}
                <div style={{
                  minWidth: '260px',
                  maxWidth: '380px',
                  marginTop: '0.35rem',
                  border: `2px solid ${inboundsAtivos.length > 0 ? '#d32f2f' : '#a5d6a7'}`,
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                  background: inboundsAtivos.length > 0 ? '#fff5f5' : '#f3faf3',
                  boxShadow: inboundsAtivos.length > 0 ? '0 10px 24px rgba(211, 47, 47, 0.08)' : '0 8px 18px rgba(46, 125, 50, 0.08)'
                }}>
                  {inboundsAtivos.length > 0 ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#d32f2f', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.04em', marginBottom: '0.55rem', textTransform: 'uppercase' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#d32f2f', display: 'inline-block', animation: 'pulse-inbound 1.2s infinite' }} />
                        {inboundsAtivos.length === 1 ? 'Inbound ativo' : `${inboundsAtivos.length} inbounds ativos`}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {inboundsAtivos.map((inb) => (
                          <div key={inb.numero_inbound} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: '#d32f2f', fontSize: '0.82rem', fontWeight: 700 }}>
                            <span>#{inb.numero_inbound}</span>
                            <span>encerra {fmtData(inb.data_limite)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ color: '#2e7d32', fontWeight: 800, fontSize: '0.85rem', textAlign: 'center', letterSpacing: '0.04em' }}>
                      ✓ SEM INBOUND ATIVO
                    </div>
                  )}
                </div>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={filtroBusca}
                    onChange={(e) => setFiltroBusca(e.target.value)}
                    placeholder="Buscar por nº da nota, fornecedor ou CNPJ..."
                    style={{ flex: 1, minWidth: '240px', padding: '0.7rem 0.9rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.9rem' }}
                  />
                  <input
                    type="date"
                    value={filtroData}
                    onChange={(e) => setFiltroData(e.target.value)}
                    title="Filtrar por data de emissão"
                    style={{ padding: '0.7rem 0.9rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.9rem' }}
                  />
                  {(filtroBusca || filtroData) && (
                    <button onClick={() => { setFiltroBusca(''); setFiltroData('') }} style={{ padding: '0.7rem 1rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Limpar</button>
                  )}
                </div>

                {notasSelecionadas.size > 0 && (
                  <div style={{ background: 'linear-gradient(90deg, #2196F3 0%, #1976D2 100%)', color: 'white', padding: '1rem 1.5rem', borderRadius: '4px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)' }}>
                    <span style={{ fontWeight: 600 }}>
                      {notasSelecionadas.size} selecionada{notasSelecionadas.size !== 1 ? 's' : ''}
                    </span>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button
                        onClick={() => baixarNotasSelecionadas('pdf')}
                        disabled={deletando || downloadandoPdf}
                        style={{ padding: '0.6rem 1.2rem', background: '#FF9800', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', opacity: downloadandoPdf ? 0.6 : 1 }}
                      >
                        {downloadandoPdf ? '...' : '📄 PDF'}
                      </button>
                      <button
                        onClick={() => baixarNotasSelecionadas('original')}
                        disabled={deletando || downloadandoPdf}
                        style={{ padding: '0.6rem 1.2rem', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        📥 Original
                      </button>
                      <button
                        onClick={excluirNotasSelecionadas}
                        disabled={deletando || downloadandoPdf}
                        style={{ padding: '0.6rem 1.2rem', background: '#f44336', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', opacity: deletando ? 0.6 : 1 }}
                      >
                        {deletando ? '...' : '🗑 Excluir'}
                      </button>
                    </div>
                  </div>
                )}

                {notasFiltradas.length === 0 ? (
                  <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>
                    {notas.length === 0 ? 'Nenhuma nota processada ainda. Faça o upload de uma NF-e acima.' : 'Nenhuma nota encontrada com esse filtro.'}
                  </p>
                ) : (
                  <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                    {/* Cabeçalho da lista */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.6rem 1.1rem', background: '#f7f9fa', borderBottom: '1px solid #e0e0e0', fontSize: '0.72rem', fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' }}>
                      <div style={{ width: '30px' }}>
                        <input
                          type="checkbox"
                          checked={notasSelecionadas.size === notasFiltradas.length && notasFiltradas.length > 0}
                          onChange={selecionarTodasNotas}
                          title="Selecionar/Desselecionar todas"
                          style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                        />
                      </div>
                      <div style={{ width: 130 }}>Status</div>
                      <div style={{ flex: 1 }}>Nota / Fornecedor</div>
                      <div style={{ width: 150, textAlign: 'right' }}>Emissão</div>
                      <div style={{ width: 200 }}>Progresso (Olist)</div>
                    </div>
                    {notasFiltradas.map((nota, idx) => {
                      const st = statusNota(nota)
                      const isSelected = notasSelecionadas.has(nota.id)
                      return (
                        <div
                          key={nota.id}
                          onClick={() => !isSelected && abrirDetalheNota(nota.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1.1rem', cursor: 'pointer', background: isSelected ? '#e3f2fd' : '#fff', borderTop: idx > 0 ? '1px solid #eef2f4' : 'none', transition: 'background .15s', borderLeft: isSelected ? '4px solid #2196F3' : 'none' }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f5f9ff' }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '#fff' }}
                        >
                          <div style={{ width: '30px', display: 'flex', justifyContent: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelecaoNota(nota.id)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                            />
                          </div>
                          <div style={{ width: 130 }}>
                            <span style={{ background: st.bg, color: st.cor, fontWeight: 700, fontSize: '0.68rem', padding: '0.25rem 0.55rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>{st.icone} {st.label}</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: '0.92rem' }}>NF #{nota.numero_nf}</div>
                            <div style={{ color: '#607d8b', fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {nota.fornecedor}{nota.cnpj ? ` · CNPJ ${nota.cnpj}` : ''} · {nota.itens?.length || 0} itens
                            </div>
                          </div>
                          <div style={{ width: 150, textAlign: 'right', color: '#90a4ae', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR') : 's/ data'}
                          </div>
                          <div style={{ width: 200 }}>
                            <BarraProgresso itens={nota.itens} compacto />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===== layout antigo (4 colunas) desativado ===== */}
          <div style={{ display: 'none' }}>
            {/* UPLOAD CARD */}
            <div className="card">
              <h2>Upload de Nota Fiscal</h2>
              <div className="card-body">
              <form onSubmit={handleUpload}>
                <div
                  className="upload-section"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="upload-icon">↑</div>
                  <h3>Selecione um arquivo</h3>
                  <p>XML ou PDF de NF-e</p>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    {file ? file.name : 'Clique ou arraste um arquivo'}
                  </p>
                </div>

                <div className="file-input-wrapper">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml,.pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    disabled={loading}
                    className="file-input"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!file || loading}
                  className="upload-button"
                >
                  {loading ? 'Processando...' : 'Enviar NF-e'}
                </button>
              </form>
              </div>
            </div>

            {/* COLUNA 2: NOTAS FISCAIS PROCESSADAS */}
            <div className="card">
              <h2>Notas Fiscais Processadas</h2>
              <div className="card-body">
              {notas.length === 0 ? (
                <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                  Nenhuma nota processada
                </p>
              ) : (
                <div className="notas-list">
                  {notas.map((nota) => (
                    <div
                      key={nota.id}
                      className="nota-item"
                      onClick={() => abrirNotaSelecionada(nota.id)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: notaSelecionada?.id === nota.id ? '#e3f2fd' : '#f9f9f9',
                        borderLeftColor: notaSelecionada?.id === nota.id ? '#0d47a1' : '#007acc',
                      }}
                    >
                      <div className="nota-number">NF #{nota.numero_nf}</div>
                      <div className="nota-info">
                        Fornecedor: <strong>{nota.fornecedor}</strong>
                      </div>
                      <div className="nota-info">
                        Série: <strong>{nota.serie}</strong>
                      </div>
                      <div className="nota-status">{nota.status.toUpperCase()}</div>
                      <BarraProgresso itens={nota.itens} compacto />
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>

            {/* COLUNA 3: ESTOQUE VIRTUAL - PRÉVIA */}
            <div className="card">
              <h2>Estoque Virtual - Prévia</h2>
              <div className="card-body">
              {!notaSelecionada ? (
                <p style={{ color: '#999', textAlign: 'center', padding: '2rem', fontSize: '0.95rem' }}>
                  Selecione uma nota fiscal para ver a prévia
                </p>
              ) : (
                <div>
                  {/* Informações da Nota */}
                  <div style={{ background: '#f9f9f9', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
                    <h3 style={{ color: '#1a1a1a', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: '600' }}>
                      {notaSelecionada.fornecedor}
                    </h3>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span style={{ color: '#666', fontSize: '0.9rem' }}>NF:</span>
                      <span style={{ color: '#1a1a1a', fontWeight: '600' }}>{notaSelecionada.numero_nf}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span style={{ color: '#666', fontSize: '0.9rem' }}>Série:</span>
                      <span style={{ color: '#1a1a1a', fontWeight: '600' }}>{notaSelecionada.serie}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span style={{ color: '#666', fontSize: '0.9rem' }}>Itens:</span>
                      <span style={{ color: '#1a1a1a', fontWeight: '600' }}>{notaSelecionada.itens?.length || 0}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid #e0e0e0' }}>
                      <span style={{ color: '#666', fontSize: '0.9rem', fontWeight: '600' }}>Valor Total:</span>
                      <span style={{ color: '#007acc', fontWeight: '700', fontSize: '1rem' }}>
                        R$ {(notaSelecionada.itens?.reduce((sum, item) => sum + (item.quantidade_nf * item.preco_unitario), 0) || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Lista de Produtos */}
                  <div style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                      Produtos ({notaSelecionada.itens?.length || 0})
                    </p>
                    {notaSelecionada.itens && notaSelecionada.itens.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {notaSelecionada.itens.map((item, idx) => (
                          <div key={idx} style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                            <div style={{ color: '#1a1a1a', fontWeight: '600', marginBottom: '0.25rem' }}>
                              {item.descricao}
                            </div>
                            <div style={{ color: '#666', fontSize: '0.8rem' }}>
                              {item.quantidade_nf.toFixed(0)} un × R$ {item.preco_unitario.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: '#999', fontSize: '0.85rem' }}>Nenhum produto</p>
                    )}
                  </div>

                  {/* Botões */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                      onClick={irParaConferenciaProdutos}
                      style={{
                        padding: '0.85rem',
                        background: '#007acc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        transition: 'all 0.3s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#005a96')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#007acc')}
                    >
                      Ir para Conferência
                    </button>

                    <button
                      onClick={() => setModalDetalhesNFAberto(true)}
                      style={{
                        padding: '0.85rem',
                        background: '#f0f0f0',
                        color: '#1a1a1a',
                        border: '1px solid #e0e0e0',
                        borderRadius: '4px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        transition: 'all 0.3s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                    >
                      Ver Detalhes
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>

            {/* COLUNA 4: DIVERGÊNCIAS REGISTRADAS */}
            <div className="card">
              <h2>Divergências Registradas</h2>
              <div className="card-body">
              {divergencias.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center', padding: '2rem', fontSize: '0.95rem' }}>
                  Nenhuma divergência registrada
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {divergencias.map((div) => {
                    let bgColor = '#e3f2fd'
                    let borderColor = '#2196F3'
                    let textColor = '#1565c0'

                    if (div.tipo_divergencia === 'a_menos') {
                      bgColor = '#ffebee'
                      borderColor = '#f44336'
                      textColor = '#c62828'
                    } else if (div.tipo_divergencia === 'a_mais') {
                      bgColor = '#fff3e0'
                      borderColor = '#ff9800'
                      textColor = '#e65100'
                    } else if (div.tipo_divergencia === 'nao_veio') {
                      bgColor = '#f3e5f5'
                      borderColor = '#9c27b0'
                      textColor = '#6a1b9a'
                    } else if (div.tipo_divergencia === 'produto_substituido') {
                      bgColor = '#f0f4c3'
                      borderColor = '#cddc39'
                      textColor = '#827717'
                    }

                    const handleResolver = async () => {
                      const res = await fetch(API_BASE + '/api/resolver-divergencia', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item_id: div.item_id })
                      })
                      if (res.ok) {
                        alert('✅ Divergência marcada como resolvida')
                        loadDivergencias()
                      } else {
                        alert('❌ Erro ao resolver')
                      }
                    }

                    const handleDeletar = async () => {
                      if (!window.confirm('Tem certeza que deseja deletar esta divergência?')) return
                      const res = await fetch(API_BASE + '/api/deletar-divergencia', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item_id: div.item_id })
                      })
                      if (res.ok) {
                        alert('✅ Divergência deletada')
                        loadDivergencias()
                      } else {
                        alert('❌ Erro ao deletar')
                      }
                    }

                    return (
                      <div
                        key={div.item_id}
                        style={{
                          background: bgColor,
                          border: `2px solid ${borderColor}`,
                          padding: '1rem',
                          borderRadius: '4px',
                          fontSize: '0.85rem'
                        }}
                      >
                        <div style={{ color: textColor, fontWeight: '700', marginBottom: '0.5rem' }}>
                          NF #{div.numero_nf} - {div.tipo_divergencia.toUpperCase().replace('_', ' ')}
                        </div>
                        <div style={{ color: '#1a1a1a', fontWeight: '600', marginBottom: '0.25rem' }}>
                          {div.produto}
                        </div>
                        <div style={{ color: '#666', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                          Código: {div.codigo}
                        </div>
                        <div style={{ color: '#666', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                          NF: {Math.round(div.quantidade_nf)} | Recebido: {Math.round(div.quantidade_confirmada)}
                        </div>
                        <div style={{ color: '#999', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                          {new Date(div.data_registro).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={handleResolver}
                            style={{
                              flex: 1,
                              padding: '0.4rem 0.5rem',
                              background: '#4caf50',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              cursor: 'pointer'
                            }}
                          >
                            ✓ Resolvida
                          </button>
                          <button
                            onClick={handleDeletar}
                            style={{
                              flex: 1,
                              padding: '0.4rem 0.5rem',
                              background: '#f44336',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              cursor: 'pointer'
                            }}
                          >
                            ✗ Deletar
                          </button>
                        </div>
                        {/* Botão para subir estoque do que realmente chegou */}
                        {div.tipo_divergencia !== 'nao_veio' && Math.round(div.quantidade_confirmada) > 0 && (
                          <button
                            onClick={() => {
                              setProdutoSelecionado({
                                id: div.item_id,
                                descricao: div.produto,
                                codigo_produto: div.codigo,
                                quantidade_nf: div.quantidade_confirmada,
                                preco_unitario: 0
                              } as any)
                              setProdutoOlistSelecionado({
                                id: '', sku: '', nome: '', preco: 0,
                                estoque: 0, estoque_saldo: 0, estoque_reservado: 0
                              })
                              setProdutoOlistSKU('')
                              setSugestoesSKU([])
                              setMostrarManual(false)
                              setPagina('relacionamento_produto')
                            }}
                            style={{
                              width: '100%',
                              marginTop: '0.5rem',
                              padding: '0.5rem',
                              background: '#007acc',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              fontSize: '0.78rem',
                              fontWeight: '700',
                              cursor: 'pointer'
                            }}
                          >
                            🔗 Vincular na Olist e Subir {Math.round(div.quantidade_confirmada)} un
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          </div>
          {/* SEÇÃO ESTOQUE COMPLETA */}
          {mostrarTodosEstoque && (
            <section className="estoque-hero">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Todos os Produtos ({estoque.length})</h2>
                <button
                  onClick={() => setMostrarTodosEstoque(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: '#f0f0f0',
                    border: '1px solid #e0e0e0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Voltar
                </button>
              </div>

              <div className="estoque-grid">
                {estoque.map((produto) => (
                  <div key={produto.id_item} className="product-card">
                    <div className="product-header">
                      <div className="product-name">
                        <h3>{produto.descricao}</h3>
                        <span className="product-code">SKU: {produto.codigo_produto}</span>
                      </div>
                      <div className="product-code-badge">
                        {produto.notas_fiscais.length} NF
                      </div>
                    </div>

                    <div className="product-stats">
                      <div className="stat-box">
                        <div className="stat-value">{produto.quantidade_total.toFixed(0)}</div>
                        <div className="stat-label">Qtd Total</div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-value">{produto.quantidade_confirmada.toFixed(0)}</div>
                        <div className="stat-label">Confirmada</div>
                      </div>
                    </div>

                    <div className="price-section">
                      <div className="price-label">Valor Total</div>
                      <div className="price-value">
                        R$ {(produto.quantidade_total * produto.preco_unitario).toFixed(2)}
                      </div>
                    </div>

                    <button
                      className="product-action"
                      onClick={() => abrirDetalhes(produto)}
                    >
                      Detalhes
                    </button>
                  </div>
                ))}
              </div>

              <div className="valor-total">
                Total: {estoque.length} produto{estoque.length !== 1 ? 's' : ''} | R$ {estoque.reduce((sum, p) => sum + (p.quantidade_total * p.preco_unitario), 0).toFixed(2)}
              </div>
            </section>
          )}

          {/* BOTÃO DISCRETO: memória de vínculos */}
          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <button
              onClick={abrirModalVinculos}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9e9e9e',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '0.5rem'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#007acc')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9e9e9e')}
            >
              ⚙ Vínculos salvos (de-para fornecedor → Olist)
            </button>
          </div>
        </main>

        {/* MODAL: VÍNCULOS SALVOS */}
        {modalVinculosAberto && (
          <div className="modal-overlay" onClick={() => setModalVinculosAberto(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', width: '90%' }}>
              <div className="modal-header">
                <h2>Vínculos Salvos (de-para fornecedor → Olist)</h2>
                <button className="modal-close" onClick={() => setModalVinculosAberto(false)}>×</button>
              </div>
              <div className="modal-body">
                <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  Cada linha é um "apelido" de fornecedor que aponta para um anúncio da Olist.
                  O mesmo anúncio pode ter vários apelidos (descrições/códigos diferentes).
                  Esses vínculos são sugeridos automaticamente em notas futuras.
                </p>
                {listaVinculos.length === 0 ? (
                  <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>
                    Nenhum vínculo salvo ainda. Eles são criados quando você vincula um produto à Olist.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55vh', overflowY: 'auto' }}>
                    {listaVinculos.map((v) => (
                      <div key={v.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr auto',
                        gap: '1rem',
                        alignItems: 'center',
                        background: '#f9f9f9',
                        border: '1px solid #e0e0e0',
                        borderRadius: '6px',
                        padding: '1rem'
                      }}>
                        <div>
                          <p style={{ color: '#999', fontSize: '0.7rem', fontWeight: 700, margin: 0 }}>FORNECEDOR (NF)</p>
                          <p style={{ color: '#1a1a1a', fontSize: '0.9rem', fontWeight: 600, margin: '0.15rem 0 0 0' }}>{v.nf_descricao}</p>
                          <p style={{ color: '#666', fontSize: '0.75rem', margin: 0 }}>Cód: {v.nf_codigo || '-'}</p>
                        </div>
                        <div>
                          <p style={{ color: '#999', fontSize: '0.7rem', fontWeight: 700, margin: 0 }}>ANÚNCIO OLIST</p>
                          <p style={{ color: '#007acc', fontSize: '0.9rem', fontWeight: 600, margin: '0.15rem 0 0 0' }}>{v.olist_nome}</p>
                          <p style={{ color: '#666', fontSize: '0.75rem', margin: 0 }}>SKU: {v.olist_sku} · usado {v.vezes_usado}x</p>
                        </div>
                        <button
                          onClick={() => deletarVinculo(v.id)}
                          style={{
                            padding: '0.5rem 0.75rem', background: '#f44336', color: 'white',
                            border: 'none', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                          }}
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {produtoSelecionado && (
          <ModalDetalhes
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            produto={produtoSelecionado}
            onConfirm={() => {
              setModalOpen(false)
              loadEstoque()
            }}
          />
        )}

        {notaSelecionada && (
          <ModalDetalhesNotaFiscal
            isOpen={modalDetalhesNFAberto}
            onClose={() => setModalDetalhesNFAberto(false)}
            nota={notaSelecionada}
          />
        )}

        {/* ===== MODAL DETALHE DA NOTA COM ABAS ===== */}
        {notaDetalheAberta && (() => {
          const nota = notaDetalheAberta
          const st = statusNota(nota)
          const divs = divergenciasDaNota(nota)
          const totalValor = (nota.itens || []).reduce((s, i) => s + i.quantidade_nf * i.preco_unitario, 0)
          const TabBtn = ({ id, label, badge }: { id: 'detalhes' | 'conferencia' | 'divergencias', label: string, badge?: number }) => (
            <button onClick={() => setAbaDetalhe(id)} style={{
              padding: '0.8rem 1.4rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
              background: abaDetalhe === id ? '#fff' : 'transparent',
              color: abaDetalhe === id ? '#007acc' : '#607d8b',
              borderBottom: abaDetalhe === id ? '3px solid #007acc' : '3px solid transparent'
            }}>
              {label}{badge ? <span style={{ marginLeft: 6, background: '#f44336', color: '#fff', borderRadius: 999, padding: '0 7px', fontSize: '0.7rem' }}>{badge}</span> : null}
            </button>
          )
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setNotaDetalheAberta(null)}>
              <div style={{ background: '#fff', borderRadius: 8, width: '95vw', maxWidth: 1200, height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                {/* HEADER */}
                <div style={{ borderBottom: '1px solid #e0e0e0', padding: '1.25rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.4rem' }}>NOTA FISCAL ELETRÔNICA</h2>
                    <p style={{ margin: '0.3rem 0 0', color: '#666', fontSize: '0.9rem' }}>NF #{nota.numero_nf} · Série {nota.serie}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ background: st.bg, color: st.cor, fontWeight: 700, fontSize: '0.8rem', padding: '0.35rem 0.8rem', borderRadius: 999 }}>{st.icone} {st.label}</span>
                    <button onClick={() => setNotaDetalheAberta(null)} style={{ background: 'none', border: 'none', fontSize: '2rem', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                </div>

                {/* ABAS */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', background: '#f7f9fa', paddingLeft: '1rem' }}>
                  <TabBtn id="detalhes" label="📄 Detalhes" />
                  <TabBtn id="conferencia" label="✅ Conferência" />
                  <TabBtn id="divergencias" label="⚠️ Divergências" badge={divs.length} />
                </div>

                {/* CONTEÚDO */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>

                  {/* ABA DETALHES */}
                  {abaDetalhe === 'detalhes' && (
                    <div>
                      <div style={{ background: '#f9f9f9', border: '2px solid #007acc', padding: '1.5rem', borderRadius: 8, marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div>
                          <p style={{ color: '#007acc', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>Fornecedor</p>
                          <h3 style={{ margin: '0.25rem 0 0.75rem', color: '#1a1a1a' }}>{nota.fornecedor}</h3>
                          <p style={{ color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }}>CNPJ</p>
                          <p style={{ color: '#1a1a1a', margin: '0 0 0.5rem' }}>{nota.cnpj || 'N/A'}</p>
                          <p style={{ color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }}>ENDEREÇO</p>
                          <p style={{ color: '#1a1a1a', margin: 0 }}>{nota.endereco || 'N/A'}</p>
                        </div>
                        <div>
                          <p style={{ color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }}>DATA DE EMISSÃO</p>
                          <p style={{ color: '#1a1a1a', fontWeight: 600, margin: '0.25rem 0 0.75rem' }}>{nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'}</p>
                          <p style={{ color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }}>QUANTIDADE DE ITENS</p>
                          <p style={{ color: '#1a1a1a', fontWeight: 700, fontSize: '1.2rem', margin: '0.25rem 0' }}>{nota.itens?.length || 0}</p>
                        </div>
                      </div>
                      <h3 style={{ marginBottom: '0.75rem' }}>Produtos</h3>
                      <div style={{ border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ background: '#007acc', color: '#fff', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '1rem', padding: '0.8rem 1rem', fontWeight: 600, fontSize: '0.85rem' }}>
                          <div>PRODUTO</div><div style={{ textAlign: 'center' }}>QTD</div><div style={{ textAlign: 'center' }}>VALOR UN.</div><div style={{ textAlign: 'center' }}>SUBTOTAL</div><div style={{ textAlign: 'right' }}>CÓDIGO</div>
                        </div>
                        {(nota.itens || []).map((item, idx) => (
                          <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '1rem', padding: '0.8rem 1rem', borderTop: idx > 0 ? '1px solid #eee' : 'none', background: idx % 2 ? '#f9f9f9' : '#fff', fontSize: '0.85rem' }}>
                            <div style={{ color: '#1a1a1a' }}>{item.descricao}</div>
                            <div style={{ textAlign: 'center', fontWeight: 600 }}>{Math.round(item.quantidade_nf)}</div>
                            <div style={{ textAlign: 'center' }}>R$ {item.preco_unitario.toFixed(2)}</div>
                            <div style={{ textAlign: 'center', color: '#007acc', fontWeight: 600 }}>R$ {(item.quantidade_nf * item.preco_unitario).toFixed(2)}</div>
                            <div style={{ textAlign: 'right', color: '#666' }}>{item.codigo_produto}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: '#f5f5f5', border: '2px solid #007acc', padding: '1rem 1.5rem', borderRadius: 6, textAlign: 'right', marginTop: '1.5rem' }}>
                        <span style={{ color: '#999', fontSize: '0.85rem' }}>VALOR TOTAL DA NOTA </span>
                        <span style={{ color: '#007acc', fontSize: '1.6rem', fontWeight: 700 }}>R$ {totalValor.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {/* ABA CONFERÊNCIA */}
                  {abaDetalhe === 'conferencia' && (
                    <div>
                      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                        <BarraProgresso itens={nota.itens} />
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <button onClick={() => setModalAdicionarProdutoAberto(true)} style={{ padding: '0.6rem 1.1rem', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>+ Adicionar Produto Manual</button>
                      </div>

                      {/* Produtos agrupados por descrição */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {agruparItensPorDescricao(nota.itens || []).map((grupo) => {
                          const temSelecionados = grupo.selecionados.length > 0
                          const multi = grupo.items.length > 1
                          // Grupo de 1 registro sempre aberto; multi-registro só se expandido
                          const expandido = !multi || gruposExpandidos.has(grupo.descricao)
                          // Resumo de status para mostrar no cabeçalho (sem precisar abrir)
                          const qSubidos = grupo.items.filter(i => i.estoque_olist_atualizado_em).length
                          const qConf = grupo.items.filter(i => (i.quantidade_confirmada !== null && i.quantidade_confirmada !== undefined) && !i.estoque_olist_atualizado_em).length
                          const qFalta = grupo.items.length - qSubidos - qConf
                          const toggleExpandir = () => {
                            const novo = new Set(gruposExpandidos)
                            if (novo.has(grupo.descricao)) novo.delete(grupo.descricao)
                            else novo.add(grupo.descricao)
                            setGruposExpandidos(novo)
                          }
                          return (
                            <div key={grupo.descricao} style={{ border: temSelecionados ? '2px solid #2196F3' : '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', background: temSelecionados ? '#e3f2fd' : '#fff' }}>
                              {/* Header do grupo */}
                              <div style={{ background: temSelecionados ? '#bbdefb' : '#f5f5f5', padding: '1rem 1.25rem', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                <div
                                  style={{ flex: 1, minWidth: '250px', display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: multi ? 'pointer' : 'default' }}
                                  onClick={multi ? toggleExpandir : undefined}
                                >
                                  {multi && (
                                    <span
                                      style={{ fontSize: '0.9rem', color: '#555', transition: 'transform 0.15s', transform: expandido ? 'rotate(90deg)' : 'rotate(0deg)', userSelect: 'none' }}
                                      aria-label={expandido ? 'Recolher' : 'Expandir'}
                                    >▶</span>
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: '1rem' }}>{grupo.descricao}</div>
                                    <div style={{ color: '#666', fontSize: '0.85rem' }}>
                                      {grupo.items.length} registro{grupo.items.length !== 1 ? 's' : ''} · Total: {Math.round(grupo.totalQtd)} un
                                      {grupo.selecionados.length > 0 && <span style={{ color: '#2196F3', fontWeight: 700, marginLeft: '0.5rem' }}>· {grupo.selecionados.length} selecionado{grupo.selecionados.length !== 1 ? 's' : ''}</span>}
                                    </div>
                                    {multi && (
                                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                        {qSubidos > 0 && <span style={{ background: '#e8f5e9', color: '#2e7d32', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }}>✅ {qSubidos} subido{qSubidos !== 1 ? 's' : ''}</span>}
                                        {qConf > 0 && <span style={{ background: '#e3f2fd', color: '#1565c0', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }}>🔄 {qConf} conferido{qConf !== 1 ? 's' : ''}</span>}
                                        {qFalta > 0 && <span style={{ background: '#fff3e0', color: '#e65100', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }}>🆕 {qFalta} a conferir</span>}
                                        <span style={{ color: '#2196F3', fontSize: '0.68rem', fontWeight: 700 }}>{expandido ? '· clique para recolher' : '· clique para ver todos'}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {grupo.items.length > 1 && grupo.selecionados.length > 0 && (
                                    <button
                                      onClick={() => {
                                        if (!notaDetalheAberta) return
                                        const primeiroItem = grupo.selecionados[0]
                                        const qtdTotal = grupo.selecionados.reduce((s, i) => s + i.quantidade_nf, 0)
                                        const msg = `Confirmar envio em massa?\n\nProduto: ${grupo.descricao}\nQuantidade de registros: ${grupo.selecionados.length}\nQuantidade total: ${Math.round(qtdTotal)} unidades\n\nOs registros serão agrupados e enviados como uma única entrada para a Olist.`
                                        if (!window.confirm(msg)) return

                                        setProdutoSelecionado({
                                          id_item: primeiroItem.id,
                                          // IDs de TODOS os registros do grupo (subida em massa)
                                          // para marcar todos como subidos, nao so o primeiro
                                          ids_massa: grupo.selecionados.map(i => i.id),
                                          descricao: grupo.descricao,
                                          codigo_produto: primeiroItem.codigo_produto,
                                          quantidade_total: qtdTotal,
                                          quantidade_nf: qtdTotal,
                                          quantidade_confirmada: qtdTotal,
                                          preco_unitario: primeiroItem.preco_unitario,
                                          notas_fiscais: grupo.selecionados.map(i => ({
                                            numero_nf: notaDetalheAberta.numero_nf || '',
                                            serie: notaDetalheAberta.serie || '',
                                            fornecedor: notaDetalheAberta.fornecedor || '',
                                            quantidade: i.quantidade_nf
                                          }))
                                        } as any)
                                        setItensSelecionadosMultiplos(new Set())
                                        setModalOpen(true)
                                      }}
                                      style={{ padding: '0.4rem 0.8rem', background: '#2196F3', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                    >
                                      📦 {grupo.selecionados.length} em Massa
                                    </button>
                                  )}
                                  {grupo.items.length > 1 && (
                                    <button
                                      onClick={() => {
                                        const novo = new Set(itensSelecionadosMultiplos)
                                        const todosSelecionados = grupo.items.every(i => novo.has(i.id))
                                        grupo.items.forEach(i => {
                                          if (todosSelecionados) novo.delete(i.id)
                                          else novo.add(i.id)
                                        })
                                        setItensSelecionadosMultiplos(novo)
                                      }}
                                      style={{ padding: '0.4rem 0.8rem', background: temSelecionados ? '#1976D2' : '#e0e0e0', color: temSelecionados ? '#fff' : '#666', border: 'none', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                    >
                                      {grupo.items.every(i => itensSelecionadosMultiplos.has(i.id)) ? '✓ Desselecionar' : '☐ Selecionar'}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Items do grupo (so quando expandido) */}
                              {expandido && (
                              <div>
                                {grupo.items.map((item, idx) => {
                                  const subido = !!item.estoque_olist_atualizado_em
                                  const conferido = item.quantidade_confirmada !== null && item.quantidade_confirmada !== undefined
                                  const selecionado = itensSelecionadosMultiplos.has(item.id)
                                  return (
                                    <div
                                      key={item.id}
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: grupo.items.length > 1 ? '30px 1fr auto' : '1fr auto',
                                        gap: '1rem',
                                        alignItems: 'center',
                                        padding: '1rem 1.25rem',
                                        borderTop: idx > 0 ? '1px solid #eee' : 'none',
                                        background: selecionado ? '#e3f2fd' : idx % 2 === 0 ? '#fff' : '#fafafa'
                                      }}
                                    >
                                      {/* Checkbox */}
                                      {grupo.items.length > 1 && (
                                        <input
                                          type="checkbox"
                                          checked={selecionado}
                                          onChange={() => toggleSelecaoMultipla(item.id)}
                                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                        />
                                      )}

                                      {/* Info */}
                                      <div>
                                        <div style={{ fontWeight: 600, color: '#1a1a1a' }}>
                                          {grupo.items.length > 1 && <span style={{ color: '#999', marginRight: '0.5rem' }}>({grupo.items.indexOf(item) + 1})</span>}
                                          {Math.round(item.quantidade_nf)} un
                                        </div>
                                        <div style={{ color: '#90a4ae', fontSize: '0.8rem' }}>
                                          Cód: {item.codigo_produto}{conferido ? ` · Recebido: ${Math.round(item.quantidade_confirmada as number)}` : ''}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                          {subido
                                            ? <span style={{ background: '#e8f5e9', color: '#2e7d32', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }}>✅ Subido na Olist</span>
                                            : conferido
                                              ? <span style={{ background: '#e3f2fd', color: '#1565c0', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }}>🔄 Conferido</span>
                                              : <span style={{ background: '#fff3e0', color: '#e65100', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }}>🆕 A conferir</span>}
                                        </div>
                                      </div>

                                      {/* Botão Conferir */}
                                      <button
                                        onClick={() => conferirProduto(item)}
                                        style={{ padding: '0.6rem 1rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                                      >
                                        Conferir
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* ABA DIVERGÊNCIAS */}
                  {abaDetalhe === 'divergencias' && (
                    <div>
                      {divs.length === 0 ? (
                        <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Nenhuma divergência registrada nesta nota.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {divs.map((div) => (
                            <div key={div.item_id} style={{ border: '2px solid #f44336', background: '#ffebee', borderRadius: 8, padding: '1rem 1.25rem' }}>
                              <div style={{ color: '#c62828', fontWeight: 700, marginBottom: 4 }}>{div.tipo_divergencia.toUpperCase().replace('_', ' ')}</div>
                              <div style={{ fontWeight: 600, color: '#1a1a1a' }}>{div.produto}</div>
                              <div style={{ color: '#666', fontSize: '0.8rem', marginBottom: '0.75rem' }}>Cód: {div.codigo} · NF: {Math.round(div.quantidade_nf)} · Recebido: {Math.round(div.quantidade_confirmada)}</div>
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button onClick={() => resolverDivergenciaItem(div.item_id)} style={{ padding: '0.4rem 0.8rem', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>✓ Resolvida</button>
                                <button onClick={() => deletarDivergenciaItem(div.item_id)} style={{ padding: '0.4rem 0.8rem', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>✗ Deletar</button>
                                {div.tipo_divergencia !== 'nao_veio' && Math.round(div.quantidade_confirmada) > 0 && (
                                  <button onClick={() => vincularDivergenciaOlist(div)} style={{ padding: '0.4rem 0.8rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>🔗 Vincular na Olist e Subir {Math.round(div.quantidade_confirmada)} un</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* FOOTER */}
                <div style={{ borderTop: '1px solid #e0e0e0', padding: '1rem 2rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setNotaDetalheAberta(null)} style={{ padding: '0.7rem 1.5rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Modal de conferência de produto (aberto pela aba Conferência) */}
        {produtoSelecionado && notaDetalheAberta && (
          <ModalDetalhesNota
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            produto={produtoSelecionado as any}
            notaNota={notaDetalheAberta}
            onNaoConfirmado={(qtd) => irParaOlistSubirEstoque(qtd)}
            onDivergenciaConfirmada={(qtd) => irParaOlistSubirEstoque(qtd)}
          />
        )}

        {/* Modal adicionar produto manual (aba Conferência) */}
        {modalAdicionarProdutoAberto && notaDetalheAberta && (
          <div className="modal-overlay" onClick={() => setModalAdicionarProdutoAberto(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Adicionar Produto Manual</h2>
                <button className="modal-close" onClick={() => setModalAdicionarProdutoAberto(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Código do Produto</label>
                  <input type="text" className="form-input" value={novoProduto.codigo} onChange={(e) => setNovoProduto({ ...novoProduto, codigo: e.target.value })} placeholder="Ex: 001234" />
                </div>
                <div className="form-group">
                  <label className="form-label">Descrição do Produto</label>
                  <input type="text" className="form-input" value={novoProduto.descricao} onChange={(e) => setNovoProduto({ ...novoProduto, descricao: e.target.value })} placeholder="Ex: Produto XYZ" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Quantidade</label>
                    <input type="text" className="form-input" value={novoProduto.quantidade} onChange={(e) => { const v = e.target.value; if (v === '' || !isNaN(parseFloat(v))) setNovoProduto({ ...novoProduto, quantidade: parseFloat(v) || 0 }) }} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Preço Unitário (R$)</label>
                    <input type="text" className="form-input" value={novoProduto.preco} onChange={(e) => { const v = e.target.value; if (v === '' || !isNaN(parseFloat(v))) setNovoProduto({ ...novoProduto, preco: parseFloat(v) || 0 }) }} placeholder="0.00" />
                  </div>
                </div>
                <div className="button-group">
                  <button className="btn btn-secondary" onClick={() => setModalAdicionarProdutoAberto(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleAdicionarProduto}>Adicionar Produto</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ===== PÁGINA DE PRODUTOS DA NOTA =====
  if (pagina === 'produtos_nota' && notaSelecionada && produtosNota.length > 0) {
    return (
      <div className="app">
        <header className="header">
          <div className="container">
            <h1>CONFERÊNCIA DE PRODUTOS</h1>
            <p>NF #{notaSelecionada.numero_nf} - {notaSelecionada.fornecedor}</p>
          </div>
        </header>

        <main className="container main-content">
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <button
              onClick={() => setPagina('inicial')}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#f0f0f0',
                border: '1px solid #e0e0e0',
                color: '#1a1a1a',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600',
                transition: 'all 0.3s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f0f0')}
            >
              ← Voltar para Nota
            </button>

            <button
              onClick={() => setModalAdicionarProdutoAberto(true)}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#4caf50',
                border: 'none',
                color: 'white',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600',
                transition: 'all 0.3s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#45a049')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#4caf50')}
            >
              + Adicionar Produto Manual
            </button>
          </div>

          {/* BARRA DE PROGRESSO DA CONFERÊNCIA */}
          <div style={{
            background: 'white',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#1a1a1a' }}>
              Progresso - Estoque Subido na Olist
            </h3>
            <BarraProgresso itens={produtosNota} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {produtosNota.map((item) => (
              <div
                key={item.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  display: 'grid',
                  gridTemplateColumns: '1fr 180px',
                  gap: '2rem',
                  alignItems: 'flex-start',
                  transition: 'all 0.3s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#d0d0d0'
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e0e0e0'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                {/* Informações do Produto */}
                <div>
                  <h3 style={{ color: '#1a1a1a', marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: '600' }}>
                    {item.descricao}
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1rem' }}>
                    <div>
                      <p style={{ color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                        CÓDIGO DO PRODUTO
                      </p>
                      <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '500' }}>
                        {item.codigo_produto}
                      </p>
                    </div>
                    <div>
                      <p style={{ color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                        QUANTIDADE ESPERADA
                      </p>
                      <p style={{ color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700' }}>
                        {Math.round(item.quantidade_nf)} un
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div>
                      <p style={{ color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                        VALOR UNITÁRIO
                      </p>
                      <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>
                        R$ {item.preco_unitario.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p style={{ color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                        VALOR TOTAL
                      </p>
                      <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>
                        R$ {(item.quantidade_nf * item.preco_unitario).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Botões de Ação */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button
                    onClick={() => {
                      const produtoEstoque: ProdutoEstoque = {
                        id_item: item.id,
                        descricao: item.descricao,
                        codigo_produto: item.codigo_produto,
                        quantidade_total: item.quantidade_nf,
                        quantidade_nf: item.quantidade_nf,
                        quantidade_confirmada: item.quantidade_confirmada || item.quantidade_nf,
                        preco_unitario: item.preco_unitario,
                        notas_fiscais: [{
                          numero_nf: notaSelecionada.numero_nf || '',
                          serie: notaSelecionada.serie || '',
                          fornecedor: notaSelecionada.fornecedor || '',
                          quantidade: item.quantidade_nf
                        }]
                      }
                      setProdutoSelecionado(produtoEstoque)
                      setModalOpen(true)
                    }}
                    style={{
                      padding: '0.75rem 1rem',
                      background: '#007acc',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      fontSize: '0.9rem'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#005a96')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#007acc')}
                  >
                    Conferência
                  </button>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem',
                    background: '#f9f9f9',
                    borderRadius: '6px',
                    border: '1px solid #e0e0e0'
                  }}>
                    <input
                      type="checkbox"
                      id={`produto-nao-veio-${item.id}`}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const produtoEstoque: ProdutoEstoque = {
                            id_item: item.id,
                            descricao: item.descricao,
                            codigo_produto: item.codigo_produto,
                            quantidade_total: item.quantidade_nf,
                            quantidade_confirmada: 0,
                            preco_unitario: item.preco_unitario,
                            notas_fiscais: [{
                              numero_nf: notaSelecionada.numero_nf || '',
                              serie: notaSelecionada.serie || '',
                              fornecedor: notaSelecionada.fornecedor || '',
                              quantidade: item.quantidade_nf
                            }]
                          }
                          setProdutoSelecionado(produtoEstoque)
                          setModalOpen(true)
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer'
                      }}
                    />
                    <label htmlFor={`produto-nao-veio-${item.id}`} style={{
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: '#666',
                      fontWeight: '500',
                      margin: 0
                    }}>
                      Não veio
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>

        {produtoSelecionado && (
          <ModalDetalhesNota
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            produto={produtoSelecionado}
            notaNota={notaSelecionada}
            onNaoConfirmado={(qtd) => irParaOlistSubirEstoque(qtd)}
            onDivergenciaConfirmada={(qtd) => irParaOlistSubirEstoque(qtd)}
          />
        )}

        {/* MODAL ADICIONAR PRODUTO MANUALMENTE */}
        {modalAdicionarProdutoAberto && (
          <div className="modal-overlay" onClick={() => setModalAdicionarProdutoAberto(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Adicionar Produto Manual</h2>
                <button className="modal-close" onClick={() => setModalAdicionarProdutoAberto(false)}>
                  ×
                </button>
              </div>

              <div className="modal-body">
                <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                  Use este formulário para adicionar produtos que chegaram mas não foram informados na nota fiscal.
                </p>

                <div className="form-group">
                  <label className="form-label">Código do Produto</label>
                  <input
                    type="text"
                    className="form-input"
                    value={novoProduto.codigo}
                    onChange={(e) => setNovoProduto({ ...novoProduto, codigo: e.target.value })}
                    placeholder="Ex: 001234"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Descrição do Produto</label>
                  <input
                    type="text"
                    className="form-input"
                    value={novoProduto.descricao}
                    onChange={(e) => setNovoProduto({ ...novoProduto, descricao: e.target.value })}
                    placeholder="Ex: Produto XYZ"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Quantidade</label>
                    <input
                      type="text"
                      className="form-input"
                      value={novoProduto.quantidade}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '' || !isNaN(parseFloat(val))) {
                          setNovoProduto({ ...novoProduto, quantidade: parseFloat(val) || 0 })
                        }
                      }}
                      placeholder="0"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Preço Unitário (R$)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={novoProduto.preco}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '' || !isNaN(parseFloat(val))) {
                          setNovoProduto({ ...novoProduto, preco: parseFloat(val) || 0 })
                        }
                      }}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="button-group">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setModalAdicionarProdutoAberto(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleAdicionarProduto}
                  >
                    Adicionar Produto
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ===== PÁGINA DE FORNECEDORES =====
  if (pagina === 'fornecedores') {
    return (
      <FornecedoresManager
        onVoltar={voltarParaInicial}
      />
    )
  }

  // ===== PÁGINA DE ANÚNCIOS (MERCADO LIVRE) =====
  if (pagina === 'anuncios') {
    return <AnunciosML onVoltar={voltarParaInicial} />
  }

  // ===== PÁGINA DE CONFERÊNCIA =====
  if (pagina === 'conferencia' && notaSelecionada) {
    const totalNota = notaSelecionada.itens?.reduce(
      (sum, item) => sum + item.quantidade_nf * item.preco_unitario,
      0
    ) || 0

    return (
      <div className="app">
        <header className="header">
          <div className="container">
            <h1>CONFERÊNCIA DE NOTA FISCAL</h1>
            <p>Verifique e confirme os itens recebidos</p>
          </div>
        </header>

        <main className="container main-content">
          <button
            onClick={voltarParaInicial}
            style={{
              marginBottom: '2rem',
              padding: '0.75rem 1.5rem',
              background: '#f0f0f0',
              border: '1px solid #e0e0e0',
              color: '#1a1a1a',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f0f0')}
          >
            ← Voltar para notas
          </button>

          {/* CARD INFORMAÇÕES DA NOTA */}
          <div className="card" style={{ marginBottom: '2rem' }}>
            <h2>Informações da Nota Fiscal</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>FORNECEDOR</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>{notaSelecionada.fornecedor}</p>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>NÚMERO DA NF</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>NF #{notaSelecionada.numero_nf}</p>
                </div>
                <div>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>SÉRIE</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>{notaSelecionada.serie}</p>
                </div>
              </div>
              <div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>DATA DE EMISSÃO</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>
                    {notaSelecionada.data_emissao
                      ? new Date(notaSelecionada.data_emissao).toLocaleDateString('pt-BR')
                      : '-'}
                  </p>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>TOTAL DA NOTA</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '700' }}>R$ {totalNota.toFixed(2)}</p>
                </div>
                <div>
                  <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }}>QUANTIDADE DE ITENS</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>
                    {notaSelecionada.itens?.length || 0} item{notaSelecionada.itens?.length !== 1 ? 'ns' : ''}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* TABELA DE ITENS */}
          <div className="card">
            <h2>Itens da Nota Fiscal</h2>
            {notaSelecionada.itens && notaSelecionada.itens.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#1a1a1a', fontWeight: '600' }}>Descrição</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }}>Código</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }}>Quantidade</th>
                      <th style={{ padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }}>Preço Unit.</th>
                      <th style={{ padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }}>Subtotal</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notaSelecionada.itens.map((item, idx) => (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid #e0e0e0',
                          backgroundColor: idx % 2 === 0 ? '#f9f9f9' : '#fff'
                        }}
                      >
                        <td style={{ padding: '1rem', color: '#1a1a1a' }}>{item.descricao}</td>
                        <td style={{ padding: '1rem', textAlign: 'center', color: '#666' }}>{item.codigo_produto}</td>
                        <td style={{ padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }}>
                          {Math.round(item.quantidade_nf)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#666' }}>
                          R$ {item.preco_unitario.toFixed(2)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }}>
                          R$ {(item.quantidade_nf * item.preco_unitario).toFixed(2)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button
                            style={{
                              padding: '0.5rem 1rem',
                              background: '#007acc',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              fontWeight: '600'
                            }}
                          >
                            Confirmar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>Nenhum item nesta nota</p>
            )}
          </div>
        </main>
      </div>
    )
  }

  // ===== PÁGINA DE RELACIONAMENTO DE PRODUTO =====
  if (pagina === 'relacionamento_produto') {
    // Usar o produto que foi clicado para conferência (produtoSelecionado)
    const produtoAtual = produtoSelecionado

    return (
      <div className="app">
        <header className="header">
          <div className="container">
            <h1>INTEGRAÇÃO OLIST</h1>
            <p>Vincular produto do estoque ao anúncio da Olist</p>
          </div>
        </header>

        <main className="container main-content">
          <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h2>Vincular ao Anúncio Olist</h2>

            {/* PRODUTO ATUAL DA NOTA */}
            {produtoAtual && (
              <div style={{ background: '#f0f9ff', border: '2px solid #007acc', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
                <h3 style={{ color: '#007acc', marginTop: 0 }}>Produto da Nota Fiscal</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '2rem' }}>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      PRODUTO
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700', margin: 0 }}>
                      {produtoAtual.descricao}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      CÓDIGO
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '600', margin: 0 }}>
                      {produtoAtual.codigo_produto}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      QUANTIDADE
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '600', margin: 0 }}>
                      {Math.round(produtoAtual.quantidade_nf)} un
                    </p>
                  </div>
                </div>
              </div>
            )}


            {/* SUGESTÃO AUTOMÁTICA (memória de vínculos) */}
            {sugestaoVinculo && !sugestaoDispensada && !produtoOlistSelecionado.sku && !kitDetectado && (
              <div style={{
                background: '#fff8e1',
                border: '2px solid #ffb300',
                padding: '1.25rem 1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>💡</span>
                  <strong style={{ color: '#e65100' }}>Esse produto já foi vinculado antes!</strong>
                </div>
                <p style={{ color: '#5d4037', fontSize: '0.9rem', margin: '0 0 0.25rem 0' }}>
                  Anúncio Olist: <strong>{sugestaoVinculo.olist_nome}</strong>
                </p>
                <p style={{ color: '#8d6e63', fontSize: '0.8rem', margin: '0 0 1rem 0' }}>
                  SKU {sugestaoVinculo.olist_sku} · usado {sugestaoVinculo.vezes_usado}x · confirme se é o mesmo produto
                </p>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={usarSugestao}
                    style={{
                      padding: '0.6rem 1.25rem', background: '#2e7d32', color: 'white',
                      border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem'
                    }}
                  >
                    ✓ Sim, é esse anúncio
                  </button>
                  <button
                    onClick={() => setSugestaoDispensada(true)}
                    style={{
                      padding: '0.6rem 1.25rem', background: '#f0f0f0', color: '#1a1a1a',
                      border: '1px solid #ddd', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                    }}
                  >
                    Não, buscar outro
                  </button>
                </div>
              </div>
            )}

            {/* KIT DETECTADO - Opções de ação */}
            {kitDetectado && componentesKit.length > 0 && (
              <div style={{
                background: '#e8f5e9',
                border: '3px solid #4caf50',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <h3 style={{ color: '#2e7d32', marginTop: 0 }}>🎁 Kit Detectado!</h3>
                <p style={{ color: '#1b5e20', fontSize: '0.95rem', margin: '0 0 1rem' }}>
                  <strong>{kitDetectado.nome_kit}</strong> ({componentesKit.length} componentes)
                </p>

                <div style={{
                  background: '#f1f8e9',
                  padding: '1rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#558b2f'
                }}>
                  <p style={{ margin: '0 0 0.5rem' }}>Componentes que serão atualizados:</p>
                  <ul style={{ margin: '0', paddingLeft: '1.25rem' }}>
                    {componentesKit.map((comp) => (
                      <li key={comp.sku} style={{ margin: '0.25rem 0' }}>
                        <strong>{comp.sku}</strong> - {comp.olist_nome}
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() => handleVincularKit(kitDetectado, componentesKit)}
                    style={{
                      padding: '0.7rem 1.5rem',
                      background: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.9rem'
                    }}
                  >
                    ✓ Vincular Kit e Atualizar Estoque
                  </button>
                  <button
                    onClick={() => {
                      setKitDetectado(null)
                      setComponentesKit([])
                      setProdutoOlistSKU('')
                    }}
                    style={{
                      padding: '0.7rem 1.5rem',
                      background: '#f0f0f0',
                      color: '#1a1a1a',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.9rem'
                    }}
                  >
                    ← Buscar outro
                  </button>
                </div>
              </div>
            )}

            {/* BUSCA DE SKU OLIST */}
            <div className="form-group" style={{ position: 'relative' }}>
              <label className="form-label">Buscar Anúncio Olist (por SKU ou Nome) - <span style={{color: '#999', fontSize: '0.85rem'}}>opcional</span></label>
              <input
                type="text"
                className="form-input"
                value={produtoOlistSKU}
                onChange={(e) => handleBuscarSKU(e.target.value)}
                placeholder="Digite SKU ou nome do produto (mínimo 2 caracteres)... ou pule para preencher manualmente"
                style={{
                  padding: '0.75rem',
                  border: produtoOlistSKU.length > 0 ? '2px solid #007acc' : '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '0.95rem',
                  transition: 'all 0.2s',
                  opacity: 0.7
                }}
              />

              {/* SUGESTÕES DE SKU - COM FEEDBACK */}
              {produtoOlistSKU.length > 0 && sugestoesSKU.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'white',
                  border: '1px solid #ddd',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  zIndex: 10,
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {sugestoesSKU.map((sugestao) => (
                    <div
                      key={sugestao.sku}
                      onClick={() => handleSelecionarSKU(sugestao)}
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid #f0f0f0',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        background: 'white'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f9f9f9')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                    >
                      <div style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600' }}>
                        SKU: {sugestao.sku}
                      </div>
                      <div style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '500' }}>
                        {sugestao.nome}
                      </div>
                      <div style={{ color: '#007acc', fontSize: '0.9rem', fontWeight: '600' }}>
                        R$ {sugestao.preco.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* MENSAGEM DE NENHUM RESULTADO */}
              {produtoOlistSKU.length >= 2 && sugestoesSKU.length === 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  padding: '1rem',
                  color: '#856404',
                  fontSize: '0.9rem',
                  zIndex: 10
                }}>
                  <strong>Nenhum produto encontrado com "{produtoOlistSKU}"</strong>
                  <br /><br />
                  <strong>💡 Dicas:</strong>
                  <br />
                  1. Verifique se o SKU/nome está correto na sua conta Olist
                  <br />
                  2. Tente buscar pelo SKU exato do produto
                  <br />
                  3. Tente buscar com parte do nome (ex: "SPIKE" ao invés de "VISEIRA SPIKE II")
                  <br />
                  4. Se a busca continuar não funcionando, você pode preencher manualmente os dados abaixo
                </div>
              )}
            </div>

            {/* BOTÃO PARA ABRIR O PREENCHIMENTO MANUAL */}
            {!produtoOlistSelecionado.sku && !mostrarManual && (
              <button
                type="button"
                onClick={() => setMostrarManual(true)}
                style={{
                  background: '#fff',
                  border: '2px solid #007acc',
                  color: '#007acc',
                  padding: '0.75rem 1.25rem',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginTop: '1rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.95rem'
                }}
              >
                📝 Preencher dados manualmente
              </button>
            )}

            {/* MODO MANUAL - ABRE AO CLICAR NO BOTÃO */}
            {!produtoOlistSelecionado.sku && mostrarManual && (
              <div style={{
                background: '#f0f9ff',
                border: '2px solid #007acc',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ color: '#007acc', marginTop: 0, marginBottom: 0 }}>📝 Preencher Dados do Anúncio Manualmente</h3>
                  <button
                    type="button"
                    onClick={() => setMostrarManual(false)}
                    style={{ background: 'none', border: 'none', color: '#999', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}
                    title="Fechar preenchimento manual"
                  >
                    ×
                  </button>
                </div>
                <p style={{ color: '#666', fontSize: '0.9rem', margin: '0.5rem 0 1.5rem 0' }}>
                  Copie os dados do anúncio da sua Olist e preencha abaixo (funciona melhor que a busca automática no momento):
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Nome do Produto</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: Suporte Baú Bagageiro Yamaha"
                      value={produtoOlistSelecionado.nome}
                      onChange={(e) => setProdutoOlistSelecionado({
                        ...produtoOlistSelecionado,
                        nome: e.target.value
                      })}
                      style={{ padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Preço</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="Ex: 299.90"
                      value={produtoOlistSelecionado.preco}
                      onChange={(e) => setProdutoOlistSelecionado({
                        ...produtoOlistSelecionado,
                        preco: parseFloat(e.target.value) || 0
                      })}
                      style={{ padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Estoque Disponível</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="Ex: 47"
                      value={produtoOlistSelecionado.estoque}
                      onChange={(e) => setProdutoOlistSelecionado({
                        ...produtoOlistSelecionado,
                        estoque: parseInt(e.target.value) || 0
                      })}
                      style={{ padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* PRODUTO SELECIONADO */}
            {produtoOlistSelecionado.sku && (
              <div style={{
                background: '#f0f4c3',
                border: '2px solid #cddc39',
                padding: '1.5rem',
                borderRadius: '8px',
                marginTop: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <h3 style={{ color: '#827717', marginTop: 0 }}>Anúncio Selecionado</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      SKU
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }}>
                      {produtoOlistSelecionado.sku}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      NOME DO ANÚNCIO
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.9rem', fontWeight: '600', margin: 0 }}>
                      {produtoOlistSelecionado.nome}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      PREÇO
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }}>
                      R$ {produtoOlistSelecionado.preco.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      ESTOQUE OLIST
                    </p>
                    <p style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }}>
                      {produtoOlistSelecionado.estoque} un disp.
                    </p>
                    <p style={{ color: '#999', fontSize: '0.75rem', margin: '0.15rem 0 0 0' }}>
                      Saldo: {produtoOlistSelecionado.estoque_saldo} | Reserv.: {produtoOlistSelecionado.estoque_reservado}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* CANDIDATOS NO INBOUND — confirmar se é o mesmo produto */}
            {produtoOlistSelecionado.sku && produtoSelecionado && reservaInbound === 0 &&
             !candidatoVinculado && inboundCandidatos.length > 0 && (
              <div style={{
                background: '#fff8e1',
                border: '2px solid #ffb300',
                padding: '1.25rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <h3 style={{ color: '#e65100', marginTop: 0, marginBottom: '0.5rem' }}>
                  🔎 Esse produto está num inbound em processo?
                </h3>
                <p style={{ color: '#7a5b00', fontSize: '0.85rem', margin: '0 0 1rem 0' }}>
                  Encontrei {inboundCandidatos.length} {inboundCandidatos.length === 1 ? 'item parecido' : 'itens parecidos'} no seu inbound (SKU do inbound é do Mercado Livre, por isso confirme pelo título). Se for o mesmo, eu <strong>seguro a quantidade do FULL</strong> e subo só o resto na Olist.
                </p>
                {inboundCandidatos.map((c) => (
                  <div key={c.item_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '1rem', padding: '0.75rem 1rem', marginBottom: '0.5rem',
                    background: 'white', border: '1px solid #ffe082', borderRadius: '6px'
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1a1a1a', fontSize: '0.9rem' }}>
                        {c.titulo}
                      </div>
                      <div style={{ color: '#888', fontSize: '0.78rem', marginTop: '0.15rem' }}>
                        SKU inbound: {c.sku_inbound || '—'} · Inbound #{c.numero_inbound} ({c.status_inbound})
                      </div>
                      <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
                        {c.baixa_aplicada === 1 ? (
                          <span style={{ color: '#2e7d32', fontWeight: 600 }}>
                            ✓ {c.qtd_full} un — já foi baixado deste inbound (não segura de novo)
                          </span>
                        ) : (
                          <span style={{ color: '#e65100', fontWeight: 600 }}>
                            📦 {c.restante_full} un destinadas ao FULL — ainda NÃO baixadas
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => confirmarCandidatoInbound(c)}
                      disabled={vinculandoCandidato}
                      style={{
                        padding: '0.6rem 1rem', whiteSpace: 'nowrap',
                        background: vinculandoCandidato ? '#ccc' : '#ef6c00',
                        color: 'white', border: 'none', borderRadius: '5px',
                        fontWeight: 600, fontSize: '0.85rem',
                        cursor: vinculandoCandidato ? 'wait' : 'pointer'
                      }}
                    >
                      {vinculandoCandidato ? 'Vinculando…'
                        : c.baixa_aplicada === 1 ? 'É esse (já baixado)'
                        : `É esse — segurar ${c.restante_full}`}
                    </button>
                  </div>
                ))}
                <p style={{ color: '#999', fontSize: '0.75rem', margin: '0.5rem 0 0 0' }}>
                  Não é nenhum desses? Pode ignorar — vai subir a quantidade cheia normalmente.
                </p>
              </div>
            )}

            {/* PREVIEW DO CÁLCULO DE ESTOQUE */}
            {produtoOlistSelecionado.sku && produtoSelecionado && (
              <div style={{
                background: '#e8f5e9',
                border: '2px solid #4caf50',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <h3 style={{ color: '#2e7d32', marginTop: 0 }}>Atualização de Estoque</h3>
                {(() => {
                  const qtdNF = Math.round(produtoSelecionado.quantidade_nf)
                  const reserva = Math.min(reservaInbound, qtdNF)
                  const qtdSubir = Math.max(0, qtdNF - reserva)
                  const novoTotal = produtoOlistSelecionado.estoque_saldo + qtdSubir
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', textAlign: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                          <p style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }}>ESTOQUE ATUAL OLIST</p>
                          <p style={{ color: '#1a1a1a', fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>
                            {produtoOlistSelecionado.estoque_saldo}
                          </p>
                        </div>
                        <div style={{ fontSize: '1.5rem', color: '#4caf50', fontWeight: '700' }}>+</div>
                        <div>
                          <p style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }}>QTD A SUBIR</p>
                          <p style={{ color: '#007acc', fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>
                            {qtdSubir}
                          </p>
                          {reserva > 0 && (
                            <p style={{ color: '#999', fontSize: '0.7rem', margin: '0.15rem 0 0 0' }}>
                              (de {qtdNF} recebidas)
                            </p>
                          )}
                        </div>
                        <div style={{ fontSize: '1.5rem', color: '#4caf50', fontWeight: '700' }}>=</div>
                        <div>
                          <p style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }}>NOVO ESTOQUE TOTAL</p>
                          <p style={{ color: '#2e7d32', fontSize: '1.8rem', fontWeight: '800', margin: 0 }}>
                            {novoTotal}
                          </p>
                        </div>
                      </div>
                      {reserva > 0 && (
                        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: '6px', color: '#e65100', fontSize: '0.88rem' }}>
                          ⚠️ <strong>{reserva} un</strong> deste produto estão separadas para o FULL no inbound {reservaInboundInbs} e serão <strong>seguradas</strong> (baixa automática no inbound). Por isso sobe só {qtdSubir} na Olist.
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* PAINEL DE BALANÇO (corrige estoque fictício antigo) */}
            {produtoOlistSelecionado.sku && produtoSelecionado && balanceandoNF && (
              <div style={{
                background: '#fff3e0',
                border: '2px solid #ff9800',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '1.5rem'
              }}>
                <h3 style={{ color: '#e65100', marginTop: 0 }}>⚖️ Balanço de Estoque (corrigir estoque fictício)</h3>
                <p style={{ color: '#666', fontSize: '0.88rem', marginTop: 0 }}>
                  O estoque atual da Olist (<strong>{produtoOlistSelecionado.estoque_saldo} un</strong>) está incorreto?
                  Informe abaixo o estoque <strong>REAL</strong> que você tem hoje. O sistema vai corrigir a base
                  e somar a quantidade da NF por cima.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                      ESTOQUE REAL HOJE
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={estoqueRealNF}
                      onChange={(e) => setEstoqueRealNF(e.target.value)}
                      placeholder="ex: 200"
                      autoFocus
                      style={{ width: '120px', padding: '0.6rem', fontSize: '1.2rem', fontWeight: '700', border: '2px solid #ff9800', borderRadius: '4px', textAlign: 'center' }}
                    />
                  </div>
                  <div style={{ fontSize: '1.5rem', color: '#ff9800', fontWeight: '700' }}>+</div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }}>QTD DA NF</p>
                    <p style={{ color: '#007acc', fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>
                      {Math.round(produtoSelecionado.quantidade_nf)}
                    </p>
                  </div>
                  <div style={{ fontSize: '1.5rem', color: '#ff9800', fontWeight: '700' }}>=</div>
                  <div>
                    <p style={{ color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }}>NOVO ESTOQUE TOTAL</p>
                    <p style={{ color: '#e65100', fontSize: '1.8rem', fontWeight: '800', margin: 0 }}>
                      {estoqueRealNF.trim() !== '' && !isNaN(Number(estoqueRealNF))
                        ? Math.round(Number(estoqueRealNF)) + Math.round(produtoSelecionado.quantidade_nf)
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
              <button
                onClick={voltarParaInicial}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#f0f0f0',
                  color: '#1a1a1a',
                  border: '1px solid #e0e0e0',
                  borderRadius: '4px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  transition: 'all 0.3s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              >
                ← Voltar para Inicial
              </button>
              <button
                onClick={() => { setBalanceandoNF(!balanceandoNF); setEstoqueRealNF('') }}
                disabled={!produtoOlistSelecionado.sku}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: balanceandoNF ? '#ff9800' : '#fff',
                  color: balanceandoNF ? '#fff' : '#e65100',
                  border: '2px solid #ff9800',
                  borderRadius: '4px',
                  fontWeight: '600',
                  cursor: produtoOlistSelecionado.sku ? 'pointer' : 'not-allowed',
                  fontSize: '0.95rem',
                  opacity: produtoOlistSelecionado.sku ? 1 : 0.5,
                  transition: 'all 0.3s'
                }}
              >
                {balanceandoNF ? '✕ Cancelar balanço' : '⚖️ Balancear estoque'}
              </button>
              {balanceandoNF ? (
                <button
                  onClick={handleBalancear}
                  disabled={!produtoOlistSelecionado.sku || estoqueRealNF.trim() === ''}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: (produtoOlistSelecionado.sku && estoqueRealNF.trim() !== '') ? '#e65100' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: '600',
                    cursor: (produtoOlistSelecionado.sku && estoqueRealNF.trim() !== '') ? 'pointer' : 'not-allowed',
                    fontSize: '0.95rem',
                    transition: 'all 0.3s'
                  }}
                >
                  ⚖️ Confirmar Balanço →
                </button>
              ) : (
                <button
                  onClick={handleVincular}
                  disabled={!produtoOlistSelecionado.sku}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: produtoOlistSelecionado.sku ? '#007acc' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: '600',
                    cursor: produtoOlistSelecionado.sku ? 'pointer' : 'not-allowed',
                    fontSize: '0.95rem',
                    transition: 'all 0.3s'
                  }}
                  onMouseEnter={(e) => {
                    if (produtoOlistSelecionado.sku) {
                      e.currentTarget.style.background = '#005a96'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (produtoOlistSelecionado.sku) {
                      e.currentTarget.style.background = '#007acc'
                    }
                  }}
                >
                  Vincular e Atualizar Estoque →
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ===== PÁGINA EMBALDES =====
  if (pagina === 'embaldes') {
    return (
      <div className="app">
        <header className="header">
          <div className="container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1>INBOUND (LISTA DE SEPARAÇÃO)</h1>
                <p>Suba os inbounds do Mercado Livre FULL antes da nota fiscal</p>
              </div>
              <button
                onClick={() => setPagina('inicial')}
                style={{
                  padding: '0.6rem 1.2rem',
                  backgroundColor: '#f0f0f0',
                  color: '#1a1a1a',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.9rem'
                }}
              >
                ← Voltar
              </button>
            </div>
          </div>
        </header>
        <main className="container main-content">
          <EmbaldesManager />
        </main>
      </div>
    )
  }

  return null
}

export default App
