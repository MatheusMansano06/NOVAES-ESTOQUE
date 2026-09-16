import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface ProdutoTipo {
  id: string | number
  sku: string
  nome: string
  situacao: string
  tipo: string
}

interface ItemFiscal {
  sku: string
  nome: string
  produto_id: string | number
  item_id: string
  shopee_item_id: string
  olist_ncm: string
  ml_ncm: string
  shopee_ncm: string
  olist_gtin: string
  ml_ean: string
  ml_cest: string
  sem_dados_ml: boolean
  sem_dados_shopee: boolean
  divergencias: string[]
  status: 'correto' | 'divergente' | 'sem_dados_ml'
}

const LABEL_TIPO: Record<string, string> = { S: 'Simples', K: 'Kit', F: 'Fabricado', M: 'Matéria-prima', V: 'Variação' }
const labelTipo = (tipo: string) => LABEL_TIPO[tipo] || tipo || '(desconhecido)'

const CORES_TIPO: Record<string, string> = { S: '#2d3277', K: '#c62828', F: '#2e7d32', M: '#8d6e00', V: '#6a1b9a' }
const corTipo = (tipo: string) => CORES_TIPO[tipo] || '#888'

const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }

function chipStyle(ativo: boolean, cor = '#2d3277'): React.CSSProperties {
  return {
    padding: '0.4rem 0.9rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
    border: ativo ? `1px solid ${cor}` : '1px solid #dfe3e8',
    background: ativo ? cor : '#fff',
    color: ativo ? '#fff' : '#444',
    cursor: 'pointer',
  }
}

function PieChart({ fatias, tamanho = 140 }: { fatias: Array<{ valor: number; cor: string }>; tamanho?: number }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0)
  let acc = 0
  const stops = fatias.map((f) => {
    const inicio = total ? (acc / total) * 360 : 0
    acc += f.valor
    const fim = total ? (acc / total) * 360 : 0
    return `${f.cor} ${inicio}deg ${fim}deg`
  })
  return (
    <div
      style={{
        width: tamanho, height: tamanho, borderRadius: '50%', flexShrink: 0,
        background: total > 0 ? `conic-gradient(${stops.join(', ')})` : '#eee',
      }}
    />
  )
}

// Botão de legenda: bolinha da cor + rótulo, usado junto do gráfico de pizza.
function LegendaBotao({ ativo, cor, onClick, children }: { ativo: boolean; cor: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
        padding: '0.35rem 0.6rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700,
        border: ativo ? `1px solid ${cor}` : '1px solid transparent',
        background: ativo ? `${cor}18` : 'transparent',
        color: '#333', cursor: 'pointer',
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cor, flexShrink: 0 }} />
      {children}
    </button>
  )
}

const norm = (v: string) => (v || '').replace(/\D/g, '')

