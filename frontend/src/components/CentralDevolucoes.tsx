import { useEffect, useState } from 'react'
import {
  listarDevolucoes, buscarDevolucao, sincronizarDevolucoes,
  DevolucaoResumo, DevolucaoDetalhe,
} from '../services/api'
import './CentralDevolucoes.css'

export function CentralDevolucoes() {
  const [lista, setLista] = useState<DevolucaoResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [detalhe, setDetalhe] = useState<DevolucaoDetalhe | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  async function carregarLista() {
    setCarregando(true)
    try {
      setLista(await listarDevolucoes())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregarLista() }, [])

  useEffect(() => {
    if (selecionadoId == null) {
      setDetalhe(null)
      return
    }
    buscarDevolucao(selecionadoId).then(setDetalhe)
  }, [selecionadoId])

  async function handleSincronizar() {
    setSincronizando(true)
    try {
      await sincronizarDevolucoes()
      await carregarLista()
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <div className="central-devolucoes">
      <div className="central-devolucoes__header">
        <h1>Central de Devoluções</h1>
        <button onClick={handleSincronizar} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </div>

      <div className="central-devolucoes__corpo">
        <table className="central-devolucoes__lista">
          <thead>
            <tr><th>Marketplace</th><th>Pedido</th><th>Status</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            {carregando && <tr><td colSpan={4}>Carregando...</td></tr>}
            {!carregando && lista.length === 0 && (
              <tr><td colSpan={4}>Nenhuma devolução sincronizada ainda.</td></tr>
            )}
            {lista.map((item) => (
              <tr
                key={item.id}
                className={item.id === selecionadoId ? 'selecionada' : ''}
                onClick={() => setSelecionadoId(item.id)}
              >
                <td>{item.marketplace}</td>
                <td>{item.order_id}</td>
                <td>{item.status_marketplace}</td>
                <td>{item.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {detalhe && (
          <div className="central-devolucoes__detalhe">
            <h2>Devolução #{detalhe.id} — {detalhe.marketplace}</h2>
            <p>Pedido: {detalhe.order_id} · Claim: {detalhe.claim_id}</p>
            <p>Status: {detalhe.status_marketplace} · Motivo: {detalhe.motivo}</p>

            <h3>Itens</h3>
            <ul>
              {detalhe.itens.map((item, i) => (
                <li key={i}>{item.sku_esperado} — {item.produto_nome} (qtd {item.quantidade})</li>
              ))}
            </ul>

            <h3>Rastreio</h3>
            <ul>
              {detalhe.eventos.map((evento, i) => (
                <li key={i}>{evento.data_hora} — {evento.status} ({evento.origem})</li>
              ))}
            </ul>

            <h3>Vínculo Olist</h3>
            {detalhe.olist ? (
              <p>
                {detalhe.olist.produto_nome_olist} · CMV R$ {detalhe.olist.cmv.toFixed(2)} ·
                {' '}Estoque {detalhe.olist.estoque_disponivel ?? '—'}
              </p>
            ) : (
              <p>Sem vínculo ainda.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
