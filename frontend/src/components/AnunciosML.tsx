import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { Precificador, type PricingSnapshot, loadPricingSummaryMap, loadPriceHistory } from './Precificador'
import { MLAnuncioEditorModal } from './MLAnuncioEditorModal'
import { VendasAnuncioModal } from './VendasAnuncioModal'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const
const DEFAULT_PAGE_SIZE = 20

interface Anuncio {
  id: string
  titulo: string
  sku: string
  preco: number
  preco_original?: number | null
  preco_promocional?: number | null
  tarifa?: number | null
  tarifa_pct?: number | null
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
  date_created?: string | null
}

interface Props { onVoltar: () => void }
type EditorMode = 'descricao' | 'imagens' | 'ficha' | 'dimensoes' | 'atacado' | 'flex'

const ABAS: { id: string; label: string }[] = [
  { id: 'active', label: 'Ativos' },
  { id: 'paused', label: 'Pausados' },
  { id: 'closed', label: 'Finalizados' },
]

const brl = (v?: number | null) => v == null ? '--' : 'R$ ' + v.toFixed(2).replace('.', ',')

// Quantos dias se passaram desde a criação do anúncio no ML.
const diasDesdeCriacao = (iso?: string | null): number | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const ms = Date.now() - d.getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

const textoCriado = (iso?: string | null): string => {
  const dias = diasDesdeCriacao(iso)
  if (dias == null) return 'criado: --'
  if (dias === 0) return 'criado hoje'
  if (dias === 1) return 'criado há 1 dia'
  return `criado há ${dias} dias`
}

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
  descontoTarifa?: number | null
}

interface MarginViewModel {
  precoOriginal: number
  precoPromocional: number
  temPromo: boolean
  frete: number | null
  tarifa: number | null
  tarifaPct: number | null
  descontoTarifa: number | null
  custo: number | null
  impostoPct: number
  imposto: number | null
  margem: number | null
  margemPct: number | null
}

interface CustoOficial { custo: number; imposto_pct: number }
type CustosOficiais = Record<string, CustoOficial>

