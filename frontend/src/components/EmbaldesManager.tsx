import { useState, useEffect } from 'react'
import api from '../services/api'

const SHARED_SYNC_INTERVAL_MS = 5000

interface ItemInbound {
  id: number
  titulo_anuncio: string
  quantidade_separada: number
  sku_inbound?: string
  codigo_ml?: string
  olist_produto_id?: string
  olist_sku?: string
  olist_nome?: string
  validado: number
  validacao_mensagem?: string
}

interface Inbound {
  id: number
  nome_embalde: string
  numero_inbound?: string
  total_unidades?: number
  arquivo_original: string
  data_upload: string
  data_limite?: string | null
  data_encerramento?: string | null
  status: string
  qtd_items: number
  qtd_validados: number
  qtd_baixados?: number
  qtd_baixados_apos_encerramento?: number
  total_lido?: number
  total_planejado_full?: number
  total_baixado_full?: number
  revisao_salva_em?: string | null
  itens?: ItemInbound[]
}

type Aba = 'processando' | 'encerrado'
type VisaoInbound = 'upload' | 'lista'

interface ItemRevisao {
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string
  quantidade_original?: number
  quantidade_full: number
  olist_encontrado: boolean
  olist_produto_id?: string | null
  olist_nome?: string | null
  estoque_atual?: number | null
  baixa_proposta?: number | null
  resultado?: number | null
  falta?: number | null
  tem_falta: boolean
  estoque_indisponivel?: boolean
  baixa_aplicada: number
  vinculado?: number
  foi_balanceado?: number
  saldo_disponivel?: number | null
  em_espera?: number
  tem_historico_full?: boolean
  imagem?: string | null
}

interface Revisao {
  embale_id: number
  nome_embalde: string
  numero_inbound?: string
  status: string
  revisao_salva_em?: string
  ultimo_item_separacao?: number | null
  resumo: { total: number; encontrados: number; nao_encontrados: number; com_falta: number }
  itens: ItemRevisao[]
}

// Kit da Olist: produto montado a partir de outros. A Olist não deixa baixar o
// estoque do kit direto — a baixa é feita em cada componente (anúncio unitário).
interface KitComponente {
  produto_id: string
  sku: string
  descricao: string
  estoque_atual?: number | null
  quantidade_no_kit: number
  quantidade_sugerida: number
}
interface KitInfo {
  eh_kit: true
  nome_kit?: string
  sku_kit?: string
  qtd_full: number
  componentes: KitComponente[]
}
type KitEstado = 'carregando' | 'nao' | KitInfo
type KitBalanceModal = { item: ItemRevisao; kit: KitInfo }

