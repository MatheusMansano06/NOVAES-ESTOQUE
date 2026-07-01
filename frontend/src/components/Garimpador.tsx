import { useState } from 'react'
import './Garimpador.css'

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
  permalink?: string | null
  preco?: number | null
}
interface Metricas {
  total_anuncios: number | null
  preco_medio: number | null
  preco_min: number | null
  preco_max: number | null
  qtd_full: number | null
  pct_full: number | null
  pct_frete_gratis: number | null
  qtd_lojas_oficiais: number | null
  amostra: number
  fonte: string
}
interface Vendedor {
  nome: string
  oficial?: boolean
  ofertas?: number
  reputacao?: string | null
  vendas?: number | null
  link?: string | null
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
  metricas?: Metricas | null
  top_vendedores?: Vendedor[]
  avisos?: string[]
  erro?: string
}

// Reputação ML: level_id (ex "5_green") -> cor + rótulo
const REP_CORES: Record<string, string> = {
  '5_green': '#12b76a', '4_light_green': '#79c34a', '3_yellow': '#eab308',
  '2_orange': '#f59e0b', '1_red': '#ef4444',
}
function repInfo(level?: string | null): { cor: string; label: string } {
  if (!level) return { cor: '#c7cbd6', label: '—' }
  return { cor: REP_CORES[level] || '#c7cbd6', label: level.replace(/_/g, ' ') }
}

// Mapa de calor monocromático (um único tom): frequência baixa = claro, alta = intenso
function heatColor(forca: number): { background: string; color: string } {
  const f = Math.max(0, Math.min(1, forca))
  const light = 95 - f * 58 // 95% (quase branco) -> 37% (navy sólido)
  return {
    background: `hsl(232, 40%, ${light}%)`,
    color: f > 0.42 ? '#fff' : '#3a4066',
  }
}

const capitalizar = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)

// Título otimizado: encadeia as palavras mais frequentes (só alfabéticas, 3+) até ~60 chars
function gerarTitulo(pal: Palavra[], limite = 60): string {
  const usadas: string[] = []
  let len = 0
  for (const p of pal) {
    if (!/^[a-zà-ÿ]{3,}$/i.test(p.palavra)) continue
    const w = capitalizar(p.palavra)
    const add = (len ? 1 : 0) + w.length
    if (len + add > limite) break
    usadas.push(w)
    len += add
  }
  return usadas.join(' ')
}

// Palavras-chave de SEO (as frequentes) prontas para copiar
function palavrasSeo(pal: Palavra[]): string {
  return pal.map((p) => p.palavra).filter((w) => /^[a-zà-ÿ0-9]{2,}$/i.test(w)).join(', ')
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function pct(v: number): string {
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

// URL do anúncio: usa permalink; senão monta fallback pelo id
function linkProduto(p: Produto): string {
  if (p.permalink) return p.permalink
  return `https://www.mercadolivre.com.br/p/${p.id ?? ''}`
}

function temMetricas(m?: Metricas | null): m is Metricas {
  if (!m) return false
  return (
    m.total_anuncios != null ||
    m.preco_medio != null ||
    m.preco_min != null ||
    m.preco_max != null ||
    m.qtd_full != null ||
    m.pct_full != null ||
    m.pct_frete_gratis != null ||
    m.qtd_lojas_oficiais != null
  )
}

function PainelMetricas({ m }: { m: Metricas }) {
  const cards: { label: string; value: string; sub?: string }[] = []

  if (m.total_anuncios != null) {
    cards.push({ label: 'Anúncios', value: m.total_anuncios.toLocaleString('pt-BR') })
  }
  if (m.preco_medio != null) {
    const faixa =
      m.preco_min != null && m.preco_max != null
        ? `${brl(m.preco_min)} – ${brl(m.preco_max)}`
        : m.preco_min != null
          ? `a partir de ${brl(m.preco_min)}`
          : undefined
    cards.push({ label: 'Preço médio', value: brl(m.preco_medio), sub: faixa })
  } else if (m.preco_min != null || m.preco_max != null) {
    cards.push({
      label: 'Faixa de preço',
      value: m.preco_min != null ? brl(m.preco_min) : brl(m.preco_max!),
      sub: m.preco_min != null && m.preco_max != null ? `até ${brl(m.preco_max)}` : undefined,
    })
  }
  if (m.qtd_full != null || m.pct_full != null) {
    cards.push({
      label: 'No Full',
      value: m.pct_full != null ? pct(m.pct_full) : m.qtd_full!.toLocaleString('pt-BR'),
      sub: m.pct_full != null && m.qtd_full != null ? `${m.qtd_full.toLocaleString('pt-BR')} ofertas` : undefined,
    })
  }
  if (m.pct_frete_gratis != null) {
    cards.push({ label: 'Frete grátis', value: pct(m.pct_frete_gratis) })
  }
  if (m.qtd_lojas_oficiais != null) {
    cards.push({ label: 'Lojas oficiais', value: m.qtd_lojas_oficiais.toLocaleString('pt-BR') })
  }

  if (cards.length === 0) return null

  return (
    <div className="gp-panel gp-metrics">
      <h3 className="gp-panel-title">Raio-x do mercado</h3>
      <div className="gp-stat-grid">
        {cards.map((c, i) => (
          <div className="gp-stat" key={i}>
            <div className="gp-stat-label">{c.label}</div>
            <div className="gp-stat-value">{c.value}</div>
            <div className="gp-stat-sub">{c.sub || ' '}</div>
          </div>
        ))}
      </div>
      {(m.fonte || m.amostra != null) && (
        <p className="gp-metrics-source">
          {m.fonte}
          {m.amostra != null ? ` · amostra de ${m.amostra.toLocaleString('pt-BR')} itens` : ''}
        </p>
      )}
    </div>
  )
}

export function Garimpador() {
  const [termo, setTermo] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState<GarimpoResult | null>(null)
  const [seoAberto, setSeoAberto] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  const copiar = async (texto: string, chave: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(chave)
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1600)
    } catch { /* clipboard bloqueado pelo navegador */ }
  }

  const buscar = async () => {
    const q = termo.trim()
    if (!q) return
    setLoading(true)
    setErro('')
    setDados(null)
    setSeoAberto(false)
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
  const palFreq = dados?.palavras_frequentes || []
  const tituloOtimizado = gerarTitulo(palFreq)
  const palavrasSeoStr = palavrasSeo(palFreq)
  const relacionadasStr = (dados?.mais_buscados || []).join(', ')

  return (
    <div className="gp-root">
      {/* Busca */}
      <div className="gp-hero">
        <div className="gp-hero-eyebrow">Pesquisa de mercado</div>
        <h1>Analise qualquer produto do Mercado Livre</h1>
        <p className="gp-hero-sub">Nicho, demanda, preços e concorrência — em uma busca.</p>
        <div className="gp-searchbar">
          <span className="gp-search-icon" aria-hidden>⌕</span>
          <input
            className="gp-search-input"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
            placeholder="Ex: varal de chão, suporte de celular…"
          />
          <button className="gp-search-btn" onClick={buscar} disabled={loading || !termo.trim()}>
            {loading ? 'Buscando…' : 'Analisar'}
          </button>
        </div>
      </div>

      {/* Estados */}
      {loading && (
        <div className="gp-state">
          <div className="gp-spinner" aria-hidden />
          <div className="gp-state-title">Analisando “{termo}”…</div>
          <div className="gp-state-desc">Buscando categoria, títulos, preços e vendedores.</div>
        </div>
      )}

      {erro && !loading && (
        <div className="gp-error"><span>{erro}</span></div>
      )}

      {!dados && !loading && !erro && (
        <div className="gp-state">
          <div className="gp-state-title">Comece uma pesquisa</div>
          <div className="gp-state-desc">Digite um produto acima para analisar o mercado.</div>
        </div>
      )}

      {/* Resultados */}
      {dados && !loading && (
        <div className="gp-results">
          {/* Categoria detectada */}
          {dados.categoria?.nome && (
            <div className="gp-catbar">
              <span className="gp-cat-label">Categoria detectada</span>
              <span className="gp-cat-chip">
                {dados.categoria.dominio || dados.categoria.nome}
                {dados.categoria.id && <span className="gp-cat-id">{dados.categoria.id}</span>}
              </span>
              {dados.total_catalogo_nominal != null && (
                <span className="gp-cat-count">
                  ~{dados.total_catalogo_nominal.toLocaleString('pt-BR')} produtos no catálogo
                </span>
              )}
            </div>
          )}

          {/* Painel de métricas (esconde graciosamente se ausente/nulo) */}
          {temMetricas(dados.metricas) && <PainelMetricas m={dados.metricas} />}

          {/* Mais buscados + palavras frequentes */}
          <div className="gp-two-col">
            <div className="gp-panel">
              <h3 className="gp-panel-title">
                Mais buscados
                {dados.categoria?.nome && <span className="gp-muted">{dados.categoria.nome}</span>}
              </h3>
              <div className="gp-chips-wrap">
                {(dados.mais_buscados || []).map((kw, i) => (
                  <span key={i} className="gp-chip"><span className="gp-rank">{i + 1}</span>{kw}</span>
                ))}
                {(!dados.mais_buscados || dados.mais_buscados.length === 0) && (
                  <span className="gp-empty-note">Sem dados de tendência para esta categoria.</span>
                )}
              </div>
            </div>

            <div className="gp-panel">
              <h3 className="gp-panel-title">Palavras nos títulos <span className="gp-muted">mapa de calor</span></h3>
              <div className="gp-heat">
                {palFreq.map((p, i) => {
                  const c = heatColor(p.n / (maxPalavra || 1))
                  return (
                    <span
                      key={i}
                      className="gp-heat-pill"
                      title={`${p.n} ocorrências`}
                      style={{ background: c.background, color: c.color }}
                    >
                      {p.palavra}<b className="gp-heat-n">{p.n}</b>
                    </span>
                  )
                })}
                {palFreq.length === 0 && (
                  <span className="gp-empty-note">Sem palavras suficientes.</span>
                )}
              </div>
              {palFreq.length > 0 && (
                <button className="gp-forma-btn" onClick={() => setSeoAberto(true)}>
                  Formar título otimizado
                </button>
              )}
            </div>
          </div>

          {/* Kit de anúncio gerado (título + palavras-chave SEO + relacionados) */}
          {seoAberto && (
            <div className="gp-panel gp-seo">
              <h3 className="gp-panel-title">Kit de anúncio</h3>
              <p className="gp-hint">
                Montado com as palavras que os concorrentes mais usam e as buscas reais dos clientes.
                É só copiar e colar.
              </p>

              <div className="gp-seo-block gp-seo-hero">
                <div className="gp-seo-head">
                  <span className="gp-seo-label">Título otimizado</span>
                  <span className={`gp-charcount${tituloOtimizado.length > 60 ? ' gp-over' : ''}`}>
                    {tituloOtimizado.length}/60
                  </span>
                </div>
                <div className="gp-seo-titulo">{tituloOtimizado || '—'}</div>
                <button
                  className="gp-copy-btn"
                  onClick={() => copiar(tituloOtimizado, 'titulo')}
                  disabled={!tituloOtimizado}
                >
                  {copiado === 'titulo' ? 'Copiado' : 'Copiar título'}
                </button>
              </div>

              <div className="gp-seo-grid">
                <div className="gp-seo-block">
                  <div className="gp-seo-head">
                    <span className="gp-seo-label">Palavras-chave (SEO da ficha)</span>
                  </div>
                  <div className="gp-seo-text">{palavrasSeoStr || '—'}</div>
                  <button
                    className="gp-copy-btn"
                    onClick={() => copiar(palavrasSeoStr, 'seo')}
                    disabled={!palavrasSeoStr}
                  >
                    {copiado === 'seo' ? 'Copiado' : 'Copiar palavras-chave'}
                  </button>
                </div>

                <div className="gp-seo-block">
                  <div className="gp-seo-head">
                    <span className="gp-seo-label">Termos relacionados</span>
                  </div>
                  <div className="gp-seo-text">{relacionadasStr || '—'}</div>
                  <button
                    className="gp-copy-btn"
                    onClick={() => copiar(relacionadasStr, 'rel')}
                    disabled={!relacionadasStr}
                  >
                    {copiado === 'rel' ? 'Copiado' : 'Copiar relacionados'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Domínio do nicho */}
          {dados.atributos_populares && Object.keys(dados.atributos_populares).length > 0 && (
            <div className="gp-panel">
              <h3 className="gp-panel-title">Quem domina o nicho <span className="gp-muted">top do catálogo</span></h3>
              <div className="gp-attr-grid">
                {Object.entries(dados.atributos_populares).map(([nome, valores]) => {
                  const maxV = valores[0]?.n || 1
                  return (
                    <div key={nome}>
                      <div className="gp-attr-name">{nome}</div>
                      {valores.map((v, i) => (
                        <div className="gp-bar-row" key={i}>
                          <div className="gp-bar-track">
                            <div
                              className={`gp-bar-fill${i === 0 ? ' gp-lead' : ''}`}
                              style={{ width: `${(v.n / maxV) * 100}%` }}
                            />
                            <span className="gp-bar-label">{v.valor}</span>
                          </div>
                          <span className="gp-bar-n">{v.n}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top lojas & vendedores do nicho — clicáveis pra loja no ML */}
          {dados.top_vendedores && dados.top_vendedores.length > 0 && (
            <div className="gp-panel">
              <h3 className="gp-panel-title">Top lojas &amp; vendedores <span className="gp-muted">quem vence a buy box</span></h3>
              <div className="gp-sellers">
                {dados.top_vendedores.map((v, i) => {
                  const rep = repInfo(v.reputacao)
                  return (
                    <a
                      key={v.nome || i}
                      className="gp-seller"
                      href={v.link || '#'}
                      target="_blank"
                      rel="noreferrer"
                      title={`Ver ${v.nome} no Mercado Livre`}
                    >
                      <span className="gp-seller-rank">{i + 1}</span>
                      <div className="gp-seller-body">
                        <div className="gp-seller-name">
                          {v.nome}
                          {v.oficial && <span className="gp-seller-badge">Oficial</span>}
                        </div>
                        <div className="gp-seller-meta">
                          <span className="gp-seller-rep"><span className="gp-rep-dot" style={{ background: rep.cor }} />{rep.label}</span>
                          {v.vendas != null && <span>{v.vendas.toLocaleString('pt-BR')} vendas</span>}
                          {v.ofertas != null && <span>{v.ofertas} no topo</span>}
                        </div>
                      </div>
                      <span className="gp-seller-go" aria-hidden>↗</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}

          {/* Produtos — clicáveis, abrem o anúncio (com oferta ativa em destaque) */}
          {dados.produtos && dados.produtos.length > 0 && (
            <div className="gp-panel">
              <h3 className="gp-panel-title">Produtos do catálogo <span className="gp-muted">com oferta em destaque</span></h3>
              <div className="gp-prod-grid">
                {dados.produtos.map((p, i) => (
                  <a
                    key={p.id || i}
                    className="gp-prod"
                    href={linkProduto(p)}
                    target="_blank"
                    rel="noreferrer"
                    title={p.nome || 'Ver anúncio'}
                  >
                    <span className="gp-prod-cta">Ver anúncio ↗</span>
                    <div className="gp-prod-thumb">
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" loading="lazy" />
                        : <span className="gp-ph" aria-hidden />}
                    </div>
                    <div className="gp-prod-name">{(p.nome || '').slice(0, 70)}</div>
                    <div className="gp-prod-meta">
                      {p.marca ? <span className="gp-prod-brand">{p.marca}</span> : <span />}
                      {p.preco != null && <span className="gp-prod-price">{brl(p.preco)}</span>}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Avisos */}
          {dados.avisos && dados.avisos.length > 0 && (
            <div className="gp-warn">
              {dados.avisos.map((a, i) => (
                <div className="gp-warn-line" key={i}>{a}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
