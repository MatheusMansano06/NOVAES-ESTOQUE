import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface TarifaInfo { percentual: number; fixo: number }
interface Props {
  titulo: string
  sku?: string
  precoInicial: number
  custoInicial?: number
  freteInicial?: number
  categoryId?: string
  tipoAtualId?: string  // gold_special | gold_pro
  onClose: () => void
}

const num = (s: string) => parseFloat((s || '').replace(',', '.')) || 0
const brl = (v: number) => 'R$ ' + (Number.isFinite(v) ? v : 0).toFixed(2).replace('.', ',')

// Defaults quando não há categoria ML (ex: aba Catálogo): Clássico 14% / Premium 17%,
// taxa fixa do ML ~R$6,75 para itens abaixo de R$79.
const tarifaDefault = (premium: boolean, preco: number): TarifaInfo => ({
  percentual: premium ? 17 : 14,
  fixo: preco < 79 ? 6.75 : 0,
})

function carregarImposto(): string {
  try { return localStorage.getItem('nvs_imposto_pct') || '9' } catch { return '9' }
}

export function Precificador({ titulo, sku, precoInicial, custoInicial = 0, freteInicial = 0, categoryId, tipoAtualId, onClose }: Props) {
  const [valorVenda, setValorVenda] = useState(precoInicial ? String(precoInicial) : '')
  const [frete, setFrete] = useState(freteInicial ? String(freteInicial) : '')
  const [custo, setCusto] = useState(custoInicial ? String(custoInicial) : '')
  const [imposto, setImposto] = useState(carregarImposto())
  const [classicoFee, setClassicoFee] = useState<TarifaInfo | null>(null)
  const [premiumFee, setPremiumFee] = useState<TarifaInfo | null>(null)
  const [carregandoFee, setCarregandoFee] = useState(false)

  const v = num(valorVenda)

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

  // Busca tarifa ao abrir e quando o valor de venda muda (debounced)
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

  const coluna = (nome: string, premium: boolean, fee: TarifaInfo | null, atual: boolean) => {
    const c = calc(fee, premium)
    return (
      <div style={{ flex: 1, minWidth: 0, background: '#f7f8fc', border: `1px solid ${atual ? '#7c4dff' : '#e0e0e0'}`, borderRadius: '10px', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#2d3277' }}>{premium ? '◆ ' : '◈ '}{nome}</span>
          {atual && <span style={{ fontSize: '0.7rem', background: '#ede7f6', color: '#4527a0', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>Exposição Atual</span>}
        </div>
        <Campo label="Valor de Venda" valor={brl(v)} />
        <Campo label="Frete (−)" valor={brl(num(frete))} />
        <Campo label="Custo (−)" valor={brl(num(custo))} />
        <Campo label="Imposto (−)" valor={brl(c.imp)} extra={`${num(imposto)}%`} />
        <Campo label="Tarifa de Venda (−)" valor={brl(c.tarifa)} extra={carregandoFee ? '...' : `${c.percentual}%`} />
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fff', borderRadius: '8px', textAlign: 'center', border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '0.78rem', color: '#666' }}>Margem de Contribuição (=)</div>
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
            <h3 style={{ margin: 0 }}>Precificador de Anúncio</h3>
            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.35rem' }}>{titulo}</div>
            <div style={{ fontSize: '0.78rem', color: '#999', marginTop: '0.15rem' }}>
              {sku ? `SKU: ${sku}` : ''}{precoInicial ? `  ·  Preço atual: ${brl(precoInicial)}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        {/* Inputs compartilhados */}
        <div style={{ padding: '1rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', background: '#fafbfc', borderBottom: '1px solid #eee' }}>
          <EditCampo label="Valor de Venda" valor={valorVenda} onChange={setValorVenda} prefixo="R$" />
          <EditCampo label="Frete" valor={frete} onChange={setFrete} prefixo="R$" />
          <EditCampo label="Custo" valor={custo} onChange={setCusto} prefixo="R$" />
          <EditCampo label="Imposto" valor={imposto} onChange={setImpostoPersist} prefixo="%" />
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {coluna('Clássico', false, classicoFee, tipoAtualId === 'gold_special')}
          {coluna('Premium', true, premiumFee, tipoAtualId === 'gold_pro')}
        </div>

        <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: '#999' }} title="Disponível numa próxima etapa">⚙ Aplicar preço ao anúncio (em breve)</span>
          <button onClick={onClose} style={{ padding: '0.6rem 1.5rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Fechar</button>
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

function EditCampo({ label, valor, onChange, prefixo }: { label: string; valor: string; onChange: (v: string) => void; prefixo: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: '#666' }}>
      {label} ({prefixo})
      <input type="text" inputMode="decimal" value={valor} onChange={e => onChange(e.target.value)} placeholder="0,00"
        style={{ padding: '0.5rem 0.6rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.95rem', fontWeight: 600 }} />
    </label>
  )
}

export default Precificador
