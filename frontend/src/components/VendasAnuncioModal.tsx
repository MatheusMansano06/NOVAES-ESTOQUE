import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

const brl = (v?: number | null) => v == null ? '--' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
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
  catalogo?: boolean | null
  atualizado_em?: string | null
  total_vendas: number
  envio_localizados?: number
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

// ---- Agrupadores para os gráficos de pizza ----
function grupoPagamento(p: Pagamento): { key: string; label: string; cor: string } {
  const m = (p.metodo || '').toLowerCase()
  const t = (p.tipo || '').toLowerCase()
  if (m.includes('pix')) return { key: 'pix', label: 'Pix', cor: '#0a7d6e' }
  if (t === 'credit_card') return { key: 'credit_card', label: 'Crédito', cor: '#7a3ffa' }
  if (t === 'debit_card') return { key: 'debit_card', label: 'Débito', cor: '#1668dc' }
  if (t.startsWith('consumer_credit') || m.includes('consumer_credit')) return { key: 'consumer_credit', label: 'Mercado Crédito', cor: '#0958d9' }
  if (t === 'account_money') return { key: 'account_money', label: 'Saldo Mercado Pago', cor: '#b45309' }
  if (t === 'ticket') return { key: 'ticket', label: 'Boleto', cor: '#475467' }
  return { key: 'outros', label: 'Outros', cor: '#98a2b3' }
}
function grupoEnvio(e: Envio): { key: string; label: string; cor: string } {
  const lt = (e.logistic_type || '').toLowerCase()
  if (lt === 'fulfillment') return { key: 'fulfillment', label: 'FULL', cor: '#2e7d32' }
  if (lt === 'self_service') return { key: 'self_service', label: 'Flex', cor: '#ef6c00' }
  if (lt === 'cross_docking') return { key: 'cross_docking', label: 'Mercado Envios (coleta)', cor: '#0958d9' }
  if (lt === 'drop_off' || lt === 'xd_drop_off') return { key: 'drop_off', label: 'Mercado Envios (agência)', cor: '#7a3ffa' }
  if (lt) return { key: 'outros', label: 'Mercado Envios', cor: '#1668dc' }
  return { key: 'sem_dados', label: 'Sem dados de envio', cor: '#d0d5dd' }
}

// UF vem como "BR-SP" ou "SP" — normaliza pra sigla de 2 letras
function ufSigla(uf?: string | null): string | null {
  if (!uf) return null
  const m = String(uf).toUpperCase().match(/[A-Z]{2}$/)
  return m ? m[0] : null
}
const PALETA_UF = ['#3538cd', '#0a7d6e', '#ef6c00', '#7a3ffa', '#1668dc', '#b45309', '#d92d20', '#0958d9', '#2e7d32', '#c11574']

interface Fatia { label: string; value: number; cor: string }

