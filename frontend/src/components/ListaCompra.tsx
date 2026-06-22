import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ItemCompra {
  sku: string
  titulo: string
  imagem?: string | null
  preco?: number | null
  vendidos: number
  velocidade_dia: number
  velocidade_mes: number
  estoque_full: number
  estoque_organico: number
  estoque_total: number
  meta_100: number
  pct_seguranca: number | null
  comprar: number
  dias_cobertura: number | null
  prioridade: 'maxima' | 'media' | 'ok' | 'sem_giro'
  curva: 'A' | 'B' | 'C'
}

interface Resumo {
  total_skus: number
  maxima: number
  media: number
  ok: number
  sem_giro: number
  curva_a: number
  curva_b: number
  curva_c: number
  snapshots_dias: number
}

interface Dados { meta_dias: number; resumo: Resumo; itens: ItemCompra[] }

const PRIO = {
  maxima: { label: '🔴 Comprar urgente', cor: '#c62828', bg: '#ffebee', borda: '#ef9a9a' },
  media: { label: '🟡 Atenção', cor: '#ef6c00', bg: '#fff3e0', borda: '#ffcc80' },
  ok: { label: '🟢 OK', cor: '#2e7d32', bg: '#e8f5e9', borda: '#a5d6a7' },
  sem_giro: { label: '⚪ Sem giro', cor: '#777', bg: '#f3f4f6', borda: '#e0e0e0' },
} as const

const CURVA_COR: Record<string, string> = { A: '#2e7d32', B: '#ef6c00', C: '#90a4ae' }

const META_OPCOES = [30, 45, 60, 75, 90]

