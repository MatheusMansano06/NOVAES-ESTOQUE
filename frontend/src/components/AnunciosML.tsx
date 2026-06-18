import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { Precificador, type PricingSnapshot, loadPricingSummaryMap, loadPriceHistory } from './Precificador'
import { MLAnuncioEditorModal } from './MLAnuncioEditorModal'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
const DEFAULT_PAGE_SIZE = 20

interface Anuncio {
  id: string
  titulo: string
  sku: string
  preco: number
  preco_original?: number | null
  disponivel: number
  vendidos: number
  status: string
  tipo_anuncio: string
  tipo_anuncio_id: string
  frete_gratis: boolean
  frete_custo?: number | null
  frete_moeda?: string | null
  logistica?: string
  flex?: boolean
  full?: boolean
  preco_atacado?: {
    id?: string
    nome?: string
    valor?: string
  } | null
  imagens_total?: number
  imagem_principal?: string
  dimensoes?: {
    altura_cm?: number | null
    largura_cm?: number | null
    comprimento_cm?: number | null
    peso_g?: number | null
    texto?: string | null
    origem?: string
  } | null
  thumbnail?: string
  permalink?: string
  categoria_id?: string
}

interface Props { onVoltar: () => void }
type EditorMode = 'descricao' | 'imagens' | 'ficha' | 'dimensoes' | 'atacado' | 'flex'

const ABAS: { id: string; label: string }[] = [
  { id: 'active', label: 'Ativos' },
  { id: 'paused', label: 'Pausados' },
  { id: 'closed', label: 'Finalizados' },
]

const brl = (v?: number | null) => v == null ? '--' : 'R$ ' + v.toFixed(2).replace('.', ',')

const textoFrete = (a: Anuncio) => {
  if (a.frete_custo != null) return brl(a.frete_custo)
  if (a.frete_gratis) return 'gratis sem custo retornado'
  return 'nao gratis / sem subsidio'
}

const logisticaInfo = (a: Anuncio): { txt: string; sub: string } => {
  if (a.full) return { txt: 'Full', sub: 'ML armazena e envia' }
  if (a.flex) return { txt: 'Flex', sub: 'voce envia no mesmo dia' }
  if (a.logistica === 'cross_docking') return { txt: 'Cross-docking', sub: 'coleta agendada pelo ML' }
  if (a.logistica === 'xd_drop_off' || a.logistica === 'drop_off') return { txt: 'Agencia', sub: 'postagem em agencia' }
  return { txt: a.logistica || 'Padrao', sub: 'Mercado Envios' }
}

const percentual = (parte: number, total: number) => total > 0 ? ((parte / total) * 100).toFixed(2) : '0.00'

interface LivePriceSummary {
  cheio: number | null
  promocional: number | null
}

interface LivePriceBreakdown {
  frete: number | null
  tarifa: number | null
  tarifaPct: number | null
}

interface MarginViewModel {
  precoOriginal: number
  precoPromocional: number
  temPromo: boolean
  frete: number | null
  tarifa: number | null
  tarifaPct: number | null
  custo: number | null
  impostoPct: number
  imposto: number | null
  margem: number | null
  margemPct: number | null
}

