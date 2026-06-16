import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const STORAGE_KEY = 'nvs_ml_precificador_v1'

interface TarifaInfo { percentual: number; fixo: number }

export interface PricingSnapshot {
  itemId: string
  precoOriginal: number
  precoPromocional: number
  valorVenda: number
  frete: number
  custo: number
  impostoPct: number
  tarifa: number
  tarifaPct: number
  margem: number
  margemPct: number
  tipoAtualId?: string
  tipoAtualLabel: string
  savedAt: string
}

interface Props {
  titulo: string
  sku?: string
  itemId?: string
  precoInicial: number
  precoOriginal?: number | null
  custoInicial?: number
  freteInicial?: number
  categoryId?: string
  tipoAtualId?: string
  onClose: () => void
  onSaved?: (snapshot: PricingSnapshot) => void
}

const num = (s: string) => parseFloat((s || '').replace(',', '.')) || 0
const brl = (v: number) => 'R$ ' + (Number.isFinite(v) ? v : 0).toFixed(2).replace('.', ',')

const tarifaDefault = (premium: boolean, preco: number): TarifaInfo => ({
  percentual: premium ? 17 : 14,
  fixo: preco < 79 ? 6.75 : 0,
})

function carregarImposto(): string {
  try { return localStorage.getItem('nvs_imposto_pct') || '9' } catch { return '9' }
}

export function loadPricingSummaryMap(): Record<string, PricingSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function loadPricingSummary(itemId?: string): PricingSnapshot | null {
  if (!itemId) return null
  const all = loadPricingSummaryMap()
  return all[itemId] || null
}

