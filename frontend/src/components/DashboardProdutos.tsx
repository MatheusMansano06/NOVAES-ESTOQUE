import { useState, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ProdutoTipo {
  id: string | number
  sku: string
  nome: string
  situacao: string
  tipo: string
}

interface ItemFiscal {
  sku: string
  nome: string
  produto_id: string | number
  item_id: string
  olist_ncm: string
  ml_ncm: string
  olist_gtin: string
  ml_ean: string
  sem_dados_ml: boolean
  divergencias: string[]
  status: 'correto' | 'divergente' | 'sem_dados_ml'
}

const LABEL_TIPO: Record<string, string> = { S: 'Simples', K: 'Kit', F: 'Fabricado', M: 'Matéria-prima', V: 'Variação' }
const labelTipo = (tipo: string) => LABEL_TIPO[tipo] || tipo || '(desconhecido)'

const CORES_TIPO: Record<string, string> = { S: '#2d3277', K: '#c62828', F: '#2e7d32', M: '#8d6e00', V: '#6a1b9a' }
const corTipo = (tipo: string) => CORES_TIPO[tipo] || '#888'

const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }

function chipStyle(ativo: boolean, cor = '#2d3277'): React.CSSProperties {
  return {
    padding: '0.4rem 0.9rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
    border: ativo ? `1px solid ${cor}` : '1px solid #dfe3e8',
    background: ativo ? cor : '#fff',
    color: ativo ? '#fff' : '#444',
    cursor: 'pointer',
  }
}