function carregarImpostoAtual(): number {
  try {
    const raw = localStorage.getItem('nvs_imposto_pct') || '9'
    const parsed = Number(String(raw).replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 9
  } catch {
    return 9
  }
}

function montarResumoMargem(anuncio: Anuncio, resumo?: PricingSnapshot, live?: LivePriceSummary | null, breakdown?: LivePriceBreakdown | null, custoOficial?: CustoOficial | null): MarginViewModel {
  const precoOriginal = live?.cheio ?? (resumo?.precoOriginal && resumo.precoOriginal > 0 ? resumo.precoOriginal : (anuncio.preco_original || anuncio.preco))
  const precoPromocional = live?.promocional ?? (resumo?.precoPromocional && resumo.precoPromocional > 0 ? resumo.precoPromocional : (anuncio.preco_promocional || anuncio.preco))
  const frete = resumo?.frete ?? breakdown?.frete ?? anuncio.frete_custo ?? null
  // tarifa/tarifaPct também vêm da lista (sync do cache), então o card mostra a
  // MC sem depender do hover que busca o detalhe ao vivo.
  const tarifa = resumo?.tarifa ?? breakdown?.tarifa ?? anuncio.tarifa ?? null
  const tarifaPct = resumo?.tarifaPct ?? breakdown?.tarifaPct ?? anuncio.tarifa_pct ?? null
  // Bônus de tarifa: quando o item está numa promoção ativa (ex.: "Aumente suas vendas"),
  // o ML banca parte do desconto (meli_percentage). Volta a favor da margem.
  const descontoTarifa = breakdown?.descontoTarifa ?? null
  // Custo oficial (planilha/banco) tem prioridade sobre o snapshot do Precificador.
  const custo = custoOficial?.custo ?? resumo?.custo ?? null
  const impostoPct = custoOficial?.imposto_pct ?? resumo?.impostoPct ?? carregarImpostoAtual()
  const imposto = precoPromocional > 0 ? (precoPromocional * impostoPct) / 100 : null
  // A tarifa efetiva paga ao ML já desconta o bônus da promoção.
  const tarifaEfetiva = tarifa != null && descontoTarifa != null ? tarifa - descontoTarifa : tarifa
  const margem = frete != null && tarifaEfetiva != null && custo != null && imposto != null
    ? precoPromocional - frete - tarifaEfetiva - custo - imposto
    : null
  const margemPct = margem != null && precoPromocional > 0 ? (margem / precoPromocional) * 100 : null

  return {
    precoOriginal,
    precoPromocional,
    temPromo: precoPromocional < precoOriginal - 0.01,
    frete,
    tarifa,
    tarifaPct,
    descontoTarifa,
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
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [statusConexao, setStatusConexao] = useState<'ok' | 'erro' | 'verificando'>('verificando')
  const [precificando, setPrecificando] = useState<Anuncio | null>(null)
  const [editando, setEditando] = useState<{ anuncio: Anuncio; mode: EditorMode } | null>(null)
  const [resumos, setResumos] = useState<Record<string, PricingSnapshot>>({})
  const [custosOficiais, setCustosOficiais] = useState<CustosOficiais>({})
  const [acaoMsg, setAcaoMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [dupCategoria, setDupCategoria] = useState<Anuncio | null>(null)
  const [centralPromo, setCentralPromo] = useState(false)
  const [vendasAnuncio, setVendasAnuncio] = useState<Anuncio | null>(null)

  const avisar = (tipo: 'ok' | 'erro', texto: string) => {
    setAcaoMsg({ tipo, texto })
    window.clearTimeout((avisar as any)._t)
    ;(avisar as any)._t = window.setTimeout(() => setAcaoMsg(null), 6000)
  }

  useEffect(() => {
    setResumos(loadPricingSummaryMap())
  }, [])

  // Custo oficial por SKU (planilha/banco) — fonte de verdade da margem.
  const carregarCustos = useCallback(() => {
    fetch(`${API_BASE}/api/custos`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d && d.custos) setCustosOficiais(d.custos as CustosOficiais) })
      .catch(() => { /* mantém vazio */ })
  }, [])

  useEffect(() => { carregarCustos() }, [carregarCustos])

  // Debounce: só dispara a busca 350ms depois da última tecla (evita 1 request por caractere).
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 350)
    return () => clearTimeout(t)
  }, [busca])

  const termoBusca = buscaDebounced

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

  const trocarAba = (novaAba: string) => { setAba(novaAba); setOffset(0); setBusca(''); setBuscaDebounced('') }
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button
            onClick={() => setCentralPromo(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 1.2rem', background: '#fff7e6', color: '#b54708', border: '1px solid #fcd9a8', borderRadius: '999px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}
          >
            🏷️ Central de Promoção
            <span style={{ fontWeight: 500, fontSize: '0.78rem', color: '#9a6a18' }}>— anúncios fora de promoção</span>
          </button>
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

        {acaoMsg && (
          <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: 600,
            background: acaoMsg.tipo === 'ok' ? '#e8f5e9' : '#ffebee',
            border: `1px solid ${acaoMsg.tipo === 'ok' ? '#a5d6a7' : '#ef9a9a'}`,
            color: acaoMsg.tipo === 'ok' ? '#2e7d32' : '#c62828' }}>
            {acaoMsg.texto}
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
                        {a.sku && <SkuChip sku={a.sku} onCopiado={() => avisar('ok', `SKU ${a.sku} copiado`)} />}
                        <a href={a.permalink} target="_blank" rel="noreferrer" style={{ color: '#3483fa', textDecoration: 'none' }}>{a.id}</a>
                        <span style={{ color: '#8a96a3' }} title={a.date_created ? new Date(a.date_created).toLocaleString('pt-BR') : undefined}>🗓️ {textoCriado(a.date_created)}</span>
                        {a.frete_gratis && <span style={{ color: '#2e7d32' }}>frete gratis</span>}
                        {a.full && <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>FULL</span>}
                        {a.flex && <span style={{ background: '#fff3e0', color: '#ef6c00', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>FLEX</span>}
                      </div>
                    </div>
                    <StockEditor anuncio={a} onSaved={carregar} onMsg={avisar} />
                    <div style={{ textAlign: 'center', minWidth: '70px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#999' }}>Vendidos</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{a.vendidos}</span>
                        <button
                          onClick={() => setVendasAnuncio(a)}
                          title="Ver todas as vendas deste anúncio"
                          style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', color: '#3483fa', cursor: 'pointer', fontSize: '.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        >🔎</button>
                      </div>
                    </div>
                    <PriceBubble anuncio={a} resumo={resumo} custoOficial={custosOficiais[a.sku]} statusCor={corStatus(a.status)} statusLabel={labelStatus(a.status)} onPriceChanged={carregar} onCustoChanged={carregarCustos} />
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
                    <MenuAcoes
                      anuncio={a}
                      onChanged={carregar}
                      onMsg={avisar}
                      onAbrirEditor={(novo) => setEditando({ anuncio: novo, mode: 'ficha' })}
                      onPedirCategoria={(alvo) => setDupCategoria(alvo)}
                    />
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
          custoInicial={custosOficiais[precificando.sku]?.custo ?? 0}
          freteInicial={precificando.frete_custo || 0}
          categoryId={precificando.categoria_id}
          tipoAtualId={precificando.tipo_anuncio_id}
          onClose={() => setPrecificando(null)}
          onSaved={(snapshot) => {
            setResumos(prev => ({ ...prev, [snapshot.itemId]: snapshot }))
            // Persiste o custo editado como custo oficial (autoritário) no backend.
            const sku = precificando.sku
            if (sku) {
              setCustosOficiais(prev => ({ ...prev, [sku]: { custo: snapshot.custo, imposto_pct: snapshot.impostoPct } }))
              fetch(`${API_BASE}/api/custos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, custo: snapshot.custo, imposto_pct: snapshot.impostoPct }),
              }).catch(() => { /* mantém estado local mesmo se falhar */ })
            }
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

      {dupCategoria && (
        <CategoriaPickerModal
          anuncio={dupCategoria}
          onClose={() => setDupCategoria(null)}
          onMsg={avisar}
          onDone={() => { setDupCategoria(null); carregar() }}
        />
      )}

      {centralPromo && (
        <CentralPromocaoPanel
          onClose={() => setCentralPromo(false)}
          onMsg={avisar}
        />
      )}
      {vendasAnuncio && (
        <VendasAnuncioModal
          itemId={vendasAnuncio.id}
          titulo={vendasAnuncio.titulo}
          onClose={() => setVendasAnuncio(null)}
        />
      )}
    </div>
  )
}

interface Promocao {
  id: string
  type: string
  name: string
  status: string
  start_date?: string | null
  finish_date?: string | null
}

interface CandidatoPromo {
  id: string
  titulo: string
  sku: string
  thumbnail?: string | null
  original_price?: number | null
  price?: number | null
  currency_id?: string | null
  suggested_discounted_price?: number | null
  min_discounted_price?: number | null
  max_discounted_price?: number | null
}

// Tipos de promoção em que o vendedor define o preço de oferta (deal_price).
const PROMO_TIPOS_COM_PRECO = new Set(['DEAL', 'PRICE_DISCOUNT', 'DOD', 'LIGHTNING', 'PRE_NEGOTIATED'])

const rotuloTipoPromo = (t: string): string => {
  switch (t) {
    case 'DEAL': return 'Campanha tradicional'
    case 'PRICE_DISCOUNT': return 'Desconto no preço'
    case 'DOD': return 'Oferta do dia'
    case 'LIGHTNING': return 'Oferta relâmpago'
    case 'MARKETPLACE_CAMPAIGN': return 'Campanha co-financiada'
    case 'SELLER_CAMPAIGN': return 'Campanha do vendedor'
    case 'PRE_NEGOTIATED': return 'Desconto pré-negociado'
    case 'VOLUME': return 'Desconto por volume'
    default: return t
  }
}

const janelaPromo = (p: Promocao): string => {
  const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '--'
  if (!p.start_date && !p.finish_date) return ''
  return `${fmt(p.start_date)} → ${fmt(p.finish_date)}`
}

function CentralPromocaoPanel({ onClose, onMsg }: { onClose: () => void; onMsg: (t: 'ok' | 'erro', s: string) => void }) {
  const [promocoes, setPromocoes] = useState<Promocao[]>([])
  const [carregandoPromos, setCarregandoPromos] = useState(true)
  const [erroPromos, setErroPromos] = useState('')
  const [selecionada, setSelecionada] = useState<Promocao | null>(null)
  const [candidatos, setCandidatos] = useState<CandidatoPromo[]>([])
  const [carregandoCand, setCarregandoCand] = useState(false)
  const [erroCand, setErroCand] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregandoPromos(true)
    setErroPromos('')
    fetch(`${API_BASE}/api/ml/promocoes`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!ativo) return
        if (d.erro) { setErroPromos(d.erro); setPromocoes([]) }
        else setPromocoes(d.promocoes || [])
      })
      .catch(e => { if (ativo) setErroPromos('Erro de conexão: ' + String(e)) })
      .finally(() => { if (ativo) setCarregandoPromos(false) })
    return () => { ativo = false }
  }, [])

  const abrirPromocao = useCallback(async (p: Promocao) => {
    setSelecionada(p)
    setCandidatos([])
    setErroCand('')
    setCarregandoCand(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/promocoes/${encodeURIComponent(p.id)}/candidatos?promotion_type=${encodeURIComponent(p.type)}`, { cache: 'no-store' })
      const d = await r.json()
      if (d.erro) { setErroCand(d.erro); setCandidatos([]) }
      else setCandidatos(d.candidatos || [])
    } catch (e) {
      setErroCand('Erro de conexão: ' + String(e))
    } finally {
      setCarregandoCand(false)
    }
  }, [])

  const removerCandidato = (itemId: string) => setCandidatos(prev => prev.filter(c => c.id !== itemId))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: '1.25rem', boxShadow: '0 24px 60px rgba(16,24,40,.28)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.85rem' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1d2939' }}>🏷️ Central de Promoção</div>
            <div style={{ fontSize: '.82rem', color: '#667085', marginTop: 2 }}>
              {selecionada ? 'Anúncios elegíveis e ainda fora desta promoção.' : 'Escolha uma campanha para ver os anúncios que ainda não estão nela.'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: '1px solid #e4e7ec', background: '#fff', color: '#667085', fontSize: '1.1rem', cursor: 'pointer' }}>×</button>
        </div>

        {!selecionada ? (
          <PromoLista
            promocoes={promocoes}
            carregando={carregandoPromos}
            erro={erroPromos}
            onEscolher={abrirPromocao}
          />
        ) : (
          <CandidatosLista
            promocao={selecionada}
            candidatos={candidatos}
            carregando={carregandoCand}
            erro={erroCand}
            onVoltar={() => { setSelecionada(null); setCandidatos([]); setErroCand('') }}
            onMsg={onMsg}
            onInscrito={removerCandidato}
          />
        )}
      </div>
    </div>
  )
}

function PromoLista({ promocoes, carregando, erro, onEscolher }: { promocoes: Promocao[]; carregando: boolean; erro: string; onEscolher: (p: Promocao) => void }) {
  if (carregando) return <div style={{ padding: '2rem', textAlign: 'center', color: '#98a2b3' }}>Carregando promoções…</div>
  if (erro) return (
    <div style={{ padding: '1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: 8, color: '#c62828' }}>
      {erro}
      <div style={{ marginTop: '.5rem', fontSize: '.85rem' }}>
        Se for autorização, <a href={`${API_BASE}/api/ml/conectar`} style={{ color: '#1976d2' }}>reconecte o Mercado Livre</a>.
      </div>
    </div>
  )
  if (promocoes.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: '#98a2b3' }}>Nenhuma promoção ativa na sua conta no momento.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {promocoes.map(p => (
        <button
          key={p.id}
          onClick={() => onEscolher(p)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', textAlign: 'left', padding: '.85rem 1rem', background: '#fff', border: '1px solid #e4e7ec', borderRadius: 10, cursor: 'pointer' }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#1d2939', fontSize: '.92rem' }}>{p.name}</div>
            <div style={{ fontSize: '.74rem', color: '#98a2b3', marginTop: 2 }}>
              {rotuloTipoPromo(p.type)}{janelaPromo(p) ? ` · ${janelaPromo(p)}` : ''}
            </div>
          </div>
          <span style={{ color: '#3483fa', fontWeight: 700, fontSize: '.85rem' }}>Ver anúncios →</span>
        </button>
      ))}
    </div>
  )
}

function CandidatosLista({ promocao, candidatos, carregando, erro, onVoltar, onMsg, onInscrito }: { promocao: Promocao; candidatos: CandidatoPromo[]; carregando: boolean; erro: string; onVoltar: () => void; onMsg: (t: 'ok' | 'erro', s: string) => void; onInscrito: (itemId: string) => void }) {
  return (
    <div>
      <button onClick={onVoltar} style={{ padding: '.4rem .9rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '.82rem', marginBottom: '.85rem' }}>← Promoções</button>
      <div style={{ fontWeight: 700, color: '#1d2939', fontSize: '.95rem', marginBottom: '.2rem' }}>{promocao.name}</div>
      <div style={{ fontSize: '.74rem', color: '#98a2b3', marginBottom: '.85rem' }}>{rotuloTipoPromo(promocao.type)}</div>
      {carregando ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#98a2b3' }}>Carregando anúncios elegíveis…</div>
      ) : erro ? (
        <div style={{ padding: '1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: 8, color: '#c62828' }}>{erro}</div>
      ) : candidatos.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#98a2b3' }}>Nenhum anúncio elegível e fora desta promoção. 🎉</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {candidatos.map(c => (
            <CandidatoCard key={c.id} candidato={c} promocao={promocao} onMsg={onMsg} onInscrito={onInscrito} />
          ))}
        </div>
      )}
    </div>
  )
}

function CandidatoCard({ candidato, promocao, onMsg, onInscrito }: { candidato: CandidatoPromo; promocao: Promocao; onMsg: (t: 'ok' | 'erro', s: string) => void; onInscrito: (itemId: string) => void }) {
  const exigePreco = PROMO_TIPOS_COM_PRECO.has(promocao.type)
  const sugerido = candidato.suggested_discounted_price ?? candidato.price ?? candidato.original_price ?? 0
  const [preco, setPreco] = useState(exigePreco ? String((sugerido || 0).toFixed(2)) : '')
  const [salvando, setSalvando] = useState(false)

  const inscrever = async () => {
    let deal_price: number | undefined
    if (exigePreco) {
      const v = Number(String(preco).replace(',', '.'))
      if (!v || v <= 0) { onMsg('erro', 'Informe um preço de oferta válido'); return }
      const min = candidato.min_discounted_price
      const max = candidato.max_discounted_price
      if (min != null && v < min) { onMsg('erro', `Preço abaixo do mínimo permitido (${brl(min)})`); return }
      if (max != null && v > max) { onMsg('erro', `Preço acima do máximo permitido (${brl(max)})`); return }
      deal_price = v
    }
    const txtPreco = exigePreco && deal_price != null ? ` por ${brl(deal_price)}` : ''
    if (!window.confirm(`Adicionar "${candidato.titulo}" à promoção "${promocao.name}"${txtPreco}?\n\nIsso altera o anúncio no Mercado Livre.`)) return
    setSalvando(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/promocoes/itens/${encodeURIComponent(candidato.id)}/inscrever`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotion_id: promocao.id, promotion_type: promocao.type, ...(deal_price != null ? { deal_price } : {}) }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao inscrever na promoção')
      onMsg('ok', `"${candidato.titulo}" adicionado à promoção`)
      onInscrito(candidato.id)
    } catch (e) {
      onMsg('erro', String(e instanceof Error ? e.message : e))
    } finally {
      setSalvando(false)
    }
  }

  const min = candidato.min_discounted_price
  const max = candidato.max_discounted_price

  return (
    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '.7rem .85rem', border: '1px solid #e4e7ec', borderRadius: 10, background: '#fff' }}>
      <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {candidato.thumbnail ? <img src={candidato.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc' }}>--</span>}
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem', color: '#1d2939', lineHeight: 1.3 }}>{candidato.titulo}</div>
        <div style={{ fontSize: '.74rem', color: '#98a2b3', marginTop: 2 }}>
          {candidato.sku ? `SKU: ${candidato.sku} · ` : ''}{candidato.id}
          {candidato.original_price != null ? ` · de ${brl(candidato.original_price)}` : ''}
        </div>
      </div>
      {exigePreco && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: '.8rem', color: '#475467', fontWeight: 700 }}>R$</span>
            <input
              type="text" inputMode="decimal" value={preco}
              onChange={e => setPreco(e.target.value)}
              style={{ width: 78, padding: '.35rem .5rem', border: '1px solid #cfd8dc', borderRadius: 6, fontSize: '.85rem', fontWeight: 700, textAlign: 'right' }}
            />
          </div>
          {(min != null || max != null) && (
            <span style={{ fontSize: '.66rem', color: '#98a2b3' }}>
              {min != null ? `mín ${brl(min)}` : ''}{min != null && max != null ? ' · ' : ''}{max != null ? `máx ${brl(max)}` : ''}
            </span>
          )}
        </div>
      )}
      <button
        onClick={inscrever}
        disabled={salvando}
        style={{ padding: '.5rem 1rem', background: '#067647', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '.84rem', cursor: salvando ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
      >
        {salvando ? '...' : 'Adicionar'}
      </button>
    </div>
  )
}

function ResumoTooltip({ anuncio, resumo, editavel = false, modal = false, onSaved, onCustoChanged, onClose, custoOficial }: { anuncio: Anuncio; resumo?: PricingSnapshot; editavel?: boolean; modal?: boolean; onSaved?: () => void; onCustoChanged?: () => void; onClose?: () => void; custoOficial?: CustoOficial | null }) {
  const [live, setLive] = useState<LivePriceSummary | null>(null)
  const [breakdown, setBreakdown] = useState<LivePriceBreakdown | null>(null)
  const [novoPreco, setNovoPreco] = useState('')
  const [novoCusto, setNovoCusto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvandoCusto, setSalvandoCusto] = useState(false)
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
          descontoTarifa: precoData && !precoData.erro ? (precoData.desconto_tarifa ?? null) : null,
        })
      }
    }).catch(() => { /* mantem fallback */ })
    return () => { ativo = false }
  }, [anuncio.id])

  const resumoMargem = montarResumoMargem(anuncio, resumo, live, breakdown, custoOficial)

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

  const salvarCusto = async () => {
    const v = Number(String(novoCusto).replace(',', '.'))
    if (!v || v < 0) { setMsg({ tipo: 'erro', texto: 'Informe um custo válido' }); return }
    if (!anuncio.sku) { setMsg({ tipo: 'erro', texto: 'Anúncio sem SKU — não é possível salvar o custo' }); return }
    if (!window.confirm(`Alterar o custo para ${brl(v)}?\n\nIsso vai recalcular a margem do anúncio.`)) return
    setSalvandoCusto(true); setMsg(null)
    try {
      const payload: { sku: string; custo: number; imposto_pct?: number } = { sku: anuncio.sku, custo: v }
      // Preserva o imposto já cadastrado (o backend reseta pra 9% se não enviar).
      if (custoOficial?.imposto_pct != null) payload.imposto_pct = custoOficial.imposto_pct
      const r = await fetch(`${API_BASE}/api/custos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao atualizar custo')
      if (!d.salvos) throw new Error('Custo não foi salvo — verifique o SKU do anúncio')
      setMsg({ tipo: 'ok', texto: `Custo atualizado: ${brl(v)}` })
      setNovoCusto('')
      onCustoChanged?.()
      onSaved?.()
    } catch (e) {
      setMsg({ tipo: 'erro', texto: String(e instanceof Error ? e.message : e) })
    } finally {
      setSalvandoCusto(false)
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
      {resumoMargem.frete != null && (
        <div style={{ fontSize: '.66rem', color: '#98a2b3', lineHeight: 1.4, margin: '-.15rem 0 .35rem', paddingLeft: '.1rem' }}>
          O valor do frete é informado pelo ML e é baseado nas dimensões do anúncio
          {anuncio.dimensoes?.texto ? ` (${anuncio.dimensoes.texto})` : ''}. Se o ML identificar
          medidas diferentes na venda, o valor do frete pode mudar.
        </div>
      )}
      <LinhaResumo label="Tarifa de venda" valor={resumoMargem.tarifa != null ? `-${brl(resumoMargem.tarifa)}` : '--'} extra={resumoMargem.tarifaPct != null ? `${resumoMargem.tarifaPct.toFixed(2)}%` : undefined} cor="#b42318" />
      {resumoMargem.descontoTarifa != null && resumoMargem.descontoTarifa > 0 && (
        <LinhaResumo label="Desconto de tarifa" valor={`+${brl(resumoMargem.descontoTarifa)}`} extra={resumoMargem.tarifa != null && resumoMargem.tarifa > 0 ? `${((resumoMargem.descontoTarifa / resumoMargem.tarifa) * 100).toFixed(1)}%` : undefined} cor="#067647" />
      )}
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
      {editavel && (
        <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid #e9eef7' }}>
          <div style={{ fontSize: '.68rem', color: '#98a2b3', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '.4rem' }}>Editar custo</div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <span style={{ fontSize: '.85rem', color: '#475467', fontWeight: 700 }}>R$</span>
            <input
              type="text"
              inputMode="decimal"
              value={novoCusto}
              onChange={e => setNovoCusto(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder={resumoMargem.custo != null ? String(resumoMargem.custo) : '0,00'}
              style={{ flex: 1, minWidth: 0, padding: '.45rem .6rem', border: '1px solid #cfd8dc', borderRadius: 6, fontSize: '.9rem', fontWeight: 700, boxSizing: 'border-box' }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); salvarCusto() }}
              disabled={salvandoCusto}
              style={{ padding: '.45rem .8rem', background: '#5b3cc4', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: salvandoCusto ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {salvandoCusto ? '...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}
      {!modal && <div style={{ position: 'absolute', top: -7, right: 32, width: 14, height: 14, background: '#ffffff', borderLeft: '1px solid #cfe0ff', borderTop: '1px solid #cfe0ff', transform: 'rotate(45deg)' }} />}
    </div>
  )
}

function PriceBubble({ anuncio, resumo, statusCor, statusLabel, onPriceChanged, onCustoChanged, custoOficial }: { anuncio: Anuncio; resumo?: PricingSnapshot; statusCor: string; statusLabel: string; onPriceChanged?: () => void; onCustoChanged?: () => void; custoOficial?: CustoOficial | null }) {
  const [hovered, setHovered] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [live, setLive] = useState<LivePriceSummary | null>(null)
  const [breakdown, setBreakdown] = useState<LivePriceBreakdown | null>(null)
  const [descTarifa, setDescTarifa] = useState<number | null>(null)
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)

  useEffect(() => {
    let ativo = true
    fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/preco-resumo`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!ativo || d.erro) return
        setLive({ cheio: d.cheio ?? null, promocional: d.promocional ?? null })
        setDescTarifa(d.desconto_tarifa ?? null)
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
          descontoTarifa: descTarifa,
        })
      })
      .catch(() => { /* fallback silencioso */ })
      .finally(() => {
        if (ativo) setLoadingBreakdown(false)
      })
    return () => { ativo = false }
  }, [hovered, resumo, breakdown, loadingBreakdown, anuncio.id, descTarifa])

  const resumoMargem = montarResumoMargem(anuncio, resumo, live, breakdown, custoOficial)

  return (
    <>
    {aberto && (
      <div
        onClick={() => setAberto(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      >
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 380 }}>
          <ResumoTooltip anuncio={anuncio} resumo={resumo} custoOficial={custoOficial} editavel modal onSaved={onPriceChanged} onCustoChanged={onCustoChanged} onClose={() => setAberto(false)} />
        </div>
      </div>
    )}
    <div
      onClick={() => setAberto(v => !v)}
      style={{
        position: 'relative',
        minWidth: '186px',
        marginLeft: 'auto',
        padding: '.6rem .85rem .68rem',
        borderRadius: '12px',
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
      {hovered && !aberto && <ResumoTooltip anuncio={anuncio} resumo={resumo} custoOficial={custoOficial} />}
    </div>
    </>
  )
}

function BubbleMetric({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '.46rem .55rem' }}>
      <div style={{ fontSize: '.66rem', color: '#98a2b3', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '.98rem', color: cor, fontWeight: 800, lineHeight: 1.25 }}>{value}</div>
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

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function SkuChip({ sku, onCopiado }: { sku: string; onCopiado: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#555' }}>
      SKU: {sku}
      <button
        onClick={async (e) => { e.stopPropagation(); if (await copiarTexto(sku)) onCopiado() }}
        title="Copiar SKU"
        style={{ border: '1px solid #d4dbe6', background: '#fff', borderRadius: '5px', cursor: 'pointer', padding: '1px 5px', fontSize: '0.72rem', lineHeight: 1.2, color: '#475467' }}
      >
        📋
      </button>
    </span>
  )
}

function StockEditor({ anuncio, onSaved, onMsg }: { anuncio: Anuncio; onSaved: () => void; onMsg: (t: 'ok' | 'erro', s: string) => void }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(String(anuncio.disponivel ?? 0))
  const [salvando, setSalvando] = useState(false)
  const travadoFull = !!anuncio.full
  const finalizado = anuncio.status === 'closed'

  const salvar = async () => {
    const q = parseInt(valor, 10)
    if (isNaN(q) || q < 0) { onMsg('erro', 'Informe uma quantidade válida'); return }
    setSalvando(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/estoque`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantidade: q }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao atualizar o estoque')
      onMsg('ok', `Estoque atualizado para ${d.quantidade_nova ?? q}`)
      setEditando(false)
      onSaved()
    } catch (e) {
      onMsg('erro', String(e instanceof Error ? e.message : e))
    } finally {
      setSalvando(false)
    }
  }

  if (editando) {
    return (
      <div style={{ textAlign: 'center', minWidth: '110px' }}>
        <div style={{ fontSize: '0.7rem', color: '#999', marginBottom: 2 }}>Estoque</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="number" min="0" step="1" autoFocus
            value={valor}
            onChange={e => setValor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false) }}
            style={{ width: '58px', padding: '0.3rem', border: '1px solid #bbb', borderRadius: 6, textAlign: 'center', fontWeight: 700 }}
          />
          <button onClick={salvar} disabled={salvando} title="Salvar" style={{ border: 'none', background: '#3483fa', color: '#fff', borderRadius: 6, padding: '0.3rem 0.45rem', cursor: salvando ? 'wait' : 'pointer', fontWeight: 800 }}>✓</button>
          <button onClick={() => { setEditando(false); setValor(String(anuncio.disponivel ?? 0)) }} title="Cancelar" style={{ border: '1px solid #ddd', background: '#fff', color: '#888', borderRadius: 6, padding: '0.3rem 0.45rem', cursor: 'pointer' }}>×</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center', minWidth: '70px' }}>
      <div style={{ fontSize: '0.7rem', color: '#999' }}>Estoque</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontWeight: 700, color: (anuncio.disponivel ?? 0) > 0 ? '#1a1a1a' : '#c62828' }}>{anuncio.disponivel}</span>
        {!travadoFull && !finalizado && (
          <button
            onClick={() => { setValor(String(anuncio.disponivel ?? 0)); setEditando(true) }}
            title="Editar estoque"
            style={{ border: '1px solid #d4dbe6', background: '#fff', borderRadius: 5, cursor: 'pointer', padding: '0 5px', fontSize: '0.72rem', color: '#475467' }}
          >✏️</button>
        )}
      </div>
      {travadoFull && <div style={{ fontSize: '0.6rem', color: '#9aa6b2', marginTop: 1 }}>FULL (ML gere)</div>}
    </div>
  )
}

function MenuItem({ label, sub, onClick, disabled, danger }: { label: string; sub?: string; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.85rem',
        background: '#fff', border: 'none', borderBottom: '1px solid #f2f4f7',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? '#bcc4cf' : danger ? '#c62828' : '#344054',
        fontWeight: 600, fontSize: '0.85rem',
      }}
    >
      {label}
      {sub && <div style={{ fontSize: '0.7rem', color: disabled ? '#cbd2da' : '#98a2b3', fontWeight: 500 }}>{sub}</div>}
    </button>
  )
}

