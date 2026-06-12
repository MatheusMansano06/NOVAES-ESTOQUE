import { useState, useEffect } from 'react'
import { listNotasFiscais, NotaFiscal, excluirMultiplasNotas, baixarNotaFiscal } from '../services/api'
import './NotaFiscalList.css'

interface NotaFiscalListProps {
  refresh: number
}

export default function NotaFiscalList({ refresh }: NotaFiscalListProps) {
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [deletando, setDeletando] = useState(false)

  const loadNotas = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listNotasFiscais()
      setNotas(response.items)
      setSelecionadas(new Set())
    } catch (err: any) {
      setError('Erro ao carregar notas fiscais')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotas()
  }, [refresh])

  const toggleSelecao = (notaId: number) => {
    const novo = new Set(selecionadas)
    if (novo.has(notaId)) {
      novo.delete(notaId)
    } else {
      novo.add(notaId)
    }
    setSelecionadas(novo)
  }

  const selecionarTodas = () => {
    if (selecionadas.size === notas.length) {
      setSelecionadas(new Set())
    } else {
      setSelecionadas(new Set(notas.map(n => n.id)))
    }
  }

  const handleExcluir = async () => {
    if (!window.confirm(`Tem certeza que deseja excluir ${selecionadas.size} nota(s)? Esta ação não pode ser desfeita.`)) {
      return
    }

    setDeletando(true)
    try {
      await excluirMultiplasNotas(Array.from(selecionadas))
      await loadNotas()
    } catch (err: any) {
      alert('Erro ao excluir notas: ' + (err.response?.data?.error || err.message))
    } finally {
      setDeletando(false)
    }
  }

  const handleBaixar = () => {
    selecionadas.forEach(notaId => {
      baixarNotaFiscal(notaId)
    })
  }

  if (loading) {
    return <div className="loading">Carregando...</div>
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  if (notas.length === 0) {
    return <div className="empty">Nenhuma nota fiscal processada ainda</div>
  }

  const todasSelecionadas = selecionadas.size === notas.length && notas.length > 0

  return (
    <div className="list-container">
      {selecionadas.size > 0 && (
        <div className="action-bar">
          <span className="selection-info">
            {selecionadas.size} selecionada{selecionadas.size !== 1 ? 's' : ''}
          </span>
          <div className="action-buttons">
            <button
              className="btn-action btn-download"
              onClick={handleBaixar}
              disabled={deletando}
              title="Baixar arquivos selecionados"
            >
              📥 Baixar ({selecionadas.size})
            </button>
            <button
              className="btn-action btn-delete"
              onClick={handleExcluir}
              disabled={deletando}
              title="Excluir notas selecionadas"
            >
              {deletando ? '...' : '🗑 Excluir'}
            </button>
          </div>
        </div>
      )}

      <div className="list-header">
        <label className="checkbox-all">
          <input
            type="checkbox"
            checked={todasSelecionadas}
            onChange={selecionarTodas}
            title="Selecionar/Desselecionar todas"
          />
          <span>Todas</span>
        </label>
      </div>

      <div className="list">
        {notas.map(nota => (
          <div key={nota.id} className={`nota-item ${selecionadas.has(nota.id) ? 'selected' : ''}`}>
            <div className="nota-checkbox">
              <input
                type="checkbox"
                checked={selecionadas.has(nota.id)}
                onChange={() => toggleSelecao(nota.id)}
              />
            </div>
            <div className="nota-content">
              <div className="nota-header">
                <h3>NF #{nota.numero_nf}</h3>
                <span className={`status-badge status-${nota.status}`}>
                  {nota.status}
                </span>
              </div>
              <div className="nota-details">
                <p><strong>Fornecedor:</strong> {nota.fornecedor}</p>
                <p><strong>Série:</strong> {nota.serie}</p>
                <p><strong>Itens:</strong> {nota.itens.length}</p>
                <p><strong>Data Upload:</strong> {new Date(nota.data_upload).toLocaleDateString('pt-BR')}</p>
              </div>
              <div className="items-preview">
                <h4>Produtos ({nota.itens.length})</h4>
                <div className="items-list">
                  {nota.itens.slice(0, 3).map(item => (
                    <div key={item.id} className="item-row">
                      <span className="item-desc">{item.descricao}</span>
                      <span className="item-qty">{item.quantidade_nf} un</span>
                    </div>
                  ))}
                  {nota.itens.length > 3 && (
                    <div className="item-more">
                      + {nota.itens.length - 3} mais...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
