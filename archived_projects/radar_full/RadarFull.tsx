import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Semaforo = 'urgente' | 'atencao' | 'tem_reposicao' | 'ok' | 'sem_giro'
type Momento = 'hoje' | 'esta_semana' | 'programe' | 'tranquilo'

interface ItemRadar {
  sku: string
  titulo: string
  imagem?: string | null
  preco?: number | null
  permalink?: string | null
  anuncios: string[]
  vendidos: number
  velocidade_dia: number
  velocidade_mes: number
  available: number
  chegando: number
  estoque_total: number
  dias_ruptura: number | null
  dias_com_chegando: number | null
  dias_p_agendar: number | null
  envie_ate: string | null
  quanto_enviar: number
  meta_100: number
  momento: Momento
  semaforo: Semaforo
}
interface Resumo {
  total_skus: number; hoje: number; esta_semana: number; programe: number; tranquilo: number
  urgentes: number; com_reposicao: number; sem_giro: number
  inventories_consultados: number; atualizado_em: string
}
interface Dados {
  parametros: { meta_dias: number; lead_time_dias: number; horizonte: number }
  resumo: Resumo
  itens: ItemRadar[]
  cache?: { hit: boolean; idade_segundos: number }
  erro?: string
}

const SEM: Record<Semaforo, { label: string; cor: string; bg: string; borda: string; barra: string }> = {
  urgente:       { label: '🔴 Urgente',    cor: '#c62828', bg: '#ffebee', borda: '#ef9a9a', barra: '#e53935' },
  atencao:       { label: '🟡 Atenção',    cor: '#ef6c00', bg: '#fff3e0', borda: '#ffcc80', barra: '#fb8c00' },
  tem_reposicao: { label: '🟢 A caminho',  cor: '#2e7d32', bg: '#e8f5e9', borda: '#a5d6a7', barra: '#43a047' },
  ok:            { label: '🟢 OK',         cor: '#2e7d32', bg: '#e8f5e9', borda: '#a5d6a7', barra: '#66bb6a' },
  sem_giro:      { label: '⚪ Sem giro',   cor: '#777',    bg: '#f3f4f6', borda: '#e0e0e0', barra: '#bdbdbd' },
}

const SECOES: { momento: Momento; titulo: string; sub: string; cor: string }[] = [
  { momento: 'hoje',        titulo: '🔴 Envie AGORA',   sub: 'no limite do prazo — mande hoje', cor: '#c62828' },
  { momento: 'esta_semana', titulo: '🟡 Esta semana',   sub: 'programe o envio nos próximos dias', cor: '#ef6c00' },
  { momento: 'programe',    titulo: '🟢 Programe',      sub: 'ainda há folga, deixe no radar', cor: '#2e7d32' },
]

const META_OPCOES = [30, 45, 60, 75]
const LS_LEAD = 'radar_lead_time'