function MenuAcoes({ anuncio, onChanged, onMsg, onAbrirEditor, onPedirCategoria }: { anuncio: Anuncio; onChanged: () => void; onMsg: (t: 'ok' | 'erro', s: string) => void; onAbrirEditor: (a: Anuncio) => void; onPedirCategoria: (a: Anuncio) => void }) {
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const finalizado = anuncio.status === 'closed'

  const acao = async (url: string, body: object | null, confirmMsg: string, okMsg: string) => {
    if (!window.confirm(confirmMsg)) return
    setAberto(false)
    setOcupado(true)
    try {
      const r = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha na operação')
      onMsg('ok', okMsg)
      onChanged()
    } catch (e) {
      onMsg('erro', String(e instanceof Error ? e.message : e))
    } finally {
      setOcupado(false)
    }
  }

  const id = anuncio.id
  const pausar = () => acao(`/api/ml/anuncios/${id}/status`, { status: 'paused' }, 'Pausar este anúncio no Mercado Livre?', 'Anúncio pausado')
  const reativar = () => acao(`/api/ml/anuncios/${id}/status`, { status: 'active' }, 'Reativar este anúncio no Mercado Livre?', 'Anúncio reativado')
  const finalizar = () => acao(`/api/ml/anuncios/${id}/status`, { status: 'closed' }, 'Finalizar este anúncio? Isso é IRREVERSÍVEL no Mercado Livre.', 'Anúncio finalizado')
  const excluir = () => acao(`/api/ml/anuncios/${id}/excluir`, null, 'Excluir este anúncio? Ele será finalizado e removido (o ML guarda o histórico).', 'Anúncio excluído')

  // Duplicação: cria um anúncio NOVO pausado. abrirEditor=true abre a edição no item novo.
  const duplicar = async (abrirEditor: boolean) => {
    setAberto(false)
    setOcupado(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${id}/duplicar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao duplicar o anúncio')
      onMsg('ok', `Anúncio duplicado e pausado (${d.novo_id}). Está na aba Pausados.`)
      if (abrirEditor && d.novo_id) {
        onAbrirEditor({ ...anuncio, id: d.novo_id, status: 'paused', permalink: d.permalink, vendidos: 0 })
      } else {
        onChanged()
      }
    } catch (e) {
      onMsg('erro', String(e instanceof Error ? e.message : e))
    } finally {
      setOcupado(false)
    }
  }
  const duplicarIgual = () => { if (window.confirm('Duplicar este anúncio igual? Será criado um novo anúncio PAUSADO.')) duplicar(false) }
  const duplicarEditando = () => duplicar(true)
  const duplicarOutraCategoria = () => { setAberto(false); onPedirCategoria(anuncio) }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setAberto(v => !v)}
        disabled={ocupado}
        title="Mais ações"
        style={{ padding: '.55rem .8rem', borderRadius: 999, border: '1px solid #d4dbe6', background: aberto ? '#eef2f7' : '#fff', color: '#344054', cursor: ocupado ? 'wait' : 'pointer', fontWeight: 800, fontSize: '.95rem', lineHeight: 1 }}
      >
        ⋮
      </button>
      {aberto && (
        <>
          <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, width: 230, background: '#fff', border: '1px solid #e4e7ec', borderRadius: 10, boxShadow: '0 14px 30px rgba(16,24,40,.16)', overflow: 'hidden' }}>
            {!finalizado && anuncio.status === 'active' && <MenuItem label="⏸️ Pausar anúncio" onClick={pausar} />}
            {!finalizado && anuncio.status === 'paused' && <MenuItem label="▶️ Reativar anúncio" onClick={reativar} />}
            {!finalizado && <MenuItem label="⛔ Finalizar anúncio" sub="irreversível no ML" onClick={finalizar} />}
            <MenuItem label="🗑️ Excluir anúncio" sub="finaliza e remove dos ativos" danger onClick={excluir} />
            <div style={{ padding: '0.35rem 0.85rem', fontSize: '0.66rem', color: '#98a2b3', textTransform: 'uppercase', letterSpacing: '.03em', background: '#fafbfc', borderTop: '1px solid #f2f4f7' }}>Duplicar (cria cópia pausada)</div>
            <MenuItem label="📄 Duplicar igual" onClick={duplicarIgual} />
            <MenuItem label="✏️ Duplicar editando" sub="abre a edição no anúncio novo" onClick={duplicarEditando} />
            <MenuItem label="🗂️ Duplicar em outra categoria" onClick={duplicarOutraCategoria} />
          </div>
        </>
      )}
    </div>
  )
}

