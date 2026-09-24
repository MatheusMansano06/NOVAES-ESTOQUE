import { useEffect, useState } from 'react'
import api from '../services/api'

interface DivergenciaFull {
  item_id: number
  embale_id: number
  inbound: string
  numero_inbound?: string | null
  titulo_anuncio: string
  sku_inbound?: string | null
  quantidade_full: number
  falta: number
  conferido: number
  em_espera: number
  data_balanceamento?: string | null
  imagem?: string | null
}

// Divergências do inbound FULL: balanço achou menos que o Vai pro FULL e o item ainda não foi resolvido.
// A resolução (declarar nova qtd e voltar, ou excluir) é feita no Histórico FULL.
export function DivergenciasFull({ onResolver }: { onResolver: () => void }) {
  const [itens, setItens] = useState<DivergenciaFull[] | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.get('/divergencias-full')
      .then((r) => setItens(r.data.itens || []))
      .catch((e) => setErro('Erro ao carregar divergências do FULL: ' + (e.response?.data?.erro || String(e))))
  }, [])

  if (erro) return <div style={{ color: '#c62828', padding: '1rem' }}>{erro}</div>
  if (!itens) return <div style={{ color: '#999', padding: '1rem' }}>Carregando divergências do FULL…</div>

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: '12px', padding: '1.25rem', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#c62828' }}>⚠️ Divergências do FULL</span>
        <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.6rem', borderRadius: '999px', background: '#ffebee', color: '#c62828', fontWeight: 700 }}>{itens.length}</span>
      </div>
      {itens.length === 0 ? (
        <div style={{ color: '#999', fontSize: '0.9rem' }}>Nenhuma divergência nos inbounds abertos.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {itens.map((d) => (
            <div key={d.item_id} style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.8rem', border: '1px solid #ffcdd2', borderRadius: '10px', background: '#fff8f8' }}>
              {d.imagem && <img src={d.imagem} alt="" style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 6, background: '#fff' }} />}
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{d.titulo_anuncio}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  SKU {d.sku_inbound || '—'} · {d.inbound}{d.numero_inbound ? ` (#${d.numero_inbound})` : ''}
                  {d.data_balanceamento ? ` · balanço em ${new Date(d.data_balanceamento + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                </div>
              </div>
              <div style={{ fontSize: '0.85rem', textAlign: 'right' }}>
                <div>Vai pro FULL <strong>{Math.round(d.quantidade_full)}</strong> · conferido <strong>{Math.round(d.conferido)}</strong></div>
                <div style={{ color: '#c62828', fontWeight: 800 }}>Faltam {Math.round(d.falta)}</div>
                {d.em_espera === 1 && <div style={{ fontSize: '0.75rem', color: '#6a1b9a', fontWeight: 700 }}>⏸ em espera</div>}
              </div>
              <button onClick={onResolver}
                style={{ padding: '0.5rem 0.9rem', background: '#fff', color: '#1976D2', border: '1px solid #1976D2', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                Resolver no Histórico →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