const fmtData = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function RadarFull({ onVerListaCompra }: { onVerListaCompra?: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [metaDias, setMetaDias] = useState(30)
  const [leadTime, setLeadTime] = useState(() => {
    const v = Number(localStorage.getItem(LS_LEAD))
    return v > 0 ? v : 5
  })
  const [busca, setBusca] = useState('')
  const [copiado, setCopiado] = useState('')

  const carregar = useCallback(async (meta: number, lead: number, refresh = false) => {
    setCarregando(true)
    setErro('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/radar-full?meta_dias=${meta}&lead_time=${lead}&horizonte=21${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro === 'sem_token' ? 'Mercado Livre desconectado — reconecte em Anúncios ML.' : (d.erro || 'Falha ao carregar o radar'))
      setDados(d)
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
      setDados(null)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar(metaDias, leadTime) }, [carregar, metaDias, leadTime])

  const mudarLead = (v: number) => {
    const lead = Math.max(0, Math.min(60, v || 0))
    setLeadTime(lead)
    localStorage.setItem(LS_LEAD, String(lead))
  }

  const copiarSku = async (sku: string) => {
    try { await navigator.clipboard.writeText(sku); setCopiado(sku); setTimeout(() => setCopiado(''), 1200) } catch { /* noop */ }
  }

  const horizonte = dados?.parametros.horizonte ?? 21
  const lead = dados?.parametros.lead_time_dias ?? leadTime

  const itensFiltrados = (dados?.itens || []).filter(it => {
    if (!busca.trim()) return true
    const q = busca.trim().toLowerCase()
    return (`${it.sku} ${it.titulo}`).toLowerCase().includes(q)
  })

  // Barra de "pista": hoje -> ruptura, com marcador ENVIE ATÉ e trecho do que está chegando.
  const barra = (it: ItemRadar) => {
    const s = SEM[it.semaforo]
    const pct = (dias: number | null) => dias == null ? 100 : Math.max(0, Math.min(100, (dias / horizonte) * 100))
    const wAvail = pct(it.dias_ruptura)
    const wCheg = it.dias_com_chegando != null ? pct(it.dias_com_chegando) : wAvail
    const marcador = it.dias_p_agendar != null ? pct(it.dias_p_agendar) : 0
    const foraPrazo = (it.dias_p_agendar ?? 0) <= 0
    return (
      <div style={{ marginTop: '0.5rem' }}>
        <div style={{ position: 'relative', height: '16px', background: '#eef1f4', borderRadius: '8px', overflow: 'hidden' }}>
          {/* trecho do que está chegando (reposição a caminho) */}
          {it.chegando > 0 && (
            <div title="reposição a caminho" style={{ position: 'absolute', left: `${wAvail}%`, width: `${Math.max(0, wCheg - wAvail)}%`, top: 0, bottom: 0, background: 'repeating-linear-gradient(45deg,#c8e6c9,#c8e6c9 5px,#a5d6a7 5px,#a5d6a7 10px)' }} />
          )}
          {/* estoque liberado (some conforme vende até a ruptura) */}
          <div style={{ position: 'absolute', left: 0, width: `${wAvail}%`, top: 0, bottom: 0, background: s.barra, opacity: 0.85 }} />
          {/* marcador ENVIE ATÉ */}
          <div title="envie até aqui" style={{ position: 'absolute', left: `calc(${marcador}% - 1px)`, top: -2, bottom: -2, width: '3px', background: foraPrazo ? '#b71c1c' : '#1a1a1a', boxShadow: '0 0 0 1px #fff' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#90a4ae', marginTop: '2px' }}>
          <span>hoje</span>
          <span>rompe {it.dias_ruptura != null ? `em ${it.dias_ruptura}d` : '—'}</span>
          <span>{horizonte}d</span>
        </div>
      </div>
    )
  }

  const card = (it: ItemRadar) => {
    const s = SEM[it.semaforo]
    const foraPrazo = (it.dias_p_agendar ?? 0) <= 0
    return (
      <div key={it.sku} style={{ display: 'flex', gap: '0.85rem', padding: '0.85rem', border: `1px solid ${s.borda}`, borderLeft: `5px solid ${s.barra}`, borderRadius: '12px', background: '#fff' }}>
        <div style={{ width: 58, height: 58, flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {it.imagem ? <img src={it.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#b0bec5', fontSize: '1.4rem' }}>📦</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => copiarSku(it.sku)} title="copiar SKU" style={{ border: 'none', background: '#eceff1', borderRadius: '6px', padding: '0.15rem 0.5rem', fontWeight: 800, fontSize: '0.78rem', color: '#37474f', cursor: 'pointer' }}>
              {copiado === it.sku ? '✓ copiado' : it.sku}
            </button>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: s.cor, background: s.bg, borderRadius: '999px', padding: '0.1rem 0.55rem' }}>{s.label}</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#37474f', marginTop: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.titulo}>{it.titulo || '—'}</div>
          {barra(it)}
          <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.72rem', color: '#607d8b', marginTop: '0.45rem' }}>
            <span>vende <strong>{it.velocidade_dia}</strong>/dia</span>
            <span><strong style={{ color: '#2e7d32' }}>{it.available}</strong> liberados</span>
            {it.chegando > 0 && <span><strong style={{ color: '#00897b' }}>{it.chegando}</strong> chegando</span>}
          </div>
        </div>
        <div style={{ width: 128, flexShrink: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.35rem', borderLeft: '1px solid #eceff1', paddingLeft: '0.6rem' }}>
          <div style={{ fontSize: '0.62rem', color: '#90a4ae', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Envie até</div>
          <div style={{ fontSize: foraPrazo ? '1.05rem' : '1.25rem', fontWeight: 900, color: foraPrazo ? '#b71c1c' : '#1a1a1a', lineHeight: 1 }}>
            {foraPrazo ? 'HOJE!' : fmtData(it.envie_ate)}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#455a64', marginTop: '0.2rem' }}>enviar <strong style={{ fontSize: '0.95rem', color: s.cor }}>{it.quanto_enviar}</strong> un</div>
        </div>
      </div>
    )
  }

  const placar = (label: string, valor: number, cor: string, bg: string) => (
    <div style={{ flex: 1, minWidth: 130, padding: '0.75rem 1rem', borderRadius: '12px', background: bg, textAlign: 'center' }}>
      <div style={{ fontSize: '1.9rem', fontWeight: 900, color: cor, lineHeight: 1 }}>{valor}</div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: cor, marginTop: '0.25rem' }}>{label}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Placar */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {placar('Envie HOJE', dados?.resumo.hoje ?? 0, '#c62828', '#ffebee')}
        {placar('Esta semana', dados?.resumo.esta_semana ?? 0, '#ef6c00', '#fff3e0')}
        {placar('Programe', dados?.resumo.programe ?? 0, '#2e7d32', '#e8f5e9')}
        {placar('A caminho', dados?.resumo.com_reposicao ?? 0, '#00695c', '#e0f2f1')}
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#455a64', fontWeight: 600 }}>
          Alvo no Full
          <select value={metaDias} onChange={e => setMetaDias(Number(e.target.value))} style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cfd8dc', fontWeight: 700 }}>
            {META_OPCOES.map(m => <option key={m} value={m}>{m} dias</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#455a64', fontWeight: 600 }}>
          Lead time
          <input type="number" min={0} max={60} value={leadTime} onChange={e => mudarLead(Number(e.target.value))} style={{ width: 56, padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cfd8dc', fontWeight: 700 }} />
          dias
        </label>
        <input placeholder="🔎 buscar SKU ou título" value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1, minWidth: 160, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
        <button onClick={() => carregar(metaDias, leadTime, true)} disabled={carregando} style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: 'none', background: '#1a237e', color: '#fff', fontWeight: 700, cursor: carregando ? 'default' : 'pointer', opacity: carregando ? 0.6 : 1 }}>
          {carregando ? 'Atualizando…' : '↻ Atualizar agora'}
        </button>
        {onVerListaCompra && (
          <button onClick={onVerListaCompra} title="Ver a mesma inteligência em formato de lista (curva ABC + compra)" style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid #1a237e', background: '#fff', color: '#1a237e', fontWeight: 700, cursor: 'pointer' }}>
            📋 Ver Lista de Compra →
          </button>
        )}
      </div>

      {erro && <div style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>{erro}</div>}

      {carregando && !dados && (
        <div style={{ padding: '2.5rem', textAlign: 'center', color: '#607d8b' }}>
          Lendo o estoque do Full ao vivo no Mercado Livre… <br /><span style={{ fontSize: '0.8rem' }}>(a primeira leitura leva alguns segundos)</span>
        </div>
      )}

      {dados && (
        <>
          <div style={{ fontSize: '0.72rem', color: '#90a4ae' }}>
            {dados.resumo.total_skus} SKUs no Full · {dados.resumo.inventories_consultados} inventories lidos ao vivo
            {dados.cache?.hit ? ` · dados de ${Math.round((dados.cache.idade_segundos || 0) / 60)}min atrás` : ' · agora mesmo'}
          </div>

          {SECOES.map(sec => {
            const lista = itensFiltrados.filter(it => it.momento === sec.momento)
            if (!lista.length) return null
            return (
              <div key={sec.momento} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', borderBottom: `2px solid ${sec.cor}22`, paddingBottom: '0.3rem' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: sec.cor }}>{sec.titulo}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: sec.cor }}>({lista.length})</span>
                  <span style={{ fontSize: '0.74rem', color: '#90a4ae' }}>{sec.sub}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '0.7rem' }}>
                  {lista.map(card)}
                </div>
              </div>
            )
          })}

          {itensFiltrados.filter(it => ['hoje', 'esta_semana', 'programe'].includes(it.momento)).length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#2e7d32', fontWeight: 600 }}>
              ✅ Nenhum produto em risco no horizonte de {horizonte} dias (lead time {lead}d). Tudo sob controle!
            </div>
          )}
        </>
      )}
    </div>
  )
}