interface CategoriaML { category_id: string; category_name?: string; domain_name?: string }

function CategoriaPickerModal({ anuncio, onClose, onMsg, onDone }: { anuncio: Anuncio; onClose: () => void; onMsg: (t: 'ok' | 'erro', s: string) => void; onDone: () => void }) {
  const [q, setQ] = useState(anuncio.titulo || '')
  const [cats, setCats] = useState<CategoriaML[]>([])
  const [buscando, setBuscando] = useState(false)
  const [duplicando, setDuplicando] = useState(false)

  const buscar = useCallback(async (termo: string) => {
    if (!termo.trim()) { setCats([]); return }
    setBuscando(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/categorias?q=${encodeURIComponent(termo.trim())}`, { cache: 'no-store' })
      const d = await r.json()
      setCats(d.categorias || [])
    } catch {
      setCats([])
    } finally {
      setBuscando(false)
    }
  }, [])

  useEffect(() => { buscar(anuncio.titulo || '') }, [buscar, anuncio.titulo])

  const escolher = async (cat: CategoriaML) => {
    if (duplicando) return
    if (!window.confirm(`Duplicar este anúncio na categoria:\n\n${cat.category_name || cat.category_id}\n\nSerá criado um novo anúncio PAUSADO.`)) return
    setDuplicando(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/duplicar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: cat.category_id }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao duplicar nesta categoria')
      onMsg('ok', `Anúncio duplicado na categoria ${cat.category_name || cat.category_id} (pausado, ${d.novo_id}).`)
      onDone()
    } catch (e) {
      onMsg('erro', String(e instanceof Error ? e.message : e))
    } finally {
      setDuplicando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 14, padding: '1.25rem', boxShadow: '0 24px 60px rgba(16,24,40,.28)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.75rem' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: '#1d2939' }}>Duplicar em outra categoria</div>
            <div style={{ fontSize: '.8rem', color: '#667085', marginTop: 2, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{anuncio.titulo}</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e4e7ec', background: '#fff', color: '#667085', fontSize: '1.1rem', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.85rem' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') buscar(q) }}
            placeholder="Buscar categoria por palavra-chave..."
            style={{ flex: 1, padding: '.6rem .8rem', border: '1px solid #cfd8dc', borderRadius: 8, fontSize: '.9rem' }}
          />
          <button onClick={() => buscar(q)} disabled={buscando} style={{ padding: '.6rem 1rem', background: '#3483fa', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: buscando ? 'wait' : 'pointer' }}>Buscar</button>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef1f5', borderRadius: 10 }}>
          {buscando ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#98a2b3' }}>Buscando categorias…</div>
          ) : cats.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#98a2b3' }}>Nenhuma categoria encontrada. Tente outra palavra-chave.</div>
          ) : cats.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => escolher(cat)}
              disabled={duplicando}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '.7rem .85rem', background: '#fff', border: 'none', borderBottom: '1px solid #f2f4f7', cursor: duplicando ? 'wait' : 'pointer' }}
            >
              <div style={{ fontWeight: 700, color: '#1d2939', fontSize: '.88rem' }}>{cat.category_name || cat.category_id}</div>
              <div style={{ fontSize: '.72rem', color: '#98a2b3' }}>{cat.category_id}{cat.domain_name ? ` · ${cat.domain_name}` : ''}</div>
            </button>
          ))}
        </div>
        {duplicando && <div style={{ marginTop: '.75rem', fontSize: '.82rem', color: '#3483fa', fontWeight: 700 }}>Duplicando no Mercado Livre…</div>}
        <div style={{ marginTop: '.75rem', fontSize: '.72rem', color: '#b54708', background: '#fffaeb', border: '1px solid #fedf89', borderRadius: 8, padding: '.5rem .6rem' }}>
          ⚠️ Categorias diferentes pedem fichas técnicas diferentes. Se o ML recusar atributos obrigatórios, o erro aparece e você ajusta a ficha no anúncio novo.
        </div>
      </div>
    </div>
  )
}

export default AnunciosML