// ===== Seção 1: Classificação Kit x Simples =====
function SecaoTipos() {
  const [itens, setItens] = useState<ProdutoTipo[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [palavra, setPalavra] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      await fetch(`${API_BASE}/api/olist/produtos-tipos/iniciar`, { method: 'POST' })
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/olist/produtos-tipos`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          break
        }
        if (d.status === 'erro') throw new Error(d.erro || 'Falha na varredura')
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = palavra.trim()
    ? itens.filter((i) => i.nome.toLowerCase().includes(palavra.trim().toLowerCase()))
    : itens

  const contagem = new Map<string, number>()
  for (const item of filtrados) {
    contagem.set(item.tipo || '', (contagem.get(item.tipo || '') || 0) + 1)
  }
  const grupos = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1])
  const total = filtrados.length

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-body" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Classificação dos anúncios: Simples x Kit</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              value={palavra}
              onChange={(e) => setPalavra(e.target.value)}
              placeholder="Filtrar por palavra (ex.: KIT)"
              style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cfd8dc', minWidth: 220 }}
            />
            <button
              type="button"
              onClick={carregar}
              disabled={carregando}
              style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {carregando ? 'Carregando...' : 'Recarregar'}
            </button>
          </div>
        </div>

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!carregando && total === 0 && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>
            {palavra.trim() ? `Nenhum produto com "${palavra}" no título.` : 'Nenhum produto encontrado.'}
          </div>
        )}

        {total > 0 && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', color: '#667085', fontWeight: 700, alignSelf: 'center' }}>{total} produto(s):</span>
              {grupos.map(([tipo, qtd]) => (
                <span
                  key={tipo}
                  style={{
                    padding: '0.35rem 0.8rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
                    background: `${corTipo(tipo)}18`, color: corTipo(tipo),
                  }}
                >
                  {labelTipo(tipo)}: {qtd} ({total ? Math.round((qtd * 1000) / total) / 10 : 0}%)
                </span>
              ))}
            </div>

            {/* barra de proporção visual */}
            <div style={{ display: 'flex', height: 10, borderRadius: '999px', overflow: 'hidden', marginBottom: '1rem' }}>
              {grupos.map(([tipo, qtd]) => (
                <div key={tipo} style={{ width: `${(qtd * 100) / total}%`, background: corTipo(tipo) }} title={`${labelTipo(tipo)}: ${qtd}`} />
              ))}
            </div>

            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Nome</th>
                    <th style={th}>SKU</th>
                    <th style={th}>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item) => (
                    <tr key={item.id}>
                      <td style={td}>{item.nome}</td>
                      <td style={td}>{item.sku}</td>
                      <td style={td}>
                        <span style={{ color: corTipo(item.tipo), fontWeight: 700 }}>{labelTipo(item.tipo)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ===== Seção 2: Dados fiscais ML x Olist =====
function SecaoFiscal() {
  const [itens, setItens] = useState<ItemFiscal[]>([])
  const [resumo, setResumo] = useState<{ total: number; corretos: number; divergentes: number; sem_dados_ml: number } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'correto' | 'divergente' | 'sem_dados_ml'>('divergente')
  const [jaRodou, setJaRodou] = useState(false)

  const comparar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      await fetch(`${API_BASE}/api/fiscal/ml-olist/iniciar`, { method: 'POST' })
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/fiscal/ml-olist`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          setResumo(d.resultado ? { total: d.resultado.total, corretos: d.resultado.corretos, divergentes: d.resultado.divergentes, sem_dados_ml: d.resultado.sem_dados_ml } : null)
          setJaRodou(true)
          break
        }
        if (d.status === 'erro') throw new Error(d.erro || 'Falha na comparação')
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  const itensExibidos = filtro === 'todos' ? itens : itens.filter((i) => i.status === filtro)

  return (
    <div className="card">
      <div className="card-body" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Dados fiscais: Mercado Livre x Olist</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#667085' }}>
              Casa por SKU e compara NCM e GTIN/EAN cadastrados em cada plataforma.
            </p>
          </div>
          <button
            type="button"
            onClick={comparar}
            disabled={carregando}
            style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {carregando ? 'Comparando... (pode levar alguns minutos)' : jaRodou ? 'Comparar de novo' : 'Comparar agora'}
          </button>
        </div>

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!jaRodou && !carregando && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>
            Clique em "Comparar agora" — a varredura chama a API do ML e da Olist produto a produto, por isso demora mais.
          </div>
        )}

        {resumo && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {([
                ['todos', `Todos (${resumo.total})`, '#444'],
                ['correto', `Corretos (${resumo.corretos})`, '#2e7d32'],
                ['divergente', `Divergentes (${resumo.divergentes})`, '#c62828'],
                ['sem_dados_ml', `Sem dados no ML (${resumo.sem_dados_ml})`, '#8d6e00'],
              ] as const).map(([valor, label, cor]) => (
                <button key={valor} type="button" onClick={() => setFiltro(valor)} style={chipStyle(filtro === valor, cor)}>
                  {label}
                </button>
              ))}
            </div>

            {itensExibidos.length === 0 ? (
              <div style={{ color: '#999', padding: '1rem 0' }}>Nenhum item nesse filtro.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Nome</th>
                      <th style={th}>SKU</th>
                      <th style={th}>NCM Olist</th>
                      <th style={th}>NCM ML</th>
                      <th style={th}>GTIN Olist</th>
                      <th style={th}>EAN ML</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensExibidos.map((item) => (
                      <tr key={item.item_id}>
                        <td style={td}>{item.nome}</td>
                        <td style={td}>{item.sku}</td>
                        <td style={{ ...td, color: item.divergencias.includes('ncm') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('ncm') ? 700 : 400 }}>
                          {item.olist_ncm || <em style={{ color: '#999' }}>vazio</em>}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('ncm') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('ncm') ? 700 : 400 }}>
                          {item.sem_dados_ml ? <em style={{ color: '#999' }}>sem dados</em> : (item.ml_ncm || <em style={{ color: '#999' }}>vazio</em>)}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('gtin') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('gtin') ? 700 : 400 }}>
                          {item.olist_gtin || <em style={{ color: '#999' }}>vazio</em>}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('gtin') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('gtin') ? 700 : 400 }}>
                          {item.sem_dados_ml ? <em style={{ color: '#999' }}>sem dados</em> : (item.ml_ean || <em style={{ color: '#999' }}>vazio</em>)}
                        </td>
                        <td style={td}>
                          {item.status === 'correto' && <span style={{ color: '#2e7d32', fontWeight: 700 }}>✅ Correto</span>}
                          {item.status === 'divergente' && <span style={{ color: '#c62828', fontWeight: 700 }}>⚠️ Divergente</span>}
                          {item.status === 'sem_dados_ml' && <span style={{ color: '#8d6e00', fontWeight: 700 }}>— Sem dados no ML</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function DashboardProdutos() {
  return (
    <div>
      <SecaoTipos />
      <SecaoFiscal />
    </div>
  )
}
