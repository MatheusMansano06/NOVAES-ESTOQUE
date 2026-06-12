import { useState } from 'react'
import './ModalDetalhes.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

// ===== NÚMERO DE WHATSAPP DO FORNECEDOR/RESPONSÁVEL =====
// Formato: código do país (55) + DDD + número, somente dígitos.
// Ex: 55 + 19 + 978149245 = 5519978149245
const NUMERO_WHATSAPP = '5519978149245'

interface Produto {
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

interface ModalDetalhesNotaProps {
  isOpen: boolean
  onClose: () => void
  produto: Produto
  notaNota: any
  onNaoConfirmado?: (qtdConfirmada: number) => void
  onDivergenciaConfirmada?: (qtdConfirmada: number) => void
}

export function ModalDetalhesNota({
  isOpen,
  onClose,
  produto,
  notaNota,
  onNaoConfirmado,
  onDivergenciaConfirmada,
}: ModalDetalhesNotaProps) {
  const [quantidadeConfirmada, setQuantidadeConfirmada] = useState<string>(
    Math.round(produto.quantidade_confirmada || produto.quantidade_total).toString()
  )
  const [loading, setLoading] = useState(false)
  const [observacoes, setObservacoes] = useState('')

  if (!isOpen) return null

  const qtdConfirmada = parseFloat(quantidadeConfirmada) || 0
  const divergencia = produto.quantidade_total - qtdConfirmada
  const temDivergencia = Math.abs(divergencia) > 0.01

  const handleConfirmar = async () => {
    // Pré-abre a aba do WhatsApp AINDA no clique do usuário (evita bloqueio de pop-up).
    // Só preenchemos a URL depois que a divergência for registrada.
    let janelaWhatsApp: Window | null = null
    if (temDivergencia) {
      janelaWhatsApp = window.open('', '_blank')
    }

    setLoading(true)
    try {
      if (temDivergencia) {
        // === FLUXO COM DIVERGÊNCIA ===
        let tipo = 'a_menos'
        if (qtdConfirmada > produto.quantidade_total) {
          tipo = 'a_mais'
        } else if (qtdConfirmada === 0) {
          tipo = 'nao_veio'
        }

        let textoMensagem = `⚠️ DIVERGÊNCIA NA NOTA FISCAL\n\n`
        textoMensagem += `Produto: ${produto.descricao}\n`
        textoMensagem += `Código: ${produto.codigo_produto}\n`
        textoMensagem += `Esperado: ${Math.round(produto.quantidade_total)} un\n`
        textoMensagem += `Recebido: ${Math.round(qtdConfirmada)} un\n`

        if (tipo === 'a_mais') {
          textoMensagem += `Situação: Quantidade MAIOR\n`
          textoMensagem += `Diferença: +${Math.round(Math.abs(divergencia))} un\n`
        } else if (tipo === 'a_menos') {
          textoMensagem += `Situação: Quantidade MENOR\n`
          textoMensagem += `Diferença: -${Math.round(Math.abs(divergencia))} un\n`
        } else if (tipo === 'nao_veio') {
          textoMensagem += `Situação: Produto NÃO CHEGOU\n`
        }

        if (observacoes) {
          textoMensagem += `\nObservações: ${observacoes}\n`
        }

        // Registrar divergência
        const resDivergencia = await fetch(API_BASE + '/api/registrar-divergencia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: produto.id_item,
            quantidade_confirmada: qtdConfirmada,
            tipo_divergencia: tipo,
            observacoes: observacoes,
            mensagem_whatsapp: textoMensagem,
          }),
        })

        if (!resDivergencia.ok) {
          alert('❌ Erro ao registrar divergência')
          if (janelaWhatsApp) janelaWhatsApp.close()
          return
        }

        await resDivergencia.json()

        // Preenche a aba do WhatsApp (já aberta no clique) com a mensagem pronta
        const urlWhatsApp = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(textoMensagem)}`
        if (janelaWhatsApp) {
          janelaWhatsApp.location.href = urlWhatsApp
        } else {
          // fallback caso o navegador tenha bloqueado a pré-abertura
          window.open(urlWhatsApp, '_blank')
        }

        alert(`✅ Divergência registrada!\n\nAbri o WhatsApp com a mensagem pronta. É só clicar em ENVIAR na conversa.\n\nDepois vamos vincular na Olist e subir ${Math.round(qtdConfirmada)} un.`)

        // Callback para ir direto vincular/subir na Olist com a qtd recebida
        if (onDivergenciaConfirmada) {
          onDivergenciaConfirmada(qtdConfirmada)
        }
      } else {
        // === FLUXO SEM DIVERGÊNCIA (quantidade correta) ===
        // Persistir a confirmação no backend (marca como conferido)
        const resConf = await fetch(API_BASE + '/api/confirmar-estoque', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: produto.id_item,
            quantidade_confirmada: qtdConfirmada,
            divergencia: null,
            observacoes: observacoes,
          }),
        })

        if (!resConf.ok) {
          alert('❌ Erro ao confirmar quantidade')
          return
        }

        alert('✅ Quantidade confirmada com sucesso!')

        // Callback para ir para próxima etapa
        if (onNaoConfirmado) {
          onNaoConfirmado(qtdConfirmada)
        }
      }
    } catch (err) {
      alert('❌ Erro: ' + err)
    } finally {
      setLoading(false)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Conferência de Produto</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
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
              <span className="info-label">Quantidade Esperada:</span>
              <span className="info-value">{Math.round(produto.quantidade_total)} un</span>
            </div>
            <div className="info-row">
              <span className="info-label">Preço Unit.:</span>
              <span className="info-value">R$ {produto.preco_unitario.toFixed(2)}</span>
            </div>
          </div>

          {/* QUANTIDADE RECEBIDA */}
          <div className="confirmation-section">
            <h3>Quantidade Recebida</h3>
            <div className="form-group">
              <label className="form-label">Quantos itens foram recebidos?</label>
              <input
                type="text"
                className="form-input"
                value={quantidadeConfirmada}
                onChange={(e) => {
                  const val = e.target.value
                  // Permitir apenas números e ponto
                  if (val === '' || !isNaN(parseFloat(val))) {
                    setQuantidadeConfirmada(val)
                  }
                }}
                placeholder="Digite a quantidade"
                disabled={loading}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '1rem',
                  letterSpacing: '0.5px'
                }}
              />
            </div>
          </div>

          {/* DIVERGÊNCIA DETECTADA */}
          {temDivergencia && (
            <>
              <div
                style={{
                  background: 'rgba(220, 53, 69, 0.1)',
                  border: '1px solid #dc3545',
                  padding: '1rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  color: '#721c24',
                }}
              >
                <strong style={{ fontSize: '1rem' }}>⚠️ DIVERGÊNCIA DETECTADA</strong>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.95rem' }}>
                  {divergencia > 0
                    ? `Quantidade ${Math.round(Math.abs(divergencia))} un MENOR que o esperado`
                    : `Quantidade ${Math.round(Math.abs(divergencia))} un MAIOR que o esperado`
                  }
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.8 }}>
                  Uma mensagem será enviada automaticamente com estes detalhes.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Observações (opcional)</label>
                <textarea
                  className="form-input"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Digite aqui qualquer observação adicional..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                  disabled={loading}
                />
              </div>
            </>
          )}

          <div className="button-group">
            <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirmar}
              disabled={loading}
            >
              {loading
                ? 'Processando...'
                : temDivergencia
                  ? 'Confirmar e Registrar Divergência'
                  : 'Confirmar'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
