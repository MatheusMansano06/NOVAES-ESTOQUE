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

// Texto grande do "quanto ainda dura" (destaque escolhido pelo usuário).
function infoDura(it: ItemCompra): { grande: string; sub: string } {
  if (it.prioridade === 'sem_giro' || it.dias_cobertura == null) {
    return { grande: 'Sem giro', sub: 'sem venda registrada ainda' }
  }
  const d = it.dias_cobertura
  if (d < 1) return { grande: 'Acaba hoje', sub: 'menos de 1 dia de estoque' }
  if (d < 2) return { grande: '~1 dia', sub: 'de estoque restante' }
  return { grande: `${Math.round(d)} dias`, sub: 'de estoque restante' }
}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {itensFiltrados.map(it => {
            const prio = PRIO[it.prioridade]
            const dura = infoDura(it)
            const gauge = Math.max(2, Math.min(100, it.pct_seguranca ?? 0))
            return (
              <div key={it.sku} style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', flexWrap: 'wrap', padding: '1rem', borderRadius: '12px', border: `1px solid ${prio.borda}`, borderLeft: `6px solid ${prio.cor}`, background: it.prioridade === 'maxima' ? '#fff8f8' : '#fff' }}>
                {/* Foto */}
                <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {it.imagem ? <img src={it.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc', fontSize: '1.5rem' }}>📦</span>}
                </div>

                {/* Meio: descrição em linguagem simples */}
                <div style={{ flex: '1 1 320px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontWeight: 800, color: '#fff', fontSize: '0.78rem', background: CURVA_COR[it.curva] }} title={`Curva ${it.curva}`}>{it.curva}</span>
                    <span style={{ fontWeight: 700, lineHeight: 1.25, fontSize: '0.92rem' }}>{it.titulo}</span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#888' }}>SKU: {it.sku}</div>
                  <div style={{ fontSize: '0.86rem', color: '#444' }}>
                    Tem <strong>{it.estoque_total} un</strong> <span style={{ color: '#888' }}>(FULL {it.estoque_full} + orgânico {it.estoque_organico})</span>
                    {it.velocidade_mes > 0 && <> · vende <strong>~{it.velocidade_mes}/mês</strong></>}
                  </div>
                  {/* Barra: quão cheio está o estoque vs a meta */}
                  <div style={{ marginTop: '0.15rem' }}>
                    <div style={{ height: 8, background: '#eceff1', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${gauge}%`, background: prio.cor, transition: 'width .3s' }} />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#999', marginTop: '0.2rem' }}>
                      {it.pct_seguranca != null ? `${it.pct_seguranca}% do estoque ideal` : 'sem meta'} · meta {it.meta_100} un ({dados?.meta_dias ?? 75} dias)
                    </div>
                  </div>
                </div>

                {/* Direita: destaque em "quanto ainda dura" + ação */}
                <div style={{ flex: '0 0 200px', minWidth: 180, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: '0.3rem', textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: prio.cor, lineHeight: 1 }}>{dura.grande}</div>
                  <div style={{ fontSize: '0.74rem', color: '#888' }}>{dura.sub}</div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: prio.cor, background: prio.bg, border: `1px solid ${prio.borda}`, borderRadius: '999px', padding: '0.2rem 0.7rem', whiteSpace: 'nowrap' }}>{prio.label}</span>
                  {it.comprar > 0 && (
                    <div style={{ marginTop: '0.2rem', fontSize: '0.92rem', color: '#1a1a1a' }}>Comprar <strong style={{ fontSize: '1.05rem' }}>{it.comprar} un</strong></div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ListaCompra