function PieChart({ titulo, segmentos, vazio, rodape }: { titulo: string; segmentos: Fatia[]; vazio?: string; rodape?: string }) {
  const dados = segmentos.filter(s => s.value > 0)
  const total = dados.reduce((s, x) => s + x.value, 0)
  const r = 46, cx = 60, cy = 60, stroke = 18, circ = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ flex: 1, minWidth: 240, background: '#fff', border: '1px solid #eaecf0', borderRadius: 12, padding: '0.85rem', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: '.8rem', fontWeight: 800, color: '#101828', marginBottom: 8 }}>{titulo}</div>
      {total === 0 ? (
        <div style={{ fontSize: '.78rem', color: '#98a2b3', padding: '1.5rem 0', textAlign: 'center' }}>{vazio || 'Sem dados'}</div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <svg width={120} height={120} viewBox="0 0 120 120" style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f2f4f7" strokeWidth={stroke} />
            {dados.map((s, i) => {
              const frac = s.value / total
              const dash = frac * circ
              const el = (
                <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.cor} strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} />
              )
              acc += frac
              return el
            })}
          </svg>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dados.map((s, i) => {
              const p = (s.value / total) * 100
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '.76rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.cor, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: '#475467', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ fontWeight: 700, color: '#101828', whiteSpace: 'nowrap' }}>{p.toFixed(1).replace('.', ',')}%</span>
                  <span style={{ color: '#98a2b3', minWidth: 34, textAlign: 'right' }}>{s.value}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {rodape && <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: '.68rem', color: '#98a2b3' }}>{rodape}</div>}
    </div>
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

  // Auto-refresh silencioso enquanto o enriquecimento de envios (em background)
  // ainda está localizando vendas — os gráficos de envio/estados crescem ao vivo.
  // Para quando cobre tudo, quando estagna (pedidos sem envio) ou após o teto.
  const pollRef = useRef({ tentativas: 0, ultimo: -1 })
  useEffect(() => {
    if (!dados) return
    const loc = dados.envio_localizados ?? 0
    if (loc >= dados.total_vendas) return
    const t = setInterval(async () => {
      const p = pollRef.current
      if (p.tentativas >= 30 || (p.ultimo === loc && p.tentativas >= 3)) { clearInterval(t); return }
      p.tentativas += 1; p.ultimo = loc
      try {
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${encodeURIComponent(itemId)}/vendas?sync=0`, { cache: 'no-store' })
        const j: Resultado = await r.json()
        if (r.ok && !j.erro) setDados(j)
      } catch { /* silencioso */ }
    }, 5000)
    return () => clearInterval(t)
  }, [dados, itemId])

  // Distribuições p/ os gráficos de pizza (só vendas válidas, histórico inteiro do item)
  const { fatiasPagamento, fatiasEnvio, fatiasEstados, ufTotal } = useMemo(() => {
    const pag = new Map<string, Fatia>()
    const env = new Map<string, Fatia>()
    const uf = new Map<string, number>()
    let ufTot = 0
    for (const v of dados?.vendas || []) {
      if (v.cancelada) continue
      const gp = grupoPagamento(v.pagamento)
      const ep = grupoEnvio(v.envio)
      const ap = pag.get(gp.key) || { label: gp.label, cor: gp.cor, value: 0 }
      ap.value += 1; pag.set(gp.key, ap)
      const ae = env.get(ep.key) || { label: ep.label, cor: ep.cor, value: 0 }
      ae.value += 1; env.set(ep.key, ae)
      const sig = ufSigla(v.envio.uf)
      if (sig) { uf.set(sig, (uf.get(sig) || 0) + 1); ufTot++ }
    }
    const ord = (m: Map<string, Fatia>) => [...m.values()].sort((a, b) => b.value - a.value)
    // Estados: top 9 + "Outros" agrupado, cores da paleta
    const ufOrd = [...uf.entries()].sort((a, b) => b[1] - a[1])
    const topN = ufOrd.slice(0, 9)
    const resto = ufOrd.slice(9).reduce((s, [, n]) => s + n, 0)
    const fEstados: Fatia[] = topN.map(([sig, n], i) => ({ label: sig, value: n, cor: PALETA_UF[i % PALETA_UF.length] }))
    if (resto > 0) fEstados.push({ label: 'Outros', value: resto, cor: '#98a2b3' })
    return { fatiasPagamento: ord(pag), fatiasEnvio: ord(env), fatiasEstados: fEstados, ufTotal: ufTot }
  }, [dados])

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: '1.02rem', color: '#101828' }}>🔎 Vendas do anúncio</span>
              {dados?.catalogo === true && (
                <span style={{ background: '#ece4ff', color: '#5925dc', fontWeight: 700, fontSize: '.7rem', padding: '2px 9px', borderRadius: 20 }}>📗 Catálogo</span>
              )}
              {dados?.catalogo === false && (
                <span style={{ background: '#eaecf0', color: '#475467', fontWeight: 700, fontSize: '.7rem', padding: '2px 9px', borderRadius: 20 }}>Anúncio próprio</span>
              )}
            </div>
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

        {/* Gráficos de distribuição — pagamento, envio e estados */}
        {dados && dados.total_vendas > 0 && (
          <div style={{ display: 'flex', gap: 12, padding: '0.85rem 1.25rem', background: '#f9fafb', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
            <PieChart titulo="💳 Métodos de pagamento" segmentos={fatiasPagamento} />
            <PieChart titulo="🚚 Modalidade de envio" segmentos={fatiasEnvio} />
            <PieChart
              titulo="📍 Estados (de onde vêm)"
              segmentos={fatiasEstados}
              vazio="Localizando vendas…"
              rodape={ufTotal < dados.total_vendas
                ? `📍 ${ufTotal} de ${dados.total_vendas} vendas localizadas${(dados.envio_localizados ?? 0) < dados.total_vendas ? ' · sincronizando o resto em segundo plano' : ''}`
                : `📍 todas as ${ufTotal} vendas localizadas`}
            />
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
