import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ItemDiv {
  item_id: string
  titulo: string
  sku: string | null
  logistic_type: string | null
  estoque: number | null
  vendidos: number | null
  permalink: string | null
  thumbnail: string | null
  declarado_cm: number[] | null
  medido_cm: number[] | null
  peso_declarado_g: number | null
  peso_medido_g: number | null
  motivos: string[]
  maior_dif_pct: number
}
interface Dados { total_ativos: number; total: number; itens: ItemDiv[]; sincronizado_em: string | null }

const LOGISTICA: Record<string, string> = { fulfillment: 'Full', cross_docking: 'Coleta', xd_drop_off: 'Agência' }
const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }
const vermelho: React.CSSProperties = { color: '#c62828', fontWeight: 700 }
const fmtLados = (l: number[] | null) => (l ? l.map((x) => x.toLocaleString('pt-BR')).join(' × ') + ' cm' : '—')
const fmtPeso = (p: number | null) => (p == null ? '—' : `${p.toLocaleString('pt-BR')} g`)
const ladoDiverge = (motivos: string[]) => motivos.some((m) => m !== 'peso')

export function DivergenciaDimensoes() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [logistica, setLogistica] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/ml/divergencia-dimensoes`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDados)
      .catch((e) => setErro(`Falha ao carregar: ${e.message}`))
  }, [])

  if (erro) return <div style={{ color: '#c62828' }}>{erro}</div>
  if (!dados) return <div>Carregando…</div>

  const termo = busca.trim().toLowerCase()
  const itens = dados.itens.filter((i) =>
    (!logistica || i.logistic_type === logistica) &&
    (!termo || [i.item_id, i.titulo, i.sku].some((c) => (c || '').toLowerCase().includes(termo))))
  const contagem = dados.itens.reduce<Record<string, number>>((acc, i) => {
    const k = i.logistic_type || '?'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
    border: ativo ? '1px solid #2d3277' : '1px solid #dfe3e8', background: ativo ? '#2d3277' : '#fff', color: ativo ? '#fff' : '#444',
  })

  return (
    <div>
      <p style={{ fontSize: '0.85rem', color: '#667085', marginTop: 0 }}>
        <b>{dados.total}</b> de {dados.total_ativos} anúncios ativos com a embalagem declarada diferente da medida pelo ML
        (tolerância: 15% ou 1 cm / 50 g). No Full, o ML ignora alteração de medida pela API.
        {dados.sincronizado_em && <> Dados do sync de {new Date(dados.sincronizado_em).toLocaleString('pt-BR')}.</>}
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <button type="button" style={chip(!logistica)} onClick={() => setLogistica(null)}>Todos ({dados.total})</button>
        {Object.entries(contagem).map(([k, n]) => (
          <button key={k} type="button" style={chip(logistica === k)} onClick={() => setLogistica(k)}>
            {LOGISTICA[k] || k} ({n})
          </button>
        ))}
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar MLB, SKU ou título"
          aria-label="Buscar anúncio"
          style={{ marginLeft: 'auto', padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc', minWidth: '220px' }}
        />
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '12px', border: '1px solid #eee' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Anúncio</th>
              <th style={th}>Logística</th>
              <th style={th}>Declarado</th>
              <th style={th}>Medido ML</th>
              <th style={th}>Peso decl.</th>
              <th style={th}>Peso ML</th>
              <th style={th}>Diverge em</th>
              <th style={th}>Maior dif.</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.item_id}>
                <td style={td}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    {i.thumbnail && <img src={i.thumbnail} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: '6px' }} />}
                    <div>
                      <a href={i.permalink || '#'} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{i.titulo}</a>
                      <div style={{ fontSize: '0.75rem', color: '#667085' }}>
                        {i.item_id}{i.sku ? ` · ${i.sku}` : ''} · estoque {i.estoque ?? '—'} · {i.vendidos ?? 0} vendidos
                      </div>
                    </div>
                  </div>
                </td>
                <td style={td}>{LOGISTICA[i.logistic_type || ''] || i.logistic_type || '—'}</td>
                <td style={td}>{fmtLados(i.declarado_cm)}</td>
                <td style={{ ...td, ...(ladoDiverge(i.motivos) ? vermelho : {}) }}>{fmtLados(i.medido_cm)}</td>
                <td style={td}>{fmtPeso(i.peso_declarado_g)}</td>
                <td style={{ ...td, ...(i.motivos.includes('peso') ? vermelho : {}) }}>{fmtPeso(i.peso_medido_g)}</td>
                <td style={td}>{i.motivos.join(', ')}</td>
                <td style={td}>{i.maior_dif_pct}%</td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr><td style={td} colSpan={8}>Nenhum anúncio divergente com esse filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
