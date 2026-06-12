import { useState, useEffect } from 'react'
import './ModalDetalhes.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface Historico {
  id: number
  quantidade_confirmada: number
  divergencia: string | null
  data_confirmacao: string
  vinculado_olist: string | null
  observacoes: string
}

interface ModalDetalhesProps {
  isOpen: boolean
  onClose: () => void
  produto: {
    id_item: number
    descricao: string
    codigo_produto: string
    quantidade_total: number
    quantidade_confirmada: number
    preco_unitario: number
    notas_fiscais: Array<{
      numero_nf: string
      serie: string
      fornecedor: string
      quantidade: number
    }>
  }
  onConfirm?: () => void
}

export function ModalDetalhes({
  isOpen,
  onClose,
  produto,
  onConfirm,
}: ModalDetalhesProps) {
  const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(
    produto.quantidade_total
  )
  const [temDivergencia, setTemDivergencia] = useState(false)
  const [divergencia, setDivergencia] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [historico, setHistorico] = useState<Historico[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    if (isOpen) {
      loadHistorico()
    }
  }, [isOpen, produto.id_item])

  const loadHistorico = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/historico-confirmacao/${produto.id_item}`
      )
      const data = await res.json()
      setHistorico(data.historico || [])
    } catch (err) {
      console.error('Erro ao carregar histórico:', err)
    }
  }

  const handleConfirmar = async () => {
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch(API_BASE + '/api/confirmar-estoque', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_id: produto.id_item,
          quantidade_confirmada: parseFloat(quantidadeConfirmada.toString()),
          divergencia: temDivergencia ? divergencia : null,
          observacoes: observacoes,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessageType('success')
        setMessage('Confirmação registrada com sucesso!')
        setQuantidadeConfirmada(produto.quantidade_total)
        setDivergencia('')
        setObservacoes('')
        setTemDivergencia(false)
        setTimeout(() => {
          loadHistorico()
          if (onConfirm) onConfirm()
        }, 1000)
      } else {
        setMessageType('error')
        setMessage(`Erro: ${data.error}`)
      }
    } catch (err) {
      setMessageType('error')
      setMessage(`Erro: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const divergenciaValor = produto.quantidade_total - quantidadeConfirmada

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Detalhes do Produto</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Info do Produto */}
          <div className="product-info">
            <h3>Informações do Produto</h3>
            <div className="info-row">
              <span className="info-label">Produto:</span>
              <span className="info-value">{produto.descricao}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Código:</span>
              <span className="info-value">{produto.codigo_produto}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Quantidade:</span>
              <span className="info-value">
                {produto.quantidade_total.toFixed(2)} unidades
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Preço Unit.:</span>
              <span className="info-value">
                R$ {produto.preco_unitario.toFixed(2)}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Valor Total:</span>
              <span className="info-value">
                R$ {(produto.quantidade_total * produto.preco_unitario).toFixed(2)}
              </span>
            </div>

            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #1e40af' }}>
              <h4 style={{ color: '#93c5fd', margin: '0 0 0.75rem 0', fontSize: '0.9rem' }}>
                Notas Fiscais
              </h4>
              <div className="nf-list">
                {produto.notas_fiscais.map((nf, idx) => (
                  <div key={idx} className="nf-badge">
                    <strong>NF {nf.numero_nf}</strong> - {nf.fornecedor} (
                    {nf.quantidade.toFixed(2)} un)
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mensagem de feedback */}
          {message && (
            <div className={messageType === 'success' ? 'success-message' : 'error-message'}>
              {message}
            </div>
          )}

          {/* Seção de Confirmação */}
          <div className="confirmation-section">
            <h3>Confirmar Recebimento</h3>

            <div className="form-group">
              <label className="form-label">Quantidade Recebida (un)</label>
              <input
                type="number"
                className="form-input"
                value={quantidadeConfirmada}
                onChange={(e) => setQuantidadeConfirmada(parseFloat(e.target.value) || 0)}
                step="0.01"
              />
            </div>

            {divergenciaValor !== 0 && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid #ef4444',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  color: '#fecaca',
                }}
              >
                ⚠️ <strong>Divergência:</strong> {Math.abs(divergenciaValor).toFixed(2)} unidades
              </div>
            )}

            <div className="form-group">
              <div className="checkbox-group">
                <div className="checkbox-item">
                  <input
                    type="checkbox"
                    id="temDivergencia"
                    checked={temDivergencia}
                    onChange={(e) => setTemDivergencia(e.target.checked)}
                  />
                  <label htmlFor="temDivergencia">Registrar divergência</label>
                </div>
              </div>
            </div>

            {temDivergencia && (
              <div className="form-group">
                <label className="form-label">Tipo de Divergência</label>
                <select
                  className="form-select"
                  value={divergencia}
                  onChange={(e) => setDivergencia(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  <option value="Quantidade Inferior">Quantidade Inferior (Recebido menos)</option>
                  <option value="Quantidade Superior">Quantidade Superior (Recebido mais)</option>
                  <option value="Produto Defeituoso">Produto Defeituoso</option>
                  <option value="Produto Errado">Produto Errado</option>
                  <option value="Dano no Transporte">Dano no Transporte</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Observações (opcional)</label>
              <textarea
                className="form-input"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Digite aqui qualquer observação adicional..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Seção Olist */}
          <div className="olist-section">
            <h3>Vincular a Anúncio Olist</h3>
            <div className="olist-info">
              Após confirmar o recebimento, você poderá vincular este produto a um anúncio na Olist.
            </div>
            <button className="btn btn-secondary" style={{ width: '100%' }}>
              + Criar/Vincular Anúncio Olist
            </button>
          </div>

          {/* Histórico */}
          {historico.length > 0 && (
            <div className="historico-section">
              <h3>Histórico de Confirmações</h3>
              {historico.map((item) => (
                <div key={item.id} className="historico-item">
                  <p className="historico-date">
                    {new Date(item.data_confirmacao).toLocaleString('pt-BR')}
                  </p>
                  <p className="historico-qty">
                    Confirmado: <strong>{item.quantidade_confirmada.toFixed(2)} un</strong>
                  </p>
                  {item.divergencia && (
                    <p className="historico-divergencia">
                      Divergência: {item.divergencia}
                    </p>
                  )}
                  {item.observacoes && (
                    <p style={{ color: '#999', fontSize: '0.8rem' }}>
                      {item.observacoes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Botões */}
          <div className="button-group">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirmar}
              disabled={loading}
            >
              {loading ? 'Processando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