function carregarImpostoAtual(): number {
  try {
    const raw = localStorage.getItem('nvs_imposto_pct') || '9'
    const parsed = Number(String(raw).replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 9
  } catch {
    return 9
  }
}

function montarResumoMargem(anuncio: Anuncio, resumo?: PricingSnapshot, live?: LivePriceSummary | null, breakdown?: LivePriceBreakdown | null): MarginViewModel {
  const precoOriginal = live?.cheio ?? (resumo?.precoOriginal && resumo.precoOriginal > 0 ? resumo.precoOriginal : (anuncio.preco_original || anuncio.preco))
  const precoPromocional = live?.promocional ?? (resumo?.precoPromocional && resumo.precoPromocional > 0 ? resumo.precoPromocional : anuncio.preco)
  const frete = resumo?.frete ?? breakdown?.frete ?? anuncio.frete_custo ?? null
  const tarifa = resumo?.tarifa ?? breakdown?.tarifa ?? null
  const tarifaPct = resumo?.tarifaPct ?? breakdown?.tarifaPct ?? null
  const custo = resumo?.custo ?? null
  const impostoPct = resumo?.impostoPct ?? carregarImpostoAtual()
  const imposto = precoPromocional > 0 ? (precoPromocional * impostoPct) / 100 : null
  const margem = frete != null && tarifa != null && custo != null && imposto != null
    ? precoPromocional - frete - tarifa - custo - imposto
    : null
  const margemPct = margem != null && precoPromocional > 0 ? (margem / precoPromocional) * 100 : null

  return {
    precoOriginal,
    precoPromocional,
    temPromo: precoPromocional < precoOriginal - 0.01,
    frete,
    tarifa,
    tarifaPct,
    custo,
    impostoPct,
    imposto,
    margem,
    margemPct,
  }
}

export function AnunciosML({ onVoltar }: Props) {
  const [aba, setAba] = useState('active')
  const [anuncios, setAnuncios] = useState<Anuncio[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [statusConexao, setStatusConexao] = useState<'ok' | 'erro' | 'verificando'>('verificando')
  const [precificando, setPrecificando] = useState<Anuncio | null>(null)
  const [editando, setEditando] = useState<{ anuncio: Anuncio; mode: EditorMode } | null>(null)
  const [resumos, setResumos] = useState<Record<string, PricingSnapshot>>({})

  useEffect(() => {
    setResumos(loadPricingSummaryMap())
  }, [])

  const termoBusca = busca.trim()

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const params = new URLSearchParams({
        status: aba,
        offset: String(offset),
        limit: String(pageSize),
      })
      if (termoBusca) params.set('q', termoBusca)
      const r = await fetch(`${API_BASE}/api/ml/anuncios?${params.toString()}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.erro) {
        setErro(d.erro || 'Falha ao carregar anuncios')
        setAnuncios([])
        setTotal(0)
        setStatusConexao('erro')
      } else {
        setAnuncios(d.anuncios || [])
        setTotal(d.total || 0)
        setStatusConexao('ok')
      }
    } catch (e) {
      setErro('Erro de conexao: ' + String(e))
      setStatusConexao('erro')
    } finally {
      setLoading(false)
    }
  }, [aba, offset, pageSize, termoBusca])

  useEffect(() => { carregar() }, [carregar])

  const trocarAba = (novaAba: string) => { setAba(novaAba); setOffset(0); setBusca('') }
  const aoMudarBusca = (valor: string) => {
    setBusca(valor)
    setOffset(0)
  }
  const aoMudarPageSize = (valor: number) => {
    setPageSize(valor)
    setOffset(0)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  const paginaAtual = Math.floor(offset / pageSize) + 1

  const corStatus = (s: string) => s === 'active' ? '#2e7d32' : s === 'paused' ? '#e65100' : '#9e9e9e'
  const labelStatus = (s: string) => s === 'active' ? 'Ativo' : s === 'paused' ? 'Pausado' : s === 'closed' ? 'Finalizado' : s

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={onVoltar} style={{ padding: '0.75rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Voltar</button>
          <span style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem', borderRadius: '20px', fontWeight: 600,
            background: statusConexao === 'ok' ? '#e8f5e9' : statusConexao === 'erro' ? '#ffebee' : '#f5f5f5',
            color: statusConexao === 'ok' ? '#2e7d32' : statusConexao === 'erro' ? '#c62828' : '#999' }}>
            {statusConexao === 'ok' ? 'Conectado ao Mercado Livre' : statusConexao === 'erro' ? 'Sem conexao com o ML' : 'Verificando...'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #e0e0e0', flexWrap: 'wrap' }}>
          {ABAS.map(t => (
            <button key={t.id} onClick={() => trocarAba(t.id)}
              style={{ padding: '0.85rem 1.5rem', background: aba === t.id ? '#FFE600' : 'transparent', color: aba === t.id ? '#2d3277' : '#333',
                border: 'none', cursor: 'pointer', fontWeight: 600, borderRadius: '8px 8px 0 0',
                borderBottom: aba === t.id ? '3px solid #2d3277' : 'none' }}>
              {t.label}{aba === t.id && total > 0 ? ` (${total})` : ''}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Buscar em todos os anuncios por titulo, SKU ou MLB..."
            value={busca}
            onChange={e => aoMudarBusca(e.target.value)}
            style={{ flex: '1 1 420px', minWidth: '280px', padding: '0.75rem 1rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.92rem', color: '#455a64', fontWeight: 600 }}>
            Mostrar
            <select
              value={pageSize}
              onChange={e => aoMudarPageSize(Number(e.target.value))}
              style={{ padding: '0.72rem 0.85rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.92rem', background: '#fff', color: '#1a1a1a' }}
            >
              {PAGE_SIZE_OPTIONS.map(opcao => (
                <option key={opcao} value={opcao}>{opcao}</option>
              ))}
            </select>
            por pagina
          </label>
        </div>

        {erro && (
          <div style={{ padding: '1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: '8px', color: '#c62828', marginBottom: '1.5rem' }}>
            {erro}
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
              Se for problema de autorizacao, <a href={`${API_BASE}/api/ml/conectar`} style={{ color: '#1976d2' }}>reconecte o Mercado Livre aqui</a>.
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Carregando anuncios...</p>
        ) : anuncios.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>{erro ? '' : 'Nenhum anuncio encontrado.'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {anuncios.map(a => {
              const resumo = resumos[a.id]
              return (
                <div key={a.id} style={{ padding: '1rem', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ width: '64px', height: '64px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(a.imagem_principal || a.thumbnail) ? <img src={a.imagem_principal || a.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc' }}>--</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.3rem', lineHeight: 1.3 }}>{a.titulo}</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem' }}>
                        <span style={{ background: '#ede7f6', color: '#4527a0', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>{a.tipo_anuncio}</span>
                        {a.sku && <span style={{ color: '#555' }}>SKU: {a.sku}</span>}
                        <a href={a.permalink} target="_blank" rel="noreferrer" style={{ color: '#3483fa', textDecoration: 'none' }}>{a.id}</a>
                        {a.frete_gratis && <span style={{ color: '#2e7d32' }}>frete gratis</span>}
                        {a.full && <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>FULL</span>}
                        {a.flex && <span style={{ background: '#fff3e0', color: '#ef6c00', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>FLEX</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: '70px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#999' }}>Estoque</div>
                      <div style={{ fontWeight: 700, color: a.disponivel > 0 ? '#1a1a1a' : '#c62828' }}>{a.disponivel}</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: '70px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#999' }}>Vendidos</div>
                      <div style={{ fontWeight: 700, color: '#1a1a1a' }}>{a.vendidos}</div>
                    </div>
                    <PriceBubble anuncio={a} resumo={resumo} statusCor={corStatus(a.status)} statusLabel={labelStatus(a.status)} onPriceChanged={carregar} />
                  </div>

                  <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #f0f0f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem' }}>
                    <InfoCard
                      icon="🚚" tom="#2563eb"
                      label="Frete do anuncio"
                      valor={textoFrete(a)}
                      sub={a.frete_gratis ? 'gratis (subsidio ML)' : 'por conta do comprador'}
                    />
                    <InfoCard
                      icon="📍" tom="#7c4dff"
                      label="Logistica"
                      valor={logisticaInfo(a).txt}
                      sub={logisticaInfo(a).sub}
                    />
                    <InfoCard
                      icon="🖼️" tom="#0f9d8f"
                      label="Imagens"
                      valor={`${a.imagens_total || 0} ${(a.imagens_total || 0) === 1 ? 'foto' : 'fotos'}`}
                      sub={(a.imagens_total || 0) < 3 ? 'recomendado: 3+' : 'cadastradas'}
                    />
                    <InfoCard
                      icon="📦" tom="#d9730d"
                      label="Dimensoes"
                      valor={a.dimensoes?.texto || '--'}
                      sub={a.full ? 'medido pelo ML (Full)' : (a.dimensoes ? 'declarado pelo vendedor' : 'nao informado')}
                      badge={a.full ? 'travado' : undefined}
                    />
                  </div>

                  <div style={{ marginTop: '.9rem', display: 'flex', gap: '.55rem', flexWrap: 'wrap' }}>
                    <ActionBtn label="Descricao" onClick={() => setEditando({ anuncio: a, mode: 'descricao' })} />
                    <ActionBtn label="Imagens" onClick={() => setEditando({ anuncio: a, mode: 'imagens' })} />
                    <ActionBtn label="Ficha Tecnica" onClick={() => setEditando({ anuncio: a, mode: 'ficha' })} />
                    <ActionBtn label="Dimensoes" onClick={() => setEditando({ anuncio: a, mode: 'dimensoes' })} />
                    <ActionBtn label="Atacado B2B" onClick={() => setEditando({ anuncio: a, mode: 'atacado' })} />
                    <ActionBtn label="Flex" onClick={() => setEditando({ anuncio: a, mode: 'flex' })} />
                    <ActionBtn label="Precificador" strong onClick={() => setPrecificando(a)} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && total > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}
              style={{ padding: '0.6rem 1.2rem', background: offset === 0 ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: offset === 0 ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Anterior</button>
            <span style={{ color: '#666', fontSize: '0.9rem' }}>Pagina {paginaAtual} de {totalPaginas}</span>
            <button disabled={paginaAtual >= totalPaginas} onClick={() => setOffset(offset + pageSize)}
              style={{ padding: '0.6rem 1.2rem', background: paginaAtual >= totalPaginas ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: paginaAtual >= totalPaginas ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Proxima</button>
          </div>
        )}

        {precificando && (
        <Precificador
          titulo={precificando.titulo}
          sku={precificando.sku}
          itemId={precificando.id}
          precoInicial={precificando.preco}
          precoOriginal={precificando.preco_original}
          freteInicial={precificando.frete_custo || 0}
          categoryId={precificando.categoria_id}
          tipoAtualId={precificando.tipo_anuncio_id}
          onClose={() => setPrecificando(null)}
          onSaved={(snapshot) => {
            setResumos(prev => ({ ...prev, [snapshot.itemId]: snapshot }))
            setPrecificando(null)
          }}
        />
      )}

      {editando && (
        <MLAnuncioEditorModal
          anuncio={editando.anuncio}
          mode={editando.mode}
          onClose={() => setEditando(null)}
          onUpdated={() => {
            setEditando(null)
            carregar()
          }}
        />
      )}
    </div>
  )
}

function ResumoTooltip({ anuncio, resumo, editavel = false, modal = false, onSaved, onClose }: { anuncio: Anuncio; resumo?: PricingSnapshot; editavel?: boolean; modal?: boolean; onSaved?: () => void; onClose?: () => void }) {
  const [live, setLive] = useState<LivePriceSummary | null>(null)
  const [breakdown, setBreakdown] = useState<LivePriceBreakdown | null>(null)
  const [novoPreco, setNovoPreco] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const historico = resumo ? loadPriceHistory(anuncio.id) : []

  useEffect(() => {
    let ativo = true
    Promise.all([
      fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/preco-resumo`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([precoData, detailData]) => {
      if (!ativo) return
      if (precoData && !precoData.erro) {
        setLive({ cheio: precoData.cheio ?? null, promocional: precoData.promocional ?? null })
      }
      if (detailData && !detailData.erro) {
        setBreakdown({
          frete: detailData?.shipping_fee?.list_cost ?? detailData?.item?.frete_custo ?? null,
          tarifa: detailData?.tarifa_atual?.tarifa ?? null,
          tarifaPct: detailData?.tarifa_atual?.percentual ?? null,
        })
      }
    }).catch(() => { /* mantem fallback */ })
    return () => { ativo = false }
  }, [anuncio.id])

  const resumoMargem = montarResumoMargem(anuncio, resumo, live, breakdown)

  // Quando abre em modo edição, pré-preenche o input com o preço cheio atual.
  useEffect(() => {
    if (editavel && novoPreco === '' && resumoMargem.precoOriginal > 0) {
      setNovoPreco(resumoMargem.precoOriginal.toFixed(2))
    }
  }, [editavel, resumoMargem.precoOriginal, novoPreco])

  const salvarPrecoCheio = async () => {
    const v = Number(String(novoPreco).replace(',', '.'))
    if (!v || v <= 0) { setMsg({ tipo: 'erro', texto: 'Informe um preço válido' }); return }
    if (!window.confirm(`Alterar o preço cheio para ${brl(v)}?\n\nIsso pode tirar o anúncio de promoções ativas no Mercado Livre.`)) return
    setSalvando(true); setMsg(null)
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/preco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preco: v }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao aplicar o preço')
      const aplicado = Number(d.preco_novo || v)
      setMsg({ tipo: 'ok', texto: `Preço cheio atualizado: ${brl(aplicado)}` })
      setLive(prev => ({ cheio: aplicado, promocional: prev?.promocional ?? null }))
      onSaved?.()
    } catch (e) {
      setMsg({ tipo: 'erro', texto: String(e instanceof Error ? e.message : e) })
    } finally {
      setSalvando(false)
    }
  }

  const rootStyle: CSSProperties = modal
    ? { position: 'relative', width: '100%', background: '#ffffff', color: '#1d2939', border: '1px solid #cfe0ff', borderRadius: '14px', padding: '1.1rem 1.25rem', boxShadow: '0 24px 60px rgba(16,24,40,.28)', textAlign: 'left' }
    : { position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: '304px', background: '#ffffff', color: '#1d2939', border: '1px solid #cfe0ff', borderRadius: '12px', padding: '.9rem 1rem', boxShadow: '0 14px 30px rgba(16,24,40,.14)', zIndex: 30, textAlign: 'left' }

  return (
    <div onClick={editavel ? (e) => e.stopPropagation() : undefined} style={rootStyle}>
      {modal && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.75rem', marginBottom: '.75rem', paddingBottom: '.6rem', borderBottom: '1px solid #e9eef7' }}>
          <div style={{ fontSize: '.9rem', fontWeight: 800, color: '#1d2939', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{anuncio.titulo}</div>
          <button onClick={(e) => { e.stopPropagation(); onClose?.() }} aria-label="Fechar" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: '1px solid #e4e7ec', background: '#fff', color: '#667085', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
      )}
      <LinhaResumo label="Preco original" valor={brl(resumoMargem.precoOriginal)} risco={resumoMargem.temPromo} />
      <LinhaResumo label="Preco promocional" valor={brl(resumoMargem.precoPromocional)} cor={resumoMargem.temPromo ? '#067647' : undefined} />
      <LinhaResumo label="Frete" valor={resumoMargem.frete != null ? `-${brl(resumoMargem.frete)}` : '--'} extra={resumoMargem.frete != null ? `${percentual(resumoMargem.frete, resumoMargem.precoPromocional)}%` : undefined} cor="#b42318" />
      <LinhaResumo label="Tarifa de venda" valor={resumoMargem.tarifa != null ? `-${brl(resumoMargem.tarifa)}` : '--'} extra={resumoMargem.tarifaPct != null ? `${resumoMargem.tarifaPct.toFixed(2)}%` : undefined} cor="#b42318" />
      <LinhaResumo label="Custo" valor={resumoMargem.custo != null ? `-${brl(resumoMargem.custo)}` : '--'} cor="#b42318" />
      <LinhaResumo label="Imposto" valor={resumoMargem.imposto != null ? `-${brl(resumoMargem.imposto)}` : '--'} extra={resumoMargem.impostoPct ? `${resumoMargem.impostoPct.toFixed(2)}%` : undefined} cor="#b42318" />
      <div style={{ height: 1, background: '#e9eef7', margin: '.55rem 0' }} />
      <LinhaResumo label="Marg. contribuicao" valor={resumoMargem.margem != null ? brl(resumoMargem.margem) : '--'} extra={resumoMargem.margemPct != null ? `${resumoMargem.margemPct.toFixed(2)}%` : undefined} strong cor={resumoMargem.margem != null && resumoMargem.margem < 0 ? '#b42318' : '#3483fa'} />
      {historico.length > 0 && (
        <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid #e9eef7' }}>
          <div style={{ fontSize: '.68rem', color: '#98a2b3', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '.3rem' }}>Histórico de preço</div>
          {historico.slice(0, 3).map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem', color: '#667085', padding: '.1rem 0' }}>
              <span>{new Date(h.data).toLocaleDateString('pt-BR')}</span>
              <span>{brl(h.de)} → <strong style={{ color: '#1d2939' }}>{brl(h.para)}</strong></span>
            </div>
          ))}
        </div>
      )}
      {resumo && (
        <div style={{ marginTop: '.45rem', fontSize: '.68rem', color: '#98a2b3' }}>
          * Frete, tarifa, custo e imposto seguem a base salva no Precificador.
        </div>
      )}
      {!resumo && !editavel && (
        <div style={{ marginTop: '.45rem', fontSize: '.68rem', color: '#98a2b3' }}>
          * Frete e tarifa vêm direto do ML. Para custo/margem exatos, salve os dados no Precificador.
        </div>
      )}
      {editavel && (
        <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid #e9eef7' }}>
          <div style={{ fontSize: '.68rem', color: '#98a2b3', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '.4rem' }}>Editar preço cheio</div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <span style={{ fontSize: '.85rem', color: '#475467', fontWeight: 700 }}>R$</span>
            <input
              type="text"
              inputMode="decimal"
              value={novoPreco}
              onChange={e => setNovoPreco(e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, minWidth: 0, padding: '.45rem .6rem', border: '1px solid #cfd8dc', borderRadius: 6, fontSize: '.9rem', fontWeight: 700, boxSizing: 'border-box' }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); salvarPrecoCheio() }}
              disabled={salvando}
              style={{ padding: '.45rem .8rem', background: '#5b3cc4', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {salvando ? '...' : 'Salvar'}
            </button>
          </div>
          <div style={{ marginTop: '.4rem', fontSize: '.7rem', color: '#b54708', background: '#fffaeb', border: '1px solid #fedf89', borderRadius: 6, padding: '.4rem .5rem' }}>
            ⚠️ Alterar o preço cheio pode tirar o anúncio de promoções ativas no Mercado Livre.
          </div>
          {msg && (
            <div style={{ marginTop: '.4rem', fontSize: '.72rem', fontWeight: 700, color: msg.tipo === 'ok' ? '#067647' : '#b42318' }}>{msg.texto}</div>
          )}
        </div>
      )}
      {!modal && <div style={{ position: 'absolute', top: -7, right: 32, width: 14, height: 14, background: '#ffffff', borderLeft: '1px solid #cfe0ff', borderTop: '1px solid #cfe0ff', transform: 'rotate(45deg)' }} />}
    </div>
  )
}

