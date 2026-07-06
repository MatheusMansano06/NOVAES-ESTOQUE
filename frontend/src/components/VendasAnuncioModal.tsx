import { useState, useEffect, useMemo, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

const brl = (v?: number | null) => v == null ? '--' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')
const pct = (v?: number | null) => v == null ? '--' : Number(v).toFixed(2).replace('.', ',') + '%'

function dataHora(iso?: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function dataCurta(iso?: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR')
}
function cep(v?: string | null): string {
  if (!v) return '--'
  const s = String(v).replace(/\D/g, '')
  return s.length === 8 ? `${s.slice(0, 5)}-${s.slice(5)}` : v
}
function tempoRelativo(iso?: string | null): string {
  if (!iso) return 'nunca'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  const seg = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (seg < 90) return 'agora'
  const min = seg / 60
  if (min < 60) return `há ${Math.round(min)} min`
  const h = min / 60
  if (h < 24) return `há ${Math.round(h)}h`
  return `há ${Math.round(h / 24)}d`
}

interface Pagamento { tipo?: string | null; metodo?: string | null; parcelas?: number | null; rotulo?: string; total_pago?: number | null }
interface Envio { logistic_type?: string | null; rotulo?: string; cep?: string | null; cidade?: string | null; uf?: string | null; destinatario?: string | null; entrega_estimada?: string | null }
interface Financeiro { receita: number; tarifa: number; frete: number; custo?: number | null; lucro: number; margem_pct?: number | null; tem_custo: boolean }
interface Venda {
  order_id: string
  pack_id?: string | null
  cliente?: string | null
  cliente_nickname?: string | null
  data?: string | null
  status?: string | null
  cancelada?: boolean
  quantidade: number
  preco_unitario: number
  titulo?: string | null
  sku?: string | null
  disponivel_apos: number
  pagamento: Pagamento
  envio: Envio
  financeiro: Financeiro
}
interface Resultado {
  item_id: string
  sku?: string | null
  titulo?: string | null
  thumbnail?: string | null
  vendidos_total?: number | null
  disponivel_atual: number
  full: boolean
  atualizado_em?: string | null
  total_vendas: number
  resumo: { unidades: number; receita: number; lucro: number; margem_pct?: number | null }
  vendas: Venda[]
  erro?: string
}

// Cor/ícone do meio de pagamento
function pagVisual(p: Pagamento): { cor: string; bg: string; icon: string } {
  const m = (p.metodo || '').toLowerCase()
  const t = (p.tipo || '').toLowerCase()
  if (m.includes('pix')) return { cor: '#0a7d6e', bg: '#d7f5ef', icon: '⚡' }
  if (t === 'credit_card') return { cor: '#7a3ffa', bg: '#ece4ff', icon: '💳' }
  if (t === 'debit_card') return { cor: '#1668dc', bg: '#dbeafe', icon: '🏦' }
  if (t === 'account_money') return { cor: '#b45309', bg: '#fef3c7', icon: '💰' }
  if (t.startsWith('consumer_credit') || m.includes('consumer_credit')) return { cor: '#0958d9', bg: '#dbeafe', icon: '🟡' }
  if (t === 'ticket') return { cor: '#475467', bg: '#eaecf0', icon: '🧾' }
  return { cor: '#475467', bg: '#eaecf0', icon: '💵' }
}

function LinhaFin({ label, valor, tom, negativo, forte }: { label: string; valor?: number | null; tom?: string; negativo?: boolean; forte?: boolean }) {
  const cor = tom || (negativo ? '#d92d20' : '#101828')
  const txt = valor == null ? '--' : (negativo ? '- ' : '') + brl(Math.abs(valor))
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: forte ? '.9rem' : '.78rem', fontWeight: forte ? 800 : 500 }}>
      <span style={{ color: '#667085' }}>{label}</span>
      <span style={{ color: cor, fontWeight: forte ? 800 : 600, whiteSpace: 'nowrap' }}>{txt}</span>
    </div>
  )
}