export function ListaCompra() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [metaDias, setMetaDias] = useState(75)
  const [filtroCurva, setFiltroCurva] = useState<'todas' | 'A' | 'B' | 'C'>('todas')
  const [filtroPrio, setFiltroPrio] = useState<'todas' | 'maxima' | 'media' | 'ok' | 'sem_giro'>('todas')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async (meta: number) => {
    setCarregando(true)
    setErro('')
    try {
      const r = await fetch(`${API_BASE}/api/lista-compra?meta_dias=${meta}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao carregar a lista de compra')
      setDados(d)
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
      setDados(null)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar(metaDias) }, [carregar, metaDias])

  const itensFiltrados = (dados?.itens || []).filter(it => {
    if (filtroCurva !== 'todas' && it.curva !== filtroCurva) return false
    if (filtroPrio !== 'todas' && it.prioridade !== filtroPrio) return false
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      if (!(`${it.sku} ${it.titulo}`).toLowerCase().includes(q)) return false
    }
    return true
  })

  const th: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.7rem', textTransform: 'uppercase', color: '#666', fontWeight: 700, borderBottom: '2px solid #eee', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' }

  const chip = (label: string, valor: number, cor: string, bg: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.7rem', borderRadius: '999px', background: bg, color: cor, fontWeight: 700, fontSize: '0.8rem' }}>
      {label} <strong>{valor}</strong>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#455a64', fontWeight: 600 }}>
          Estoque cheio (100%) =
          <select value={metaDias} onChange={e => setMetaDias(Number(e.target.value))} style={{ padding: '0.5rem 0.7rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }}>
            {META_OPCOES.map(m => <option key={m} value={m}>{m} dias de venda</option>)}
          </select>
        </label>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por SKU ou título..."
          style={{ flex: '1 1 280px', minWidth: 220, padding: '0.6rem 0.85rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.9rem' }}
        />
        <button onClick={() => carregar(metaDias)} style={{ padding: '0.6rem 1rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>Atualizar</button>
      </div>

      {dados?.resumo && (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {chip('🔴 Urgente', dados.resumo.maxima, '#c62828', '#ffebee')}
          {chip('🟡 Atenção', dados.resumo.media, '#ef6c00', '#fff3e0')}
          {chip('🟢 OK', dados.resumo.ok, '#2e7d32', '#e8f5e9')}
          {chip('⚪ Sem giro', dados.resumo.sem_giro, '#777', '#f3f4f6')}
          <div style={{ width: 1, height: 22, background: '#e0e0e0' }} />
          {chip('Curva A', dados.resumo.curva_a, '#2e7d32', '#f1f8f4')}
          {chip('Curva B', dados.resumo.curva_b, '#ef6c00', '#fff8f0')}
          {chip('Curva C', dados.resumo.curva_c, '#607d8b', '#f5f7f8')}
        </div>
      )}

      {dados && dados.resumo.snapshots_dias < 7 && (
        <div style={{ fontSize: '0.82rem', color: '#8a6d3b', background: '#fcf8e3', border: '1px solid #faebcc', borderRadius: '8px', padding: '0.7rem 0.9rem' }}>
          ℹ️ A velocidade está usando a média histórica (vendas ÷ idade do anúncio). Conforme os dias passam ({dados.resumo.snapshots_dias} de 7 coletados), ela vai afinando pela venda recente real.
        </div>
      )}

      {/* Filtros rápidos */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {(['todas', 'A', 'B', 'C'] as const).map(c => (
          <button key={c} onClick={() => setFiltroCurva(c)} style={{ padding: '0.4rem 0.85rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', border: `1px solid ${filtroCurva === c ? '#1976D2' : '#cfd8dc'}`, background: filtroCurva === c ? '#1976D2' : '#fff', color: filtroCurva === c ? '#fff' : '#455a64' }}>
            {c === 'todas' ? 'Todas as curvas' : `Curva ${c}`}
          </button>
        ))}
        <div style={{ width: 1, height: 22, background: '#e0e0e0', alignSelf: 'center' }} />
        {(['todas', 'maxima', 'media', 'ok', 'sem_giro'] as const).map(p => (
          <button key={p} onClick={() => setFiltroPrio(p)} style={{ padding: '0.4rem 0.85rem', borderRadius: '999px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', border: `1px solid ${filtroPrio === p ? '#1976D2' : '#cfd8dc'}`, background: filtroPrio === p ? '#1976D2' : '#fff', color: filtroPrio === p ? '#fff' : '#455a64' }}>
            {p === 'todas' ? 'Todas' : PRIO[p].label}
          </button>
        ))}
      </div>

      {erro && <div style={{ padding: '1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: '8px', color: '#c62828' }}>{erro}</div>}

      {carregando ? (
        <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Calculando lista de compra…</p>
      ) : itensFiltrados.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Nenhum produto neste filtro.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Produto</th>
                <th style={th}>Curva</th>
                <th style={{ ...th, textAlign: 'right' }}>Estoque (FULL+org)</th>
                <th style={{ ...th, textAlign: 'right' }}>Vende/mês</th>
                <th style={{ ...th, textAlign: 'right' }}>Dura</th>
                <th style={{ ...th, textAlign: 'right' }}>% segurança</th>
                <th style={{ ...th, textAlign: 'right' }}>Comprar</th>
                <th style={th}>Prioridade</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map(it => {
                const prio = PRIO[it.prioridade]
                return (
                  <tr key={it.sku} style={{ background: it.prioridade === 'maxima' ? '#fff6f6' : '#fff' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {it.imagem ? <img src={it.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc' }}>📦</span>}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, lineHeight: 1.25, fontSize: '0.85rem' }}>{it.titulo}</div>
                          <div style={{ fontSize: '0.74rem', color: '#888' }}>SKU: {it.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontWeight: 800, color: '#fff', background: CURVA_COR[it.curva] }}>{it.curva}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{it.estoque_total}</div>
                      <div style={{ fontSize: '0.72rem', color: '#999' }}>FULL {it.estoque_full} · org {it.estoque_organico}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.velocidade_mes > 0 ? it.velocidade_mes : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.dias_cobertura != null ? `${it.dias_cobertura}d` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: prio.cor }}>{it.pct_seguranca != null ? `${it.pct_seguranca}%` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{it.comprar > 0 ? it.comprar : '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: prio.cor, background: prio.bg, border: `1px solid ${prio.borda}`, borderRadius: '999px', padding: '0.2rem 0.6rem', whiteSpace: 'nowrap' }}>{prio.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ListaCompra