export function EmbaldesManager({ modoSeparacao = false }: { modoSeparacao?: boolean } = {}) {
  const [inbounds, setInbounds] = useState<Inbound[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [nomeInbound, setNomeInbound] = useState('')
  const [dataLimite, setDataLimite] = useState('')
  const [semData, setSemData] = useState(true)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [inboundSelecionado, setInboundSelecionado] = useState<Inbound | null>(null)
  const [aba, setAba] = useState<Aba>('processando')
  const [visao, setVisao] = useState<VisaoInbound>(modoSeparacao ? 'lista' : 'upload')
  const [editandoData, setEditandoData] = useState<number | null>(null)
  const [novaData, setNovaData] = useState('')
  const [editandoNome, setEditandoNome] = useState<number | null>(null)
  const [novoNomeInbound, setNovoNomeInbound] = useState('')
  const [revisao, setRevisao] = useState<Revisao | null>(null)
  const [revisandoId, setRevisandoId] = useState<number | null>(null)
  const [carregandoRevisao, setCarregandoRevisao] = useState(false)
  const [declaracoes, setDeclaracoes] = useState<Record<number, number>>({})
  const [confirmandoBaixa, setConfirmandoBaixa] = useState(false)
  const [baixandoItemId, setBaixandoItemId] = useState<number | null>(null)
  const [itensBaixados, setItensBaixados] = useState<Record<number, number>>({})
  const [quantidadesFull, setQuantidadesFull] = useState<Record<number, string>>({})
  const [salvandoQuantidadeId, setSalvandoQuantidadeId] = useState<number | null>(null)
  // Filtro da tabela de revisão
  type FiltroRev = 'todos' | 'vinculados' | 'nao_vinculados' | 'baixados' | 'nao_baixados' | 'full_alterado'
  const [filtroRevisao, setFiltroRevisao] = useState<FiltroRev>('todos')
  // Histórico de alterações da quantidade do FULL
  const [historicoFull, setHistoricoFull] = useState<any[]>([])
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  // Vínculo manual de item "não achado"
  const [vinculandoItem, setVinculandoItem] = useState<ItemRevisao | null>(null)
  const [buscaTermo, setBuscaTermo] = useState('')
  const [buscaResultados, setBuscaResultados] = useState<any[]>([])
  const [buscandoOlist, setBuscandoOlist] = useState(false)
  const [buscaNaoAutorizado, setBuscaNaoAutorizado] = useState<{ url?: string } | null>(null)
  const [vinculandoProduto, setVinculandoProduto] = useState(false)
  // Balanço de estoque
  const [balanceandoItem, setBalanceandoItem] = useState<ItemRevisao | null>(null)
  const [balanceandoKit, setBalanceandoKit] = useState<KitBalanceModal | null>(null)
  const [qtdRealConferida, setQtdRealConferida] = useState('')
  const [balanceandoId, setBalanceandoId] = useState<number | null>(null)
  // Itens em espera (bloqueados por fatores externos)
  const [itensEmEspera, setItensEmEspera] = useState<Record<number, boolean>>({})
  const [marcandoEmEspera, setMarcandoEmEspera] = useState<number | null>(null)
  // Modo "Lista de separação": um produto por vez, em tela cheia
  const [sepIndex, setSepIndex] = useState(0)
  const [skuImg, setSkuImg] = useState<Record<string, string>>({})
  // Filtro do picker: mostrar só os itens que tiveram a qtd do FULL alterada
  const [soEditados, setSoEditados] = useState(false)
  const [soEmEspera, setSoEmEspera] = useState(false)
  // Kit por item (cache da detecção), quantidade por componente e estado da baixa
  const [kitPorItem, setKitPorItem] = useState<Record<number, KitEstado>>({})
  const [kitQtds, setKitQtds] = useState<Record<string, string>>({})
  const [kitRealQtds, setKitRealQtds] = useState<Record<string, string>>({})
  const [baixandoKit, setBaixandoKit] = useState(false)
  const [kitResultado, setKitResultado] = useState<Record<number, any[]>>({})

  // Mapa SKU -> imagem do anúncio (ML), usado só no modo separação p/ mostrar a foto.
  useEffect(() => {
    if (!modoSeparacao) return
    let cancelado = false
    ;(async () => {
      try {
        // Endpoint dedicado: mapa SKU->imagem de TODO o cache do ML (sem o teto de 50
        // da listagem paginada de anúncios, que fazia a maioria das fotos sumir).
        const r = await api.get('/ml/imagens')
        const mapa: Record<string, string> = {}
        for (const [sku, img] of Object.entries(r.data?.imagens || {})) {
          if (sku && img) mapa[String(sku).trim().toUpperCase()] = String(img)
        }
        if (!cancelado) setSkuImg(mapa)
      } catch { /* foto é opcional — não trava as ações */ }
    })()
    return () => { cancelado = true }
  }, [modoSeparacao])

  useEffect(() => {
    carregarInbounds()
  }, [])

  useEffect(() => {
    if (visao !== 'lista') return
    const sincronizar = async () => {
      await carregarInbounds()
    }
    const recarregarAoVoltar = () => {
      if (document.visibilityState === 'visible') sincronizar()
    }
    const id = setInterval(sincronizar, SHARED_SYNC_INTERVAL_MS)
    window.addEventListener('focus', sincronizar)
    document.addEventListener('visibilitychange', recarregarAoVoltar)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', sincronizar)
      document.removeEventListener('visibilitychange', recarregarAoVoltar)
    }
  }, [visao])

  // Auto-detecção de kit: ao exibir um item no picker, verifica se é kit na Olist
  // (cacheado por item). Se for, o picker mostra os componentes p/ baixar cada um.
  useEffect(() => {
    if (!modoSeparacao || !revisao) return
    const lista = soEditados
      ? revisao.itens.filter((x) => x.tem_historico_full)
      : soEmEspera
        ? revisao.itens.filter((x) => itensEmEspera[x.item_id])
        : revisao.itens
    if (lista.length === 0) return
    const it = lista[Math.min(sepIndex, lista.length - 1)]
    if (!it) return
    const jaBaixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
    const vinc = it.vinculado === 1 || !!it.olist_produto_id
    if (jaBaixado || !vinc) return
    if (kitPorItem[it.item_id] !== undefined) return // já checado/carregando
    setKitPorItem((prev) => ({ ...prev, [it.item_id]: 'carregando' }))
    api.get(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/kit`)
      .then((r) => {
        const d = r.data
        if (d && d.eh_kit) {
          setKitPorItem((prev) => ({ ...prev, [it.item_id]: d as KitInfo }))
          setKitQtds((prev) => {
            const novo = { ...prev }
            for (const c of (d.componentes || [])) {
              if (novo[c.produto_id] === undefined) novo[c.produto_id] = String(c.quantidade_sugerida ?? 0)
            }
            return novo
          })
        } else {
          setKitPorItem((prev) => ({ ...prev, [it.item_id]: 'nao' }))
        }
      })
      .catch(() => setKitPorItem((prev) => ({ ...prev, [it.item_id]: 'nao' })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoSeparacao, revisao?.embale_id, sepIndex, soEditados, soEmEspera])

  // Baixa os componentes do kit na Olist (cada um vira uma saída). Retorna true se todos OK.
  const baixarKitComponentes = async (it: ItemRevisao, kit: KitInfo): Promise<boolean> => {
    if (!revisao) return false
    const componentes = kit.componentes.map((c) => ({
      produto_id: c.produto_id,
      sku: c.sku,
      quantidade: Math.max(0, Number(kitQtds[c.produto_id] ?? c.quantidade_sugerida) || 0),
    }))
    const resumo = componentes.map((c) => `• ${c.sku || c.produto_id}: ${c.quantidade}`).join('\n')
    if (!confirm(`Baixar os componentes do kit "${it.titulo_anuncio}" na Olist?\n\n${resumo}\n\nNão há volta.`)) return false
    try {
      setBaixandoKit(true)
      const r = await api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/baixar-kit`, { componentes })
      const d = r.data
      setKitResultado((prev) => ({ ...prev, [it.item_id]: d.resultados || [] }))
      if (d.todos_ok) {
        setItensBaixados((prev) => ({ ...prev, [it.item_id]: 1 }))
        setMessage(d.mensagem || 'Componentes do kit baixados na Olist')
        return true
      }
      setMessage(d.mensagem || 'Alguns componentes do kit falharam')
      return false
    } catch (erro: any) {
      const dados = erro.response?.data || {}
      setMessage('Erro: ' + (dados.erro || dados.error || String(erro)) + (dados.detalhe ? ` — ${dados.detalhe}` : ''))
      return false
    } finally {
      setBaixandoKit(false)
    }
  }

  const carregarInbounds = async () => {
    try {
      setLoading(true)
      const resposta = await api.get('/embaldes?limit=200')
      setInbounds(resposta.data.items)
    } catch (erro) {
      setMessage('Erro ao carregar inbounds: ' + String(erro))
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!arquivo) {
      setMessage('Selecione um arquivo PDF')
      return
    }
    if (!nomeInbound.trim()) {
      setMessage('Digite um nome para o inbound')
      return
    }

    try {
      setLoading(true)
      setMessage('')

      const formData = new FormData()
      formData.append('arquivo', arquivo)
      formData.append('nome_embale', nomeInbound)
      if (dataLimite) formData.append('data_limite', dataLimite)

      const resposta = await api.post('/embaldes/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      const d = resposta.data
      setMessage(`Inbound ${d.numero_inbound || ''} processado: ${d.itens_validados}/${d.itens_processados} items vinculados`)
      setNomeInbound('')
      setDataLimite('')
      setSemData(true)
      setArquivo(null)

      await carregarInbounds()
    } catch (erro: any) {
      const msgErro = erro.response?.data?.erro || String(erro)
      setMessage('Erro: ' + msgErro)
    } finally {
      setLoading(false)
    }
  }

  const irParaLista = async () => {
    setVisao('lista')
    await carregarInbounds()
  }

  const voltarParaUpload = () => {
    setVisao('upload')
    setInboundSelecionado(null)
    setRevisandoId(null)
    setRevisao(null)
    setDeclaracoes({})
    setItensBaixados({})
  }

  const carregarDetalhes = async (inb: Inbound) => {
    if (inboundSelecionado?.id === inb.id) {
      setInboundSelecionado(null)
      return
    }
    // Visões mutuamente exclusivas: abrir os itens fecha a revisão Olist.
    setRevisandoId(null)
    setRevisao(null)
    try {
      const resposta = await api.get(`/embaldes/${inb.id}`)
      setInboundSelecionado(resposta.data)
    } catch (erro) {
      setMessage('Erro ao carregar detalhes: ' + String(erro))
    }
  }

  const encerrarInbound = async (id: number) => {
    if (!confirm('Encerrar este inbound? Ele vai parar de descontar do estoque nas próximas notas.')) return
    try {
      await api.post(`/embaldes/${id}/encerrar`)
      await carregarInbounds()
      setMessage('Inbound encerrado')
    } catch (erro: any) {
      setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)))
    }
  }

  const salvarData = async (id: number) => {
    try {
      await api.post(`/embaldes/${id}/data-limite`, { data_limite: novaData || null })
      setEditandoData(null)
      setNovaData('')
      await carregarInbounds()
      setMessage('Data limite atualizada')
    } catch (erro: any) {
      setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)))
    }
  }

  const salvarNomeInbound = async (id: number) => {
    try {
      const nome = novoNomeInbound.trim()
      if (!nome) {
        setMessage('Digite um nome válido para o inbound')
        return
      }
      await api.post(`/embaldes/${id}/nome`, { nome_embale: nome })
      setEditandoNome(null)
      setNovoNomeInbound('')
      await carregarInbounds()
      if (inboundSelecionado?.id === id) {
        const resposta = await api.get(`/embaldes/${id}`)
        setInboundSelecionado(resposta.data)
      }
      setMessage('Nome do inbound atualizado')
    } catch (erro: any) {
      setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)))
    }
  }

  const deletarInbound = async (id: number) => {
    if (!confirm('DELETAR este inbound PERMANENTEMENTE? Esta ação não pode ser desfeita. Todos os itens serão removidos do banco de dados.')) return
    try {
      setLoading(true)
      await api.delete(`/embaldes/${id}`)
      await carregarInbounds()
      if (inboundSelecionado?.id === id) {
        setInboundSelecionado(null)
      }
      setMessage('Inbound deletado permanentemente')
    } catch (erro: any) {
      setMessage('Erro ao deletar: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setLoading(false)
    }
  }

  const NUMERO_WHATSAPP = '5519978149245'

  const balancearItem = async (item: ItemRevisao, embaleId: number) => {
    if (!qtdRealConferida || qtdRealConferida === '') {
      setMessage('Digite a quantidade conferida no físico')
      return
    }

    // Abre a aba do WhatsApp AINDA no clique (evita bloqueio de pop-up).
    const real = parseFloat(qtdRealConferida)
    const vaiPraoFull = Math.round(item.quantidade_full || 0)
    const haveraDivergencia = real < vaiPraoFull
    let janelaWhats: Window | null = null
    if (haveraDivergencia) janelaWhats = window.open('', '_blank')

    try {
      setBalanceandoId(item.item_id)
      const resultado = await api.post(`/embaldes/${embaleId}/itens/${item.item_id}/balancear`, {
        quantidade_real: real
      })

      setMessage(`Balanço realizado! ${resultado.data.mensagem}`)

      // Divergência: notifica no WhatsApp (produto, qtd real e qtd que vai pro FULL)
      if (resultado.data.tem_divergencia) {
        const falta = Math.max(0, vaiPraoFull - real)
        const mensagem =
          `⚠️ DIVERGÊNCIA NO INBOUND (FULL)\n\n` +
          `Produto: ${item.titulo_anuncio}\n` +
          (item.sku_inbound ? `SKU: ${item.sku_inbound}\n` : '') +
          `Quantidade real conferida: ${real}\n` +
          `Quantidade que vai pro FULL: ${vaiPraoFull}\n` +
          `Falta: ${falta}`
        const url = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensagem)}`
        if (janelaWhats) janelaWhats.location.href = url
        else window.open(url, '_blank')
      } else if (janelaWhats) {
        janelaWhats.close()
      }

      fecharBalanceamentos()
      await carregarRevisao(embaleId)
    } catch (erro: any) {
      if (janelaWhats) janelaWhats.close()
      const dados = erro.response?.data || {}
      const base = dados.erro || dados.error || String(erro)
      setMessage('Erro: ' + base + (dados.detalhe ? ` — ${dados.detalhe}` : ''))
    } finally {
      setBalanceandoId(null)
    }
  }

  const balancearKit = async (item: ItemRevisao, kit: KitInfo, embaleId: number): Promise<boolean> => {
    const componentes = kit.componentes.map((c) => {
      const realTxt = kitRealQtds[c.produto_id]
      return {
        produto_id: c.produto_id,
        sku: c.sku,
        quantidade_no_kit: c.quantidade_no_kit,
        quantidade_real: realTxt === '' ? NaN : Number(realTxt),
        quantidade_baixar: Math.max(0, Number(kitQtds[c.produto_id] ?? c.quantidade_sugerida) || 0),
        descricao: c.descricao,
      }
    })
    const invalido = componentes.find((c) => !Number.isFinite(c.quantidade_real) || c.quantidade_real < 0)
    if (invalido) {
      setMessage(`Informe a quantidade real conferida para todos os componentes do kit.`)
      return false
    }

    let janelaWhats: Window | null = null
    const haveraDivergencia = componentes.some((c) => c.quantidade_real < c.quantidade_baixar)
    if (haveraDivergencia) janelaWhats = window.open('', '_blank')

    try {
      setBalanceandoId(item.item_id)
      const resultado = await api.post(`/embaldes/${embaleId}/itens/${item.item_id}/balancear-kit`, { componentes })
      const dados = resultado.data || {}
      setKitResultado((prev) => ({ ...prev, [item.item_id]: dados.resultados || [] }))
      setMessage(dados.mensagem || 'Balanço dos componentes concluído')

      if (dados.tem_divergencia) {
        const faltas = (dados.resultados || [])
          .filter((r: any) => r.status === 'divergencia')
          .map((r: any) => `- ${r.sku || r.produto_id}: faltam ${r.falta}`)
          .join('\n')
        const mensagem =
          `⚠️ DIVERGÊNCIA NO INBOUND (KIT)\n\n` +
          `Produto: ${item.titulo_anuncio}\n` +
          (item.sku_inbound ? `SKU: ${item.sku_inbound}\n` : '') +
          `Qtd FULL planejada: ${Math.round(item.quantidade_full || 0)} kit(s)\n\n` +
          `Componentes com falta:\n${faltas || '- conferir manualmente'}`
        const url = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensagem)}`
        if (janelaWhats) janelaWhats.location.href = url
        else window.open(url, '_blank')
      } else if (janelaWhats) {
        janelaWhats.close()
      }

      if (dados.todos_ok) {
        setItensBaixados((prev) => ({ ...prev, [item.item_id]: Math.round(item.quantidade_full || 0) }))
      }

      fecharBalanceamentos()
      await carregarRevisao(embaleId)
      return !!dados.todos_ok
    } catch (erro: any) {
      if (janelaWhats) janelaWhats.close()
      const dados = erro.response?.data || {}
      const base = dados.erro || dados.error || String(erro)
      setMessage('Erro: ' + base + (dados.detalhe ? ` — ${dados.detalhe}` : ''))
      return false
    } finally {
      setBalanceandoId(null)
    }
  }

  const carregarHistoricoFull = async (embaleId: number) => {
    try {
      const resposta = await api.get(`/embaldes/${embaleId}/historico-full`)
      setHistoricoFull(resposta.data.itens || [])
      setMostrarHistorico(true)
    } catch (erro: any) {
      setMessage('Erro ao carregar histórico: ' + (erro.response?.data?.erro || String(erro)))
    }
  }

  const carregarRevisao = async (id: number) => {
    if (revisandoId === id) {
      // Toggle: fecha
      setRevisandoId(null)
      setRevisao(null)
      setDeclaracoes({})
      setQuantidadesFull({})
      return
    }
    try {
      setCarregandoRevisao(true)
      // Visões mutuamente exclusivas: abrir a revisão fecha a lista de itens.
      setInboundSelecionado(null)
      setRevisandoId(id)
      setRevisao(null)
      setDeclaracoes({})
      setItensBaixados({})
      setQuantidadesFull({})
      setFiltroRevisao('todos')
      const resposta = await api.get(`/embaldes/${id}/revisao`)
      setRevisao(resposta.data)
      // Retoma de onde parou: posiciona no item salvo no banco (se ainda existir).
      const itensRev: ItemRevisao[] = resposta.data.itens || []
      const ultimoId = resposta.data.ultimo_item_separacao
      const idxSalvo = ultimoId != null ? itensRev.findIndex((it) => it.item_id === ultimoId) : -1
      setSepIndex(idxSalvo >= 0 ? idxSalvo : 0)
      const planejadas: Record<number, string> = {}
      for (const it of resposta.data.itens || []) {
        planejadas[it.item_id] = String(Math.round(it.quantidade_full ?? 0))
      }
      setQuantidadesFull(planejadas)
      // Marca os que já foram baixados antes
      const jaBaixados: Record<number, number> = {}
      for (const it of resposta.data.itens || []) {
        if (it.baixa_aplicada === 1) jaBaixados[it.item_id] = 1
      }
      setItensBaixados(jaBaixados)
      // Recupera o estado "em espera" salvo no banco
      const emEspera: Record<number, boolean> = {}
      for (const it of resposta.data.itens || []) {
        if (it.em_espera === 1) emEspera[it.item_id] = true
      }
      setItensEmEspera(emEspera)
    } catch (erro: any) {
      setMessage('Erro ao revisar: ' + (erro.response?.data?.erro || String(erro)))
      setRevisandoId(null)
    } finally {
      setCarregandoRevisao(false)
    }
  }

  // Salva no banco o produto onde a separação parou (retomar de onde parou).
  // Fire-and-forget: não trava a navegação se a rede falhar.
  const salvarPosicaoSeparacao = (embaleId: number, itemId: number) => {
    api.post(`/embaldes/${embaleId}/posicao-separacao`, { item_id: itemId }).catch(() => { /* posição é best-effort */ })
  }

  const confirmarBaixa = async () => {
    if (!revisao) return
    if (!confirm('Confirmar a baixa EM MASSA na Olist? Isso escreve no estoque real e não há volta.')) return
    try {
      setConfirmandoBaixa(true)
      const resposta = await api.post(`/embaldes/${revisao.embale_id}/confirmar-baixa`, {
        itens: declaracoes
      })
      setMessage(`Sucesso! ${resposta.data.mensagem}`)
      // Marca os itens baixados localmente
      const novos: Record<number, number> = { ...itensBaixados }
      for (const r of resposta.data.resultados || []) {
        if (r.status === 'ok' || r.status === 'ja_baixado') novos[r.item_id] = r.quantidade_baixada || 0
      }
      setItensBaixados(novos)
    } catch (erro: any) {
      setMessage('Erro ao confirmar: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setConfirmandoBaixa(false)
    }
  }

  const baixarItem = async (it: ItemRevisao): Promise<boolean> => {
    if (!revisao) return false
    const qtd = it.tem_falta
      ? (declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0))
      : Math.round(it.quantidade_full)
    if (!confirm(`Baixar ${qtd} un. de "${it.titulo_anuncio}" na Olist? Não há volta.`)) return false
    try {
      setBaixandoItemId(it.item_id)
      const resposta = await api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/baixa`, {
        quantidade: qtd
      })
      const r = resposta.data
      if (r.status === 'ok' || r.status === 'ja_baixado') {
        setItensBaixados({ ...itensBaixados, [it.item_id]: r.quantidade_baixada || qtd })
        setMessage(r.mensagem || 'Baixa aplicada')
        return true
      } else {
        const base = r.mensagem || r.erro || 'Não foi possível baixar'
        setMessage(base + (r.detalhe ? ` — ${r.detalhe}` : ''))
        return false
      }
    } catch (erro: any) {
      const dados = erro.response?.data || {}
      const base = dados.erro || dados.error || String(erro)
      setMessage('Erro: ' + base + (dados.detalhe ? ` — ${dados.detalhe}` : ''))
      return false
    } finally {
      setBaixandoItemId(null)
    }
  }

  const abrirBalanceamento = (it: ItemRevisao) => {
    setBalanceandoItem(it)
    setBalanceandoKit(null)
    setQtdRealConferida('')
  }

  const abrirBalanceamentoKit = (it: ItemRevisao, kit: KitInfo) => {
    setBalanceandoItem(null)
    setQtdRealConferida('')
    setBalanceandoKit({ item: it, kit })
    setKitRealQtds((prev) => {
      const next = { ...prev }
      for (const c of kit.componentes) {
        if (next[c.produto_id] === undefined) next[c.produto_id] = ''
      }
      return next
    })
  }

  const fecharBalanceamentos = () => {
    setBalanceandoItem(null)
    setBalanceandoKit(null)
    setQtdRealConferida('')
  }

  const salvarQuantidadeFull = async (it: ItemRevisao) => {
    if (!revisao) return
    const bruto = quantidadesFull[it.item_id]
    const quantidade = Math.max(0, Number(bruto || 0))
    if (!Number.isFinite(quantidade)) {
      setMessage('Digite uma quantidade vÃ¡lida para o FULL')
      return
    }

    const atual = Number(it.quantidade_full || 0)
    if (Math.abs(atual - quantidade) < 0.0001) return

    try {
      setSalvandoQuantidadeId(it.item_id)
      const resposta = await api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/quantidade-full`, {
        quantidade_full: quantidade,
      })
      const snapshot: ItemRevisao | undefined = resposta.data.snapshot
      if (snapshot) {
        // Só chegamos aqui quando a qtd mudou de fato (gera registro no histórico),
        // então marca tem_historico_full p/ o filtro "Qtd FULL alterada" refletir na hora.
        const snapshotMarcado: ItemRevisao = { ...snapshot, tem_historico_full: true }
        setRevisao((anterior) => anterior ? {
          ...anterior,
          resumo: {
            ...anterior.resumo,
            com_falta: anterior.itens
              .map((itemAtual) => itemAtual.item_id === snapshotMarcado.item_id ? snapshotMarcado : itemAtual)
              .filter((itemAtual) => itemAtual.tem_falta).length,
          },
          itens: anterior.itens.map((itemAtual) => itemAtual.item_id === snapshotMarcado.item_id ? snapshotMarcado : itemAtual),
        } : anterior)
        setQuantidadesFull((anterior) => ({ ...anterior, [it.item_id]: String(Math.round(snapshot.quantidade_full || 0)) }))
        if (!snapshot.tem_falta) {
          setDeclaracoes((anterior) => {
            const novo = { ...anterior }
            delete novo[it.item_id]
            return novo
          })
        }
      }
      await carregarInbounds()
    } catch (erro: any) {
      setQuantidadesFull((anterior) => ({ ...anterior, [it.item_id]: String(Math.round(it.quantidade_full || 0)) }))
      setMessage('Erro ao ajustar quantidade do FULL: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setSalvandoQuantidadeId(null)
    }
  }

  const abrirVinculo = (it: ItemRevisao) => {
    setVinculandoItem(it)
    const termo = it.sku_inbound || it.titulo_anuncio || ''
    setBuscaTermo(termo)
    setBuscaResultados([])
    setBuscaNaoAutorizado(null)
    if (termo) buscarOlist(termo)
  }

  const buscarOlist = async (termo: string) => {
    if (!termo || termo.trim().length < 1) return
    try {
      setBuscandoOlist(true)
      setBuscaNaoAutorizado(null)
      const resposta = await api.get('/olist/produtos', { params: { q: termo.trim() } })
      setBuscaResultados(resposta.data.produtos || [])
      if (resposta.data.nao_autorizado) {
        setBuscaNaoAutorizado({ url: resposta.data.url_autorizacao })
      }
    } catch (erro: any) {
      setMessage('Erro na busca: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setBuscandoOlist(false)
    }
  }

  const vincularAnuncio = async (produto: any) => {
    if (!vinculandoItem || !revisao) return
    // Se o item já foi baixado, trocar o vínculo transfere a baixa: estorna no
    // produto antigo e baixa no novo. Confirma antes (mexe no estoque da Olist).
    const jaBaixado = vinculandoItem.baixa_aplicada === 1
    const qtd = Math.round(Number(vinculandoItem.quantidade_full || 0))
    if (jaBaixado) {
      const ok = window.confirm(
        `Este item já foi baixado.\n\nTrocar o vínculo vai DEVOLVER ${qtd} un ao produto atual ` +
        `(${vinculandoItem.olist_nome || 'produto antigo'}) e BAIXAR ${qtd} un em "${produto.nome || produto.descricao}".\n\nConfirmar?`
      )
      if (!ok) return
    }
    try {
      setVinculandoProduto(true)
      const resp = await api.post(`/embaldes/${revisao.embale_id}/itens/${vinculandoItem.item_id}/vincular`, {
        olist_produto_id: produto.id,
        olist_sku: produto.sku || produto.codigo_produto || '',
        olist_nome: produto.nome || produto.descricao || '',
        olist_preco: produto.preco || 0,
      })
      setMessage(resp.data?.mensagem || `Vinculado: ${produto.nome || produto.descricao}`)
      setVinculandoItem(null)
      setBuscaResultados([])
      // Recarrega a revisão (agora o item será achado e terá estoque)
      const id = revisao.embale_id
      setRevisandoId(null)
      await carregarRevisao(id)
    } catch (erro: any) {
      setMessage('Erro ao vincular: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setVinculandoProduto(false)
    }
  }

  const formatarData = (iso?: string | null) => {
    if (!iso) return null
    return new Date(iso).toLocaleDateString('pt-BR')
  }

  // "valendo" e "processando" são ambos ativos (não encerrados)
  const ehAtivo = (status: string) => status !== 'encerrado'
  const inboundsFiltrados = inbounds.filter((i) =>
    aba === 'encerrado' ? i.status === 'encerrado' : ehAtivo(i.status)
  )
  const countProcessando = inbounds.filter((i) => ehAtivo(i.status)).length
  const countEncerrado = inbounds.filter((i) => i.status === 'encerrado').length
  const sucessoUpload = message && !message.toLowerCase().includes('erro')

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '1.25rem',
        flexWrap: 'wrap'
      }}>
        <h2 style={{ margin: 0, color: '#061a35' }}>Inbound (Lista de Separação FULL)</h2>
        {visao === 'upload' ? (
          <button
            type="button"
            onClick={irParaLista}
            style={{
              padding: '0.75rem 1.2rem',
              background: '#0878ff',
              color: '#fff',
              border: '1px solid #0878ff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              boxShadow: '0 8px 18px rgba(8, 120, 255, 0.22)'
            }}
          >
            Ver Inbounds
          </button>
        ) : (
          <button
            type="button"
            onClick={voltarParaUpload}
            style={{
              padding: '0.75rem 1.2rem',
              background: '#ffffff',
              color: '#0878ff',
              border: '1px solid #0878ff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Voltar para subir lista
          </button>
        )}
      </div>

      {/* Formulário de Upload */}
      {visao === 'upload' && (
      <div style={{
        backgroundColor: '#ffffff',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '2rem',
        border: '1px solid rgba(8, 120, 255, 0.18)',
        boxShadow: '0 18px 45px rgba(6, 26, 53, 0.14)'
      }}>
        <h3 style={{ marginTop: 0 }}>Subir Inbound</h3>
        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Envie o PDF de separação do Mercado Livre FULL ou da Shopee Fulfillment.
          O sistema lê o SKU de cada produto e verifica se já existe um anúncio vinculado na Olist.
        </p>

        <form onSubmit={handleUpload}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                Nome do Inbound:
              </label>
              <input
                type="text"
                placeholder="Ex: Inbound Semana 1"
                value={nomeInbound}
                onChange={(e) => setNomeInbound(e.target.value)}
                disabled={loading}
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem' }}
              />
            </div>
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                Data de envio do FULL:
              </label>
              <input
                type="date"
                value={dataLimite}
                onChange={(e) => setDataLimite(e.target.value)}
                disabled={loading || semData}
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem', backgroundColor: semData ? '#f0f0f0' : '#fff', color: semData ? '#999' : '#000' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', cursor: 'pointer', fontSize: '0.88rem', color: '#555' }}>
                <input
                  type="checkbox"
                  checked={semData}
                  onChange={(e) => { setSemData(e.target.checked); if (e.target.checked) setDataLimite('') }}
                  disabled={loading}
                />
                Sem data ainda (fica como <strong style={{ color: '#1565c0' }}>&nbsp;valendo</strong>)
              </label>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
              Arquivo PDF:
            </label>
            <div style={{ border: '2px dashed #ccc', borderRadius: '4px', padding: '1.5rem', textAlign: 'center', backgroundColor: '#fff' }}>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                disabled={loading}
                style={{ display: 'none' }}
                id="pdf-input"
              />
              <label htmlFor="pdf-input" style={{ cursor: 'pointer', display: 'block' }}>
                {arquivo ? (
                  <div style={{ color: '#2e7d32', fontWeight: 'bold' }}>{arquivo.name}</div>
                ) : (
                  <div style={{ color: '#666' }}>Clique para selecionar um PDF</div>
                )}
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !arquivo || !nomeInbound}
            style={{
              padding: '0.9rem 2rem',
              backgroundColor: (loading || !arquivo || !nomeInbound) ? '#ccc' : '#1976D2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (loading || !arquivo || !nomeInbound) ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '1rem'
            }}
          >
            {loading ? 'Processando...' : 'Subir Inbound'}
          </button>
        </form>

        {message && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: message.toLowerCase().includes('erro') ? '#ffebee' : '#e8f5e9',
            color: message.toLowerCase().includes('erro') ? '#c62828' : '#2e7d32',
            borderRadius: '4px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <span>{message}</span>
            {sucessoUpload && (
              <button
                type="button"
                onClick={irParaLista}
                style={{
                  padding: '0.55rem 1rem',
                  background: '#0878ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Ver Inbounds
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {visao === 'lista' && (
      <div style={{
        backgroundColor: '#ffffff',
        padding: '1.5rem',
        borderRadius: '8px',
        border: '1px solid rgba(8, 120, 255, 0.18)',
        boxShadow: '0 18px 45px rgba(6, 26, 53, 0.14)'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#061a35' }}>Gestão de Inbounds</h3>

        {message && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            backgroundColor: message.toLowerCase().includes('erro') ? '#ffebee' : '#e8f5e9',
            color: message.toLowerCase().includes('erro') ? '#c62828' : '#2e7d32',
            borderRadius: '6px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <span>{message}</span>
            <button
              onClick={() => setMessage('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'inherit', lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}

        {/* Abas */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #eef3f8', flexWrap: 'wrap' }}>
          <button
            onClick={() => setAba('processando')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '1rem',
              color: aba === 'processando' ? '#1976D2' : '#6d7b8f',
              borderBottom: aba === 'processando' ? '3px solid #1976D2' : '3px solid transparent',
              marginBottom: '-2px'
            }}
          >
            Ativos ({countProcessando})
          </button>
          <button
            onClick={() => setAba('encerrado')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '1rem',
              color: aba === 'encerrado' ? '#1976D2' : '#6d7b8f',
              borderBottom: aba === 'encerrado' ? '3px solid #1976D2' : '3px solid transparent',
              marginBottom: '-2px'
            }}
          >
            Encerrados ({countEncerrado})
          </button>
        </div>

        {/* Lista de Inbounds */}
        {inboundsFiltrados.length === 0 ? (
          <p style={{ color: '#6d7b8f', textAlign: 'center', padding: '2rem' }}>
            {aba === 'processando' ? 'Nenhum inbound processando.' : 'Nenhum inbound encerrado.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {inboundsFiltrados.map((inb) => (
              <div
                key={inb.id}
                style={{
                  border: '1px solid rgba(8, 120, 255, 0.16)',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  backgroundColor: inb.status === 'encerrado' ? '#f8fbff' : '#fff',
                  boxShadow: '0 8px 22px rgba(6, 26, 53, 0.08)'
                }}
              >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5rem', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }}
                onClick={() => carregarDetalhes(inb)}
              >
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  {editandoNome === inb.id ? (
                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={novoNomeInbound}
                        onChange={(e) => setNovoNomeInbound(e.target.value)}
                        style={{ padding: '0.45rem 0.6rem', border: '1px solid #ddd', borderRadius: '4px', minWidth: '220px', fontSize: '0.95rem' }}
                      />
                      <button onClick={() => salvarNomeInbound(inb.id)} style={{ padding: '0.4rem 0.7rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>OK</button>
                      <button onClick={() => { setEditandoNome(null); setNovoNomeInbound('') }} style={{ padding: '0.4rem 0.7rem', background: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>x</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{inb.nome_embalde}</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditandoNome(inb.id); setNovoNomeInbound(inb.nome_embalde || '') }}
                        style={{ padding: '0.2rem 0.5rem', background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }}
                      >
                        editar nome
                      </button>
                    </div>
                  )}
                  <div style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                    {inb.numero_inbound ? `Frete #${inb.numero_inbound}` : 'Sem número'}
                    {inb.total_unidades ? ` · ${Math.round(inb.total_unidades)} un` : ''}
                  </div>
                  {(() => {
                    const declarado = Math.round(inb.total_unidades || 0)
                    const lido = Math.round(inb.total_lido || 0)
                    if (declarado > 0 && lido !== declarado) {
                      const faltam = declarado - lido
                      return (
                        <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.6rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: '4px', color: '#c62828', fontSize: '0.78rem', fontWeight: 'bold' }}>
                          ⚠️ Leitura incompleta: {lido} de {declarado} un lidas
                          {faltam > 0 ? ` (faltam ${faltam})` : ` (${-faltam} a mais)`}. Confira os itens manualmente.
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>

                {/* Data limite */}
                <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: '0.85rem' }} onClick={(e) => e.stopPropagation()}>
                  {editandoData === inb.id ? (
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="date"
                        value={novaData}
                        onChange={(e) => setNovaData(e.target.value)}
                        style={{ padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                      <button onClick={() => salvarData(inb.id)} style={{ padding: '0.4rem 0.7rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>OK</button>
                      <button onClick={() => { setNovaData(''); salvarData(inb.id) }} title="Volta para VALENDO (sem data)" style={{ padding: '0.4rem 0.7rem', background: '#fff', color: '#1565c0', border: '1px solid #1565c0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }}>Sem data</button>
                      <button onClick={() => { setEditandoData(null); setNovaData('') }} style={{ padding: '0.4rem 0.7rem', background: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>x</button>
                    </div>
                  ) : (
                    <div>
                      <span style={{ color: '#666' }}>Envio FULL: </span>
                      {inb.status === 'valendo' ? (
                        <span style={{ padding: '0.15rem 0.5rem', background: '#e3f2fd', color: '#1565c0', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.8rem' }}>
                          VALENDO (sem data)
                        </span>
                      ) : (
                        <strong>{formatarData(inb.data_limite) || 'sem data'}</strong>
                      )}
                      {ehAtivo(inb.status) && (
                        <button
                          onClick={() => { setEditandoData(inb.id); setNovaData(inb.data_limite?.slice(0, 10) || '') }}
                          style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }}
                        >
                          editar
                        </button>
                      )}
                      {inb.status === 'encerrado' && inb.data_encerramento && (
                        <div style={{ color: '#999', marginTop: '0.2rem' }}>
                          Encerrado em {formatarData(inb.data_encerramento)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Vinculados ou Feito */}
                {inb.status === 'encerrado' ? (
                  <div style={{ flex: '0 1 110px', textAlign: 'center' }}>
                    {(() => {
                      const total = inb.qtd_items || 0
                      const processados = inb.qtd_baixados_apos_encerramento || 0
                      const percentual = total > 0 ? Math.round((processados / total) * 100) : 0
                      return (
                        <>
                          <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: percentual === 100 ? '#2e7d32' : percentual >= 50 ? '#ef6c00' : '#c62828' }}>
                            {percentual}%
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#666' }}>
                            {processados}/{total} feito
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ) : (
                  <div style={{ flex: '0 1 110px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: inb.qtd_validados === inb.qtd_items ? '#2e7d32' : '#ef6c00' }}>
                      {inb.qtd_validados}/{inb.qtd_items}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#666' }}>vinculados</div>
                  </div>
                )}

                {/* Ação */}
                <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', flex: '0 1 130px' }}>
                  <button
                    onClick={() => carregarRevisao(inb.id)}
                    style={{ padding: '0.5rem 1rem', background: revisandoId === inb.id ? '#1976D2' : '#fff', color: revisandoId === inb.id ? '#fff' : '#1976D2', border: '1px solid #1976D2', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    {revisandoId === inb.id ? 'Fechar revisão' : 'Revisar Olist'}
                  </button>
                  {ehAtivo(inb.status) ? (
                    <button
                      onClick={() => encerrarInbound(inb.id)}
                      style={{ padding: '0.5rem 1rem', background: '#fff', color: '#c62828', border: '1px solid #c62828', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                    >
                      Encerrar
                    </button>
                  ) : (
                    <button
                      onClick={() => deletarInbound(inb.id)}
                      style={{ padding: '0.5rem 1rem', background: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                      title="Remover este inbound encerrado do banco de dados"
                    >
                      Deletar
                    </button>
                  )}
                </div>
              </div>

              {/* Revisão de baixa na Olist */}
              {revisandoId === inb.id && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '2px solid #1976D2', overflowX: 'auto' }}>
                  {carregandoRevisao ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#1976D2', fontWeight: 'bold' }}>
                      Consultando estoque na Olist, produto por produto... aguarde.
                    </div>
                  ) : revisao ? (
                    modoSeparacao ? (
                      (() => {
                        const qtdEditados = revisao.itens.filter((x) => x.tem_historico_full).length
                        const qtdEmEspera = revisao.itens.filter((x) => itensEmEspera[x.item_id]).length
                        // Filtros: "só editados" (qtd FULL alterada) ou "só em espera".
                        const itens = soEditados
                          ? revisao.itens.filter((x) => x.tem_historico_full)
                          : soEmEspera
                            ? revisao.itens.filter((x) => itensEmEspera[x.item_id])
                            : revisao.itens
                        const total = itens.length
                        if ((soEditados || soEmEspera) && total === 0) {
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', padding: '2rem', textAlign: 'center', color: '#777' }}>
                              <div>{soEmEspera ? 'Nenhum produto está em espera neste inbound.' : 'Nenhum produto teve a quantidade do FULL alterada ainda.'}</div>
                              <button onClick={() => { setSoEditados(false); setSoEmEspera(false) }} style={{ padding: '0.55rem 1.1rem', background: '#fff', color: '#1976D2', border: '1px solid #1976D2', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Ver todos os produtos</button>
                            </div>
                          )
                        }
                        if (total === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Este inbound não tem itens.</div>
                        const idx = Math.min(sepIndex, total - 1)
                        const it = itens[idx]
                        const jaBaixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                        const naoAchado = !it.olist_encontrado
                        const semEstoque = it.olist_encontrado && it.estoque_indisponivel
                        const emEspera = !!itensEmEspera[it.item_id]
                        const podeBaixar = it.olist_encontrado && !semEstoque && !jaBaixado
                        const podeBalancear = it.olist_encontrado && !semEstoque && !jaBaixado
                        const vinculado = it.vinculado === 1 || !!it.olist_produto_id
                        // Foto: Olist (primária, vem no item) com o cache do ML como reserva.
                        const img = it.imagem || skuImg[String(it.sku_inbound || '').trim().toUpperCase()]
                        const quantidadeEditavel = quantidadesFull[it.item_id] ?? String(Math.round(it.quantidade_full || 0))
                        const irPara = (novoIdx: number) => {
                          const alvo = itens[novoIdx]
                          if (alvo) salvarPosicaoSeparacao(revisao.embale_id, alvo.item_id)
                          setSepIndex(novoIdx)
                        }
                        const proximo = () => irPara(Math.min(idx + 1, total - 1))
                        const anterior = () => irPara(Math.max(idx - 1, 0))
                        const resolvidos = itens.filter((x) => x.baixa_aplicada === 1 || !!itensBaixados[x.item_id] || !!itensEmEspera[x.item_id]).length
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Filtro: só os que tive a qtd do FULL alterada (retoma direto neles) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => { setSoEditados((v) => !v); setSoEmEspera(false); setSepIndex(0) }}
                                disabled={!soEditados && qtdEditados === 0}
                                title={qtdEditados === 0 ? 'Nenhum produto teve a quantidade do FULL alterada ainda' : 'Mostrar só os produtos com a quantidade do FULL alterada'}
                                style={{
                                  padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.85rem',
                                  cursor: (!soEditados && qtdEditados === 0) ? 'not-allowed' : 'pointer',
                                  border: `1px solid ${soEditados ? '#0d47a1' : '#90caf9'}`,
                                  background: soEditados ? '#0d47a1' : '#fff',
                                  color: soEditados ? '#fff' : (qtdEditados === 0 ? '#aaa' : '#0d47a1'),
                                }}
                              >
                                ✏️ Qtd FULL alterada ({qtdEditados})
                              </button>
                              <button
                                onClick={() => { setSoEmEspera((v) => !v); setSoEditados(false); setSepIndex(0) }}
                                disabled={!soEmEspera && qtdEmEspera === 0}
                                title={qtdEmEspera === 0 ? 'Nenhum produto está em espera' : 'Mostrar só os produtos em espera'}
                                style={{
                                  padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.85rem',
                                  cursor: (!soEmEspera && qtdEmEspera === 0) ? 'not-allowed' : 'pointer',
                                  border: `1px solid ${soEmEspera ? '#6a1b9a' : '#ce93d8'}`,
                                  background: soEmEspera ? '#6a1b9a' : '#fff',
                                  color: soEmEspera ? '#fff' : (qtdEmEspera === 0 ? '#aaa' : '#6a1b9a'),
                                }}
                              >
                                ⏸️ Em espera ({qtdEmEspera})
                              </button>
                              {soEditados && (
                                <span style={{ fontSize: '0.82rem', color: '#666' }}>Mostrando só os editados. <button onClick={() => { setSoEditados(false); setSepIndex(0) }} style={{ background: 'none', border: 'none', color: '#1976D2', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Ver todos</button></span>
                              )}
                              {soEmEspera && (
                                <span style={{ fontSize: '0.82rem', color: '#666' }}>Mostrando só os em espera. <button onClick={() => { setSoEmEspera(false); setSepIndex(0) }} style={{ background: 'none', border: 'none', color: '#1976D2', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Ver todos</button></span>
                              )}
                            </div>

                            {/* Barra de progresso */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                              <div style={{ fontWeight: 700, color: '#0d47a1', fontSize: '1.05rem' }}>
                                Produto {idx + 1} de {total}{soEditados ? ' (editados)' : soEmEspera ? ' (em espera)' : ''}
                              </div>
                              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                {resolvidos} de {total} resolvidos
                              </div>
                            </div>
                            <div style={{ height: '8px', background: '#e3f2fd', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${total > 0 ? Math.round((resolvidos / total) * 100) : 0}%`, background: '#1976D2', transition: 'width 0.3s' }} />
                            </div>

                            {/* Card grande: foto + infos */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '1.5rem', border: '1px solid #e0e0e0', borderRadius: '14px', padding: '1.5rem', background: jaBaixado ? '#eef7ee' : emEspera ? '#f5f5f5' : '#fff', alignItems: 'start' }}>
                              <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {img
                                  ? <img src={img} alt={it.titulo_anuncio} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <span style={{ color: '#ccc', fontSize: '3rem' }}>📦</span>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
                                <div>
                                  <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.3, color: '#1a1a1a' }}>{it.titulo_anuncio}</div>
                                  <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.9rem', color: '#555', fontWeight: 600 }}>SKU: {it.sku_inbound || '—'}</span>
                                    <span style={{ padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: vinculado ? '#e8f5e9' : '#fff3e0', color: vinculado ? '#2e7d32' : '#ef6c00', border: `1px solid ${vinculado ? '#a5d6a7' : '#ffcc80'}` }}>
                                      {vinculado ? '✓ vinculado' : 'sem vínculo'}
                                    </span>
                                    {jaBaixado && <span style={{ padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' }}>↓ estoque retirado</span>}
                                  </div>
                                  {vinculado && (
                                    <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: '0.82rem', color: '#555' }}>
                                        🔗 Vinculado a: <strong style={{ color: '#2e7d32' }}>{it.olist_nome || it.olist_produto_id || '—'}</strong>
                                      </span>
                                      <button
                                        onClick={() => abrirVinculo(it)}
                                        style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem', fontWeight: 700, color: '#ef6c00', background: '#fff', border: '1px solid #ffcc80', borderRadius: '999px', cursor: 'pointer' }}
                                      >
                                        Trocar vínculo
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Números */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '0.25rem' }}>
                                  <div style={{ background: '#f7f9fa', borderRadius: '8px', padding: '0.7rem' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#666', textTransform: 'uppercase', fontWeight: 700 }}>Estoque Olist</div>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1a1a1a' }}>{naoAchado ? '—' : semEstoque ? '?' : it.estoque_atual}</div>
                                  </div>
                                  <div style={{ background: '#f7f9fa', borderRadius: '8px', padding: '0.7rem' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#666', textTransform: 'uppercase', fontWeight: 700 }}>Vai pro FULL</div>
                                    {jaBaixado ? (
                                      <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{Math.round(it.quantidade_full)}</div>
                                    ) : (
                                      <input
                                        type="number" min="0" step="1"
                                        value={quantidadeEditavel}
                                        onChange={(e) => setQuantidadesFull({ ...quantidadesFull, [it.item_id]: e.target.value })}
                                        onBlur={() => salvarQuantidadeFull(it)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') salvarQuantidadeFull(it) }}
                                        disabled={emEspera}
                                        style={{ width: '90px', padding: '0.35rem', borderRadius: '6px', border: '1px solid #bbb', textAlign: 'center', fontSize: '1.1rem', fontWeight: 800, marginTop: '0.15rem', background: emEspera ? '#f0f0f0' : '#fff' }}
                                      />
                                    )}
                                  </div>
                                  <div style={{ background: '#f7f9fa', borderRadius: '8px', padding: '0.7rem' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#666', textTransform: 'uppercase', fontWeight: 700 }}>Situação</div>
                                    <div style={{ fontSize: '0.95rem', fontWeight: 800, marginTop: '0.25rem' }}>
                                      {naoAchado ? <span style={{ color: '#ef6c00' }}>Não achado na Olist</span>
                                        : semEstoque ? <span style={{ color: '#999' }}>Estoque indisponível</span>
                                        : it.tem_falta ? <span style={{ color: '#c62828' }}>Falta {Math.round(it.falta || 0)}</span>
                                        : <span style={{ color: '#2e7d32' }}>OK</span>}
                                    </div>
                                  </div>
                                </div>

                                {/* Declarar (quando há falta) */}
                                {it.tem_falta && !jaBaixado && !naoAchado && !semEstoque && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#666', fontWeight: 700 }}>Declarar p/ baixa:</label>
                                    <input
                                      type="number" min="0" max={it.estoque_atual || 0}
                                      value={declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0)}
                                      onChange={(e) => setDeclaracoes({ ...declaracoes, [it.item_id]: parseFloat(e.target.value) || 0 })}
                                      disabled={emEspera}
                                      style={{ width: '80px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #ddd', textAlign: 'center', fontSize: '0.95rem', background: emEspera ? '#f0f0f0' : '#fff' }}
                                    />
                                  </div>
                                )}

                                {/* Espera */}
                                {!jaBaixado && (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#555', cursor: 'pointer', width: 'fit-content' }}>
                                    <input
                                      type="checkbox"
                                      checked={emEspera}
                                      onChange={(e) => {
                                        const novo = { ...itensEmEspera, [it.item_id]: e.target.checked }
                                        setItensEmEspera(novo)
                                        setMarcandoEmEspera(it.item_id)
                                        api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/em-espera`, { em_espera: e.target.checked ? 1 : 0 }).finally(() => setMarcandoEmEspera(null))
                                      }}
                                      disabled={marcandoEmEspera === it.item_id}
                                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                    />
                                    Deixar em espera (bloqueia este item)
                                  </label>
                                )}

                                {/* Ações */}
                                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                  {emEspera ? (
                                    <span style={{ padding: '0.6rem 1rem', color: '#999', fontWeight: 700, background: '#f0f0f0', borderRadius: '8px' }}>Bloqueado (em espera)</span>
                                  ) : jaBaixado ? (
                                    <span style={{ padding: '0.6rem 1rem', color: '#2e7d32', fontWeight: 700, background: '#e8f5e9', borderRadius: '8px' }}>✓ Estoque retirado</span>
                                  ) : naoAchado ? (
                                    <button onClick={() => abrirVinculo(it)} style={{ padding: '0.7rem 1.4rem', background: '#fff', color: '#ef6c00', border: '1px solid #ef6c00', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>Vincular na Olist</button>
                                  ) : (() => {
                                    const kit = kitPorItem[it.item_id]
                                    if (kit === 'carregando') {
                                      return <span style={{ padding: '0.6rem 1rem', color: '#1976D2', fontWeight: 700, fontSize: '0.9rem' }}>Verificando se é kit…</span>
                                    }
                                    if (kit && typeof kit === 'object') {
                                      const res = kitResultado[it.item_id] || []
                                      return (
                                        <div style={{ width: '100%', border: '1px dashed #1976D2', borderRadius: '10px', padding: '0.9rem', background: '#f3f8ff' }}>
                                          <div style={{ fontWeight: 800, color: '#0d47a1', marginBottom: '0.25rem' }}>🎁 É um kit — trabalhe pelos componentes unitários</div>
                                          <div style={{ fontSize: '0.82rem', color: '#555', marginBottom: '0.6rem' }}>
                                            A Olist não deixa mexer no kit direto. Faça a baixa ou o balanço nos componentes abaixo.
                                          </div>
                                          {kit.componentes.map((c) => {
                                            const r = res.find((x) => String(x.produto_id) === String(c.produto_id))
                                            return (
                                              <div key={c.produto_id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', padding: '0.45rem 0', borderBottom: '1px solid #e3eefc' }}>
                                                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.descricao || c.sku || c.produto_id}</div>
                                                  <div style={{ fontSize: '0.78rem', color: '#666' }}>SKU: {c.sku || '—'} · {c.quantidade_no_kit}× por kit{c.estoque_atual != null ? ` · estoque Olist ${c.estoque_atual}` : ''}</div>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#555', fontWeight: 700 }}>
                                                  Baixar
                                                  <input
                                                    type="number" min="0" step="1"
                                                    value={kitQtds[c.produto_id] ?? String(c.quantidade_sugerida)}
                                                    onChange={(e) => setKitQtds({ ...kitQtds, [c.produto_id]: e.target.value })}
                                                    style={{ width: '90px', padding: '0.35rem', borderRadius: '6px', border: '1px solid #90caf9', textAlign: 'center', fontWeight: 800 }}
                                                  />
                                                </label>
                                                {r && (r.sucesso
                                                  ? <span style={{ color: '#2e7d32', fontWeight: 700, fontSize: '0.8rem' }}>✓ baixado</span>
                                                  : <span style={{ color: '#c62828', fontWeight: 700, fontSize: '0.8rem' }} title={r.detalhe || ''}>✗ falhou</span>)}
                                              </div>
                                            )
                                          })}
                                          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
                                            <button
                                              onClick={() => abrirBalanceamentoKit(it, kit)}
                                              disabled={balanceandoId === it.item_id}
                                              style={{ padding: '0.7rem 1.4rem', background: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '8px', cursor: balanceandoId === it.item_id ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}
                                            >
                                              {balanceandoId === it.item_id ? 'Abrindo…' : 'Balancear componentes'}
                                            </button>
                                            <button
                                              onClick={async () => { const ok = await baixarKitComponentes(it, kit); if (ok) proximo() }}
                                              disabled={baixandoKit}
                                              style={{ padding: '0.7rem 1.4rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '8px', cursor: baixandoKit ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}
                                            >
                                              {baixandoKit ? 'Baixando componentes…' : 'Baixar componentes na Olist'}
                                            </button>
                                          </div>
                                        </div>
                                      )
                                    }
                                    return (
                                      <>
                                        {podeBalancear && (
                                          <button onClick={() => abrirBalanceamento(it)} style={{ padding: '0.7rem 1.4rem', background: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>Balanço</button>
                                        )}
                                        {podeBaixar && (
                                          <button
                                            onClick={async () => { const ok = await baixarItem(it); if (ok) proximo() }}
                                            disabled={baixandoItemId === it.item_id}
                                            style={{ padding: '0.7rem 1.4rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '8px', cursor: baixandoItemId === it.item_id ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}
                                          >
                                            {baixandoItemId === it.item_id ? 'Baixando...' : 'Baixar na Olist'}
                                          </button>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                              </div>
                            </div>

                            {/* Navegação */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                              <button
                                onClick={anterior}
                                disabled={idx === 0}
                                style={{ padding: '0.7rem 1.4rem', background: '#fff', color: idx === 0 ? '#ccc' : '#555', border: '1px solid #ddd', borderRadius: '8px', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                              >
                                ← Anterior
                              </button>
                              <button
                                onClick={proximo}
                                disabled={idx >= total - 1}
                                style={{ padding: '0.7rem 1.8rem', background: idx >= total - 1 ? '#eee' : '#0d47a1', color: idx >= total - 1 ? '#999' : '#fff', border: 'none', borderRadius: '8px', cursor: idx >= total - 1 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '1rem' }}
                              >
                                Próximo →
                              </button>
                            </div>
                          </div>
                        )
                      })()
                    ) : (
                    <div>
                      {/* Resumo */}
                      {(() => {
                        const qtdEmEspera = revisao.itens.filter((it) => itensEmEspera[it.item_id]).length
                        return (
                          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ padding: '0.6rem 1rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.85rem' }}>
                              Total: <strong>{revisao.resumo.total}</strong>
                            </div>
                            <div style={{ padding: '0.6rem 1rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' }}>
                              Achados na Olist: <strong>{revisao.resumo.encontrados}</strong>
                            </div>
                            <div style={{ padding: '0.6rem 1rem', background: '#fff3e0', borderRadius: '4px', fontSize: '0.85rem' }}>
                              Não achados: <strong>{revisao.resumo.nao_encontrados}</strong>
                            </div>
                            <div style={{ padding: '0.6rem 1rem', background: '#ffebee', borderRadius: '4px', fontSize: '0.85rem' }}>
                              Com falta: <strong>{revisao.resumo.com_falta}</strong>
                            </div>
                            {qtdEmEspera > 0 && (
                              <div style={{ padding: '0.6rem 1rem', background: '#f3e5f5', borderRadius: '4px', fontSize: '0.85rem' }}>
                                Em espera: <strong>{qtdEmEspera}</strong>
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                        A primeira leitura do inbound fica salva no banco. Ajuste "Vai pro FULL" quando precisar e use baixa/balanço sem revisar tudo de novo.
                      </div>

                      {/* Filtros */}
                      {(() => {
                        const itBaixado = (it: ItemRevisao) => it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                        const itVinc = (it: ItemRevisao) => it.vinculado === 1 || !!it.olist_produto_id
                        const itFullAlterado = (it: ItemRevisao) => !!it.tem_historico_full
                        const chips: { id: FiltroRev; label: string; n: number }[] = [
                          { id: 'todos', label: 'Todos', n: revisao.itens.length },
                          { id: 'vinculados', label: 'Vinculados', n: revisao.itens.filter(itVinc).length },
                          { id: 'nao_vinculados', label: 'Não vinculados', n: revisao.itens.filter((i) => !itVinc(i)).length },
                          { id: 'baixados', label: 'Estoque retirado', n: revisao.itens.filter(itBaixado).length },
                          { id: 'nao_baixados', label: 'Ainda não retirado', n: revisao.itens.filter((i) => !itBaixado(i)).length },
                          { id: 'full_alterado', label: 'Qtd FULL alterada', n: revisao.itens.filter(itFullAlterado).length },
                        ]
                        return (
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {chips.map((c) => {
                              const ativo = filtroRevisao === c.id
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => setFiltroRevisao(c.id)}
                                  style={{
                                    padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: 'pointer',
                                    fontSize: '0.85rem', fontWeight: 600,
                                    border: ativo ? '1px solid #1976D2' : '1px solid #ddd',
                                    background: ativo ? '#1976D2' : '#fff',
                                    color: ativo ? '#fff' : '#555',
                                  }}
                                >
                                  {c.label} <span style={{ opacity: 0.8 }}>({c.n})</span>
                                </button>
                              )
                            })}
                            <button
                              onClick={() => carregarHistoricoFull(revisao.embale_id)}
                              style={{
                                padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: 'pointer',
                                fontSize: '0.85rem', fontWeight: 600,
                                border: '1px solid #8e24aa', background: '#fff', color: '#8e24aa',
                              }}
                            >
                              📜 Histórico de alterações
                            </button>
                          </div>
                        )
                      })()}

                      {/* Tabela */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 1.2fr 0.9fr 1.1fr 0.8fr 0.6fr 1.5fr', gap: '0.5rem', padding: '0.7rem 0.9rem', background: '#f5f5f5', borderRadius: '4px 4px 0 0', fontSize: '0.8rem', fontWeight: 'bold', color: '#555', textTransform: 'uppercase' }}>
                        <div>Produto / SKU</div>
                        <div style={{ textAlign: 'center' }}>Estoque Olist</div>
                        <div style={{ textAlign: 'center' }}>Vai pro FULL</div>
                        <div style={{ textAlign: 'center' }}>Resultado</div>
                        <div style={{ textAlign: 'center' }}>Situação</div>
                        <div style={{ textAlign: 'center' }}>Declarar</div>
                        <div style={{ textAlign: 'center' }}>Espera</div>
                        <div style={{ textAlign: 'center' }}>Ação</div>
                      </div>
                      <div style={{ maxHeight: '560px', overflowY: 'auto', border: '1px solid #eee', borderTop: 'none' }}>
                        {revisao.itens.filter((it) => {
                          const baixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                          const vinc = it.vinculado === 1 || !!it.olist_produto_id
                          if (filtroRevisao === 'vinculados') return vinc
                          if (filtroRevisao === 'nao_vinculados') return !vinc
                          if (filtroRevisao === 'baixados') return baixado
                          if (filtroRevisao === 'nao_baixados') return !baixado
                          if (filtroRevisao === 'full_alterado') return !!it.tem_historico_full
                          return true
                        }).map((it) => {
                          const naoAchado = !it.olist_encontrado
                          const semEstoque = it.olist_encontrado && it.estoque_indisponivel
                          const bg = naoAchado ? '#fff8f0' : it.tem_falta ? '#ffebee' : '#fff'
                          const jaBaixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                          const vinculado = it.vinculado === 1 || !!it.olist_produto_id
                          const podeBaixar = it.olist_encontrado && !semEstoque && !jaBaixado
                          const podeBalancear = it.olist_encontrado && !semEstoque && !jaBaixado
                          const quantidadeEditavel = quantidadesFull[it.item_id] ?? String(Math.round(it.quantidade_full || 0))
                          return (
                            <div
                              key={it.item_id}
                              style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 1.2fr 0.9fr 1.1fr 0.8fr 0.6fr 1.5fr', gap: '0.5rem', padding: '0.8rem 0.9rem', background: jaBaixado ? '#eef7ee' : bg, borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem', alignItems: 'center', opacity: itensEmEspera[it.item_id] ? 0.5 : (jaBaixado ? 0.8 : 1) }}
                            >
                              <div>
                                <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{it.titulo_anuncio}</div>
                                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  <span>SKU: {it.sku_inbound || '—'}</span>
                                  <span style={{
                                    padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
                                    background: vinculado ? '#e8f5e9' : '#fff3e0',
                                    color: vinculado ? '#2e7d32' : '#ef6c00',
                                    border: `1px solid ${vinculado ? '#a5d6a7' : '#ffcc80'}`
                                  }}>
                                    {vinculado ? '✓ vinculado' : 'sem vínculo'}
                                  </span>
                                  {jaBaixado && (
                                    <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' }}>
                                      ↓ estoque retirado
                                    </span>
                                  )}
                                </div>
                                {vinculado && (
                                  <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.76rem', color: '#555' }}>
                                      🔗 <strong style={{ color: '#2e7d32' }}>{it.olist_nome || it.olist_produto_id || '—'}</strong>
                                    </span>
                                    <button
                                      onClick={() => abrirVinculo(it)}
                                      style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, color: '#ef6c00', background: '#fff', border: '1px solid #ffcc80', borderRadius: '999px', cursor: 'pointer' }}
                                    >
                                      Trocar vínculo
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {naoAchado ? '—' : semEstoque ? '?' : it.estoque_atual}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {jaBaixado ? (
                                  <strong>{Math.round(it.quantidade_full)}</strong>
                                ) : (
                                  <div style={{ display: 'grid', gap: '0.25rem', justifyItems: 'center' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={quantidadeEditavel}
                                      onChange={(e) => setQuantidadesFull({ ...quantidadesFull, [it.item_id]: e.target.value })}
                                      onBlur={() => salvarQuantidadeFull(it)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') salvarQuantidadeFull(it) }}
                                      disabled={itensEmEspera[it.item_id]}
                                      style={{ width: '78px', padding: '0.32rem', borderRadius: '4px', border: '1px solid #bbb', textAlign: 'center', fontSize: '0.9rem', fontWeight: 700, backgroundColor: itensEmEspera[it.item_id] ? '#f0f0f0' : '#fff', color: itensEmEspera[it.item_id] ? '#999' : '#000', cursor: itensEmEspera[it.item_id] ? 'not-allowed' : 'auto' }}
                                    />
                                    {salvandoQuantidadeId === it.item_id && (
                                      <span style={{ fontSize: '0.68rem', color: '#1976D2', fontWeight: 700 }}>salvando...</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign: 'center', fontWeight: 'bold', color: '#2e7d32' }}>
                                {naoAchado || semEstoque ? '—' : it.tem_falta ? '—' : it.resultado}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {naoAchado ? (
                                  <span style={{ color: '#ef6c00', fontWeight: 'bold', fontSize: '0.8rem' }}>Não achado na Olist</span>
                                ) : semEstoque ? (
                                  <span style={{ color: '#999', fontSize: '0.8rem' }}>Estoque indisponível</span>
                                ) : it.tem_falta ? (
                                  <span style={{ color: '#c62828', fontWeight: 'bold', fontSize: '0.8rem' }}>Falta {Math.round(it.falta || 0)}</span>
                                ) : (
                                  <span style={{ color: '#2e7d32', fontWeight: 'bold', fontSize: '0.8rem' }}>OK</span>
                                )}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {it.tem_falta && !jaBaixado ? (
                                  <input
                                    type="number"
                                    min="0"
                                    max={it.estoque_atual || 0}
                                    value={declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0)}
                                    onChange={(e) => setDeclaracoes({ ...declaracoes, [it.item_id]: parseFloat(e.target.value) || 0 })}
                                    disabled={itensEmEspera[it.item_id]}
                                    style={{ width: '60px', padding: '0.3rem', borderRadius: '3px', border: '1px solid #ddd', textAlign: 'center', fontSize: '0.85rem', backgroundColor: itensEmEspera[it.item_id] ? '#f0f0f0' : '#fff', color: itensEmEspera[it.item_id] ? '#999' : '#000', cursor: itensEmEspera[it.item_id] ? 'not-allowed' : 'auto' }}
                                  />
                                ) : (
                                  <span style={{ color: '#999', fontSize: '0.8rem' }}>—</span>
                                )}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {jaBaixado ? (
                                  <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={itensEmEspera[it.item_id] || false}
                                    onChange={(e) => {
                                      const novo = { ...itensEmEspera, [it.item_id]: e.target.checked }
                                      setItensEmEspera(novo)
                                      if (revisao) {
                                        setMarcandoEmEspera(it.item_id)
                                        api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/em-espera`, { em_espera: e.target.checked ? 1 : 0 }).finally(() => setMarcandoEmEspera(null))
                                      }
                                    }}
                                    disabled={marcandoEmEspera === it.item_id}
                                    style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                                  />
                                )}
                              </div>
                              <div style={{ textAlign: 'center', display: 'flex', gap: '0.3rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                {itensEmEspera[it.item_id] ? (
                                  <span style={{ color: '#999', fontWeight: 'bold', fontSize: '0.8rem' }}>Bloqueado</span>
                                ) : jaBaixado ? (
                                  <span style={{ color: '#2e7d32', fontWeight: 'bold', fontSize: '0.8rem' }}>✓ Baixado</span>
                                ) : naoAchado ? (
                                  <button
                                    onClick={() => abrirVinculo(it)}
                                    style={{ padding: '0.3rem 0.7rem', background: '#fff', color: '#ef6c00', border: '1px solid #ef6c00', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                                  >
                                    Vincular
                                  </button>
                                ) : (
                                  <>
                                    {podeBalancear && (
                                      <button
                                        onClick={() => abrirBalanceamento(it)}
                                        style={{ padding: '0.3rem 0.7rem', background: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                                      >
                                        Balanço
                                      </button>
                                    )}
                                    {podeBaixar ? (
                                      <button
                                        onClick={() => baixarItem(it)}
                                        disabled={baixandoItemId === it.item_id}
                                        style={{ padding: '0.3rem 0.7rem', background: '#fff', color: '#1976D2', border: '1px solid #1976D2', borderRadius: '4px', cursor: baixandoItemId === it.item_id ? 'wait' : 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                                      >
                                        {baixandoItemId === it.item_id ? '...' : 'Baixar'}
                                      </button>
                                    ) : (
                                      <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Botão Confirmar Baixa em massa */}
                      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          onClick={confirmarBaixa}
                          disabled={confirmandoBaixa}
                          style={{ padding: '0.6rem 1.2rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: confirmandoBaixa ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: confirmandoBaixa ? 0.7 : 1 }}
                        >
                          {confirmandoBaixa ? 'Processando...' : 'Baixar TODOS pendentes na Olist'}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>
                          Baixa em massa. Ou use "Baixar" linha por linha. Não há volta!
                        </span>
                      </div>
                    </div>
                    )) : null}
                </div>
              )}

              {/* Detalhes expandidos */}
              {inboundSelecionado?.id === inb.id && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #eee' }}>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {inboundSelecionado.itens?.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '1rem',
                          backgroundColor: item.validado ? '#f1f8f4' : '#fff8f0',
                          borderRadius: '4px',
                          borderLeft: `4px solid ${item.validado ? '#2e7d32' : '#ef6c00'}`
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '1rem', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{item.titulo_anuncio}</div>
                            <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.3rem' }}>
                              SKU: <strong>{item.sku_inbound || '—'}</strong>
                              {item.codigo_ml ? ` · ML: ${item.codigo_ml}` : ''}
                            </div>
                            {!item.validado && item.validacao_mensagem && (
                              <div style={{ fontSize: '0.8rem', color: '#ef6c00', marginTop: '0.3rem' }}>
                                {item.validacao_mensagem}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{Math.round(item.quantidade_separada)}</div>
                            <div style={{ fontSize: '0.78rem', color: '#666' }}>unidades</div>
                          </div>
                          <div style={{
                            padding: '0.4rem 0.9rem',
                            backgroundColor: item.validado ? '#2e7d32' : '#ef6c00',
                            color: 'white',
                            borderRadius: '4px',
                            fontSize: '0.82rem',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}>
                            {item.validado ? 'Vinculado' : 'Sem vínculo'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Modal de Balanço de Estoque */}
      {balanceandoKit && (
        <div
          onClick={fecharBalanceamentos}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', width: '720px', maxWidth: '94vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#d32f2f' }}>Balancear Kit por Componentes</h3>
              <button onClick={fecharBalanceamentos} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ background: '#fff3e0', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', borderLeft: '4px solid #d32f2f' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Kit detectado na Olist</div>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                <strong>{balanceandoKit.item.titulo_anuncio}</strong>
                <br />SKU: {balanceandoKit.item.sku_inbound || balanceandoKit.kit.sku_kit || '—'}
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
              {balanceandoKit.kit.componentes.map((c) => {
                const real = kitRealQtds[c.produto_id]
                const baixar = kitQtds[c.produto_id] ?? String(c.quantidade_sugerida)
                const realNum = real === '' ? null : Number(real)
                const baixarNum = Math.max(0, Number(baixar) || 0)
                const divergente = realNum !== null && Number.isFinite(realNum) && realNum < baixarNum
                return (
                  <div key={c.produto_id} style={{ border: '1px solid #eee', borderRadius: '8px', padding: '0.9rem', background: divergente ? '#fff8f6' : '#fafcff' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{c.descricao || c.sku || c.produto_id}</div>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.75rem' }}>
                      SKU: {c.sku || '—'} · {c.quantidade_no_kit}x por kit · estoque Olist atual: {c.estoque_atual ?? '—'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 700, color: '#555' }}>
                        Vai pro FULL
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={baixar}
                          onChange={(e) => setKitQtds({ ...kitQtds, [c.produto_id]: e.target.value })}
                          style={{ padding: '0.55rem', borderRadius: '6px', border: '1px solid #bbb', fontWeight: 800 }}
                        />
                      </label>
                      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 700, color: '#555' }}>
                        Quantidade real no físico
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={real}
                          onChange={(e) => setKitRealQtds({ ...kitRealQtds, [c.produto_id]: e.target.value })}
                          placeholder={c.estoque_atual != null ? String(c.estoque_atual) : '0'}
                          style={{ padding: '0.55rem', borderRadius: '6px', border: '2px solid #d32f2f', fontWeight: 800 }}
                        />
                      </label>
                    </div>
                    {divergente && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#c62828', fontWeight: 700 }}>
                        Faltam {baixarNum - (realNum || 0)} un deste componente para baixar o FULL.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ background: '#f6f7f9', padding: '0.8rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.84rem', color: '#555' }}>
              O sistema vai balancear cada anúncio unitário com a quantidade real informada e, se houver saldo suficiente, já descontar a quantidade que vai para o FULL.
            </div>

            <div style={{ display: 'flex', gap: '0.7rem' }}>
              <button
                onClick={async () => {
                  const ok = await balancearKit(balanceandoKit.item, balanceandoKit.kit, revisandoId || 0)
                  if (ok && modoSeparacao) proximo()
                }}
                disabled={balanceandoId !== null}
                style={{ flex: 1, padding: '0.7rem', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: '4px', cursor: balanceandoId !== null ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: balanceandoId !== null ? 0.6 : 1 }}
              >
                {balanceandoId !== null ? 'Processando...' : 'Confirmar Balanço dos Componentes'}
              </button>
              <button
                onClick={fecharBalanceamentos}
                style={{ flex: 1, padding: '0.7rem', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {balanceandoItem && (
        <div
          onClick={fecharBalanceamentos}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', width: '520px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#d32f2f' }}>Balancear Estoque</h3>
              <button onClick={fecharBalanceamentos} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ background: '#fff3e0', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', borderLeft: '4px solid #d32f2f' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>⚠ Produto com divergência</div>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                <strong>{balanceandoItem.titulo_anuncio}</strong>
                <br />SKU: {balanceandoItem.sku_inbound || '—'}
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.3rem', fontWeight: 'bold' }}>Estoque na Olist (hoje)</label>
                  <div style={{ padding: '0.6rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '1.1rem', fontWeight: 'bold', color: '#1976D2' }}>
                    {balanceandoItem.estoque_atual || 0} un
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.3rem', fontWeight: 'bold' }}>Qtd FULL pendente</label>
                  <div style={{ padding: '0.6rem', background: '#f5f5f5', borderRadius: '4px', fontSize: '1.1rem', fontWeight: 'bold', color: '#ef6c00' }}>
                    {Math.round(balanceandoItem.quantidade_full)} un
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.3rem', fontWeight: 'bold' }}>
                  Quantas unidades você conferiu no FÍSICO? *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={qtdRealConferida}
                  onChange={(e) => setQtdRealConferida(e.target.value)}
                  autoFocus
                  placeholder="0"
                  style={{ width: '100%', padding: '0.7rem', borderRadius: '4px', border: '2px solid #d32f2f', fontSize: '1rem', fontWeight: 'bold' }}
                />
                <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.3rem', fontStyle: 'italic' }}>
                  Confira no estoque físico e digite a quantidade real que você encontrou
                </div>
              </div>
            </div>

            {(() => {
              const real = qtdRealConferida ? parseInt(qtdRealConferida) : null
              const full = Math.round(balanceandoItem.quantidade_full)
              const divergente = real !== null && real < full
              if (divergente) {
                const falta = full - (real as number)
                return (
                  <div style={{ background: '#fff3e0', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem', borderLeft: '4px solid #ef6c00' }}>
                    <strong>⚠️ Vai gerar divergência:</strong>
                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.2rem' }}>
                      <li>Olist será corrigida para {real} un (o real que você tem)</li>
                      <li><strong>NÃO</strong> será baixado para o FULL (faltam {falta} un para os {full} planejados)</li>
                      <li>O item continua com divergência até você resolver</li>
                      <li>Vou abrir o <strong>WhatsApp</strong> com a notificação (produto, qtd real e qtd que vai pro FULL)</li>
                    </ul>
                  </div>
                )
              }
              return (
                <div style={{ background: '#e8f5e9', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <strong>O que vai acontecer:</strong>
                  <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.2rem' }}>
                    <li>Olist será atualizada para {qtdRealConferida || '?'} un (corrigindo erros)</li>
                    <li>Será descontado {full} un para o FULL</li>
                    <li>Sobra: {real !== null ? Math.max(0, real - full) : '?'} un disponível</li>
                  </ul>
                </div>
              )
            })()}

            <div style={{ display: 'flex', gap: '0.7rem' }}>
              <button
                onClick={() => balancearItem(balanceandoItem, revisandoId || 0)}
                disabled={balanceandoId !== null || !qtdRealConferida}
                style={{ flex: 1, padding: '0.7rem', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: '4px', cursor: balanceandoId !== null || !qtdRealConferida ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: balanceandoId !== null || !qtdRealConferida ? 0.6 : 1 }}
              >
                {balanceandoId !== null ? 'Processando...' : 'Confirmar Balanço'}
              </button>
              <button
                onClick={fecharBalanceamentos}
                style={{ flex: 1, padding: '0.7rem', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Histórico de alterações do FULL */}
      {mostrarHistorico && (
        <div
          onClick={() => setMostrarHistorico(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', width: '720px', maxWidth: '94vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#8e24aa' }}>📜 Histórico de alterações do FULL</h3>
              <button onClick={() => setMostrarHistorico(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>
            {historicoFull.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                Nenhuma alteração de quantidade do FULL registrada neste inbound.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {historicoFull.map((h) => {
                  const aumento = h.tipo === 'aumento'
                  return (
                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.7rem 0.9rem', border: '1px solid #eee', borderRadius: '6px', borderLeft: `4px solid ${aumento ? '#2e7d32' : '#ef6c00'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{h.titulo_anuncio}</div>
                        <div style={{ fontSize: '0.78rem', color: '#666' }}>
                          SKU: {h.sku_inbound || '—'} · {h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR') : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, background: aumento ? '#e8f5e9' : '#fff3e0', color: aumento ? '#2e7d32' : '#ef6c00' }}>
                          {aumento ? '▲ aumentou' : '▼ reduziu'}
                        </span>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '0.2rem' }}>
                          {Math.round(h.quantidade_anterior)} → {Math.round(h.quantidade_nova)} un
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de vínculo manual (item não achado na Olist) */}
      {vinculandoItem && (
        <div
          onClick={() => { setVinculandoItem(null); setBuscaResultados([]) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', width: '640px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Vincular a um anúncio da Olist</h3>
              <button onClick={() => { setVinculandoItem(null); setBuscaResultados([]) }} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>
              Produto do inbound: <strong>{vinculandoItem.titulo_anuncio}</strong>
              <br />SKU do inbound: <strong>{vinculandoItem.sku_inbound || '—'}</strong>
            </div>

            {/* Busca */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input
                type="text"
                value={buscaTermo}
                onChange={(e) => setBuscaTermo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') buscarOlist(buscaTermo) }}
                placeholder="Buscar por SKU ou nome do anúncio..."
                autoFocus
                style={{ flex: 1, padding: '0.6rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.95rem' }}
              />
              <button
                onClick={() => buscarOlist(buscaTermo)}
                disabled={buscandoOlist}
                style={{ padding: '0.6rem 1.2rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {buscandoOlist ? 'Buscando...' : 'Buscar'}
              </button>
            </div>

            {/* Resultados */}
            {buscandoOlist ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#666' }}>Buscando na Olist...</div>
            ) : buscaResultados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#999' }}>
                {buscaNaoAutorizado ? (
                  <span style={{ color: '#b42318' }}>
                    ⚠️ Olist desconectado — não dá pra buscar produtos.{' '}
                    <a href={buscaNaoAutorizado.url || '/api/olist/conectar'} target="_blank" rel="noreferrer"
                      style={{ color: '#1976d2', fontWeight: 600 }}>Reconectar agora ↗</a>
                  </span>
                ) : buscaTermo ? 'Nenhum anúncio encontrado. Tente outro termo.' : 'Digite um termo e busque.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {buscaResultados.map((p) => (
                  <div
                    key={p.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.9rem', border: '1px solid #eee', borderRadius: '4px', gap: '1rem' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.nome || p.descricao}</div>
                      <div style={{ fontSize: '0.78rem', color: '#666' }}>
                        SKU: {p.sku || p.codigo_produto || '—'}{p.preco ? ` · R$ ${Number(p.preco).toFixed(2)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => vincularAnuncio(p)}
                      disabled={vinculandoProduto}
                      style={{ padding: '0.4rem 1rem', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '4px', cursor: vinculandoProduto ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                    >
                      {vinculandoProduto ? '...' : 'Vincular'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