function Copiavel({ texto, prefixo }: { texto?: string | null; prefixo?: string }) {
  const [copiado, setCopiado] = useState(false)
  if (!texto) return <span style={{ color: '#98a2b3' }}>--</span>
  return (
    <span
      onClick={() => { navigator.clipboard?.writeText(String(texto)); setCopiado(true); setTimeout(() => setCopiado(false), 1200) }}
      title="Copiar"
      style={{ cursor: 'pointer', fontVariantNumeric: 'tabular-nums', color: copiado ? '#0a7d6e' : '#1d2939' }}
    >
      {prefixo}{texto} {copiado ? '✓' : '⧉'}
    </span>
  )
}

function CardVenda({ v }: { v: Venda }) {
  const pv = pagVisual(v.pagamento)
  const fin = v.financeiro
  const lucroCor = fin.lucro >= 0 ? '#0a7d6e' : '#d92d20'
  return (
    <div style={{
      border: '1px solid #eaecf0', borderRadius: 12, padding: '0.9rem', background: v.cancelada ? '#fff7f7' : '#fff',
      display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(220px,1.4fr) minmax(180px,auto)', gap: '1rem', alignItems: 'stretch',
      opacity: v.cancelada ? 0.75 : 1,
    }}>
      {/* Coluna 1 — cliente / IDs / entrega */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: '#101828', fontSize: '.9rem' }}>{v.cliente || v.cliente_nickname || 'Cliente'}</div>
        {v.cliente_nickname && <div style={{ fontSize: '.72rem', color: '#98a2b3', marginBottom: 6 }}>{v.cliente_nickname}</div>}
        <div style={{ fontSize: '.74rem', color: '#475467', lineHeight: 1.7 }}>
          <div>Venda: <Copiavel texto={v.order_id} prefixo="#" /></div>
          <div>Carrinho: <Copiavel texto={v.pack_id} prefixo="#" /></div>
          <div>📍 CEP: <strong>{cep(v.envio.cep)}</strong>{v.envio.uf ? ` · ${v.envio.cidade || ''}/${v.envio.uf}` : ''}</div>
          <div>🗓️ {dataHora(v.data)}</div>
        </div>
      </div>

      {/* Coluna 2 — produto / qtd / pagamento / envio */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: '#fef0c7', color: '#b54708', fontWeight: 800, fontSize: '.74rem', padding: '2px 8px', borderRadius: 6 }}>{v.quantidade}x</span>
          <span style={{ fontWeight: 700, color: '#101828' }}>{brl(v.preco_unitario)}</span>
          {v.sku && <span style={{ fontSize: '.72rem', color: '#667085' }}>SKU {v.sku}</span>}
          {v.cancelada && <span style={{ background: '#fee4e2', color: '#b42318', fontSize: '.68rem', fontWeight: 700, padding: '1px 7px', borderRadius: 6 }}>CANCELADA</span>}
        </div>
        <div style={{ fontSize: '.78rem', color: '#475467', lineHeight: 1.4 }}>{v.titulo}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: pv.bg, color: pv.cor, fontWeight: 700, fontSize: '.75rem', padding: '3px 9px', borderRadius: 20 }}>
            <span>{pv.icon}</span>{v.pagamento.rotulo || '—'}
          </span>
          <span style={{ fontSize: '.72rem', color: '#667085' }}>🚚 {v.envio.rotulo || 'Mercado Envios'}</span>
        </div>
        <div style={{ fontSize: '.74rem', color: '#0a7d6e', fontWeight: 600 }}>
          {v.disponivel_apos} disponível{v.disponivel_apos === 1 ? '' : 'is'} após esta venda
        </div>
        {v.envio.entrega_estimada && (
          <div style={{ fontSize: '.72rem', color: '#667085' }}>📦 Entrega estimada: {dataCurta(v.envio.entrega_estimada)}</div>
        )}
      </div>

      {/* Coluna 3 — financeiro */}
      <div style={{ minWidth: 180, borderLeft: '1px dashed #eaecf0', paddingLeft: '0.9rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
        <LinhaFin label="Receita" valor={fin.receita} tom="#0a7d6e" />
        <LinhaFin label="Tarifa ML" valor={fin.tarifa} negativo />
        <LinhaFin label="Frete" valor={fin.frete} negativo />
        {fin.tem_custo
          ? <LinhaFin label="Custo produto" valor={fin.custo} negativo />
          : <div style={{ fontSize: '.7rem', color: '#98a2b3' }}>custo do SKU não cadastrado</div>}
        <div style={{ borderTop: '1px solid #eaecf0', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: '.78rem', fontWeight: 800, color: '#101828' }}>Lucro</span>
          <span style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: lucroCor }}>{brl(fin.lucro)}</span>
            {fin.margem_pct != null && <span style={{ fontSize: '.72rem', color: lucroCor, marginLeft: 6 }}>({pct(fin.margem_pct)})</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

export function VendasAnuncioModal({ itemId, titulo, onClose }: { itemId: string; titulo?: string; onClose: () => void }) {
  const [dados, setDados] = useState<Resultado | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [pagFiltro, setPagFiltro] = useState<string>('todos')

  const carregar = useCallback(async (forcar = false) => {
    if (forcar) setAtualizando(true); else setCarregando(true)
    setErro('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${encodeURIComponent(itemId)}/vendas?sync=${forcar ? 1 : 0}`, { cache: 'no-store' })
      const j: Resultado = await r.json()
      if (!r.ok || j.erro) throw new Error(j.erro || 'Falha ao carregar vendas')
      setDados(j)
    } catch (e: any) {
      setErro(e?.message || 'Erro ao carregar vendas')
    } finally {
      setCarregando(false); setAtualizando(false)
    }
  }, [itemId])

  useEffect(() => { carregar(false) }, [carregar])

  const vendasFiltradas = useMemo(() => {
    if (!dados) return []
    const q = busca.trim().toLowerCase()
    return dados.vendas.filter(v => {
      if (pagFiltro !== 'todos') {
        const m = (v.pagamento.metodo || '').toLowerCase()
        const t = (v.pagamento.tipo || '').toLowerCase()
        if (pagFiltro === 'pix' && !m.includes('pix')) return false
        if (pagFiltro === 'credit_card' && t !== 'credit_card') return false
        if (pagFiltro === 'debit_card' && t !== 'debit_card') return false
        if (pagFiltro === 'outros' && (m.includes('pix') || t === 'credit_card' || t === 'debit_card')) return false
      }
      if (!q) return true
      return [v.cliente, v.cliente_nickname, v.order_id, v.pack_id, v.envio.cep, v.envio.cidade].some(x => (x || '').toString().toLowerCase().includes(q))
    })
  }, [dados, busca, pagFiltro])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2vh 1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1080, maxHeight: '96vh', display: 'flex', flexDirection: 'column', background: '#f9fafb', borderRadius: 16, boxShadow: '0 24px 60px rgba(16,24,40,.32)', overflow: 'hidden' }}>
        {/* Cabeçalho */}
        <div style={{ padding: '1rem 1.25rem', background: '#fff', borderBottom: '1px solid #eaecf0', display: 'flex', gap: 14, alignItems: 'center' }}>
          {dados?.thumbnail && <img src={dados.thumbnail} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#101828' }}>🔎 Vendas do anúncio</div>
            <div style={{ fontSize: '.8rem', color: '#667085', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dados?.titulo || titulo || itemId}</div>
          </div>
          {dados && (
            <div style={{ flexShrink: 0, fontSize: '.72rem', color: '#98a2b3', textAlign: 'right' }}>atualizado<br />{tempoRelativo(dados.atualizado_em)}</div>
          )}
          <button
            onClick={() => carregar(true)}
            disabled={atualizando || carregando}
            title="Buscar vendas novas no Mercado Livre agora"
            style={{ flexShrink: 0, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #d0d5dd', background: atualizando ? '#f2f4f7' : '#fff', color: '#3538cd', fontSize: '.8rem', fontWeight: 600, cursor: atualizando || carregando ? 'default' : 'pointer' }}
          >{atualizando ? '⏳ Atualizando…' : '🔄 Atualizar'}</button>
          <button onClick={onClose} aria-label="Fechar" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: '1px solid #e4e7ec', background: '#fff', color: '#667085', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
        </div>

        {/* Resumo */}
        {dados && (
          <div style={{ display: 'flex', gap: 10, padding: '0.75rem 1.25rem', background: '#fff', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
            <Kpi label="Vendas" valor={String(dados.total_vendas)} />
            <Kpi label="Unidades" valor={String(dados.resumo.unidades)} />
            <Kpi label="Receita" valor={brl(dados.resumo.receita)} tom="#0a7d6e" />
            <Kpi label="Lucro" valor={brl(dados.resumo.lucro)} tom={dados.resumo.lucro >= 0 ? '#0a7d6e' : '#d92d20'} sub={dados.resumo.margem_pct != null ? pct(dados.resumo.margem_pct) : undefined} />
            <Kpi label="Disponível hoje" valor={String(dados.disponivel_atual)} />
            {dados.vendidos_total != null && <Kpi label="Vendidos (ML)" valor={String(dados.vendidos_total)} />}
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, padding: '0.65rem 1.25rem', background: '#fff', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por cliente, venda, carrinho, CEP…"
            style={{ flex: 1, minWidth: 200, padding: '7px 11px', border: '1px solid #e4e7ec', borderRadius: 8, fontSize: '.82rem' }} />
          {[['todos', 'Todos'], ['pix', '⚡ Pix'], ['credit_card', '💳 Crédito'], ['debit_card', '🏦 Débito'], ['outros', 'Outros']].map(([id, lab]) => (
            <button key={id} onClick={() => setPagFiltro(id)}
              style={{ padding: '6px 11px', borderRadius: 8, border: '1px solid ' + (pagFiltro === id ? '#7a3ffa' : '#e4e7ec'), background: pagFiltro === id ? '#ece4ff' : '#fff', color: pagFiltro === id ? '#5925dc' : '#475467', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>
              {lab}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {carregando && <div style={{ textAlign: 'center', color: '#667085', padding: '2.5rem' }}>Carregando vendas do Mercado Livre…</div>}
          {!carregando && erro && (
            <div style={{ textAlign: 'center', color: '#b42318', padding: '2rem' }}>
              {erro}<br /><button onClick={() => carregar(false)} style={{ marginTop: 10, padding: '7px 16px', borderRadius: 8, border: '1px solid #e4e7ec', background: '#fff', cursor: 'pointer' }}>Tentar de novo</button>
            </div>
          )}
          {!carregando && !erro && vendasFiltradas.length === 0 && (
            <div style={{ textAlign: 'center', color: '#667085', padding: '2.5rem' }}>Nenhuma venda encontrada para este anúncio.</div>
          )}
          {!carregando && !erro && vendasFiltradas.map(v => <CardVenda key={`${v.order_id}-${v.sku || ''}`} v={v} />)}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, valor, tom, sub }: { label: string; valor: string; tom?: string; sub?: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #eaecf0', borderRadius: 10, padding: '.5rem .8rem', minWidth: 92 }}>
      <div style={{ fontSize: '.68rem', color: '#98a2b3', textTransform: 'uppercase', letterSpacing: '.3px' }}>{label}</div>
      <div style={{ fontWeight: 800, color: tom || '#101828', fontSize: '.98rem' }}>{valor}{sub && <span style={{ fontSize: '.72rem', color: tom || '#667085', marginLeft: 5 }}>{sub}</span>}</div>
    </div>
  )
}
