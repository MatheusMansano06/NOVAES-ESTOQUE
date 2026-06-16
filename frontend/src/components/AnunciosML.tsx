import { useState, useEffect, useCallback } from 'react'
import { Precificador, type PricingSnapshot, loadPricingSummaryMap } from './Precificador'
import { MLAnuncioEditorModal } from './MLAnuncioEditorModal'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const PAGINA = 50

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
type EditorMode = 'descricao' | 'flex' | 'atacado' | 'imagens' | 'ficha' | 'dimensoes'

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

const percentual = (parte: number, total: number) => total > 0 ? ((parte / total) * 100).toFixed(2) : '0.00'

export function AnunciosML({ onVoltar }: Props) {
  const [aba, setAba] = useState('active')
  const [anuncios, setAnuncios] = useState<Anuncio[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [statusConexao, setStatusConexao] = useState<'ok' | 'erro' | 'verificando'>('verificando')
  const [precificando, setPrecificando] = useState<Anuncio | null>(null)
  const [editando, setEditando] = useState<{ anuncio: Anuncio; mode: EditorMode } | null>(null)
  const [resumos, setResumos] = useState<Record<string, PricingSnapshot>>({})
  const [hoveredResumoId, setHoveredResumoId] = useState<string | null>(null)

  useEffect(() => {
    setResumos(loadPricingSummaryMap())
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios?status=${aba}&offset=${offset}&limit=${PAGINA}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.erro) {
        setErro(d.erro || 'Falha ao carregar anuncios')
        setAnuncios([])
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
  }, [aba, offset])

  useEffect(() => { carregar() }, [carregar])

  const trocarAba = (novaAba: string) => { setAba(novaAba); setOffset(0); setBusca('') }

  const termo = busca.trim().toLowerCase()
  const filtrados = termo === '' ? anuncios : anuncios.filter(a =>
    a.titulo.toLowerCase().includes(termo) || a.sku.toLowerCase().includes(termo) || a.id.toLowerCase().includes(termo)
  )

  const totalPaginas = Math.max(1, Math.ceil(total / PAGINA))
  const paginaAtual = Math.floor(offset / PAGINA) + 1

  const corStatus = (s: string) => s === 'active' ? '#2e7d32' : s === 'paused' ? '#e65100' : '#9e9e9e'
  const labelStatus = (s: string) => s === 'active' ? 'Ativo' : s === 'paused' ? 'Pausado' : s === 'closed' ? 'Finalizado' : s

  return (
    <div className="app" style={{ background: '#ffffff' }}>
      <header className="header"><div className="container"><h1>NVS TECH</h1><p>Anuncios do Mercado Livre</p></div></header>

      <main className="container main-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
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

        <input type="text" placeholder="Buscar nesta pagina por titulo, SKU ou MLB..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '0.75rem 1rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '1.5rem', boxSizing: 'border-box' }} />

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
        ) : filtrados.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>{erro ? '' : 'Nenhum anuncio encontrado.'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtrados.map(a => {
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
                    <div
                      style={{
                        position: 'relative',
                        textAlign: 'right',
                        minWidth: '120px',
                        marginLeft: 'auto',
                        padding: resumo ? '.45rem .6rem' : 0,
                        borderRadius: resumo ? '12px' : 0,
                        background: resumo ? '#f7f3ff' : 'transparent',
                        border: resumo ? '1px solid #dfd0ff' : 'none',
                        cursor: resumo ? 'default' : 'inherit',
                      }}
                      onMouseEnter={() => resumo && setHoveredResumoId(a.id)}
                      onMouseLeave={() => setHoveredResumoId(prev => prev === a.id ? null : prev)}
                    >
                      {a.preco_original && a.preco_original > a.preco && (
                        <div style={{ fontSize: '0.75rem', color: '#999', textDecoration: 'line-through' }}>{brl(a.preco_original)}</div>
                      )}
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a1a1a' }}>{brl(a.preco)}</div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: corStatus(a.status) }}>{labelStatus(a.status)}</div>
                      {resumo && (
                        <div style={{ marginTop: '.2rem', fontSize: '.7rem', color: '#6941c6', fontWeight: 700 }}>Resumo salvo</div>
                      )}
                      {resumo && hoveredResumoId === a.id && (
                        <ResumoTooltip anuncio={a} resumo={resumo} />
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #f0f0f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    <InfoBox label="Frete do anuncio" valor={textoFrete(a)} detalhe={a.frete_gratis ? 'taxa direta do ML' : 'sem frete gratis'} />
                    <InfoBox label="Preco de atacado" valor={a.preco_atacado?.valor || '--'} detalhe={a.preco_atacado?.nome || 'nao informado'} />
                    <InfoBox label="Imagens" valor={`${a.imagens_total || 0}`} detalhe={(a.imagens_total || 0) === 1 ? 'imagem cadastrada' : 'imagens cadastradas'} />
                    <InfoBox label="Dimensoes" valor={a.dimensoes?.texto || '--'} detalhe={a.dimensoes?.origem || 'nao retornado pelo ML'} />
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

        {!loading && total > PAGINA && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGINA))}
              style={{ padding: '0.6rem 1.2rem', background: offset === 0 ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: offset === 0 ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Anterior</button>
            <span style={{ color: '#666', fontSize: '0.9rem' }}>Pagina {paginaAtual} de {totalPaginas}</span>
            <button disabled={paginaAtual >= totalPaginas} onClick={() => setOffset(offset + PAGINA)}
              style={{ padding: '0.6rem 1.2rem', background: paginaAtual >= totalPaginas ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: paginaAtual >= totalPaginas ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Proxima</button>
          </div>
        )}
      </main>

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

function ResumoTooltip({ anuncio, resumo }: { anuncio: Anuncio; resumo: PricingSnapshot }) {
  const precoOriginal = resumo.precoOriginal > 0 ? resumo.precoOriginal : (anuncio.preco_original || anuncio.preco)
  const precoPromocional = resumo.precoPromocional > 0 ? resumo.precoPromocional : anuncio.preco

  return (
    <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 12px)', width: '290px', background: '#4e3a73', color: '#fff', borderRadius: '8px', padding: '.9rem 1rem', boxShadow: '0 18px 32px rgba(41, 26, 77, 0.35)', zIndex: 30, textAlign: 'left' }}>
      <LinhaResumo label="Preco Original" valor={brl(precoOriginal)} />
      <LinhaResumo label="Preco Promocional" valor={brl(precoPromocional)} />
      <LinhaResumo label="Frete" valor={`-${brl(resumo.frete)}`} extra={`(${percentual(resumo.frete, precoPromocional)}%)`} />
      <LinhaResumo label="Tarifa de Venda" valor={`-${brl(resumo.tarifa)}`} extra={`(${resumo.tarifaPct.toFixed(2)}%)`} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.22)', margin: '.55rem 0' }} />
      <LinhaResumo label="Margem Contribuicao" valor={brl(resumo.margem)} extra={`(${resumo.margemPct.toFixed(2)}%)`} strong />
      <div style={{ marginTop: '.55rem', fontSize: '.72rem', lineHeight: 1.45, color: '#e8dfff' }}>
        <div>* Frete puxado direto do anuncio no Mercado Livre</div>
        <div>* Margem calculada com base no preco promocional salvo</div>
      </div>
      <div style={{ position: 'absolute', top: -8, right: 32, width: 16, height: 16, background: '#4e3a73', transform: 'rotate(45deg)' }} />
    </div>
  )
}

function LinhaResumo({ label, valor, extra, strong = false }: { label: string; valor: string; extra?: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', padding: '.18rem 0', fontSize: strong ? '.97rem' : '.86rem', fontWeight: strong ? 800 : 700 }}>
      <span>{label}</span>
      <span style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <span>{valor}</span>
        {extra && <span style={{ fontSize: '.78rem', opacity: 0.9 }}>{extra}</span>}
      </span>
    </div>
  )
}

function InfoBox({ label, valor, detalhe }: { label: string; valor: string; detalhe?: string }) {
  return (
    <div style={{ background: '#fafbfc', border: '1px solid #edf1f4', borderRadius: '8px', padding: '0.75rem 0.85rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#7a8793', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#16212b', lineHeight: 1.3 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: '0.75rem', color: '#8a96a3', marginTop: '0.25rem' }}>{detalhe}</div>}
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
