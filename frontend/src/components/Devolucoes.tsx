import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Bucket = 'para_revisao' | 'para_retirar' | 'outros_problemas'

interface Card {
  claim_id: string
  pedido_id: string
  pack_id: string
  order_ids: string[]
  bucket: Bucket
  regra: string
  reason_id: string
  motivo_label: string
  produto_nome: string
  produto_imagem: string
  valor_pago: number
  taxa_venda: number
  ml_tipo_logistica: string
  return_status: string
  shipment_status: string
  shipment_destination: string
  mandatory: number
  due_date: string
  date_created: string
  last_updated: string
}

interface Resumo {
  para_revisao: number
  para_retirar: number
  outros_problemas: number
  total: number
  fonte: string
}

const SECOES: { bucket: Bucket; titulo: string; sub: string; cor: string }[] = [
  { bucket: 'para_retirar', titulo: '📦 Retirar nos Correios', sub: 'o cliente postou — retire dentro do prazo ou o ML devolve o dinheiro', cor: '#c62828' },
  { bucket: 'para_revisao', titulo: '🔍 Revisar o que chegou', sub: 'produto de volta com você — confira e decida', cor: '#ef6c00' },
  { bucket: 'outros_problemas', titulo: '⚠️ Outros problemas', sub: 'mediação, reclamação e casos em análise no ML', cor: '#5e35b1' },
]

// Dias de calendário, não diferença de horas: um prazo às 23:33 de hoje vence
// HOJE, não "em 1 dia". O ML manda due_date com fuso (-04:00); o new Date()
// converte pro fuso local e a comparação é feita entre datas já normalizadas.
const diasAte = (iso?: string | null): number | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const hoje = new Date()
  const diaPrazo = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diaHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((diaPrazo.getTime() - diaHoje.getTime()) / 86400000)
}

const fmtPrazo = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const fmtBRL = (v?: number | null) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const urgencia = (dias: number | null) => {
  if (dias === null) return { cor: '#90a4ae', bg: '#f3f4f6', label: 'sem prazo' }
  if (dias < 0) return { cor: '#b71c1c', bg: '#ffcdd2', label: 'VENCIDO' }
  if (dias === 0) return { cor: '#b71c1c', bg: '#ffcdd2', label: 'vence HOJE' }
  if (dias === 1) return { cor: '#c62828', bg: '#ffebee', label: 'vence amanhã' }
  if (dias <= 3) return { cor: '#ef6c00', bg: '#fff3e0', label: `${dias} dias` }
  return { cor: '#2e7d32', bg: '#e8f5e9', label: `${dias} dias` }
}

