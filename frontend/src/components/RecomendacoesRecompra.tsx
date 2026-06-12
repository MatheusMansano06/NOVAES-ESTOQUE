import React, { useState, useEffect } from 'react'
import ModalRecomendacaoDetalhes from './ModalRecomendacaoDetalhes'

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

interface RecomendacoesRecompraProps {
  onVoltar: () => void
}

const RecomendacoesRecompra: React.FC<RecomendacoesRecompraProps> = ({ onVoltar }) => {
  const [recomendacoes, setRecomendacoes] = useState<Recomendacao[]>([])
  const [filtroUrgencia, setFiltroUrgencia] = useState<'todos' | 'critico' | 'moderado' | 'ok'>('todos')
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [selecionada, setSelecionada] = useState<Recomendacao | null>(null)
  const [modalAberto, setModalAberto] = useState(false)

  // Carregar recomendações ao montar
  useEffect(() => {
    loadRecomendacoes()
  }, [filtroUrgencia])

  const loadRecomendacoes = async () => {
    try {
      setCarregando(true)
      setErro(null)

      const params = new URLSearchParams()
      if (filtroUrgencia !== 'todos') {
        params.append('filtro', filtroUrgencia)
      }

      const response = await fetch(`http://127.0.0.1:8000/api/recomendacoes?${params}`)
      if (!response.ok) {
        throw new Error('Erro ao carregar recomendações')
      }

      const data = await response.json()
      setRecomendacoes(data.recomendacoes || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setCarregando(false)
    }
  }

  const atualizarRecomendacoes = async () => {
    try {
      setAtualizando(true)
      const response = await fetch('http://127.0.0.1:8000/api/recomendacoes/gerar', {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('Erro ao atualizar recomendações')
      }

      await loadRecomendacoes()
      alert('✅ Recomendações atualizadas com sucesso!')
    } catch (err) {
      alert('❌ Erro ao atualizar: ' + (err instanceof Error ? err.message : 'desconhecido'))
    } finally {
      setAtualizando(false)
    }
  }

  const abrirDetalhes = (recomendacao: Recomendacao) => {
    setSelecionada(recomendacao)
    setModalAberto(true)
  }

  const fecharModal = () => {
    setModalAberto(false)
    setSelecionada(null)
  }

  const handleCompraConfirmada = () => {
    fecharModal()
    loadRecomendacoes()
  }

  // Agrupar por urgência
  const recomendacoesPorUrgencia = {
    critico: recomendacoes.filter(r => r.urgencia === 'critico'),
    moderado: recomendacoes.filter(r => r.urgencia === 'moderado'),
    ok: recomendacoes.filter(r => r.urgencia === 'ok')
  }

  const renderizarCard = (rec: Recomendacao) => {
    const borderColor = {
      critico: '#f44336',
      moderado: '#ff9800',
      ok: '#4caf50'
    }[rec.urgencia]

    const backgroundColor = {
      critico: '#ffebee',
      moderado: '#fff3e0',
      ok: '#e8f5e9'
    }[rec.urgencia]

    return (
      <div
        key={rec.id}
        style={{
          borderLeft: `4px solid ${borderColor}`,
          backgroundColor: backgroundColor,
          padding: '1rem',
          marginBottom: '1rem',
          borderRadius: '4px',
          border: `1px solid ${borderColor}20`
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#1a1a1a' }}>
              {rec.nome_produto}
            </h4>
            <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
              Estoque: <strong>{rec.estoque_atual} un</strong> | Vende:{' '}
              <strong>{rec.frequencia_venda_diaria.toFixed(1)}/dia</strong> | Falta em:{' '}
              <strong>{rec.dias_ate_faltar.toFixed(1)}d</strong>
            </div>
            <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.8rem' }}>
              <strong>Recomendação:</strong> Compre {rec.quantidade_recomendada} unidades
            </div>
            <div
              style={{
                backgroundColor: '#fff',
                padding: '0.75rem',
                borderRadius: '4px',
                marginBottom: '0.8rem',
                fontSize: '0.85rem'
              }}
            >
              <div style={{ fontWeight: 'bold', color: '#28a745', marginBottom: '0.3rem' }}>
                ✅ {rec.fornecedor_recomendado} @ R$ {rec.preco_unitario.toFixed(2)}/un = R${' '}
                {rec.custo_total.toFixed(2)}
              </div>
              <div style={{ color: '#999' }}>{rec.motivo}</div>
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              marginLeft: '1rem',
              minWidth: '80px'
            }}
          >
            <div
              style={{
                backgroundColor: borderColor,
                color: '#fff',
                padding: '0.3rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                marginBottom: '0.5rem'
              }}
            >
              {rec.urgencia === 'critico' && '🔴 CRÍTICO'}
              {rec.urgencia === 'moderado' && '🟡 MODERADO'}
              {rec.urgencia === 'ok' && '🟢 OK'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-start' }}>
          <button
            onClick={() => abrirDetalhes(rec)}
            style={{
              padding: '0.4rem 0.8rem',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
          >
            Ver Detalhes
          </button>
          <button
            onClick={() => abrirDetalhes(rec)}
            style={{
              padding: '0.4rem 0.8rem',
              backgroundColor: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
          >
            Comprar Agora ▶
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <button
              onClick={onVoltar}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                marginRight: '1rem'
              }}
            >
              ← Voltar
            </button>
            <h1 style={{ display: 'inline-block', margin: '0' }}>
              🛒 RECOMENDAÇÕES DE RECOMPRA
            </h1>
          </div>
          <button
            onClick={atualizarRecomendacoes}
            disabled={atualizando}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: atualizando ? '#ccc' : '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: atualizando ? 'not-allowed' : 'pointer'
            }}
          >
            {atualizando ? '⏳ Atualizando...' : '🔄 Atualizar Agora'}
          </button>
        </div>

        {/* Filtros */}
        <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setFiltroUrgencia('todos')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: filtroUrgencia === 'todos' ? '#007acc' : '#fff',
              color: filtroUrgencia === 'todos' ? '#fff' : '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Todos ({recomendacoes.length})
          </button>
          <button
            onClick={() => setFiltroUrgencia('critico')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: filtroUrgencia === 'critico' ? '#f44336' : '#fff',
              color: filtroUrgencia === 'critico' ? '#fff' : '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🔴 Crítico ({recomendacoesPorUrgencia.critico.length})
          </button>
          <button
            onClick={() => setFiltroUrgencia('moderado')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: filtroUrgencia === 'moderado' ? '#ff9800' : '#fff',
              color: filtroUrgencia === 'moderado' ? '#fff' : '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🟡 Moderado ({recomendacoesPorUrgencia.moderado.length})
          </button>
          <button
            onClick={() => setFiltroUrgencia('ok')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: filtroUrgencia === 'ok' ? '#4caf50' : '#fff',
              color: filtroUrgencia === 'ok' ? '#fff' : '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🟢 Ok ({recomendacoesPorUrgencia.ok.length})
          </button>
        </div>

        {/* Mensagens */}
        {erro && (
          <div
            style={{
              backgroundColor: '#ffebee',
              color: '#c62828',
              padding: '1rem',
              borderRadius: '4px',
              marginBottom: '1rem'
            }}
          >
            ❌ Erro: {erro}
          </div>
        )}

        {carregando ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p>⏳ Carregando recomendações...</p>
          </div>
        ) : filtroUrgencia === 'todos' ? (
          <>
            {/* CRÍTICO */}
            {recomendacoesPorUrgencia.critico.length > 0 && (
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ color: '#f44336', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #f44336' }}>
                  🔴 CRÍTICO ({recomendacoesPorUrgencia.critico.length}) - Compre HOJE
                </h2>
                {recomendacoesPorUrgencia.critico.map(renderizarCard)}
              </div>
            )}

            {/* MODERADO */}
            {recomendacoesPorUrgencia.moderado.length > 0 && (
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ color: '#ff9800', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #ff9800' }}>
                  🟡 MODERADO ({recomendacoesPorUrgencia.moderado.length}) - Próximos 5-7 dias
                </h2>
                {recomendacoesPorUrgencia.moderado.map(renderizarCard)}
              </div>
            )}

            {/* OK */}
            {recomendacoesPorUrgencia.ok.length > 0 && (
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ color: '#4caf50', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #4caf50' }}>
                  🟢 OK ({recomendacoesPorUrgencia.ok.length}) - Estoque para 15+ dias
                </h2>
                {recomendacoesPorUrgencia.ok.map(renderizarCard)}
              </div>
            )}

            {recomendacoes.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                <p>😊 Ótimo! Nenhuma recomendação urgente no momento. Seu estoque está saudável!</p>
              </div>
            )}
          </>
        ) : recomendacoes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
            <p>Nenhuma recomendação nesta categoria.</p>
          </div>
        ) : (
          recomendacoes.map(renderizarCard)
        )}
      </div>

      {/* Modal de Detalhes */}
      {selecionada && (
        <ModalRecomendacaoDetalhes
          isOpen={modalAberto}
          onClose={fecharModal}
          recomendacao={selecionada}
          onConfirmarCompra={handleCompraConfirmada}
        />
      )}
    </div>
  )
}

export default RecomendacoesRecompra
