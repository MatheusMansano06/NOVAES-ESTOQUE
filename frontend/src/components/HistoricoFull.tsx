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
  estoque_atual?: number | null
  data_em_espera?: string | null
  imagem?: string | null
}

interface ItemNaoEnviar {
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string | null
  quantidade_full: number
  estoque_atual?: number | null
  data_nao_enviar?: string | null
  imagem?: string | null
}

interface Alteracao {
  id: number
  item_id: number
  titulo_anuncio: string
  sku_inbound?: string | null
  quantidade_anterior: number
  quantidade_nova: number
  estoque_atual?: number | null
  tipo: string
  criado_em?: string | null
}

interface HistoricoCompleto {
  embale_id: number
  nome_embalde: string
  numero_inbound?: string
  em_espera: ItemEmEspera[]
  total_em_espera: number
  nao_enviar: ItemNaoEnviar[]
  total_nao_enviar: number
  alteracoes: Alteracao[]
  total_alteracoes: number
}

const fmtData = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtQtd = (valor?: number | null) => {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '—'
  return String(Math.round(Number(valor)))
}

function Foto({ src, alt }: { src?: string | null; alt: string }) {
  return (
    <div style={{ width: '46px', height: '46px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #eee' }}>
      {src
        ? <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ color: '#ccc', fontSize: '1.3rem' }}>📦</span>}
    </div>
  )
}

