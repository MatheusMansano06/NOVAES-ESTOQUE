import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface Categoria {
  id?: string | null
  nome?: string | null
  dominio?: string | null
}
interface Palavra { palavra: string; n: number }
interface AtributoValor { valor: string; n: number }
interface Produto {
  id?: string
  nome?: string
  marca?: string | null
  thumbnail?: string | null
  dominio?: string | null
  atributos?: Record<string, string>
}
interface GarimpoResult {
  ok?: boolean
  query?: string
  categoria?: Categoria | null
  mais_buscados?: string[]
  palavras_frequentes?: Palavra[]
  produtos?: Produto[]
  atributos_populares?: Record<string, AtributoValor[]>
  total_catalogo_nominal?: number | null
  avisos?: string[]
  erro?: string
}

const NAVY = '#2d3277'

// Tamanho de fonte proporcional à frequência (nuvem de palavras)
function tamanhoPalavra(n: number, max: number): number {
  if (max <= 0) return 0.85
  return 0.8 + (n / max) * 0.9 // 0.8rem .. 1.7rem
}

export function Garimpador() {
  const [termo, setTermo] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState<GarimpoResult | null>(null)

  const buscar = async () => {
    const q = termo.trim()
    if (!q) return
    setLoading(true)
    setErro('')
    setDados(null)
    try {
      const res = await fetch(`${API_BASE}/api/ml/garimpo?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data: GarimpoResult = await res.json()
      if (!res.ok || data.erro) {
        setErro(data.erro || `Falha na busca (HTTP ${res.status})`)
        return
      }
      setDados(data)
    } catch (e) {
      setErro('Não foi possível consultar o Mercado Livre. Verifique a conexão do ML.')
    } finally {
      setLoading(false)
    }
  }

  const maxPalavra = dados?.palavras_frequentes?.[0]?.n || 0

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Barra de busca */}
      <div className="card" style={{ border: `2px solid ${NAVY}`, marginBottom: '1.25rem' }}>
        <div className="card-body" style={{ padding: '1.1rem 1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '1.3rem' }}>🔎</span>
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
              placeholder="Digite um produto (ex: varal de chão, suporte de celular...)"
              style={{
                flex: 1, border: '1px solid #d5d8ec', borderRadius: 10, padding: '0.7rem 0.9rem',
                fontSize: '1rem', outline: 'none',
              }}
            />
            <button
              onClick={buscar}
              disabled={loading || !termo.trim()}
              style={{
                background: NAVY, color: '#fff', border: 'none', borderRadius: 10,
                padding: '0.7rem 1.6rem', fontSize: '0.95rem', fontWeight: 700,
                cursor: loading || !termo.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !termo.trim() ? 0.6 : 1, whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Garimpando…' : 'Buscar'}
            </button>
          </div>
        </div>
      </div>

      {/* Estado vazio / loading / erro */}
      {loading && (
        <div style={{ textAlign: 'center', color: '#667085', padding: '3rem 0' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⛏️</div>
          <div>Garimpando <strong style={{ color: NAVY }}>"{termo}"</strong> no Mercado Livre…</div>
        </div>
      )}

      {erro && !loading && (
        <div style={{ background: '#fdecea', color: '#c62828', borderRadius: 10, padding: '1rem', fontWeight: 600 }}>
          ✕ {erro}
        </div>
      )}

      {!dados && !loading && !erro && (
        <div style={{ textAlign: 'center', color: '#98a2b3', padding: '3rem 0' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📦</div>
          <div style={{ fontSize: '1.05rem' }}>Busque um produto para descobrir nicho, demanda e concorrência.</div>
        </div>
      )}

      {/* Resultados */}
      {dados && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Categoria detectada */}
          {dados.categoria?.nome && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ color: '#667085', fontSize: '0.85rem' }}>Categoria detectada:</span>
              <span style={{
                background: '#eef0fb', color: NAVY, fontWeight: 700, fontSize: '0.9rem',
                padding: '0.3rem 0.8rem', borderRadius: 999,
              }}>
                {dados.categoria.dominio || dados.categoria.nome}
                {dados.categoria.id && <span style={{ opacity: 0.6, marginLeft: 6, fontWeight: 500 }}>{dados.categoria.id}</span>}
              </span>
              {dados.total_catalogo_nominal != null && (
                <span style={{ color: '#98a2b3', fontSize: '0.8rem', marginLeft: 'auto' }}>
                  ~{dados.total_catalogo_nominal.toLocaleString('pt-BR')} produtos no catálogo
                </span>
              )}
            </div>
          )}

          {/* Duas colunas: mais buscados + palavras frequentes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {/* Mais buscados na categoria */}
            <div className="card">
              <div className="card-body" style={{ padding: '1.1rem' }}>
                <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔥 Mais buscados no Mercado Livre
                  {dados.categoria?.nome && <span style={{ color: '#98a2b3', fontWeight: 500 }}>({dados.categoria.nome})</span>}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(dados.mais_buscados || []).map((kw, i) => (
                    <span key={i} style={{
                      border: '1px solid #d5d8ec', borderRadius: 999, padding: '0.3rem 0.75rem',
                      fontSize: '0.83rem', color: '#344054', background: '#fff',
                    }}>
                      {kw}
                    </span>
                  ))}
                  {(!dados.mais_buscados || dados.mais_buscados.length === 0) && (
                    <span style={{ color: '#98a2b3', fontSize: '0.85rem' }}>Sem dados de tendência para esta categoria.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Palavras mais frequentes (nuvem) */}
            <div className="card">
              <div className="card-body" style={{ padding: '1.1rem' }}>
                <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: NAVY }}>
                  💬 Palavras frequentes nos títulos
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.7rem', alignItems: 'baseline' }}>
                  {(dados.palavras_frequentes || []).map((p, i) => (
                    <span key={i} title={`${p.n}x`} style={{
                      fontSize: `${tamanhoPalavra(p.n, maxPalavra)}rem`,
                      fontWeight: p.n === maxPalavra ? 800 : 600,
                      color: `rgba(45,50,119,${0.45 + 0.55 * (p.n / (maxPalavra || 1))})`,
                    }}>
                      {p.palavra}
                    </span>
                  ))}
                  {(!dados.palavras_frequentes || dados.palavras_frequentes.length === 0) && (
                    <span style={{ color: '#98a2b3', fontSize: '0.85rem' }}>Sem palavras suficientes.</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Atributos populares (marcas, cores, modelos dominantes) */}
          {dados.atributos_populares && Object.keys(dados.atributos_populares).length > 0 && (
            <div className="card">
              <div className="card-body" style={{ padding: '1.1rem' }}>
                <h3 style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: NAVY }}>
                  🏷️ Quem domina o nicho (top do catálogo)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {Object.entries(dados.atributos_populares).map(([nome, valores]) => {
                    const maxV = valores[0]?.n || 1
                    return (
                      <div key={nome}>
                        <div style={{ fontSize: '0.78rem', color: '#667085', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>{nome}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {valores.map((v, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ flex: 1, background: '#eef0fb', borderRadius: 6, height: 20, position: 'relative', overflow: 'hidden' }}>
                                <div style={{ width: `${(v.n / maxV) * 100}%`, height: '100%', background: NAVY, borderRadius: 6 }} />
                                <span style={{ position: 'absolute', left: 8, top: 1, fontSize: '0.75rem', color: '#1a1a1a', fontWeight: 600, lineHeight: '18px' }}>{v.valor}</span>
                              </div>
                              <span style={{ fontSize: '0.75rem', color: '#98a2b3', minWidth: 20, textAlign: 'right' }}>{v.n}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Produtos do catálogo */}
          {dados.produtos && dados.produtos.length > 0 && (
            <div className="card">
              <div className="card-body" style={{ padding: '1.1rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: NAVY }}>
                  📦 Produtos em destaque no catálogo
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
                  {dados.produtos.map((p, i) => (
                    <div key={p.id || i} style={{ border: '1px solid #eceef5', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" style={{ width: '100%', height: 110, objectFit: 'contain', marginBottom: '0.5rem' }} />
                        : <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d0d5dd', fontSize: '2rem' }}>📦</div>}
                      <div style={{ fontSize: '0.78rem', color: '#344054', lineHeight: 1.3, minHeight: 30 }}>
                        {(p.nome || '').slice(0, 60)}
                      </div>
                      {p.marca && <div style={{ fontSize: '0.72rem', color: NAVY, fontWeight: 700, marginTop: 4 }}>{p.marca}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Avisos (transparência sobre limites da API) */}
          {dados.avisos && dados.avisos.length > 0 && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 10, padding: '0.9rem 1rem' }}>
              {dados.avisos.map((a, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: '#8a6d3b', display: 'flex', gap: 6 }}>
                  <span>ℹ️</span><span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