function PriceBubble({ anuncio, resumo, statusCor, statusLabel, onPriceChanged }: { anuncio: Anuncio; resumo?: PricingSnapshot; statusCor: string; statusLabel: string; onPriceChanged?: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [live, setLive] = useState<LivePriceSummary | null>(null)
  const [breakdown, setBreakdown] = useState<LivePriceBreakdown | null>(null)
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)

  useEffect(() => {
    let ativo = true
    fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/preco-resumo`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!ativo || d.erro) return
        setLive({ cheio: d.cheio ?? null, promocional: d.promocional ?? null })
      })
      .catch(() => { /* fallback para os valores da lista */ })
    return () => { ativo = false }
  }, [anuncio.id])

  useEffect(() => {
    if (!hovered || resumo || breakdown || loadingBreakdown) return
    let ativo = true
    setLoadingBreakdown(true)
    fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!ativo || d.erro) return
        setBreakdown({
          frete: d?.shipping_fee?.list_cost ?? d?.item?.frete_custo ?? null,
          tarifa: d?.tarifa_atual?.tarifa ?? null,
          tarifaPct: d?.tarifa_atual?.percentual ?? null,
        })
      })
      .catch(() => { /* fallback silencioso */ })
      .finally(() => {
        if (ativo) setLoadingBreakdown(false)
      })
    return () => { ativo = false }
  }, [hovered, resumo, breakdown, loadingBreakdown, anuncio.id])

  const resumoMargem = montarResumoMargem(anuncio, resumo, live, breakdown)

  return (
    <>
    {aberto && (
      <div
        onClick={() => setAberto(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      >
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 380 }}>
          <ResumoTooltip anuncio={anuncio} resumo={resumo} editavel modal onSaved={onPriceChanged} onClose={() => setAberto(false)} />
        </div>
      </div>
    )}
    <div
      onClick={() => setAberto(v => !v)}
      style={{
        position: 'relative',
        minWidth: '148px',
        marginLeft: 'auto',
        padding: '.42rem .7rem .48rem',
        borderRadius: '10px',
        background: '#fff',
        border: aberto ? '1px solid #5b3cc4' : '1px solid #9fc2ff',
        boxShadow: (hovered || aberto) ? '0 10px 24px rgba(52,131,250,.18)' : 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {resumoMargem.temPromo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', justifyContent: 'flex-start', marginBottom: '.1rem' }}>
          <span style={{ fontSize: '.75rem' }}>🏷️</span>
          <span style={{ fontSize: '0.78rem', color: '#98a2b3', textDecoration: 'line-through', fontWeight: 700 }}>{brl(resumoMargem.precoOriginal)}</span>
        </div>
      )}
      <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#1a1a1a' }}>{brl(resumoMargem.precoPromocional)}</div>
      <div style={{ marginTop: '.38rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.38rem' }}>
        <BubbleMetric label="MC R$" value={resumoMargem.margem != null ? brl(resumoMargem.margem) : '--'} cor={resumoMargem.margem != null && resumoMargem.margem < 0 ? '#b42318' : '#067647'} />
        <BubbleMetric label="MC %" value={resumoMargem.margemPct != null ? `${resumoMargem.margemPct.toFixed(2)}%` : '--'} cor={resumoMargem.margemPct != null && resumoMargem.margemPct < 0 ? '#b42318' : '#067647'} />
      </div>
      <div style={{ marginTop: '.08rem', fontSize: '0.72rem', fontWeight: 700, color: statusCor, textAlign: 'right' }}>{statusLabel}</div>
      {hovered && !aberto && <ResumoTooltip anuncio={anuncio} resumo={resumo} />}
    </div>
    </>
  )
}

function BubbleMetric({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '.34rem .45rem' }}>
      <div style={{ fontSize: '.62rem', color: '#98a2b3', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '.82rem', color: cor, fontWeight: 800, lineHeight: 1.2 }}>{value}</div>
    </div>
  )
}

function LinhaResumo({ label, valor, extra, strong = false, cor, risco = false }: { label: string; valor: string; extra?: string; strong?: boolean; cor?: string; risco?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', padding: '.2rem 0' }}>
      <span style={{ fontSize: '.8rem', color: '#667085', fontWeight: strong ? 700 : 500 }}>{label}</span>
      <span style={{ display: 'flex', gap: '.45rem', alignItems: 'baseline' }}>
        <span style={{ fontSize: strong ? '.95rem' : '.85rem', fontWeight: strong ? 800 : 700, color: cor || '#1d2939', textDecoration: risco ? 'line-through' : 'none' }}>{valor}</span>
        {extra && <span style={{ fontSize: '.72rem', color: '#98a2b3' }}>{extra}</span>}
      </span>
    </div>
  )
}

function InfoCard({ icon, tom, label, valor, sub, badge }: { icon: string; tom: string; label: string; valor: string; sub?: string; badge?: string }) {
  return (
    <div style={{ position: 'relative', background: '#fff', border: '1px solid #e8edf2', borderRadius: '12px', padding: '0.7rem 0.8rem', borderLeft: `3px solid ${tom}` }}>
      {badge && (
        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: '0.62rem', fontWeight: 700, color: '#b54708', background: '#fff4e6', border: '1px solid #fcd9a8', padding: '1px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.02em' }}>{badge}</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.45rem' }}>
        <span style={{ fontSize: '0.85rem', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${tom}14`, borderRadius: 6 }}>{icon}</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#8a96a3', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#16212b', lineHeight: 1.25 }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#9aa6b2', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  )
}

function ActionBtn({ label, onClick, strong = false }: { label: string; onClick: () => void; strong?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '.55rem .8rem',
        borderRadius: 999,
        border: `1px solid ${strong ? '#cbb8ff' : '#d4dbe6'}`,
        background: strong ? '#f4f0ff' : '#fff',
        color: strong ? '#5b3cc4' : '#344054',
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: '.82rem',
      }}
    >
      {label}
    </button>
  )
}

export default AnunciosML
