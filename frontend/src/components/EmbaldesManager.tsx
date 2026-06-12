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
  itens?: ItemInbound[]
}

type Aba = 'processando' | 'encerrado'
type VisaoInbound = 'upload' | 'lista'

interface ItemRevisao {
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string
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
}

interface Revisao {
  embale_id: number
  nome_embalde: string
  numero_inbound?: string
  status: string
  resumo: { total: number; encontrados: number; nao_encontrados: number; com_falta: number }
  itens: ItemRevisao[]
}

export function EmbaldesManager() {
  const [inbounds, setInbounds] = useState<Inbound[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [nomeInbound, setNomeInbound] = useState('')
  const [dataLimite, setDataLimite] = useState('')
  const [semData, setSemData] = useState(true)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [inboundSelecionado, setInboundSelecionado] = useState<Inbound | null>(null)
  const [aba, setAba] = useState<Aba>('processando')
  const [visao, setVisao] = useState<VisaoInbound>('upload')
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
  // Filtro da tabela de revisão
  type FiltroRev = 'todos' | 'vinculados' | 'nao_vinculados' | 'baixados' | 'nao_baixados'
  const [filtroRevisao, setFiltroRevisao] = useState<FiltroRev>('todos')
  // Vínculo manual de item "não achado"
  const [vinculandoItem, setVinculandoItem] = useState<ItemRevisao | null>(null)
  const [buscaTermo, setBuscaTermo] = useState('')
  const [buscaResultados, setBuscaResultados] = useState<any[]>([])
  const [buscandoOlist, setBuscandoOlist] = useState(false)
  const [vinculandoProduto, setVinculandoProduto] = useState(false)

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

  const carregarRevisao = async (id: number) => {
    if (revisandoId === id) {
      // Toggle: fecha
      setRevisandoId(null)
      setRevisao(null)
      setDeclaracoes({})
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
      setFiltroRevisao('todos')
      const resposta = await api.get(`/embaldes/${id}/revisao`)
      setRevisao(resposta.data)
      // Marca os que já foram baixados antes
      const jaBaixados: Record<number, number> = {}
      for (const it of resposta.data.itens || []) {
        if (it.baixa_aplicada === 1) jaBaixados[it.item_id] = 1
      }
      setItensBaixados(jaBaixados)
    } catch (erro: any) {
      setMessage('Erro ao revisar: ' + (erro.response?.data?.erro || String(erro)))
      setRevisandoId(null)
    } finally {
      setCarregandoRevisao(false)
    }
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

  const baixarItem = async (it: ItemRevisao) => {
    if (!revisao) return
    const qtd = it.tem_falta
      ? (declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0))
      : Math.round(it.quantidade_full)
    if (!confirm(`Baixar ${qtd} un. de "${it.titulo_anuncio}" na Olist? Não há volta.`)) return
    try {
      setBaixandoItemId(it.item_id)
      const resposta = await api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/baixa`, {
        quantidade: qtd
      })
      const r = resposta.data
      if (r.status === 'ok' || r.status === 'ja_baixado') {
        setItensBaixados({ ...itensBaixados, [it.item_id]: r.quantidade_baixada || qtd })
        setMessage(r.mensagem || 'Baixa aplicada')
      } else {
        setMessage(r.mensagem || r.erro || 'Não foi possível baixar')
      }
    } catch (erro: any) {
      setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setBaixandoItemId(null)
    }
  }

  const abrirVinculo = (it: ItemRevisao) => {
    setVinculandoItem(it)
    const termo = it.sku_inbound || it.titulo_anuncio || ''
    setBuscaTermo(termo)
    setBuscaResultados([])
    if (termo) buscarOlist(termo)
  }

  const buscarOlist = async (termo: string) => {
    if (!termo || termo.trim().length < 1) return
    try {
      setBuscandoOlist(true)
      const resposta = await api.get('/olist/produtos', { params: { q: termo.trim() } })
      setBuscaResultados(resposta.data.produtos || [])
    } catch (erro: any) {
      setMessage('Erro na busca: ' + (erro.response?.data?.erro || String(erro)))
    } finally {
      setBuscandoOlist(false)
    }
  }

  const vincularAnuncio = async (produto: any) => {
    if (!vinculandoItem || !revisao) return
    try {
      setVinculandoProduto(true)
      await api.post(`/embaldes/${revisao.embale_id}/itens/${vinculandoItem.item_id}/vincular`, {
        olist_produto_id: produto.id,
        olist_sku: produto.sku || produto.codigo_produto || '',
        olist_nome: produto.nome || produto.descricao || '',
        olist_preco: produto.preco || 0,
      })
      setMessage(`Vinculado: ${produto.nome || produto.descricao}`)
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

                {/* Vinculados */}
                <div style={{ flex: '0 1 110px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: inb.qtd_validados === inb.qtd_items ? '#2e7d32' : '#ef6c00' }}>
                    {inb.qtd_validados}/{inb.qtd_items}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#666' }}>vinculados</div>
                </div>

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
                    <span style={{ padding: '0.4rem 0.9rem', background: '#9e9e9e', color: '#fff', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 'bold', textAlign: 'center' }}>
                      Encerrado
                    </span>
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
                    <div>
                      {/* Resumo */}
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
                      </div>

                      <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                        Revisão (somente leitura) — selecione quantas unidades baixar em cada item.
                      </div>

                      {/* Filtros */}
                      {(() => {
                        const itBaixado = (it: ItemRevisao) => it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                        const itVinc = (it: ItemRevisao) => it.vinculado === 1 || !!it.olist_produto_id
                        const chips: { id: FiltroRev; label: string; n: number }[] = [
                          { id: 'todos', label: 'Todos', n: revisao.itens.length },
                          { id: 'vinculados', label: 'Vinculados', n: revisao.itens.filter(itVinc).length },
                          { id: 'nao_vinculados', label: 'Não vinculados', n: revisao.itens.filter((i) => !itVinc(i)).length },
                          { id: 'baixados', label: 'Estoque retirado', n: revisao.itens.filter(itBaixado).length },
                          { id: 'nao_baixados', label: 'Ainda não retirado', n: revisao.itens.filter((i) => !itBaixado(i)).length },
                        ]
                        return (
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
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
                          </div>
                        )
                      })()}

                      {/* Tabela */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 0.9fr 0.9fr 0.9fr 1.1fr 0.8fr 1fr', gap: '0.5rem', padding: '0.7rem 0.9rem', background: '#f5f5f5', borderRadius: '4px 4px 0 0', fontSize: '0.8rem', fontWeight: 'bold', color: '#555', textTransform: 'uppercase' }}>
                        <div>Produto / SKU</div>
                        <div style={{ textAlign: 'center' }}>Estoque Olist</div>
                        <div style={{ textAlign: 'center' }}>Vai pro FULL</div>
                        <div style={{ textAlign: 'center' }}>Resultado</div>
                        <div style={{ textAlign: 'center' }}>Situação</div>
                        <div style={{ textAlign: 'center' }}>Declarar</div>
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
                          return true
                        }).map((it) => {
                          const naoAchado = !it.olist_encontrado
                          const semEstoque = it.olist_encontrado && it.estoque_indisponivel
                          const bg = naoAchado ? '#fff8f0' : it.tem_falta ? '#ffebee' : '#fff'
                          const jaBaixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id]
                          const vinculado = it.vinculado === 1 || !!it.olist_produto_id
                          const podeBaixar = it.olist_encontrado && !semEstoque && !jaBaixado
                          return (
                            <div
                              key={it.item_id}
                              style={{ display: 'grid', gridTemplateColumns: '2.4fr 0.9fr 0.9fr 0.9fr 1.1fr 0.8fr 1fr', gap: '0.5rem', padding: '0.8rem 0.9rem', background: jaBaixado ? '#eef7ee' : bg, borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem', alignItems: 'center', opacity: jaBaixado ? 0.8 : 1 }}
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
                              </div>
                              <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {naoAchado ? '—' : semEstoque ? '?' : it.estoque_atual}
                              </div>
                              <div style={{ textAlign: 'center' }}>{Math.round(it.quantidade_full)}</div>
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
                                    style={{ width: '60px', padding: '0.3rem', borderRadius: '3px', border: '1px solid #ddd', textAlign: 'center', fontSize: '0.85rem' }}
                                  />
                                ) : (
                                  <span style={{ color: '#999', fontSize: '0.8rem' }}>—</span>
                                )}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {jaBaixado ? (
                                  <span style={{ color: '#2e7d32', fontWeight: 'bold', fontSize: '0.8rem' }}>✓ Baixado</span>
                                ) : naoAchado ? (
                                  <button
                                    onClick={() => abrirVinculo(it)}
                                    style={{ padding: '0.3rem 0.7rem', background: '#fff', color: '#ef6c00', border: '1px solid #ef6c00', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                                  >
                                    Vincular
                                  </button>
                                ) : podeBaixar ? (
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
                  ) : null}
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
                {buscaTermo ? 'Nenhum anúncio encontrado. Tente outro termo.' : 'Digite um termo e busque.'}
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
