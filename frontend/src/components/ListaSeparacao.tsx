import { useState, useEffect } from 'react'

interface ItemSeparacao {
  id: number
  embalde_id: number
  titulo_anuncio: string
  sku_inbound: string
  quantidade_separada: number
  olist_sku?: string
  olist_nome?: string
  imagem_principal?: string
  thumbnail?: string
  foi_balanceado?: number
  em_espera?: number
  saldo_disponivel?: number
  quantidade_baixada?: number
  codigo_ml?: string
}

interface Inbound {
  id: number
  numero_inbound: string
  nome_embalde: string
  data_limite?: string
  total_unidades?: number
  total_planejado_full?: number
  total_baixado_full?: number
  itens?: ItemSeparacao[]
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export function ListaSeparacao() {
  const [inbounds, setInbounds] = useState<Inbound[]>([])
  const [inboundSelecionado, setInboundSelecionado] = useState<Inbound | null>(null)
  const [indexItemAtual, setIndexItemAtual] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    carregarInbounds()
  }, [])

  const carregarInbounds = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/embaldes/lista`)
      if (!res.ok) throw new Error('Falha ao carregar inbounds')
      const data = await res.json()
      setInbounds(data)
    } catch (err) {
      setMessage(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    } finally {
      setLoading(false)
    }
  }

  const abrirInbound = async (inbound: Inbound) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/embaldes/${inbound.id}/itens`)
      if (!res.ok) throw new Error('Falha ao carregar itens do inbound')
      const itens = await res.json()
      const inboundComItens = { ...inbound, itens }
      setInboundSelecionado(inboundComItens)
      setIndexItemAtual(0)
    } catch (err) {
      setMessage(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    } finally {
      setLoading(false)
    }
  }

  const proximoItem = () => {
    if (inboundSelecionado && inboundSelecionado.itens) {
      if (indexItemAtual < inboundSelecionado.itens.length - 1) {
        setIndexItemAtual(indexItemAtual + 1)
      }
    }
  }

  const itemAtual = inboundSelecionado?.itens?.[indexItemAtual]

  const handleBalancear = async () => {
    if (!itemAtual) return
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/embaldes/${inboundSelecionado?.id}/item/${itemAtual.id}/balancear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Falha ao balancear')
      setMessage('Item balanceado com sucesso!')
      setTimeout(() => proximoItem(), 800)
    } catch (err) {
      setMessage(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleBaixar = async () => {
    if (!itemAtual) return
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/embaldes/${inboundSelecionado?.id}/item/${itemAtual.id}/baixar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Falha ao baixar estoque')
      setMessage('Estoque baixado com sucesso!')
      setTimeout(() => proximoItem(), 800)
    } catch (err) {
      setMessage(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleEspera = async () => {
    if (!itemAtual) return
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/embaldes/${inboundSelecionado?.id}/item/${itemAtual.id}/espera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Falha ao marcar como espera')
      setMessage('Item marcado como em espera!')
      setTimeout(() => proximoItem(), 800)
    } catch (err) {
      setMessage(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    } finally {
      setActionLoading(false)
    }
  }

  // Se nenhum inbound selecionado, mostra lista de inbounds
  if (!inboundSelecionado) {
    return (
      <div style={{ padding: '2rem' }}>
        {message && (
          <div style={{
            padding: '1rem',
            marginBottom: '1.5rem',
            background: message.includes('Erro') ? '#ffebee' : '#e8f5e9',
            color: message.includes('Erro') ? '#c62828' : '#2e7d32',
            borderRadius: '8px',
            border: `1px solid ${message.includes('Erro') ? '#ef5350' : '#4caf50'}`
          }}>
            {message}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1.5rem'
        }}>
          {loading ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#666' }}>
              Carregando inbounds...
            </div>
          ) : inbounds.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#999' }}>
              Nenhum inbound encontrado
            </div>
          ) : (
            inbounds.map((inbound) => (
              <button
                key={inbound.id}
                onClick={() => abrirInbound(inbound)}
                style={{
                  padding: '1.5rem',
                  background: '#fff',
                  border: '2px solid #e0e0e0',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.3s',
                  hover: { borderColor: '#1976d2', boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)' }
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#1976d2'
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(25, 118, 210, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e0e0e0'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1a1a1a', marginBottom: '0.5rem' }}>
                  {inbound.nome_embalde || inbound.numero_inbound}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem' }}>
                  <div>Inbound: {inbound.numero_inbound}</div>
                  {inbound.total_unidades && <div>Total: {Math.round(inbound.total_unidades)} un.</div>}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#1976d2', fontWeight: '600' }}>
                  Abrir →
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  // Se tem inbound selecionado, mostra o picker visual
  if (!itemAtual) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
        Nenhum item neste inbound
        <div style={{ marginTop: '1rem' }}>
          <button
            onClick={() => setInboundSelecionado(null)}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#f0f0f0',
              border: '1px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            ← Voltar para lista
          </button>
        </div>
      </div>
    )
  }

  const percentualCompleto = Math.round(((indexItemAtual + 1) / (inboundSelecionado.itens?.length || 1)) * 100)

  return (
    <div style={{ padding: '2rem', background: '#f9f9f9', minHeight: '100vh' }}>
      {message && (
        <div style={{
          padding: '1rem',
          marginBottom: '1.5rem',
          background: message.includes('Erro') ? '#ffebee' : '#e8f5e9',
          color: message.includes('Erro') ? '#c62828' : '#2e7d32',
          borderRadius: '8px',
          border: `1px solid ${message.includes('Erro') ? '#ef5350' : '#4caf50'}`,
          animation: 'slideDown 0.3s ease'
        }}>
          {message}
        </div>
      )}

      {/* Header do inbound */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '2px solid #e0e0e0'
      }}>
        <div>
          <h2 style={{ margin: '0 0 0.5rem 0', color: '#1a1a1a' }}>
            {inboundSelecionado.nome_embalde || inboundSelecionado.numero_inbound}
          </h2>
          <div style={{ color: '#666', fontSize: '0.9rem' }}>
            Inbound: {inboundSelecionado.numero_inbound}
          </div>
        </div>
        <button
          onClick={() => setInboundSelecionado(null)}
          style={{
            padding: '0.6rem 1.2rem',
            background: '#f0f0f0',
            border: '1px solid #ddd',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.9rem'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f0f0')}
        >
          ← Voltar
        </button>
      </div>

      {/* Barra de progresso */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#666' }}>
            Produto {indexItemAtual + 1} de {inboundSelecionado.itens?.length}
          </span>
          <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#1976d2' }}>
            {percentualCompleto}%
          </span>
        </div>
        <div style={{
          width: '100%',
          height: '8px',
          background: '#e0e0e0',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${percentualCompleto}%`,
            height: '100%',
            background: '#1976d2',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Card grande do produto */}
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '2rem',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        maxWidth: '700px',
        margin: '0 auto'
      }}>
        {/* Imagem */}
        <div style={{
          width: '100%',
          height: '400px',
          background: '#f5f5f5',
          borderRadius: '12px',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {itemAtual.imagem_principal || itemAtual.thumbnail ? (
            <img
              src={itemAtual.imagem_principal || itemAtual.thumbnail}
              alt={itemAtual.titulo_anuncio}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
          ) : (
            <div style={{ color: '#999', fontSize: '1rem', fontWeight: '600' }}>
              Sem imagem disponível
            </div>
          )}
        </div>

        {/* Informações */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#1a1a1a', fontSize: '1.3rem', lineHeight: '1.4' }}>
            {itemAtual.titulo_anuncio}
          </h3>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem',
            padding: '1rem',
            background: '#f9f9f9',
            borderRadius: '8px'
          }}>
            <div>
              <div style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                SKU INBOUND
              </div>
              <div style={{ color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700' }}>
                {itemAtual.sku_inbound || '—'}
              </div>
            </div>
            <div>
              <div style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                QUANTIDADE
              </div>
              <div style={{ color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700' }}>
                {Math.round(itemAtual.quantidade_separada)} un.
              </div>
            </div>
            {itemAtual.olist_sku && (
              <>
                <div>
                  <div style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                    SKU OLIST
                  </div>
                  <div style={{ color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }}>
                    {itemAtual.olist_sku}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                    NOME OLIST
                  </div>
                  <div style={{ color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '600' }}>
                    {itemAtual.olist_nome || '—'}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status atual */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {itemAtual.foi_balanceado ? (
              <div style={{
                padding: '0.5rem 1rem',
                background: '#fff3e0',
                color: '#e65100',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                border: '1px solid #ffe0b2'
              }}>
                ⚖️ Balanceado
              </div>
            ) : null}
            {itemAtual.em_espera ? (
              <div style={{
                padding: '0.5rem 1rem',
                background: '#f3e5f5',
                color: '#7b1fa2',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                border: '1px solid #e1bee7'
              }}>
                ⏸️ Em espera
              </div>
            ) : null}
            {itemAtual.quantidade_baixada ? (
              <div style={{
                padding: '0.5rem 1rem',
                background: '#e8f5e9',
                color: '#2e7d32',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                border: '1px solid #c8e6c9'
              }}>
                ✓ Baixado
              </div>
            ) : null}
          </div>
        </div>

        {/* Ações */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <button
            onClick={handleBalancear}
            disabled={actionLoading || itemAtual.foi_balanceado}
            style={{
              padding: '1rem',
              background: itemAtual.foi_balanceado ? '#ccc' : '#ff9800',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: '700',
              cursor: itemAtual.foi_balanceado ? 'not-allowed' : 'pointer',
              opacity: actionLoading ? 0.7 : 1,
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => {
              if (!itemAtual.foi_balanceado && !actionLoading) {
                e.currentTarget.style.background = '#f57c00'
              }
            }}
            onMouseLeave={(e) => {
              if (!itemAtual.foi_balanceado) {
                e.currentTarget.style.background = '#ff9800'
              }
            }}
          >
            ⚖️ Balancear
          </button>

          <button
            onClick={handleBaixar}
            disabled={actionLoading || itemAtual.quantidade_baixada}
            style={{
              padding: '1rem',
              background: itemAtual.quantidade_baixada ? '#ccc' : '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: '700',
              cursor: itemAtual.quantidade_baixada ? 'not-allowed' : 'pointer',
              opacity: actionLoading ? 0.7 : 1,
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => {
              if (!itemAtual.quantidade_baixada && !actionLoading) {
                e.currentTarget.style.background = '#45a049'
              }
            }}
            onMouseLeave={(e) => {
              if (!itemAtual.quantidade_baixada) {
                e.currentTarget.style.background = '#4caf50'
              }
            }}
          >
            📦 Baixar
          </button>

          <button
            onClick={handleEspera}
            disabled={actionLoading}
            style={{
              padding: '1rem',
              background: itemAtual.em_espera ? '#ccc' : '#9c27b0',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: '700',
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              opacity: actionLoading ? 0.7 : 1,
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => {
              if (!actionLoading) {
                e.currentTarget.style.background = '#7b1fa2'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#9c27b0'
            }}
          >
            ⏸️ Espera
          </button>
        </div>

        {/* Botão Próximo */}
        <button
          onClick={proximoItem}
          disabled={indexItemAtual >= (inboundSelecionado.itens?.length || 0) - 1 || actionLoading}
          style={{
            width: '100%',
            padding: '1.2rem',
            background: indexItemAtual >= (inboundSelecionado.itens?.length || 0) - 1 ? '#ccc' : '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '700',
            cursor: indexItemAtual >= (inboundSelecionado.itens?.length || 0) - 1 ? 'not-allowed' : 'pointer',
            opacity: actionLoading ? 0.7 : 1,
            transition: 'all 0.3s'
          }}
          onMouseEnter={(e) => {
            if (indexItemAtual < (inboundSelecionado.itens?.length || 0) - 1 && !actionLoading) {
              e.currentTarget.style.background = '#1565c0'
            }
          }}
          onMouseLeave={(e) => {
            if (indexItemAtual < (inboundSelecionado.itens?.length || 0) - 1) {
              e.currentTarget.style.background = '#1976d2'
            }
          }}
        >
          {indexItemAtual >= (inboundSelecionado.itens?.length || 0) - 1 ? '✓ Inbound concluído!' : 'Próximo →'}
        </button>
      </div>
    </div>
  )
}
