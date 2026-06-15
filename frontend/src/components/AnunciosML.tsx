import { useState, useEffect, useCallback } from 'react'

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
  logistica?: string
  thumbnail?: string
  permalink?: string
}

interface Props { onVoltar: () => void }

const ABAS: { id: string; label: string }[] = [
  { id: 'active', label: 'Ativos' },
  { id: 'paused', label: 'Pausados' },
  { id: 'closed', label: 'Finalizados' },
]

const brl = (v?: number | null) => v == null ? '—' : 'R$ ' + v.toFixed(2).replace('.', ',')

export function AnunciosML({ onVoltar }: Props) {
  const [aba, setAba] = useState('active')
  const [anuncios, setAnuncios] = useState<Anuncio[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [statusConexao, setStatusConexao] = useState<'ok' | 'erro' | 'verificando'>('verificando')

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios?status=${aba}&offset=${offset}&limit=${PAGINA}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.erro) {
        setErro(d.erro || 'Falha ao carregar anúncios')
        setAnuncios([])
        setStatusConexao('erro')
      } else {
        setAnuncios(d.anuncios || [])
        setTotal(d.total || 0)
        setStatusConexao('ok')
      }
    } catch (e) {
      setErro('Erro de conexão: ' + String(e))
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
      <header className="header"><div className="container"><h1>NVS TECH</h1><p>Anúncios do Mercado Livre</p></div></header>

      <main className="container main-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <button onClick={onVoltar} style={{ padding: '0.75rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>← Voltar</button>
          <span style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem', borderRadius: '20px', fontWeight: 600,
            background: statusConexao === 'ok' ? '#e8f5e9' : statusConexao === 'erro' ? '#ffebee' : '#f5f5f5',
            color: statusConexao === 'ok' ? '#2e7d32' : statusConexao === 'erro' ? '#c62828' : '#999' }}>
            {statusConexao === 'ok' ? '● Conectado ao Mercado Livre' : statusConexao === 'erro' ? '● Sem conexão com o ML' : '○ Verificando...'}
          </span>
        </div>

        {/* Abas de status */}
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

        {/* Busca */}
        <input type="text" placeholder="Buscar nesta página por título, SKU ou MLB..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '0.75rem 1rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem', marginBottom: '1.5rem', boxSizing: 'border-box' }} />

        {erro && (
          <div style={{ padding: '1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: '8px', color: '#c62828', marginBottom: '1.5rem' }}>
            {erro}
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
              Se for problema de autorização, <a href={`${API_BASE}/api/ml/conectar`} style={{ color: '#1976d2' }}>reconecte o Mercado Livre aqui</a>.
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Carregando anúncios...</p>
        ) : filtrados.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>{erro ? '' : 'Nenhum anúncio encontrado.'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtrados.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: '1rem', padding: '1rem', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', alignItems: 'center' }}>
                <div style={{ width: '64px', height: '64px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.thumbnail ? <img src={a.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc' }}>—</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.3rem', lineHeight: 1.3 }}>{a.titulo}</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem' }}>
                    <span style={{ background: '#ede7f6', color: '#4527a0', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>{a.tipo_anuncio}</span>
                    {a.sku && <span style={{ color: '#555' }}>SKU: {a.sku}</span>}
                    <a href={a.permalink} target="_blank" rel="noreferrer" style={{ color: '#3483fa', textDecoration: 'none' }}>{a.id} ↗</a>
                    {a.frete_gratis && <span style={{ color: '#2e7d32' }}>frete grátis</span>}
                    {a.logistica === 'fulfillment' && <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>FULL</span>}
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
                <div style={{ textAlign: 'right', minWidth: '90px' }}>
                  {a.preco_original && a.preco_original > a.preco && (
                    <div style={{ fontSize: '0.75rem', color: '#999', textDecoration: 'line-through' }}>{brl(a.preco_original)}</div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a1a1a' }}>{brl(a.preco)}</div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: corStatus(a.status) }}>{labelStatus(a.status)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Paginação */}
        {!loading && total > PAGINA && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGINA))}
              style={{ padding: '0.6rem 1.2rem', background: offset === 0 ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: offset === 0 ? 'not-allowed' : 'pointer', fontWeight: 600 }}>← Anterior</button>
            <span style={{ color: '#666', fontSize: '0.9rem' }}>Página {paginaAtual} de {totalPaginas}</span>
            <button disabled={paginaAtual >= totalPaginas} onClick={() => setOffset(offset + PAGINA)}
              style={{ padding: '0.6rem 1.2rem', background: paginaAtual >= totalPaginas ? '#f5f5f5' : '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: paginaAtual >= totalPaginas ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Próxima →</button>
          </div>
        )}
      </main>
    </div>
  )
}

export default AnunciosML
