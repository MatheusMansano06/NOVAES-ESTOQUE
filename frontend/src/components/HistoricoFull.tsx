import { useState, useEffect } from 'react'
import api from '../services/api'

interface InboundResumo {
  id: number
  nome_embalde: string
  numero_inbound?: string
  status: string
  data_upload?: string
}

interface ItemEmEspera {
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string | null
  quantidade_full: number
  data_em_espera?: string | null
}

interface Alteracao {
  id: number
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string | null
  quantidade_anterior: number
  quantidade_nova: number
  tipo: string
  criado_em?: string | null
}

interface HistoricoCompleto {
  embale_id: number
  nome_embalde: string
  numero_inbound?: string
  em_espera: ItemEmEspera[]
  total_em_espera: number
  alteracoes: Alteracao[]
  total_alteracoes: number
}

const fmtData = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function HistoricoFull() {
  const [inbounds, setInbounds] = useState<InboundResumo[]>([])
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [dados, setDados] = useState<HistoricoCompleto | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.get('/embaldes?limit=200')
      .then((r) => setInbounds(r.data.items || []))
      .catch((e) => setErro('Erro ao carregar inbounds: ' + String(e)))
  }, [])

  const carregar = async (id: number) => {
    if (selecionado === id) { setSelecionado(null); setDados(null); return }
    setSelecionado(id)
    setCarregando(true)
    setErro('')
    setDados(null)
    try {
      const r = await api.get(`/embaldes/${id}/historico-completo`)
      setDados(r.data)
    } catch (e: any) {
      setErro('Erro ao carregar histórico: ' + (e.response?.data?.erro || String(e)))
    } finally {
      setCarregando(false)
    }
  }

  const cardSecao: React.CSSProperties = { border: '1px solid #e0e0e0', borderRadius: '12px', padding: '1.25rem', background: '#fff' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '0.55rem 0.75rem', fontSize: '0.72rem', textTransform: 'uppercase', color: '#666', fontWeight: 700, borderBottom: '2px solid #eee' }
  const td: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.9rem', borderBottom: '1px solid #f0f0f0' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ fontSize: '0.9rem', color: '#666' }}>
        Selecione um inbound para ver os itens <strong>em espera</strong> e todas as <strong>alterações da quantidade que vai pro FULL</strong>.
      </div>

      {erro && (
        <div style={{ padding: '0.85rem 1rem', background: '#ffebee', border: '1px solid #ef5350', borderRadius: '8px', color: '#c62828' }}>{erro}</div>
      )}

      {/* Lista de inbounds */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {inbounds.length === 0 && !erro && (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: '#999' }}>Nenhum inbound encontrado.</div>
        )}
        {inbounds.map((inb) => (
          <button
            key={inb.id}
            onClick={() => carregar(inb.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
              padding: '0.85rem 1.1rem', textAlign: 'left', cursor: 'pointer',
              border: `1px solid ${selecionado === inb.id ? '#1976D2' : '#e0e0e0'}`,
              borderRadius: '10px', background: selecionado === inb.id ? '#e3f2fd' : '#fff',
              fontWeight: 600, color: '#1a1a1a',
            }}
          >
            <span>
              {inb.nome_embalde || 'Inbound'}
              {inb.numero_inbound ? <span style={{ color: '#888', fontWeight: 500 }}> · #{inb.numero_inbound}</span> : null}
            </span>
            <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.6rem', borderRadius: '999px', fontWeight: 700,
              background: inb.status === 'encerrado' ? '#eceff1' : '#e8f5e9', color: inb.status === 'encerrado' ? '#607d8b' : '#2e7d32' }}>
              {inb.status === 'encerrado' ? 'Encerrado' : 'Processando'}
            </span>
          </button>
        ))}
      </div>

      {carregando && <div style={{ padding: '1.5rem', textAlign: 'center', color: '#1976D2' }}>Carregando histórico…</div>}

      {dados && !carregando && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* EM ESPERA */}
          <div style={cardSecao}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#6a1b9a' }}>⏸️ Em espera</span>
              <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.6rem', borderRadius: '999px', background: '#f3e5f5', color: '#6a1b9a', fontWeight: 700 }}>{dados.total_em_espera}</span>
            </div>
            {dados.em_espera.length === 0 ? (
              <div style={{ color: '#999', fontSize: '0.9rem' }}>Nenhum item em espera neste inbound.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Produto</th>
                      <th style={th}>SKU</th>
                      <th style={th}>Vai pro FULL</th>
                      <th style={th}>Em espera desde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.em_espera.map((it) => (
                      <tr key={it.item_id}>
                        <td style={td}>{it.titulo_anuncio}</td>
                        <td style={td}>{it.sku_inbound || '—'}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{Math.round(it.quantidade_full || 0)}</td>
                        <td style={{ ...td, color: '#666' }}>{fmtData(it.data_em_espera)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ALTERAÇÕES DE QUANTIDADE */}
          <div style={cardSecao}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0d47a1' }}>✏️ Alterações da quantidade do FULL</span>
              <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.6rem', borderRadius: '999px', background: '#e3f2fd', color: '#0d47a1', fontWeight: 700 }}>{dados.total_alteracoes}</span>
            </div>
            {dados.alteracoes.length === 0 ? (
              <div style={{ color: '#999', fontSize: '0.9rem' }}>Nenhuma alteração de quantidade registrada neste inbound.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Produto</th>
                      <th style={th}>SKU</th>
                      <th style={th}>De</th>
                      <th style={th}>Para</th>
                      <th style={th}>Tipo</th>
                      <th style={th}>Quando</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.alteracoes.map((h) => {
                      const aumento = h.tipo === 'aumento'
                      return (
                        <tr key={h.id}>
                          <td style={td}>{h.titulo_anuncio}</td>
                          <td style={td}>{h.sku_inbound || '—'}</td>
                          <td style={{ ...td, color: '#888' }}>{Math.round(h.quantidade_anterior || 0)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{Math.round(h.quantidade_nova || 0)}</td>
                          <td style={td}>
                            <span style={{ fontSize: '0.78rem', padding: '0.12rem 0.55rem', borderRadius: '999px', fontWeight: 700,
                              background: aumento ? '#e8f5e9' : '#fff3e0', color: aumento ? '#2e7d32' : '#ef6c00' }}>
                              {aumento ? '↑ aumento' : '↓ redução'}
                            </span>
                          </td>
                          <td style={{ ...td, color: '#666' }}>{fmtData(h.criado_em)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