export function HistoricoFull() {
  const [inbounds, setInbounds] = useState<InboundResumo[]>([])
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [dados, setDados] = useState<HistoricoCompleto | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  // Quantidade a declarar (qtd que vai pro FULL) por item em espera
  const [declarar, setDeclarar] = useState<Record<number, string>>({})
  // item_id em processamento (desabilita os botões daquela linha)
  const [acaoItem, setAcaoItem] = useState<number | null>(null)

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
    setDeclarar({})
    try {
      const r = await api.get(`/embaldes/${id}/historico-completo`)
      setDados(r.data)
    } catch (e: any) {
      setErro('Erro ao carregar histórico: ' + (e.response?.data?.erro || String(e)))
    } finally {
      setCarregando(false)
    }
  }

  const recarregar = async () => {
    if (selecionado == null) return
    try {
      const r = await api.get(`/embaldes/${selecionado}/historico-completo`)
      setDados(r.data)
    } catch (e: any) {
      setErro('Erro ao recarregar: ' + (e.response?.data?.erro || String(e)))
    }
  }

  // Volta o item à lista de separação com a quantidade declarada como nova "Vai pro FULL"
  const voltarParaSeparacao = async (it: ItemEmEspera) => {
    if (!dados) return
    const bruto = declarar[it.item_id]
    const qtd = (bruto !== undefined && bruto !== '')
      ? Math.max(0, Math.round(Number(bruto) || 0))
      : Math.round(it.quantidade_full || 0)
    setAcaoItem(it.item_id)
    setErro('')
    try {
      await api.post(`/embaldes/${dados.embale_id}/itens/${it.item_id}/quantidade-full`, { quantidade_full: qtd })
      await api.post(`/embaldes/${dados.embale_id}/itens/${it.item_id}/em-espera`, { em_espera: 0 })
      await recarregar()
    } catch (e: any) {
      setErro('Erro ao voltar pra separação: ' + (e.response?.data?.erro || String(e)))
    } finally {
      setAcaoItem(null)
    }
  }

  const excluirDaSeparacao = async (item_id: number) => {
    if (!dados) return
    setAcaoItem(item_id)
    setErro('')
    try {
      await api.post(`/embaldes/${dados.embale_id}/itens/${item_id}/nao-enviar`, { nao_enviar: 1 })
      await recarregar()
    } catch (e: any) {
      setErro('Erro ao excluir da separação: ' + (e.response?.data?.erro || String(e)))
    } finally {
      setAcaoItem(null)
    }
  }

  const trazerDeVolta = async (item_id: number) => {
    if (!dados) return
    setAcaoItem(item_id)
    setErro('')
    try {
      await api.post(`/embaldes/${dados.embale_id}/itens/${item_id}/nao-enviar`, { nao_enviar: 0 })
      await recarregar()
    } catch (e: any) {
      setErro('Erro ao trazer de volta: ' + (e.response?.data?.erro || String(e)))
    } finally {
      setAcaoItem(null)
    }
  }

  const cardSecao: React.CSSProperties = { border: '1px solid #e0e0e0', borderRadius: '12px', padding: '1.25rem', background: '#fff' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '0.55rem 0.75rem', fontSize: '0.72rem', textTransform: 'uppercase', color: '#666', fontWeight: 700, borderBottom: '2px solid #eee' }
  const td: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.9rem', borderBottom: '1px solid #f0f0f0' }
  const btn: React.CSSProperties = { padding: '0.4rem 0.7rem', borderRadius: '7px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', border: '1px solid transparent' }

  const produtoCell = (titulo: string, imagem?: string | null) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <Foto src={imagem} alt={titulo} />
      <span style={{ lineHeight: 1.3 }}>{titulo}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ fontSize: '0.9rem', color: '#666' }}>
        Selecione um inbound para ver os itens <strong>em espera</strong>, os <strong>excluídos</strong> e todas as <strong>alterações da quantidade que vai pro FULL</strong>.
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
            <div style={{ fontSize: '0.82rem', color: '#777', marginBottom: '0.85rem' }}>
              Declare quantos vão pro FULL e <strong>volte pra separação</strong> (a pessoa balanceia ou retira 100%), ou <strong>exclua</strong> se o produto não vai ser enviado.
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
                      <th style={th}>Qtd a declarar</th>
                      <th style={th}>Em espera desde</th>
                      <th style={th}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.em_espera.map((it) => {
                      const ocupado = acaoItem === it.item_id
                      const valorDeclarar = declarar[it.item_id] ?? String(Math.round(it.quantidade_full || 0))
                      return (
                        <tr key={it.item_id}>
                          <td style={td}>{produtoCell(it.titulo_anuncio, it.imagem)}</td>
                          <td style={td}>{it.sku_inbound || '—'}</td>
                          <td style={td}>
                            <input
                              type="number" min="0" step="1"
                              value={valorDeclarar}
                              onChange={(e) => setDeclarar({ ...declarar, [it.item_id]: e.target.value })}
                              disabled={ocupado}
                              style={{ width: '90px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #bbb', textAlign: 'center', fontSize: '1rem', fontWeight: 800, background: ocupado ? '#f0f0f0' : '#fff' }}
                            />
                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.2rem' }}>Olist atual: {fmtQtd(it.estoque_atual)}</div>
                          </td>
                          <td style={{ ...td, color: '#666' }}>{fmtData(it.data_em_espera)}</td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => voltarParaSeparacao(it)}
                                disabled={ocupado}
                                style={{ ...btn, background: '#1976D2', color: '#fff', opacity: ocupado ? 0.6 : 1 }}
                              >
                                ↩️ Voltar pra separação
                              </button>
                              <button
                                onClick={() => excluirDaSeparacao(it.item_id)}
                                disabled={ocupado}
                                style={{ ...btn, background: '#fff', color: '#c62828', border: '1px solid #ef9a9a', opacity: ocupado ? 0.6 : 1 }}
                              >
                                🗑️ Excluir (não enviar)
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* EXCLUÍDOS (NÃO SERÃO ENVIADOS) */}
          <div style={cardSecao}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#c62828' }}>🚫 Excluídos (não serão enviados)</span>
              <span style={{ fontSize: '0.78rem', padding: '0.15rem 0.6rem', borderRadius: '999px', background: '#ffebee', color: '#c62828', fontWeight: 700 }}>{dados.total_nao_enviar}</span>
            </div>
            {dados.nao_enviar.length === 0 ? (
              <div style={{ color: '#999', fontSize: '0.9rem' }}>Nenhum item excluído da separação.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Produto</th>
                      <th style={th}>SKU</th>
                      <th style={th}>Vai pro FULL</th>
                      <th style={th}>Excluído em</th>
                      <th style={th}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.nao_enviar.map((it) => {
                      const ocupado = acaoItem === it.item_id
                      return (
                        <tr key={it.item_id}>
                          <td style={td}>{produtoCell(it.titulo_anuncio, it.imagem)}</td>
                          <td style={td}>{it.sku_inbound || '—'}</td>
                          <td style={td}>{fmtQtd(it.quantidade_full)}</td>
                          <td style={{ ...td, color: '#666' }}>{fmtData(it.data_nao_enviar)}</td>
                          <td style={td}>
                            <button
                              onClick={() => trazerDeVolta(it.item_id)}
                              disabled={ocupado}
                              style={{ ...btn, background: '#fff', color: '#2e7d32', border: '1px solid #a5d6a7', opacity: ocupado ? 0.6 : 1 }}
                            >
                              ↩️ Trazer de volta
                            </button>
                          </td>
                        </tr>
                      )
                    })}
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
                      <th style={th}>Vai pro FULL</th>
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
                          <td style={td}>
                            <div style={{ fontWeight: 700 }}>{fmtQtd(h.quantidade_nova)}</div>
                            <div style={{ fontSize: '0.78rem', color: '#666' }}>Olist atual: {fmtQtd(h.estoque_atual)}</div>
                          </td>
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