function savePricingSummary(snapshot: PricingSnapshot) {
  const all = loadPricingSummaryMap()
  all[snapshot.itemId] = snapshot
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

const HIST_KEY = 'nvs_ml_preco_hist_v1'

export interface PriceHistoryEntry { data: string; de: number; para: number }

export function loadPriceHistoryMap(): Record<string, PriceHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(HIST_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function loadPriceHistory(itemId?: string): PriceHistoryEntry[] {
  if (!itemId) return []
  return loadPriceHistoryMap()[itemId] || []
}

function addPriceHistory(itemId: string, entry: PriceHistoryEntry) {
  const all = loadPriceHistoryMap()
  all[itemId] = [entry, ...(all[itemId] || [])].slice(0, 10)
  localStorage.setItem(HIST_KEY, JSON.stringify(all))
}

export function Precificador({
  titulo,
  sku,
  itemId,
  precoInicial,
  precoOriginal,
  custoInicial = 0,
  freteInicial = 0,
  categoryId,
  tipoAtualId,
  onClose,
  onSaved,
}: Props) {
  const resumoSalvo = loadPricingSummary(itemId)
  const [valorVenda, setValorVenda] = useState(resumoSalvo?.valorVenda ? String(resumoSalvo.valorVenda) : (precoInicial ? String(precoInicial) : ''))
  const [frete, setFrete] = useState(freteInicial ? String(freteInicial) : '')
  const [custo, setCusto] = useState(resumoSalvo?.custo ? String(resumoSalvo.custo) : (custoInicial ? String(custoInicial) : ''))
  const [imposto, setImposto] = useState(resumoSalvo?.impostoPct ? String(resumoSalvo.impostoPct) : carregarImposto())
  const [classicoFee, setClassicoFee] = useState<TarifaInfo | null>(null)
  const [premiumFee, setPremiumFee] = useState<TarifaInfo | null>(null)
  const [carregandoFee, setCarregandoFee] = useState(false)
  const [carregandoFrete, setCarregandoFrete] = useState(false)
  const [salvandoResumo, setSalvandoResumo] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [aplicarMsg, setAplicarMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const v = num(valorVenda)

  useEffect(() => {
    setFrete(freteInicial ? String(freteInicial) : '')
  }, [freteInicial])

  useEffect(() => {
    if (!itemId) return
    let ativo = true

    async function carregarFreteReal() {
      setCarregandoFrete(true)
      try {
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${itemId}`, { cache: 'no-store' })
        const d = await r.json()
        const freteMl = Number(d?.item?.frete_custo || 0)
        if (ativo) setFrete(freteMl > 0 ? String(freteMl) : '')
      } catch {
        if (ativo) setFrete(freteInicial ? String(freteInicial) : '')
      } finally {
        if (ativo) setCarregandoFrete(false)
      }
    }

    carregarFreteReal()
    return () => { ativo = false }
  }, [itemId, freteInicial])

  const buscarTarifa = useCallback(async (preco: number) => {
    if (!categoryId || preco <= 0) {
      setClassicoFee(tarifaDefault(false, preco))
      setPremiumFee(tarifaDefault(true, preco))
      return
    }
    setCarregandoFee(true)
    try {
      const r = await fetch(`${API_BASE}/api/ml/precificacao?price=${preco}&category_id=${categoryId}`, { cache: 'no-store' })
      const d = await r.json()
      setClassicoFee(d.classico ? { percentual: d.classico.percentual || 0, fixo: d.classico.fixo || 0 } : tarifaDefault(false, preco))
      setPremiumFee(d.premium ? { percentual: d.premium.percentual || 0, fixo: d.premium.fixo || 0 } : tarifaDefault(true, preco))
    } catch {
      setClassicoFee(tarifaDefault(false, preco))
      setPremiumFee(tarifaDefault(true, preco))
    } finally {
      setCarregandoFee(false)
    }
  }, [categoryId])

  useEffect(() => {
    const t = setTimeout(() => buscarTarifa(num(valorVenda)), 450)
    return () => clearTimeout(t)
  }, [valorVenda, buscarTarifa])

  const setImpostoPersist = (val: string) => {
    setImposto(val)
    try { localStorage.setItem('nvs_imposto_pct', val) } catch { /* ignore */ }
  }

  const calc = (fee: TarifaInfo | null, premium: boolean) => {
    const f = fee || tarifaDefault(premium, v)
    const tarifa = v * (f.percentual / 100) + (f.fixo || 0)
    const imp = v * (num(imposto) / 100)
    const margem = v - num(frete) - num(custo) - imp - tarifa
    const pct = v > 0 ? (margem / v) * 100 : 0
    return { tarifa, imp, margem, pct, percentual: f.percentual }
  }

  const calcAtual = tipoAtualId === 'gold_pro'
    ? calc(premiumFee, true)
    : calc(classicoFee, false)

  const tipoAtualLabel = tipoAtualId === 'gold_pro' ? 'Premium' : 'Classico'
  const freteDisponivel = !carregandoFrete && frete !== ''

  const buildSnapshot = (): PricingSnapshot => ({
    itemId: itemId || '',
    precoOriginal: Number(precoOriginal || precoInicial || 0),
    precoPromocional: Number(precoInicial || 0),
    valorVenda: v,
    frete: num(frete),
    custo: num(custo),
    impostoPct: num(imposto),
    tarifa: calcAtual.tarifa,
    tarifaPct: calcAtual.percentual,
    margem: calcAtual.margem,
    margemPct: calcAtual.pct,
    tipoAtualId,
    tipoAtualLabel,
    savedAt: new Date().toISOString(),
  })

  const salvarResumo = () => {
    if (!itemId) return
    setSalvandoResumo(true)
    try {
      const snapshot = buildSnapshot()
      savePricingSummary(snapshot)
      onSaved?.(snapshot)
      onClose()
    } finally {
      setSalvandoResumo(false)
    }
  }

  const aplicarPrecoAnuncio = async () => {
    if (!itemId || v <= 0) return
    if (!window.confirm(`Aplicar ${brl(v)} como preço de venda neste anúncio no Mercado Livre?`)) return
    setAplicando(true)
    setAplicarMsg(null)
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${itemId}/preco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preco: v }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao aplicar o preço')
      addPriceHistory(itemId, { data: new Date().toISOString(), de: Number(d.preco_anterior || 0), para: Number(d.preco_novo || v) })
      setAplicarMsg({ tipo: 'ok', texto: `Preço aplicado: ${brl(Number(d.preco_novo || v))}` })
      onSaved?.(buildSnapshot())
    } catch (e) {
      setAplicarMsg({ tipo: 'erro', texto: String(e instanceof Error ? e.message : e) })
    } finally {
      setAplicando(false)
    }
  }

  const coluna = (premium: boolean, fee: TarifaInfo | null, atual: boolean) => {
    const c = calc(fee, premium)
    return (
      <div style={{ flex: 1, minWidth: 0, background: '#f7f8fc', border: `1px solid ${atual ? '#7c4dff' : '#e0e0e0'}`, borderRadius: '10px', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#2d3277' }}>{premium ? 'Premium' : 'Classico'}</span>
          {atual && <span style={{ fontSize: '0.7rem', background: '#ede7f6', color: '#4527a0', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>Exposicao Atual</span>}
        </div>
        <Campo label="Valor de Venda" valor={brl(v)} />
        <Campo label="Frete (-)" valor={carregandoFrete ? 'Carregando...' : brl(num(frete))} extra={carregandoFrete ? 'direto ML' : 'travado'} />
        <Campo label="Custo (-)" valor={brl(num(custo))} />
        <Campo label="Imposto (-)" valor={brl(c.imp)} extra={`${num(imposto)}%`} />
        <Campo label="Tarifa de Venda (-)" valor={brl(c.tarifa)} extra={carregandoFee ? '...' : `${c.percentual}%`} />
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fff', borderRadius: '8px', textAlign: 'center', border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '0.78rem', color: '#666' }}>Margem de Contribuicao (=)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: c.margem >= 0 ? '#2e7d32' : '#c62828' }}>{brl(c.margem)}</div>
          <div style={{ fontWeight: 700, color: c.margem >= 0 ? '#2e7d32' : '#c62828' }}>({c.pct.toFixed(2)} %)</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '12px', maxWidth: '720px', width: '100%', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Precificador de Anuncio</h3>
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.35rem' }}>{titulo}</div>
            <div style={{ fontSize: '0.78rem', color: '#999', marginTop: '0.15rem' }}>
              {sku ? `SKU: ${sku}` : ''}{precoInicial ? `  |  Preco atual: ${brl(precoInicial)}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#999' }}>x</button>
        </div>

        <div style={{ padding: '1rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', background: '#fafbfc', borderBottom: '1px solid #eee' }}>
          <EditCampo label="Valor de Venda" valor={valorVenda} onChange={setValorVenda} prefixo="R$" />
          <EditCampo label="Frete" valor={carregandoFrete ? 'Aguardando ML...' : (frete || '0,00')} onChange={setFrete} prefixo="R$" readOnly />
          <EditCampo label="Custo" valor={custo} onChange={setCusto} prefixo="R$" />
          <EditCampo label="Imposto" valor={imposto} onChange={setImpostoPersist} prefixo="%" />
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {coluna(false, classicoFee, tipoAtualId === 'gold_special')}
          {coluna(true, premiumFee, tipoAtualId === 'gold_pro')}
        </div>

        <div style={{ padding: '0 1.5rem 1.25rem' }}>
          {aplicarMsg && (
            <div style={{ marginBottom: '0.85rem', padding: '0.6rem 0.85rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
              background: aplicarMsg.tipo === 'ok' ? '#ecfdf3' : '#fef3f2',
              border: `1px solid ${aplicarMsg.tipo === 'ok' ? '#abefc6' : '#fecdca'}`,
              color: aplicarMsg.tipo === 'ok' ? '#067647' : '#b42318' }}>
              {aplicarMsg.texto}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#999' }}>
              O frete vem direto do Mercado Livre e fica bloqueado no calculo.
            </span>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
              <button onClick={onClose} style={{ padding: '0.6rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Fechar</button>
              {itemId && (
                <button onClick={salvarResumo} disabled={salvandoResumo || !freteDisponivel} style={{ padding: '0.6rem 1.5rem', background: '#fff', border: '1px solid #5b3cc4', color: '#5b3cc4', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, opacity: salvandoResumo || !freteDisponivel ? 0.6 : 1 }}>
                  {salvandoResumo ? 'Salvando...' : 'Salvar resumo'}
                </button>
              )}
              {itemId && (
                <button onClick={aplicarPrecoAnuncio} disabled={aplicando || v <= 0} style={{ padding: '0.6rem 1.5rem', background: '#5b3cc4', border: '1px solid #5b3cc4', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, opacity: aplicando || v <= 0 ? 0.6 : 1 }}>
                  {aplicando ? 'Aplicando...' : 'Aplicar preço ao anúncio'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, valor, extra }: { label: string; valor: string; extra?: string }) {
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#888' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.6rem', background: '#fff', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '0.9rem' }}>
        <span>{valor}</span>
        {extra && <span style={{ color: '#999', fontSize: '0.78rem' }}>{extra}</span>}
      </div>
    </div>
  )
}

function EditCampo({ label, valor, onChange, prefixo, readOnly = false }: { label: string; valor: string; onChange: (v: string) => void; prefixo: string; readOnly?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: '#666' }}>
      {label} ({prefixo})
      <input
        type="text"
        inputMode="decimal"
        value={valor}
        onChange={e => onChange(e.target.value)}
        placeholder="0,00"
        readOnly={readOnly}
        disabled={readOnly}
        style={{ padding: '0.5rem 0.6rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600, background: readOnly ? '#f3f4f6' : '#fff', color: readOnly ? '#667085' : '#101828', cursor: readOnly ? 'not-allowed' : 'text' }}
      />
    </label>
  )
}

export default Precificador