export function Devolucoes() {
  const [cards, setCards] = useState<Record<Bucket, Card[]>>({ para_revisao: [], para_retirar: [], outros_problemas: [] })
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [busca, setBusca] = useState('')
  const [copiado, setCopiado] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const buckets: Bucket[] = ['para_revisao', 'para_retirar', 'outros_problemas']
      const [r, ...cs] = await Promise.all([
        fetch(`${API_BASE}/api/resumo-ml`, { cache: 'no-store' }).then(x => x.json()),
        ...buckets.map(b =>
          fetch(`${API_BASE}/api/devolucoes/cards?bucket=${b}`, { cache: 'no-store' }).then(x => x.json())),
      ])
      setResumo(r)
      setCards({
        para_revisao: cs[0]?.cards || [],
        para_retirar: cs[1]?.cards || [],
        outros_problemas: cs[2]?.cards || [],
      })
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const sincronizar = async () => {
    setSincronizando(true)
    setErro('')
    setAviso('')
    try {
      const r = await fetch(`${API_BASE}/api/devolucoes/sincronizar-ml`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro || d.mensagem || 'Falha ao sincronizar')
      if (d.erros?.length) setAviso(`Sincronizado, mas ${d.erros.length} claim(s) deram erro no ML.`)
      await carregar()
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setSincronizando(false)
    }
  }

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(texto); setTimeout(() => setCopiado(''), 1200) } catch { /* noop */ }
  }

  const filtrar = (lista: Card[]) => lista.filter(c => {
    if (!busca.trim()) return true
    const q = busca.trim().toLowerCase()
    return `${c.produto_nome} ${c.claim_id} ${c.pedido_id} ${c.motivo_label}`.toLowerCase().includes(q)
  })

  const card = (c: Card) => {
    const dias = diasAte(c.due_date)
    const u = urgencia(dias)
    const liquido = (c.valor_pago || 0) - (c.taxa_venda || 0)
    return (
      <div key={c.claim_id} style={{ display: 'flex', gap: '0.85rem', padding: '0.85rem', border: `1px solid ${u.cor}33`, borderLeft: `5px solid ${u.cor}`, borderRadius: '12px', background: '#fff' }}>
        <div style={{ width: 58, height: 58, flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {c.produto_imagem
            ? <img src={c.produto_imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: '#b0bec5', fontSize: '1.4rem' }}>📦</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {c.due_date && (
              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: u.cor, background: u.bg, padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                {u.label}
              </span>
            )}
            {!!c.mandatory && (
              <span title="prazo obrigatório: perder significa reembolso automático ao comprador" style={{ fontSize: '0.68rem', fontWeight: 800, color: '#b71c1c', border: '1px solid #ef9a9a', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                obrigatório
              </span>
            )}
            {c.ml_tipo_logistica === 'full_ml' && (
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#00695c', background: '#e0f2f1', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                FULL
              </span>
            )}
          </div>
          <div title={c.produto_nome} style={{ fontWeight: 700, fontSize: '0.86rem', color: '#263238', margin: '0.3rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.produto_nome || '(sem título)'}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#546e7a' }}>
            {c.motivo_label || '—'}
          </div>
          <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.72rem', color: '#607d8b', marginTop: '0.35rem' }}>
            <span><b style={{ color: '#263238' }}>{fmtBRL(c.valor_pago)}</b> pago</span>
            <span>taxa {fmtBRL(c.taxa_venda)}</span>
            <span>líquido <b style={{ color: '#263238' }}>{fmtBRL(liquido)}</b></span>
            {c.due_date && <span>prazo {fmtPrazo(c.due_date)}</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
            <button onClick={() => copiar(c.claim_id)} title="copiar nº da reclamação" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid #cfd8dc', background: '#fff', color: '#455a64', cursor: 'pointer', fontWeight: 600 }}>
              {copiado === c.claim_id ? '✓ copiado' : `📋 ${c.claim_id}`}
            </button>
            <a href={`https://www.mercadolivre.com.br/vendas/${c.pedido_id}/detalhe`} target="_blank" rel="noreferrer" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid #ffe082', background: '#fffde7', color: '#f57f17', textDecoration: 'none', fontWeight: 700 }}>
              abrir no ML ↗
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem' }}>
        {SECOES.map(s => (
          <div key={s.bucket} style={{ padding: '0.8rem 1rem', borderRadius: '12px', background: '#fff', border: `1px solid ${s.cor}33`, borderTop: `4px solid ${s.cor}` }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: s.cor, lineHeight: 1 }}>
              {resumo ? (resumo[s.bucket] ?? 0) : '—'}
            </div>
            <div style={{ fontSize: '0.76rem', color: '#546e7a', fontWeight: 600, marginTop: '0.2rem' }}>{s.titulo}</div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
        <input placeholder="🔎 buscar produto, motivo ou nº da reclamação" value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1, minWidth: 200, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
        <button onClick={carregar} disabled={carregando || sincronizando} style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid #1a237e', background: '#fff', color: '#1a237e', fontWeight: 700, cursor: 'pointer', opacity: carregando ? 0.6 : 1 }}>
          ↻ Recarregar
        </button>
        <button onClick={sincronizar} disabled={sincronizando} title="Rebusca tudo no Mercado Livre — leva alguns minutos" style={{ padding: '0.45rem 0.9rem', borderRadius: '8px', border: 'none', background: '#1a237e', color: '#fff', fontWeight: 700, cursor: sincronizando ? 'default' : 'pointer', opacity: sincronizando ? 0.6 : 1 }}>
          {sincronizando ? 'Sincronizando…' : '⟳ Sincronizar com o ML'}
        </button>
      </div>

      {sincronizando && (
        <div style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: '#e8eaf6', color: '#1a237e', fontWeight: 600 }}>
          Lendo as reclamações no Mercado Livre… isso leva alguns minutos, pode deixar a aba aberta.
        </div>
      )}
      {erro && <div style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>{erro}</div>}
      {aviso && <div style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: '#fff3e0', color: '#ef6c00', fontWeight: 600 }}>{aviso}</div>}

      {carregando && !resumo && (
        <div style={{ padding: '2.5rem', textAlign: 'center', color: '#607d8b' }}>Carregando a fila de devoluções…</div>
      )}

      {resumo && (
        <>
          <div style={{ fontSize: '0.72rem', color: '#90a4ae' }}>
            {resumo.total} devoluções na fila · lido do cache do último sync
          </div>

          {SECOES.map(sec => {
            const lista = filtrar(cards[sec.bucket])
            if (!lista.length) return null
            return (
              <div key={sec.bucket} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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

          {resumo.total === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#2e7d32', fontWeight: 600 }}>
              ✅ Nenhuma devolução na fila. Tudo limpo!
            </div>
          )}
          {resumo.total > 0 && SECOES.every(s => !filtrar(cards[s.bucket]).length) && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#607d8b' }}>
              Nenhuma devolução bate com “{busca}”.
            </div>
          )}
        </>
      )}
    </div>
  )
}
