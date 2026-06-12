import React, { useState, useEffect } from 'react'

interface FornecedorAlternativo {
  nome: string
  preco_unitario: number
  lead_time_dias: number
  frequencia_compra: number
  motivo_nao_recomendado?: string
}

interface Recomendacao {
  id: number
  urgencia: string
  sku_olist: string
  nome_produto: string
  estoque_atual: number
  quantidade_recomendada: number
  dias_ate_faltar: number
  frequencia_venda_diaria: number
  fornecedor_recomendado: string
  preco_unitario: number
  custo_total: number
  motivo: string
  fornecedores_alternativos: FornecedorAlternativo[]
}

interface ModalRecomendacaoDetalhesProps {
  isOpen: boolean
  onClose: () => void
  recomendacao: Recomendacao
  onConfirmarCompra: () => void
}

interface AnaliseDemanda {
  vendas_ultimos_7_dias: number
  vendas_ultimos_14_dias: number
  vendas_ultimos_30_dias: number
  media_diaria: number
  desvio_padrao: number
  tendencia: string
  crescimento_semana_anterior: number
  previsao_proximos_7_dias: number
}

interface EstoqueAtual {
  quantidade: number
  valor_total_custo: number
  valor_total_venda: number
  cobertura_dias: number
  status: string
}

interface RecomendacaoDetalhada {
  sku: string
  nome: string
  analise_demanda: AnaliseDemanda
  estoque_atual: EstoqueAtual
  fornecedores: any[]
  recomendacao_final: any
}

