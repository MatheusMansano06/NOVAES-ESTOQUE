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
  avisos?: string[]
  erro?: string
}

// Cor de calor (heat map) por frequência: frio (âmbar claro) → quente (vermelho)
function heatColor(forca: number): { background: string; color: string } {
  const f = Math.max(0, Math.min(1, forca))
  const hue = 46 - f * 42 // 46 (ouro) → 4 (vermelho)
  const light = 91 - f * 45 // 91% (claro) → 46% (intenso)
  return {
    background: `hsl(${hue}, 92%, ${light}%)`,
    color: f > 0.5 ? '#fff' : '#6b4e00',
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
  const cards: { label: string; value: string; sub?: string; gold?: boolean }[] = []

  if (m.total_anuncios != null) {
    cards.push({ label: 'Anúncios', value: m.total_anuncios.toLocaleString('pt-BR'), gold: true })
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
      gold: true,
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
    <div className="gp-metrics">
      <div className="gp-metrics-head">📊 Raio-x do mercado</div>
      <div className="gp-stat-grid">
        {cards.map((c, i) => (
          <div className="gp-stat" key={i}>
            <div className="gp-stat-label">{c.label}</div>
            <div className={`gp-stat-value${c.gold ? ' gp-gold' : ''}`}>{c.value}</div>
            {c.sub && <div className="gp-stat-sub">{c.sub}</div>}
          </div>
        ))}
      </div>
      {(m.fonte || m.amostra != null) && (
        <p className="gp-metrics-source">
          <span>ℹ️</span>
          <span>
            {m.fonte}
            {m.amostra != null ? ` · amostra de ${m.amostra.toLocaleString('pt-BR')} itens` : ''}
          </span>
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
      {/* HERO / busca */}
      <div className="gp-hero">
        <div className="gp-hero-eyebrow">⛏️ Garimpador de mercado</div>
        <h1>Encontre o ouro escondido no Mercado Livre</h1>
        <p className="gp-hero-sub">
          Digite um produto e desenterre nicho, demanda, preços e quem domina a concorrência.
        </p>
        <div className="gp-searchbar">
          <span className="gp-search-icon">🔎</span>
          <input
            className="gp-search-input"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
            placeholder="Ex: varal de chão, suporte de celular, organizador de gaveta…"
          />
          <button className="gp-search-btn" onClick={buscar} disabled={loading || !termo.trim()}>
            {loading ? '⛏️ Garimpando…' : 'Garimpar'}
          </button>
        </div>
      </div>

      {/* Estados */}
      {loading && (
        <div className="gp-state">
          <div className="gp-pick">⛏️</div>
          <div className="gp-state-title">
            Garimpando <strong style={{ color: '#2d3277' }}>"{termo}"</strong>…
          </div>
          <div className="gp-state-desc">Escavando categorias, títulos e preços no Mercado Livre.</div>
        </div>
      )}

      {erro && !loading && (
        <div className="gp-error"><span>✕</span><span>{erro}</span></div>
      )}

      {!dados && !loading && !erro && (
        <div className="gp-state">
          <div className="gp-state-emoji">💎</div>
          <div className="gp-state-title">Sua garimpagem começa aqui.</div>
          <div className="gp-state-desc">Busque um produto para descobrir nicho, demanda e concorrência.</div>
        </div>
      )}

      {/* Resultados */}
      {dados && !loading && (
        <div className="gp-results">
          {/* Categoria detectada */}
          {dados.categoria?.nome && (
            <div className="gp-catbar">
              <span className="gp-cat-label">Categoria detectada:</span>
              <span className="gp-cat-chip">
                🗂️ {dados.categoria.dominio || dados.categoria.nome}
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
                🔥 Mais buscados no Mercado Livre
                {dados.categoria?.nome && <span className="gp-muted">({dados.categoria.nome})</span>}
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
              <h3 className="gp-panel-title">🌡️ Mapa de calor das palavras nos títulos</h3>
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
                  ✨ Formar título otimizado
                </button>
              )}
            </div>
          </div>

          {/* Kit de anúncio gerado (título + palavras-chave SEO + relacionados) */}
          {seoAberto && (
            <div className="gp-panel gp-seo">
              <h3 className="gp-panel-title">✨ Kit de anúncio gerado</h3>
              <p className="gp-seo-hint">
                Montado com as palavras que os concorrentes mais usam nos títulos e as buscas reais dos
                clientes. É só copiar e colar no seu anúncio.
              </p>

              <div className="gp-seo-block gp-seo-hero">
                <div className="gp-seo-head">
                  <span className="gp-seo-label">📌 Título otimizado</span>
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
                  {copiado === 'titulo' ? '✓ Copiado!' : '📋 Copiar título'}
                </button>
              </div>

              <div className="gp-seo-grid">
                <div className="gp-seo-block">
                  <div className="gp-seo-head">
                    <span className="gp-seo-label">🔑 Palavras-chave (SEO da ficha)</span>
                  </div>
                  <div className="gp-seo-text">{palavrasSeoStr || '—'}</div>
                  <button
                    className="gp-copy-btn"
                    onClick={() => copiar(palavrasSeoStr, 'seo')}
                    disabled={!palavrasSeoStr}
                  >
                    {copiado === 'seo' ? '✓ Copiado!' : '📋 Copiar palavras-chave'}
                  </button>
                </div>

                <div className="gp-seo-block">
                  <div className="gp-seo-head">
                    <span className="gp-seo-label">🎯 Termos relacionados (o que o cliente busca)</span>
                  </div>
                  <div className="gp-seo-text">{relacionadasStr || '—'}</div>
                  <button
                    className="gp-copy-btn"
                    onClick={() => copiar(relacionadasStr, 'rel')}
                    disabled={!relacionadasStr}
                  >
                    {copiado === 'rel' ? '✓ Copiado!' : '📋 Copiar relacionados'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Domínio do nicho */}
          {dados.atributos_populares && Object.keys(dados.atributos_populares).length > 0 && (
            <div className="gp-panel">
              <h3 className="gp-panel-title">🏷️ Quem domina o nicho (top do catálogo)</h3>
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

          {/* Produtos — clicáveis, abrem o anúncio */}
          {dados.produtos && dados.produtos.length > 0 && (
            <div className="gp-panel">
              <h3 className="gp-panel-title">📦 Produtos em destaque no catálogo</h3>
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
                        ? <img src={p.thumbnail} alt="" />
                        : <span className="gp-ph">📦</span>}
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
                <div className="gp-warn-line" key={i}><span>ℹ️</span><span>{a}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
