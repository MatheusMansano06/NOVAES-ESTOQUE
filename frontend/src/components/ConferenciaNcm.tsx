import { useState, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ItemNcm {
  id: string | number
  sku: string
  nome: string
  situacao: string
  tipo: string
  ncm_atual: string
  shopee_item_id: string
  shopee_ncm: string
  bate: boolean
}

const LABEL_TIPO: Record<string, string> = { S: 'Simples', K: 'Kit', F: 'Fabricado', M: 'Matéria-prima' }
const labelTipo = (tipo: string) => LABEL_TIPO[tipo] || tipo || '(desconhecido)'

function chipStyle(ativo: boolean): React.CSSProperties {
  return {
    padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700,
    border: ativo ? '1px solid #2d3277' : '1px solid #dfe3e8',
    background: ativo ? '#2d3277' : '#fff',
    color: ativo ? '#fff' : '#444',
    cursor: 'pointer',
  }
}

function FiltroChips({ label, total, opcoes, selecionado, onSelecionar }: {
  label: string
  total: number
  opcoes: Array<[string, number, string]> // [valor, contagem, rótulo]
  selecionado: string | null
  onSelecionar: (valor: string | null) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.75rem', color: '#667085', marginRight: '0.25rem' }}>{label}:</span>
      <button type="button" onClick={() => onSelecionar(null)} style={chipStyle(!selecionado)}>
        Todos ({total})
      </button>
      {opcoes.map(([valor, qtd, rotulo]) => (
        <button key={valor} type="button" onClick={() => onSelecionar(valor)} style={chipStyle(selecionado === valor)}>
          {rotulo} ({qtd})
        </button>
      ))}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }

export function ConferenciaNcm() {
  const [termo, setTermo] = useState('Viseira')
  const [ncmEsperado, setNcmEsperado] = useState('65070000')
  const [itens, setItens] = useState<ItemNcm[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [atualizandoId, setAtualizandoId] = useState<string | number | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string | number>>(new Set())
  const [emMassa, setEmMassa] = useState<{ total: number; feito: number } | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'divergentes' | 'batem'>('divergentes')
  const [filtroNcmAtual, setFiltroNcmAtual] = useState<string | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null)

  const buscar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const params = new URLSearchParams({ termo, ncm_esperado: ncmEsperado })
      await fetch(`${API_BASE}/api/olist/conferencia-ncm/iniciar?${params}`, { method: 'POST' })

      // A varredura roda em background (1 request por produto, throttle da
      // Olist) — faz polling do status em vez de esperar tudo numa request só.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/olist/conferencia-ncm`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          setSelecionados(new Set())
          setFiltroNcmAtual(null)
          setFiltroTipo(null)
          break
        }
        if (d.status === 'erro') {
          throw new Error(d.erro || 'Falha na varredura')
        }
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [termo, ncmEsperado])

  useEffect(() => { buscar() }, [])

  // Faz a chamada em si; devolve null em sucesso ou a mensagem de erro.
  const executarAlteracao = async (item: ItemNcm): Promise<string | null> => {
    try {
      const r = await fetch(`${API_BASE}/api/olist/atualizar-ncm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: item.id, ncm: ncmEsperado, shopee_item_id: item.shopee_item_id || undefined }),
      })
      const d = await r.json()
      if (!r.ok || !d.sucesso) throw new Error(d.erro || 'Falha ao atualizar NCM')
      setItens((prev) => prev.map((p) => (p.id === item.id ? { ...p, ncm_atual: ncmEsperado, shopee_ncm: p.shopee_item_id ? ncmEsperado : p.shopee_ncm, bate: true } : p)))
      return null
    } catch (e) {
      return String(e instanceof Error ? e.message : e)
    }
  }

  const alterarNcm = async (item: ItemNcm) => {
    if (!window.confirm(`Alterar o NCM de "${item.nome}" (SKU ${item.sku}) de ${item.ncm_atual || 'vazio'} para ${ncmEsperado}?`)) return
    setAtualizandoId(item.id)
    const erroItem = await executarAlteracao(item)
    setAtualizandoId(null)
    if (erroItem) alert('❌ ' + erroItem)
  }

  const toggleSelecionado = (id: string | number) => {
    setSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const divergentes = itens.filter((i) => !i.bate)
  const batem = itens.filter((i) => i.bate)
  const itensPorStatus = filtroStatus === 'divergentes' ? divergentes : filtroStatus === 'batem' ? batem : itens

  // Agrupa por NCM atual (ex.: "6506.10.10", "8714.10.00", vazio) e por tipo
  // (Simples/Kit) dentro do filtro de status já aplicado, pra isolar cada grupo.
  const contagemPorNcm = new Map<string, number>()
  const contagemPorTipo = new Map<string, number>()
  for (const item of itensPorStatus) {
    const chaveNcm = item.ncm_atual || '(vazio)'
    contagemPorNcm.set(chaveNcm, (contagemPorNcm.get(chaveNcm) || 0) + 1)
    contagemPorTipo.set(item.tipo || '', (contagemPorTipo.get(item.tipo || '') || 0) + 1)
  }
  const gruposNcm = Array.from(contagemPorNcm.entries()).sort((a, b) => b[1] - a[1])
  const gruposTipo = Array.from(contagemPorTipo.entries()).sort((a, b) => b[1] - a[1])

  const itensExibidos = itensPorStatus
    .filter((i) => !filtroNcmAtual || (i.ncm_atual || '(vazio)') === filtroNcmAtual)
    .filter((i) => filtroTipo === null || (i.tipo || '') === filtroTipo)

  const todosDivergentesSelecionados = divergentes.length > 0 && divergentes.every((i) => selecionados.has(i.id))

  const alternarSelecaoTodos = () => {
    setSelecionados(todosDivergentesSelecionados ? new Set() : new Set(divergentes.map((i) => i.id)))
  }

  const alterarSelecionadosEmMassa = async () => {
    const alvos = itens.filter((i) => selecionados.has(i.id) && !i.bate)
    if (alvos.length === 0) return
    if (!window.confirm(`Alterar o NCM de ${alvos.length} produto(s) selecionado(s) para ${ncmEsperado}?`)) return

    setEmMassa({ total: alvos.length, feito: 0 })
    const erros: string[] = []
    for (const item of alvos) {
      const erroItem = await executarAlteracao(item)
      if (erroItem) erros.push(`${item.sku}: ${erroItem}`)
      setEmMassa((prev) => (prev ? { ...prev, feito: prev.feito + 1 } : prev))
    }
    setEmMassa(null)
    setSelecionados(new Set())
    if (erros.length > 0) {
      alert(`❌ ${erros.length} de ${alvos.length} falharam:\n` + erros.slice(0, 10).join('\n'))
    }
  }

  return (
    <div className="card">
      <div className="card-body" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>Título contém</label>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>NCM esperado</label>
            <input value={ncmEsperado} onChange={(e) => setNcmEsperado(e.target.value)} style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
          </div>
          <button
            type="button"
            onClick={buscar}
            disabled={carregando}
            style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {carregando ? 'Buscando...' : 'Buscar'}
          </button>
          {itens.length > 0 && (
            <span style={{ fontSize: '0.82rem', color: divergentes.length > 0 ? '#c62828' : '#2e7d32', fontWeight: 700 }}>
              {itens.length} anúncio(s) · {divergentes.length} com NCM divergente
            </span>
          )}
        </div>

        {itens.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {([
              ['todos', `Todos (${itens.length})`],
              ['divergentes', `Divergentes (${divergentes.length})`],
              ['batem', `Batem (${batem.length})`],
            ] as const).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => { setFiltroStatus(valor); setFiltroNcmAtual(null); setFiltroTipo(null) }}
                style={{
                  padding: '0.4rem 0.9rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
                  border: filtroStatus === valor ? '1px solid #2d3277' : '1px solid #dfe3e8',
                  background: filtroStatus === valor ? '#2d3277' : '#fff',
                  color: filtroStatus === valor ? '#fff' : '#444',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}

            {divergentes.length > 0 && (
              <button
                type="button"
                onClick={alterarSelecionadosEmMassa}
                disabled={selecionados.size === 0 || !!emMassa}
                style={{
                  marginLeft: 'auto', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                  background: selecionados.size === 0 ? '#e0a0a0' : '#c62828', color: '#fff',
                  fontWeight: 700, fontSize: '0.82rem', cursor: selecionados.size === 0 ? 'default' : 'pointer',
                }}
              >
                {emMassa ? `Alterando ${emMassa.feito}/${emMassa.total}...` : `Alterar NCM dos selecionados (${selecionados.size})`}
              </button>
            )}
          </div>
        )}

        {gruposNcm.length > 1 && (
          <FiltroChips
            label="NCM atual"
            total={itensPorStatus.length}
            opcoes={gruposNcm.map(([ncm, qtd]) => [ncm, qtd, ncm] as [string, number, string])}
            selecionado={filtroNcmAtual}
            onSelecionar={setFiltroNcmAtual}
          />
        )}

        {gruposTipo.length > 1 && (
          <FiltroChips
            label="Tipo"
            total={itensPorStatus.length}
            opcoes={gruposTipo.map(([tipo, qtd]) => [tipo, qtd, labelTipo(tipo)] as [string, number, string])}
            selecionado={filtroTipo}
            onSelecionar={setFiltroTipo}
          />
        )}

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!carregando && itens.length === 0 && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>Nenhum anúncio encontrado com "{termo}" no título.</div>
        )}

        {!carregando && itens.length > 0 && itensExibidos.length === 0 && (
          <div style={{ color: '#999', padding: '1rem 0' }}>Nenhum item nesse filtro.</div>
        )}

        {itensExibidos.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>
                    {divergentes.length > 0 && (
                      <input type="checkbox" checked={todosDivergentesSelecionados} onChange={alternarSelecaoTodos} />
                    )}
                  </th>
                  <th style={th}>Nome</th>
                  <th style={th}>SKU</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>NCM Olist</th>
                  <th style={th}>NCM Shopee</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {itensExibidos.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>
                      {!item.bate && (
                        <input
                          type="checkbox"
                          checked={selecionados.has(item.id)}
                          onChange={() => toggleSelecionado(item.id)}
                          disabled={!!emMassa}
                        />
                      )}
                    </td>
                    <td style={td}>{item.nome}</td>
                    <td style={td}>{item.sku}</td>
                    <td style={td}>{labelTipo(item.tipo)}</td>
                    <td style={td}>{item.ncm_atual || <em style={{ color: '#999' }}>vazio</em>}</td>
                    <td style={td}>
                      {item.shopee_item_id
                        ? (item.shopee_ncm || <em style={{ color: '#999' }}>vazio</em>)
                        : <em style={{ color: '#bbb' }}>sem anúncio</em>}
                    </td>
                    <td style={td}>
                      {item.bate ? (
                        <span style={{ color: '#2e7d32', fontWeight: 700 }}>✅ Bate</span>
                      ) : (
                        <span style={{ color: '#c62828', fontWeight: 700 }}>⚠️ Divergente</span>
                      )}
                    </td>
                    <td style={td}>
                      {!item.bate && (
                        <button
                          type="button"
                          onClick={() => alterarNcm(item)}
                          disabled={atualizandoId === item.id || !!emMassa}
                          style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: 'none', background: '#c62828', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                        >
                          {atualizandoId === item.id ? 'Alterando...' : 'Alterar NCM'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