const ModalRecomendacaoDetalhes: React.FC<ModalRecomendacaoDetalhesProps> = ({
  isOpen,
  onClose,
  recomendacao,
  onConfirmarCompra
}) => {
  const [analiseDetalhada, setAnaliseDetalhada] = useState<RecomendacaoDetalhada | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [comprando, setComprando] = useState(false)

  useEffect(() => {
    if (isOpen && recomendacao) {
      loadAnaliseDetalhada()
    }
  }, [isOpen, recomendacao])

  const loadAnaliseDetalhada = async () => {
    try {
      setCarregando(true)
      const response = await fetch(
        `http://127.0.0.1:8000/api/recomendacoes/${recomendacao.sku_olist}`
      )

      if (!response.ok) {
        throw new Error('Erro ao carregar análise')
      }

      const data = await response.json()
      setAnaliseDetalhada(data)
    } catch (err) {
      console.error('Erro:', err)
      alert('Erro ao carregar análise detalhada')
    } finally {
      setCarregando(false)
    }
  }

  const handleComprarAgora = async () => {
    try {
      setComprando(true)

      const response = await fetch(
        `http://127.0.0.1:8000/api/recomendacoes/${recomendacao.sku_olist}/confirmar-compra`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quantidade: recomendacao.quantidade_recomendada,
            fornecedor: recomendacao.fornecedor_recomendado,
            observacoes: ''
          })
        }
      )

      if (!response.ok) {
        throw new Error('Erro ao confirmar compra')
      }

      alert(`✅ Pedido de ${recomendacao.quantidade_recomendada} unidades registrado!`)
      onConfirmarCompra()
      onClose()
    } catch (err) {
      alert('❌ Erro: ' + (err instanceof Error ? err.message : 'desconhecido'))
    } finally {
      setComprando(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '2rem',
          position: 'relative',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            backgroundColor: 'transparent',
            border: 'none',
            fontSize: '1.5rem',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          ✕
        </button>

        <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          {recomendacao.nome_produto} - Análise Detalhada
        </h2>

        {carregando ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p>⏳ Carregando análise...</p>
          </div>
        ) : analiseDetalhada ? (
          <>
            {/* ANÁLISE DE DEMANDA */}
            <div
              style={{
                backgroundColor: '#f9f9f9',
                padding: '1rem',
                borderRadius: '4px',
                marginBottom: '1.5rem'
              }}
            >
              <h3 style={{ marginTop: 0, color: '#007acc' }}>📈 ANÁLISE DE DEMANDA</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Últimos 7 dias:</strong> {analiseDetalhada.analise_demanda.vendas_ultimos_7_dias} un
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Últimos 30 dias:</strong> {analiseDetalhada.analise_demanda.vendas_ultimos_30_dias} un
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Média diária:</strong> {analiseDetalhada.analise_demanda.media_diaria.toFixed(2)} un/dia
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Previsão próximos 7 dias:</strong>{' '}
                    {analiseDetalhada.analise_demanda.previsao_proximos_7_dias} un
                  </p>
                </div>
              </div>
              <p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>
                <strong>Tendência:</strong> {analiseDetalhada.analise_demanda.tendencia}{' '}
                {analiseDetalhada.analise_demanda.crescimento_semana_anterior > 0
                  ? `(crescimento ${analiseDetalhada.analise_demanda.crescimento_semana_anterior.toFixed(1)}%)`
                  : ''}
              </p>
            </div>

            {/* ESTOQUE ATUAL */}
            <div
              style={{
                backgroundColor: '#f9f9f9',
                padding: '1rem',
                borderRadius: '4px',
                marginBottom: '1.5rem'
              }}
            >
              <h3 style={{ marginTop: 0, color: '#007acc' }}>📦 ESTOQUE ATUAL</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Quantidade:</strong> {analiseDetalhada.estoque_atual.quantidade} unidades
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Cobertura:</strong> {analiseDetalhada.estoque_atual.cobertura_dias.toFixed(1)} dias
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Valor total (custo):</strong> R${' '}
                    {analiseDetalhada.estoque_atual.valor_total_custo.toFixed(2)}
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Status:</strong>{' '}
                    <span
                      style={{
                        backgroundColor:
                          analiseDetalhada.estoque_atual.status === 'critico'
                            ? '#ffcdd2'
                            : '#fff9c4',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '3px'
                      }}
                    >
                      {analiseDetalhada.estoque_atual.status === 'critico' && '🔴 CRÍTICO'}
                      {analiseDetalhada.estoque_atual.status === 'moderado' && '🟡 MODERADO'}
                      {analiseDetalhada.estoque_atual.status === 'ok' && '🟢 OK'}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* FORNECEDORES */}
            <div
              style={{
                backgroundColor: '#f9f9f9',
                padding: '1rem',
                borderRadius: '4px',
                marginBottom: '1.5rem'
              }}
            >
              <h3 style={{ marginTop: 0, color: '#007acc' }}>🏪 FORNECEDORES DISPONÍVEIS</h3>

              {/* Melhor fornecedor */}
              {analiseDetalhada.fornecedores.length > 0 && (
                <div
                  style={{
                    backgroundColor: '#e8f5e9',
                    padding: '1rem',
                    borderRadius: '4px',
                    marginBottom: '1rem',
                    borderLeft: '4px solid #28a745'
                  }}
                >
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#28a745' }}>
                    ✅ RECOMENDADO: {analiseDetalhada.fornecedores[0]?.nome || recomendacao.fornecedor_recomendado}
                  </h4>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Preço:</strong> R$ {recomendacao.preco_unitario.toFixed(2)}/un (melhor!)
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Lead time:</strong> {analiseDetalhada.fornecedores[0]?.lead_time_dias || 'N/A'} dias
                  </p>
                  <p style={{ margin: '0.3rem 0' }}>
                    <strong>Comprado:</strong> {analiseDetalhada.fornecedores[0]?.frequencia_compra || 0}x antes (confiável)
                  </p>
                  {analiseDetalhada.fornecedores[0]?.historico_precos && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                      <strong>Histórico de preços:</strong>
                      {analiseDetalhada.fornecedores[0].historico_precos.map((p: any, idx: number) => (
                        <div key={idx}>
                          • {new Date(p.data).toLocaleDateString()}: R$ {p.preco.toFixed(2)} ({p.quantidade} un)
                        </div>
                      ))}
                      <div style={{ color: '#666', marginTop: '0.3rem' }}>
                        → {analiseDetalhada.fornecedores[0]?.tendencia_preco}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fornecedores alternativos */}
              {recomendacao.fornecedores_alternativos.map((f, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#fff3e0',
                    padding: '0.8rem',
                    borderRadius: '4px',
                    marginBottom: '0.8rem',
                    borderLeft: '4px solid #ff9800'
                  }}
                >
                  <h5 style={{ margin: '0 0 0.3rem 0' }}>ALT {idx + 1}: {f.nome}</h5>
                  <p style={{ margin: '0.2rem 0' }}>
                    Preço: R$ {f.preco_unitario.toFixed(2)}/un | Lead time: {f.lead_time_dias} dias | Comprado:{' '}
                    {f.frequencia_compra}x
                  </p>
                  <p style={{ margin: '0.2rem 0', color: '#d84315', fontSize: '0.85rem' }}>
                    ❌ {f.motivo_nao_recomendado}
                  </p>
                </div>
              ))}
            </div>

            {/* RECOMENDAÇÃO FINAL */}
            <div
              style={{
                backgroundColor: '#e3f2fd',
                padding: '1rem',
                borderRadius: '4px',
                borderLeft: '4px solid #007acc'
              }}
            >
              <h3 style={{ marginTop: 0, color: '#007acc' }}>🎯 RECOMENDAÇÃO FINAL</h3>
              {analiseDetalhada.recomendacao_final && (
                <div>
                  <div
                    style={{
                      backgroundColor: '#fff',
                      padding: '1rem',
                      borderRadius: '4px',
                      marginBottom: '1rem'
                    }}
                  >
                    <p style={{ margin: '0.3rem 0' }}>
                      <strong style={{ fontSize: '1.1em' }}>COMPRAR: {analiseDetalhada.recomendacao_final.comprar_quantidade} unidades</strong>
                    </p>
                    <p style={{ margin: '0.3rem 0' }}>
                      <strong>FORNECEDOR:</strong> {analiseDetalhada.recomendacao_final.fornecedor}
                    </p>
                    <p style={{ margin: '0.3rem 0' }}>
                      <strong>PREÇO:</strong> R$ {analiseDetalhada.recomendacao_final.preco_unitario.toFixed(2)}/un = R${' '}
                      {analiseDetalhada.recomendacao_final.custo_total.toFixed(2)} total
                    </p>
                    <p style={{ margin: '0.3rem 0' }}>
                      <strong>PRAZO:</strong> {analiseDetalhada.recomendacao_final.prazo_entrega_dias} dias →
                      Chegará em {new Date(analiseDetalhada.recomendacao_final.data_chegada_estimada).toLocaleDateString()}
                    </p>
                    <p style={{ margin: '0.3rem 0' }}>
                      <strong>COBERTURA APÓS COMPRA:</strong> {analiseDetalhada.recomendacao_final.cobertura_apos_compra} dias
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: '#666' }}>
            <p>Não foi possível carregar a análise detalhada.</p>
          </div>
        )}

        {/* Botões */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#fff',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Voltar
          </button>
          <button
            onClick={handleComprarAgora}
            disabled={comprando}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: comprando ? '#ccc' : '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: comprando ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {comprando ? '⏳ Processando...' : '✅ Comprar Agora'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalRecomendacaoDetalhes
