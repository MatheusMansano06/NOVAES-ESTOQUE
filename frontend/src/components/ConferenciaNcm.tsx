import { useState, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ItemNcm {
  id: string | number
  sku: string
  nome: string
  situacao: string
  ncm_atual: string
  bate: boolean
}

const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }

export function ConferenciaNcm() {
  const [termo, setTermo] = useState('Viseira')
  const [ncmEsperado, setNcmEsperado] = useState('65070000')
  const [itens, setItens] = useState<ItemNcm[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [atualizandoId, setAtualizandoId] = useState<string | number | null>(null)

  const buscar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const params = new URLSearchParams({ termo, ncm_esperado: ncmEsperado })
      await fetch(`${API_BASE}/api/olist/conferencia-ncm/iniciar?${params}`, { method: 'POST' })

      // A varredura roda em background (1 request por produto, throttle da
      // Olist) — faz polling do status em vez de esperar tudo numa request só.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/olist/conferencia-ncm`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          break
        }
        if (d.status === 'erro') {
          throw new Error(d.erro || 'Falha na varredura')
        }
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [termo, ncmEsperado])

  useEffect(() => { buscar() }, [])

  const alterarNcm = async (item: ItemNcm) => {
    if (!window.confirm(`Alterar o NCM de "${item.nome}" (SKU ${item.sku}) de ${item.ncm_atual || 'vazio'} para ${ncmEsperado}?`)) return
    setAtualizandoId(item.id)
    try {
      const r = await fetch(`${API_BASE}/api/olist/atualizar-ncm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: item.id, ncm: ncmEsperado }),
      })
      const d = await r.json()
      if (!r.ok || !d.sucesso) throw new Error(d.erro || 'Falha ao atualizar NCM')
      setItens((prev) => prev.map((p) => (p.id === item.id ? { ...p, ncm_atual: ncmEsperado, bate: true } : p)))
    } catch (e) {
      alert('❌ ' + String(e instanceof Error ? e.message : e))
    } finally {
      setAtualizandoId(null)
    }
  }

  const divergentes = itens.filter((i) => !i.bate).length

  return (
    <div className="card">
      <div className="card-body" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>Título contém</label>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>NCM esperado</label>
            <input value={ncmEsperado} onChange={(e) => setNcmEsperado(e.target.value)} style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
          </div>
          <button
            type="button"
            onClick={buscar}
            disabled={carregando}
            style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {carregando ? 'Buscando...' : 'Buscar'}
          </button>
          {itens.length > 0 && (
            <span style={{ fontSize: '0.82rem', color: divergentes > 0 ? '#c62828' : '#2e7d32', fontWeight: 700 }}>
              {itens.length} anúncio(s) · {divergentes} com NCM divergente
            </span>
          )}
        </div>

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!carregando && itens.length === 0 && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>Nenhum anúncio encontrado com "{termo}" no título.</div>
        )}

        {itens.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Nome</th>
                  <th style={th}>SKU</th>
                  <th style={th}>NCM atual</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>{item.nome}</td>
                    <td style={td}>{item.sku}</td>
                    <td style={td}>{item.ncm_atual || <em style={{ color: '#999' }}>vazio</em>}</td>
                    <td style={td}>
                      {item.bate ? (
                        <span style={{ color: '#2e7d32', fontWeight: 700 }}>✅ Bate</span>
                      ) : (
                        <span style={{ color: '#c62828', fontWeight: 700 }}>⚠️ Divergente</span>
                      )}
                    </td>
                    <td style={td}>
                      {!item.bate && (
                        <button
                          type="button"
                          onClick={() => alterarNcm(item)}
                          disabled={atualizandoId === item.id}
                          style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: 'none', background: '#c62828', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                        >
                          {atualizandoId === item.id ? 'Alterando...' : 'Alterar NCM'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