// Modal por item: escolhe Olist/ML/ambos, mostra se já bate, corrige só o que
// estiver diferente — se os dois já baterem, não chama nenhuma API.
function ModalCorrigirFiscal({ item, onClose, onSalvo }: {
  item: ItemFiscal
  onClose: () => void
  onSalvo: (patch: Partial<ItemFiscal>) => void
}) {
  const [corrigirOlist, setCorrigirOlist] = useState(true)
  const [corrigirMl, setCorrigirMl] = useState(true)
  const [corrigirShopee, setCorrigirShopee] = useState(!!item.shopee_item_id)
  const [ncm, setNcm] = useState(item.olist_ncm || item.ml_ncm || item.shopee_ncm || '')
  const [cest, setCest] = useState(item.ml_cest || '')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const olistBate = !!ncm.trim() && norm(item.olist_ncm) === norm(ncm)
  const mlBate = !!ncm.trim() && norm(item.ml_ncm) === norm(ncm) && !!cest.trim() && (item.ml_cest || '').trim() === cest.trim()
  const shopeeBate = !!ncm.trim() && norm(item.shopee_ncm) === norm(ncm)

  const salvar = async () => {
    setMsg(null)
    if (!corrigirOlist && !corrigirMl && !corrigirShopee) { setMsg({ tipo: 'erro', texto: 'Escolha pelo menos uma plataforma.' }); return }
    if (!ncm.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o NCM.' }); return }
    if (corrigirMl && !cest.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o CEST para corrigir no Mercado Livre.' }); return }

    const precisaOlist = corrigirOlist && !olistBate
    const precisaMl = corrigirMl && !mlBate
    const precisaShopee = corrigirShopee && !!item.shopee_item_id && !shopeeBate
    if (!precisaOlist && !precisaMl && !precisaShopee) {
      setMsg({ tipo: 'ok', texto: '✅ Já está 100% concluído — nada para corrigir.' })
      return
    }

    setSalvando(true)
    try {
      const body: Record<string, unknown> = { ncm: ncm.trim() }
      if (precisaOlist) body.produto_id = item.produto_id
      if (precisaMl) { body.item_id = item.item_id; body.cest = cest.trim() }
      if (precisaShopee) body.shopee_item_id = item.shopee_item_id

      const r = await fetch(`${API_BASE}/api/fiscal/atualizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok || !d.sucesso) {
        const partes = [d.olist?.erro, d.ml?.erro, d.shopee?.erro].filter(Boolean)
        throw new Error(partes.join(' | ') || 'Falha ao corrigir')
      }
      onSalvo({
        olist_ncm: precisaOlist ? ncm.trim() : item.olist_ncm,
        ml_ncm: precisaMl ? ncm.trim() : item.ml_ncm,
        ml_cest: precisaMl ? cest.trim() : item.ml_cest,
        shopee_ncm: precisaShopee ? ncm.trim() : item.shopee_ncm,
        sem_dados_ml: precisaMl ? false : item.sem_dados_ml,
        sem_dados_shopee: precisaShopee ? false : item.sem_dados_shopee,
      })
      setMsg({ tipo: 'ok', texto: '✅ Corrigido com sucesso.' })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: String(e instanceof Error ? e.message : e) })
    } finally {
      setSalvando(false)
    }
  }

  // Portal pro <body>: o modal fica dentro de um .card com backdrop-filter,
  // que "prende" position:fixed relativo à altura do card inteiro (a tabela
  // toda) em vez do viewport — por isso aparecia no meio da rolagem, não da
  // tela visível.
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: '14px', padding: '1.4rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 0.25rem' }}>Corrigir dados fiscais</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#667085' }}>{item.nome} — SKU {item.sku}</p>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem', borderRadius: '8px', background: '#f7f8fa', marginBottom: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={corrigirOlist} onChange={(e) => setCorrigirOlist(e.target.checked)} />
          <span style={{ fontSize: '0.85rem' }}>
            <strong>Olist</strong> — NCM atual: {item.olist_ncm || 'vazio'} {olistBate && <span style={{ color: '#2e7d32' }}>✅ bate</span>}
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem', borderRadius: '8px', background: '#f7f8fa', marginBottom: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={corrigirMl} onChange={(e) => setCorrigirMl(e.target.checked)} />
          <span style={{ fontSize: '0.85rem' }}>
            <strong>Mercado Livre</strong> — NCM atual: {item.ml_ncm || 'vazio'}, CEST atual: {item.ml_cest || 'faltando'} {mlBate && <span style={{ color: '#2e7d32' }}>✅ bate</span>}
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem', borderRadius: '8px', background: item.shopee_item_id ? '#f7f8fa' : '#fafafa', marginBottom: '1rem', cursor: item.shopee_item_id ? 'pointer' : 'default', opacity: item.shopee_item_id ? 1 : 0.6 }}>
          <input type="checkbox" checked={corrigirShopee} disabled={!item.shopee_item_id} onChange={(e) => setCorrigirShopee(e.target.checked)} />
          <span style={{ fontSize: '0.85rem' }}>
            <strong>Shopee</strong> — {item.shopee_item_id
              ? <>NCM atual: {item.shopee_ncm || 'vazio'} {shopeeBate && <span style={{ color: '#2e7d32' }}>✅ bate</span>}</>
              : 'sem anúncio nesse SKU'}
          </span>
        </label>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>NCM desejado</label>
          <input value={ncm} onChange={(e) => setNcm(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
        </div>

        {corrigirMl && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#667085', display: 'block', marginBottom: '0.25rem' }}>CEST desejado (Mercado Livre)</label>
            <input value={cest} onChange={(e) => setCest(e.target.value)} placeholder="ex.: 0100700" style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
          </div>
        )}

        {msg && (
          <div style={{ marginBottom: '1rem', color: msg.tipo === 'erro' ? '#c62828' : '#2e7d32', fontWeight: 700, fontSize: '0.85rem' }}>
            {msg.texto}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #dfe3e8', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Fechar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            style={{ padding: '0.5rem 1.2rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ===== Seção 1: Classificação Kit x Simples =====
function SecaoTipos() {
  const [itens, setItens] = useState<ProdutoTipo[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [palavra, setPalavra] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      await fetch(`${API_BASE}/api/olist/produtos-tipos/iniciar`, { method: 'POST' })
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/olist/produtos-tipos`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          setFiltroTipo(null)
          break
        }
        if (d.status === 'erro') throw new Error(d.erro || 'Falha na varredura')
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradosPorPalavra = palavra.trim()
    ? itens.filter((i) => i.nome.toLowerCase().includes(palavra.trim().toLowerCase()))
    : itens

  const contagem = new Map<string, number>()
  for (const item of filtradosPorPalavra) {
    contagem.set(item.tipo || '', (contagem.get(item.tipo || '') || 0) + 1)
  }
  const grupos = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1])
  const total = filtradosPorPalavra.length

  const filtrados = filtroTipo === null
    ? filtradosPorPalavra
    : filtradosPorPalavra.filter((i) => (i.tipo || '') === filtroTipo)

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-body" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Classificação dos anúncios: Simples x Kit</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              value={palavra}
              onChange={(e) => { setPalavra(e.target.value); setFiltroTipo(null) }}
              placeholder="Filtrar por palavra (ex.: KIT)"
              style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cfd8dc', minWidth: 220 }}
            />
            <button
              type="button"
              onClick={carregar}
              disabled={carregando}
              style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {carregando ? 'Carregando...' : 'Recarregar'}
            </button>
          </div>
        </div>

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!carregando && total === 0 && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>
            {palavra.trim() ? `Nenhum produto com "${palavra}" no título.` : 'Nenhum produto encontrado.'}
          </div>
        )}

        {total > 0 && (
          <>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <PieChart fatias={grupos.map(([tipo, qtd]) => ({ valor: qtd, cor: corTipo(tipo) }))} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <LegendaBotao ativo={filtroTipo === null} cor="#444" onClick={() => setFiltroTipo(null)}>
                  Todos: {total} (100%)
                </LegendaBotao>
                {grupos.map(([tipo, qtd]) => (
                  <LegendaBotao key={tipo} ativo={filtroTipo === tipo} cor={corTipo(tipo)} onClick={() => setFiltroTipo(tipo)}>
                    {labelTipo(tipo)}: {qtd} ({total ? Math.round((qtd * 1000) / total) / 10 : 0}%)
                  </LegendaBotao>
                ))}
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Nome</th>
                    <th style={th}>SKU</th>
                    <th style={th}>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item) => (
                    <tr key={item.id}>
                      <td style={td}>{item.nome}</td>
                      <td style={td}>{item.sku}</td>
                      <td style={td}>
                        <span style={{ color: corTipo(item.tipo), fontWeight: 700 }}>{labelTipo(item.tipo)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ===== Seção 2: Dados fiscais ML x Olist =====
function SecaoFiscal() {
  const [itens, setItens] = useState<ItemFiscal[]>([])
  const [resumo, setResumo] = useState<{ total: number; corretos: number; divergentes: number; sem_dados_ml: number } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'correto' | 'divergente' | 'sem_dados_ml'>('divergente')
  const [jaRodou, setJaRodou] = useState(false)
  const [ncmDesejado, setNcmDesejado] = useState('65070000')
  const [cestDesejado, setCestDesejado] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [emMassa, setEmMassa] = useState<{ total: number; feito: number } | null>(null)
  const [itemModal, setItemModal] = useState<ItemFiscal | null>(null)

  const comparar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      await fetch(`${API_BASE}/api/fiscal/ml-olist/iniciar`, { method: 'POST' })
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const r = await fetch(`${API_BASE}/api/fiscal/ml-olist`, { cache: 'no-store' })
        const d = await r.json()
        if (d.status === 'pronto') {
          setItens(d.resultado?.itens || [])
          setResumo(d.resultado ? { total: d.resultado.total, corretos: d.resultado.corretos, divergentes: d.resultado.divergentes, sem_dados_ml: d.resultado.sem_dados_ml } : null)
          setJaRodou(true)
          break
        }
        if (d.status === 'erro') throw new Error(d.erro || 'Falha na comparação')
      }
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  const itensExibidos = filtro === 'todos' ? itens : itens.filter((i) => i.status === filtro)

  // Corrige na Olist e no ML numa chamada só; devolve null em sucesso ou a mensagem de erro.
  const executarCorrecao = async (item: ItemFiscal): Promise<string | null> => {
    try {
      const r = await fetch(`${API_BASE}/api/fiscal/atualizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produto_id: item.produto_id,
          item_id: item.item_id,
          shopee_item_id: item.shopee_item_id || undefined,
          ncm: ncmDesejado,
          cest: cestDesejado.trim() || undefined,
        }),
      })
      const d = await r.json()
      if (!r.ok || !d.sucesso) {
        const partes = [d.olist?.erro, d.ml?.erro, d.shopee?.erro].filter(Boolean)
        throw new Error(partes.join(' | ') || 'Falha ao corrigir')
      }
      const cestNovo = d.ml?.cest_novo
      setItens((prev) => prev.map((p) => (
        p.item_id === item.item_id
          ? {
              ...p,
              olist_ncm: ncmDesejado,
              ml_ncm: ncmDesejado,
              ml_cest: cestNovo != null ? cestNovo : p.ml_cest,
              shopee_ncm: p.shopee_item_id ? ncmDesejado : p.shopee_ncm,
              sem_dados_ml: false,
              sem_dados_shopee: p.shopee_item_id ? false : p.sem_dados_shopee,
              divergencias: p.divergencias.filter((x) => x !== 'ncm' && x !== 'ncm_shopee'),
              status: p.divergencias.filter((x) => x !== 'ncm' && x !== 'ncm_shopee').length ? 'divergente' : 'correto',
            }
          : p
      )))
      return null
    } catch (e) {
      return String(e instanceof Error ? e.message : e)
    }
  }

  const toggleSelecionado = (itemId: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(itemId)) novo.delete(itemId)
      else novo.add(itemId)
      return novo
    })
  }

  const corrigiveis = itensExibidos.filter((i) => i.status === 'divergente' || i.status === 'sem_dados_ml')
  const todosSelecionados = corrigiveis.length > 0 && corrigiveis.every((i) => selecionados.has(i.item_id))

  const alternarSelecaoTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(corrigiveis.map((i) => i.item_id)))
  }

  const corrigirSelecionadosEmMassa = async () => {
    const alvos = itens.filter((i) => selecionados.has(i.item_id))
    if (alvos.length === 0) return
    if (!ncmDesejado.trim() || !cestDesejado.trim()) {
      alert('Preencha o NCM e o CEST desejados antes de corrigir — o CEST muda junto com o NCM, sempre.')
      return
    }
    if (!window.confirm(`Corrigir NCM de ${alvos.length} produto(s) selecionado(s) para ${ncmDesejado} e CEST para ${cestDesejado.trim()} no ML, na Olist e no ML?`)) return

    setEmMassa({ total: alvos.length, feito: 0 })
    const erros: string[] = []
    for (const item of alvos) {
      const erroItem = await executarCorrecao(item)
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Dados fiscais: Mercado Livre x Olist x Shopee</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#667085' }}>
              Casa por SKU e compara NCM e GTIN/EAN cadastrados em cada plataforma.
            </p>
          </div>
          <button
            type="button"
            onClick={comparar}
            disabled={carregando}
            style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#2d3277', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {carregando ? 'Comparando... (pode levar alguns minutos)' : jaRodou ? 'Comparar de novo' : 'Comparar agora'}
          </button>
        </div>

        {erro && <div style={{ color: '#c62828', marginBottom: '0.75rem' }}>{erro}</div>}

        {!jaRodou && !carregando && !erro && (
          <div style={{ color: '#999', padding: '1rem 0' }}>
            Clique em "Comparar agora" — a varredura chama a API do ML e da Olist produto a produto, por isso demora mais.
          </div>
        )}

        {resumo && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {([
                ['todos', `Todos (${resumo.total})`, '#444'],
                ['correto', `Corretos (${resumo.corretos})`, '#2e7d32'],
                ['divergente', `Divergentes (${resumo.divergentes})`, '#c62828'],
                ['sem_dados_ml', `Sem dados no ML (${resumo.sem_dados_ml})`, '#8d6e00'],
              ] as const).map(([valor, label, cor]) => (
                <button key={valor} type="button" onClick={() => setFiltro(valor)} style={chipStyle(filtro === valor, cor)}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.75rem', padding: '0.75rem', background: '#f7f8fa', borderRadius: '8px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#667085', display: 'block', marginBottom: '0.2rem' }}>NCM desejado (Olist + ML)</label>
                <input value={ncmDesejado} onChange={(e) => setNcmDesejado(e.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#667085', display: 'block', marginBottom: '0.2rem' }}>CEST desejado (ML) — muda sempre junto com o NCM</label>
                <input value={cestDesejado} onChange={(e) => setCestDesejado(e.target.value)} placeholder="ex.: 0100700" style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
              </div>
              {corrigiveis.length > 0 && (
                <button
                  type="button"
                  onClick={corrigirSelecionadosEmMassa}
                  disabled={selecionados.size === 0 || !ncmDesejado.trim() || !cestDesejado.trim() || !!emMassa}
                  title={!cestDesejado.trim() ? 'Preencha o CEST desejado' : undefined}
                  style={{
                    marginLeft: 'auto', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                    background: (selecionados.size === 0 || !ncmDesejado.trim() || !cestDesejado.trim()) ? '#e0a0a0' : '#c62828', color: '#fff',
                    fontWeight: 700, fontSize: '0.82rem', cursor: (selecionados.size === 0 || !ncmDesejado.trim() || !cestDesejado.trim()) ? 'default' : 'pointer',
                  }}
                >
                  {emMassa ? `Corrigindo ${emMassa.feito}/${emMassa.total}...` : `Corrigir selecionados (${selecionados.size})`}
                </button>
              )}
            </div>

            {itensExibidos.length === 0 ? (
              <div style={{ color: '#999', padding: '1rem 0' }}>Nenhum item nesse filtro.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>
                        {corrigiveis.length > 0 && (
                          <input type="checkbox" checked={todosSelecionados} onChange={alternarSelecaoTodos} />
                        )}
                      </th>
                      <th style={th}>Nome</th>
                      <th style={th}>SKU</th>
                      <th style={th}>NCM Olist</th>
                      <th style={th}>NCM ML</th>
                      <th style={th}>NCM Shopee</th>
                      <th style={th}>GTIN Olist</th>
                      <th style={th}>EAN ML</th>
                      <th style={th}>CEST ML</th>
                      <th style={th}>Status</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensExibidos.map((item) => {
                      const corrigivel = item.status === 'divergente' || item.status === 'sem_dados_ml'
                      return (
                      <tr key={item.item_id}>
                        <td style={td}>
                          {corrigivel && (
                            <input
                              type="checkbox"
                              checked={selecionados.has(item.item_id)}
                              onChange={() => toggleSelecionado(item.item_id)}
                              disabled={!!emMassa}
                            />
                          )}
                        </td>
                        <td style={td}>{item.nome}</td>
                        <td style={td}>{item.sku}</td>
                        <td style={{ ...td, color: item.divergencias.includes('ncm') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('ncm') ? 700 : 400 }}>
                          {item.olist_ncm || <em style={{ color: '#999' }}>vazio</em>}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('ncm') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('ncm') ? 700 : 400 }}>
                          {item.sem_dados_ml ? <em style={{ color: '#999' }}>sem dados</em> : (item.ml_ncm || <em style={{ color: '#999' }}>vazio</em>)}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('ncm_shopee') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('ncm_shopee') ? 700 : 400 }}>
                          {!item.shopee_item_id ? <em style={{ color: '#bbb' }}>sem anúncio</em> : (item.shopee_ncm || <em style={{ color: '#999' }}>vazio</em>)}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('gtin') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('gtin') ? 700 : 400 }}>
                          {item.olist_gtin || <em style={{ color: '#999' }}>vazio</em>}
                        </td>
                        <td style={{ ...td, color: item.divergencias.includes('gtin') ? '#c62828' : undefined, fontWeight: item.divergencias.includes('gtin') ? 700 : 400 }}>
                          {item.sem_dados_ml ? <em style={{ color: '#999' }}>sem dados</em> : (item.ml_ean || <em style={{ color: '#999' }}>vazio</em>)}
                        </td>
                        <td style={td}>
                          {item.sem_dados_ml
                            ? <em style={{ color: '#999' }}>sem dados</em>
                            : (item.ml_cest || <em style={{ color: '#c62828', fontWeight: 700 }}>faltando</em>)}
                        </td>
                        <td style={td}>
                          {item.status === 'correto' && <span style={{ color: '#2e7d32', fontWeight: 700 }}>✅ Correto</span>}
                          {item.status === 'divergente' && <span style={{ color: '#c62828', fontWeight: 700 }}>⚠️ Divergente</span>}
                          {item.status === 'sem_dados_ml' && <span style={{ color: '#8d6e00', fontWeight: 700 }}>— Sem dados no ML</span>}
                        </td>
                        <td style={td}>
                          {corrigivel && (
                            <button
                              type="button"
                              onClick={() => setItemModal(item)}
                              disabled={!!emMassa}
                              style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: 'none', background: '#c62828', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                            >
                              Corrigir
                            </button>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {itemModal && (
        <ModalCorrigirFiscal
          item={itemModal}
          onClose={() => setItemModal(null)}
          onSalvo={(patch) => {
            setItens((prev) => prev.map((p) => (p.item_id === itemModal.item_id ? { ...p, ...patch } : p)))
            setItemModal((prev) => (prev ? { ...prev, ...patch } : prev))
          }}
        />
      )}
    </div>
  )
}

// Cada seção agora é a própria página (menu separado) — juntas numa só
// página davam uma rolagem enorme (tabelas grandes uma embaixo da outra).
export function PaginaClassificacaoTipos() {
  return <SecaoTipos />
}

export function PaginaFiscalMlOlist() {
  return <SecaoFiscal />
}
