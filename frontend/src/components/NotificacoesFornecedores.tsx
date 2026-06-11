import React, { useState, useEffect } from 'react'
import api from '../services/api'

export interface Notificacao {
  id: number
  fornecedor_id: number
  fornecedor_nome: string
  produto_codigo: string
  produto_descricao: string
  quantidade_atual: number
  estoque_minimo: number
  telefone_usado: string
  enviado_em: string
  status: string
  erro_mensagem?: string
}

export const NotificacoesFornecedores: React.FC = () => {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [loading, setLoading] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    carregarNotificacoes()
  }, [])

  const carregarNotificacoes = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/historico-notificacoes', {
        params: { skip: 0, limit: 100 }
      })
      setNotificacoes(response.data.notificacoes)
    } catch (err: any) {
      setError('Erro ao carregar notificações: ' + (err.response?.data?.error || 'Desconhecido'))
    } finally {
      setLoading(false)
    }
  }

  const handleNotificarAgora = async () => {
    setEnviando(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await api.post('/notificar-fornecedores', {})

      if (response.data.notificacoes_enviadas > 0) {
        setSuccessMessage(`✓ ${response.data.notificacoes_enviadas} notificação(ões) registrada(s) e pronta(s) para enviar!`)
      } else {
        setSuccessMessage('✓ Verificação concluída. Nenhum produto com estoque baixo no momento.')
      }

      // Recarregar histórico
      await carregarNotificacoes()
    } catch (err: any) {
      setError('Erro ao notificar fornecedores: ' + (err.response?.data?.error || 'Desconhecido'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2>📲 Notificações de Fornecedores</h2>
        <p style={{ color: '#666', marginBottom: '15px' }}>
          Gestão de notificações automáticas de estoque baixo via WhatsApp.
          Notificações são enviadas automaticamente todos os dias às 08:00.
        </p>

        <button
          onClick={handleNotificarAgora}
          disabled={enviando || loading}
          style={{
            padding: '12px 24px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: enviando ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            opacity: enviando || loading ? 0.6 : 1
          }}
        >
          {enviando ? '⏳ Notificando...' : '🔔 Notificar Fornecedores Agora'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#ffebee',
          color: '#c62828',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          {error}
        </div>
      )}

      {successMessage && (
        <div style={{
          padding: '12px',
          backgroundColor: '#e8f5e9',
          color: '#2e7d32',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          {successMessage}
        </div>
      )}

      <h3 style={{ marginTop: '30px', marginBottom: '15px' }}>Histórico de Notificações</h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          Carregando histórico...
        </div>
      ) : notificacoes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
          Nenhuma notificação registrada ainda.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            backgroundColor: 'white',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Data/Hora</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Fornecedor</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Produto</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Estoque</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>WhatsApp</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {notificacoes.map(n => (
                <tr key={n.id} style={{
                  borderBottom: '1px solid #eee',
                }}>
                  <td style={{ padding: '12px' }}>
                    {new Date(n.enviado_em).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <strong>{n.fornecedor_nome}</strong>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <div>{n.produto_descricao}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      Código: {n.produto_codigo}
                    </div>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <div>
                      <span style={{
                        padding: '4px 8px',
                        backgroundColor: '#ffebee',
                        color: '#c62828',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        {n.quantidade_atual} / {n.estoque_minimo}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <a
                      href={`https://wa.me/${n.telefone_usado}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: '#25D366',
                        textDecoration: 'none',
                        fontWeight: 'bold'
                      }}
                    >
                      💬 {n.telefone_usado}
                    </a>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 8px',
                      backgroundColor: n.status === 'enviado' ? '#c8e6c9' : '#ffe0b2',
                      color: n.status === 'enviado' ? '#2e7d32' : '#e65100',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {n.status === 'enviado' ? '✓ Enviada' : '⚠ ' + n.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
