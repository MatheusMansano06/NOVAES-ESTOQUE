import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Criterio = 'dimensao' | 'toda_venda'
interface Embalagem {
  id: number; nome: string; criterio: Criterio
  altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null
  estoque_atual: number; estoque_minimo: number; custo_medio: number
  url_compra: string | null; ativo: number; observacao: string | null
}
interface Produto {
  item_id: string; sku: string | null; titulo: string | null; imagem: string | null
  dimensoes: string | null; tem_dimensao: boolean
  caixa_id: number | null; caixa_nome: string | null; origem: 'auto' | 'manual' | 'sem'
}
interface Movimento {
  id: number; embalagem: string | null; sku: string | null
  quantidade: number; motivo: string; descricao: string | null; data: string | null
}

const fmtR$ = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDataHora = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const btn = (bg: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  padding: '0.4rem 0.8rem', borderRadius: '8px', border: 'none', background: bg, color: '#fff',
  fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', ...extra,
})
const inputStyle: React.CSSProperties = { padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc', width: '100%', boxSizing: 'border-box' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: '14px', padding: '1.4rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }

export function EstoqueEmbalagens() {
  const [aba, setAba] = useState<'embalagens' | 'produtos' | 'historico'>('embalagens')
  const [embalagens, setEmbalagens] = useState<Embalagem[]>([])
  const [resumo, setResumo] = useState({ total: 0, ativas: 0, em_baixa: 0 })
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [resumoProd, setResumoProd] = useState({ total: 0, sem_caixa: 0, caixas_ativas: 0 })
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [erro, setErro] = useState('')
  const [buscaProd, setBuscaProd] = useState('')

  const [editando, setEditando] = useState<Partial<Embalagem> | null>(null)
  const [comprando, setComprando] = useState<Embalagem | null>(null)
  const [ajustando, setAjustando] = useState<Embalagem | null>(null)

  const carregarEmbalagens = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/embalagens`, { cache: 'no-store' })
      const d = await r.json()
      setEmbalagens(d.embalagens || []); setResumo(d.resumo || { total: 0, ativas: 0, em_baixa: 0 })
    } catch (e) { setErro(String(e)) }
  }, [])
  const carregarProdutos = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/embalagens/produtos`, { cache: 'no-store' })
      const d = await r.json()
      setProdutos(d.itens || []); setResumoProd(d.resumo || { total: 0, sem_caixa: 0, caixas_ativas: 0 })
    } catch (e) { setErro(String(e)) }
  }, [])
  const carregarMovimentos = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/embalagens/movimentos?limit=200`, { cache: 'no-store' })
      const d = await r.json(); setMovimentos(d.movimentos || [])
    } catch (e) { setErro(String(e)) }
  }, [])

  useEffect(() => { carregarEmbalagens() }, [carregarEmbalagens])
  useEffect(() => { if (aba === 'produtos') carregarProdutos() }, [aba, carregarProdutos])
  useEffect(() => { if (aba === 'historico') carregarMovimentos() }, [aba, carregarMovimentos])

  const salvarEmbalagem = async () => {
    if (!editando?.nome?.trim()) { setErro('Dê um nome à embalagem'); return }
    try {
      const r = await fetch(`${API_BASE}/api/embalagens`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editando),
      })
      const d = await r.json(); if (d.erro) throw new Error(d.erro)
      setEditando(null); await carregarEmbalagens()
    } catch (e) { setErro(String(e instanceof Error ? e.message : e)) }
  }
  const processarBaixas = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/embalagens/processar-baixas`, { method: 'POST' })
      const d = await r.json()
      alert(d.resumo ? `Baixas processadas!\nVendas novas: ${d.resumo.vendas_novas}\nCaixas: ${d.resumo.baixas_caixa} · Inserts: ${d.resumo.baixas_insert}\nSem caixa: ${d.resumo.sem_embalagem}` : 'Processado.')
      await carregarEmbalagens()
    } catch (e) { setErro(String(e)) }
  }
  const vincular = async (sku: string, embalagem_id: number | null) => {
    try {
      await fetch(`${API_BASE}/api/embalagens/vinculo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, embalagem_id }),
      })
      await carregarProdutos()
    } catch (e) { setErro(String(e)) }
  }

  const caixas = embalagens.filter(e => e.criterio === 'dimensao' && e.ativo)
  const produtosFiltrados = produtos.filter(p => !buscaProd.trim() || `${p.sku} ${p.titulo}`.toLowerCase().includes(buscaProd.trim().toLowerCase()))

  const chip = (label: string, valor: number, cor: string, bg: string) => (
    <div style={{ padding: '0.4rem 0.8rem', borderRadius: '999px', background: bg, color: cor, fontWeight: 700, fontSize: '0.82rem' }}>{label}: <strong>{valor}</strong></div>
  )
  const tab = (id: typeof aba, label: string) => (
    <button onClick={() => setAba(id)} style={{ padding: '0.5rem 1rem', border: 'none', borderBottom: aba === id ? '3px solid #1a237e' : '3px solid transparent', background: 'none', fontWeight: 700, color: aba === id ? '#1a237e' : '#78909c', cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {chip('Embalagens', resumo.ativas, '#1a237e', '#e8eaf6')}
        {chip('Em baixa', resumo.em_baixa, '#c62828', '#ffebee')}
        {resumoProd.sem_caixa > 0 && chip('Produtos sem caixa', resumoProd.sem_caixa, '#ef6c00', '#fff3e0')}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditando({ criterio: 'dimensao', estoque_minimo: 0 })} style={btn('#1a237e')}>+ Nova embalagem</button>
        <button onClick={processarBaixas} style={btn('#00695c')} title="Desconta agora as embalagens das vendas novas">↻ Processar baixas</button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #eceff1' }}>
        {tab('embalagens', 'Minhas embalagens')}
        {tab('produtos', 'Produtos & caixa')}
        {tab('historico', 'Histórico')}
      </div>

      {erro && <div style={{ padding: '0.7rem 1rem', borderRadius: '10px', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>{erro} <button onClick={() => setErro('')} style={{ float: 'right', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button></div>}

      {/* ===== MINHAS EMBALAGENS ===== */}
      {aba === 'embalagens' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
          {embalagens.length === 0 && <div style={{ color: '#90a4ae', padding: '2rem' }}>Nenhuma embalagem cadastrada ainda. Clique em “+ Nova embalagem”.</div>}
          {embalagens.map(e => {
            const baixo = e.ativo === 1 && e.estoque_atual <= e.estoque_minimo
            return (
              <div key={e.id} style={{ border: `1px solid ${baixo ? '#ef9a9a' : '#e0e0e0'}`, borderLeft: `5px solid ${baixo ? '#e53935' : (e.criterio === 'dimensao' ? '#3949ab' : '#8e24aa')}`, borderRadius: '12px', padding: '0.9rem', background: '#fff', opacity: e.ativo ? 1 : 0.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                  <strong style={{ fontSize: '0.95rem' }}>{e.nome}</strong>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '999px', background: e.criterio === 'dimensao' ? '#e8eaf6' : '#f3e5f5', color: e.criterio === 'dimensao' ? '#3949ab' : '#8e24aa' }}>
                    {e.criterio === 'dimensao' ? '📦 caixa' : '🎁 toda venda'}
                  </span>
                </div>
                {e.criterio === 'dimensao' && (
                  <div style={{ fontSize: '0.72rem', color: '#78909c', marginTop: '0.3rem' }}>
                    {e.altura_cm ? `${e.altura_cm} × ${e.largura_cm} × ${e.comprimento_cm} cm` : 'sem dimensões definidas'}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '1.7rem', fontWeight: 900, color: baixo ? '#c62828' : '#1a1a1a' }}>{e.estoque_atual}</span>
                  <span style={{ fontSize: '0.72rem', color: '#90a4ae' }}>em estoque {baixo && '· BAIXO!'}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#455a64', marginTop: '0.2rem' }}>custo médio <strong>{fmtR$(e.custo_medio)}</strong> / un</div>
                {e.url_compra && <a href={e.url_compra} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#1565c0' }}>🔗 link da compra</a>}
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
                  <button onClick={() => setComprando(e)} style={btn('#2e7d32', { fontSize: '0.74rem' })}>+ Comprar</button>
                  <button onClick={() => setAjustando(e)} style={btn('#546e7a', { fontSize: '0.74rem' })}>Ajustar</button>
                  <button onClick={() => setEditando(e)} style={btn('#3949ab', { fontSize: '0.74rem' })}>Editar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== PRODUTOS & CAIXA ===== */}
      {aba === 'produtos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <input placeholder="🔎 buscar SKU ou título" value={buscaProd} onChange={e => setBuscaProd(e.target.value)} style={{ ...inputStyle, maxWidth: 320 }} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#78909c', borderBottom: '1px solid #eceff1' }}>
                  <th style={{ padding: '0.5rem' }}>Produto</th><th>Dimensões</th><th>Caixa reconhecida</th><th>Forçar caixa</th>
                </tr>
              </thead>
              <tbody>
                {produtosFiltrados.slice(0, 300).map(p => (
                  <tr key={p.item_id} style={{ borderBottom: '1px solid #f5f5f5', background: p.origem === 'sem' ? '#fff8e1' : undefined }}>
                    <td style={{ padding: '0.5rem', maxWidth: 260 }}>
                      <div style={{ fontWeight: 700 }}>{p.sku || '—'}</div>
                      <div style={{ color: '#90a4ae', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{p.titulo}</div>
                    </td>
                    <td style={{ color: p.tem_dimensao ? '#455a64' : '#bdbdbd' }}>{p.dimensoes || 'sem dimensão'}</td>
                    <td>
                      {p.caixa_nome
                        ? <span style={{ fontWeight: 700, color: p.origem === 'manual' ? '#8e24aa' : '#2e7d32' }}>{p.caixa_nome} {p.origem === 'manual' ? '(manual)' : '(auto)'}</span>
                        : <span style={{ color: '#ef6c00', fontWeight: 700 }}>a definir</span>}
                    </td>
                    <td>
                      <select value={p.origem === 'manual' ? String(p.caixa_id) : ''} onChange={ev => p.sku && vincular(p.sku, ev.target.value ? Number(ev.target.value) : null)} style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #cfd8dc' }}>
                        <option value="">auto (por dimensão)</option>
                        {caixas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== HISTÓRICO ===== */}
      {aba === 'historico' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {movimentos.length === 0 && <div style={{ color: '#90a4ae', padding: '1.5rem' }}>Sem movimentações ainda.</div>}
          {movimentos.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0.7rem', borderRadius: '8px', background: '#fafafa' }}>
              <span style={{ fontSize: '0.7rem', color: '#90a4ae', width: 90 }}>{fmtDataHora(m.data)}</span>
              <span style={{ fontWeight: 700, minWidth: 60, color: m.quantidade < 0 ? '#c62828' : '#2e7d32' }}>{m.quantidade > 0 ? '+' : ''}{m.quantidade}</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '999px', background: m.motivo === 'venda' ? '#e3f2fd' : m.motivo === 'compra' ? '#e8f5e9' : '#f3e5f5', color: '#455a64' }}>{m.motivo}</span>
              <span style={{ fontWeight: 600 }}>{m.embalagem}</span>
              <span style={{ color: '#90a4ae', fontSize: '0.78rem' }}>{m.descricao}</span>
            </div>
          ))}
        </div>
      )}

      {/* ===== MODAL NOVA/EDITAR ===== */}
      {editando && (
        <div style={overlay} onClick={() => setEditando(null)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>{editando.id ? 'Editar embalagem' : 'Nova embalagem'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <input placeholder="Nome (ex: Caixa P, Folheto A5)" value={editando.nome || ''} onChange={e => setEditando({ ...editando, nome: e.target.value })} style={inputStyle} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['dimensao', 'toda_venda'] as Criterio[]).map(c => (
                  <button key={c} onClick={() => setEditando({ ...editando, criterio: c })} style={{ ...btn(editando.criterio === c ? '#1a237e' : '#eceff1', { color: editando.criterio === c ? '#fff' : '#546e7a', flex: 1 }) }}>
                    {c === 'dimensao' ? '📦 Caixa (por dimensão)' : '🎁 Vai em toda venda'}
                  </button>
                ))}
              </div>
              {editando.criterio === 'dimensao' && (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {(['altura_cm', 'largura_cm', 'comprimento_cm'] as const).map((k, i) => (
                    <input key={k} type="number" placeholder={['Altura', 'Largura', 'Compr.'][i] + ' cm'} value={(editando as any)[k] ?? ''} onChange={e => setEditando({ ...editando, [k]: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
                  ))}
                </div>
              )}
              <input type="number" placeholder="Estoque mínimo (alerta)" value={editando.estoque_minimo ?? ''} onChange={e => setEditando({ ...editando, estoque_minimo: Number(e.target.value) || 0 })} style={inputStyle} />
              <input placeholder="Link da compra (opcional)" value={editando.url_compra || ''} onChange={e => setEditando({ ...editando, url_compra: e.target.value })} style={inputStyle} />
              {editando.id != null && (
                <label style={{ fontSize: '0.82rem', color: '#546e7a' }}>
                  <input type="checkbox" checked={editando.ativo !== 0} onChange={e => setEditando({ ...editando, ativo: e.target.checked ? 1 : 0 })} /> Ativa
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditando(null)} style={btn('#b0bec5')}>Cancelar</button>
              <button onClick={salvarEmbalagem} style={btn('#1a237e')}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL COMPRA (KIT) ===== */}
      {comprando && <ModalCompra emb={comprando} onClose={() => setComprando(null)} onSaved={() => { setComprando(null); carregarEmbalagens() }} setErro={setErro} />}

      {/* ===== MODAL AJUSTE ===== */}
      {ajustando && <ModalAjuste emb={ajustando} onClose={() => setAjustando(null)} onSaved={() => { setAjustando(null); carregarEmbalagens() }} setErro={setErro} />}
    </div>
  )
}

function ModalCompra({ emb, onClose, onSaved, setErro }: { emb: Embalagem; onClose: () => void; onSaved: () => void; setErro: (s: string) => void }) {
  const [quantidade, setQuantidade] = useState<number | ''>('')
  const [valorTotal, setValorTotal] = useState<number | ''>('')
  const [url, setUrl] = useState(emb.url_compra || '')
  const custoUnit = (quantidade && valorTotal) ? Number(valorTotal) / Number(quantidade) : 0
  const salvar = async () => {
    if (!quantidade || Number(quantidade) <= 0) { setErro('Informe a quantidade comprada'); return }
    try {
      const r = await fetch(`${API_BASE}/api/embalagens/compra`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embalagem_id: emb.id, quantidade: Number(quantidade), valor_total: Number(valorTotal) || 0, url }),
      })
      const d = await r.json(); if (d.erro) throw new Error(d.erro)
      onSaved()
    } catch (e) { setErro(String(e instanceof Error ? e.message : e)) }
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.3rem' }}>Registrar compra</h3>
        <div style={{ color: '#90a4ae', fontSize: '0.82rem', marginBottom: '1rem' }}>{emb.nome} · entra {quantidade || 0} un no estoque</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <input type="number" placeholder="Quantidade de unidades (ex: kit 4×1000 = 4000)" value={quantidade} onChange={e => setQuantidade(e.target.value ? Number(e.target.value) : '')} style={inputStyle} />
          <input type="number" placeholder="Valor total pago (R$)" value={valorTotal} onChange={e => setValorTotal(e.target.value ? Number(e.target.value) : '')} style={inputStyle} />
          <div style={{ background: '#e8f5e9', borderRadius: '8px', padding: '0.6rem', fontSize: '0.85rem', color: '#2e7d32', fontWeight: 700 }}>
            Custo unitário: {fmtR$(custoUnit)} / un
          </div>
          <input placeholder="Link do site da compra (opcional)" value={url} onChange={e => setUrl(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('#b0bec5')}>Cancelar</button>
          <button onClick={salvar} style={btn('#2e7d32')}>Registrar</button>
        </div>
      </div>
    </div>
  )
}

function ModalAjuste({ emb, onClose, onSaved, setErro }: { emb: Embalagem; onClose: () => void; onSaved: () => void; setErro: (s: string) => void }) {
  const [novo, setNovo] = useState<number | ''>(emb.estoque_atual)
  const [motivo, setMotivo] = useState('')
  const salvar = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/embalagens/ajuste`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embalagem_id: emb.id, novo_estoque: Number(novo), motivo }),
      })
      const d = await r.json(); if (d.erro) throw new Error(d.erro)
      onSaved()
    } catch (e) { setErro(String(e instanceof Error ? e.message : e)) }
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.3rem' }}>Ajustar estoque</h3>
        <div style={{ color: '#90a4ae', fontSize: '0.82rem', marginBottom: '1rem' }}>{emb.nome} · atual: {emb.estoque_atual}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <input type="number" placeholder="Novo estoque" value={novo} onChange={e => setNovo(e.target.value ? Number(e.target.value) : '')} style={inputStyle} />
          <input placeholder="Motivo (ex: contagem física)" value={motivo} onChange={e => setMotivo(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('#b0bec5')}>Cancelar</button>
          <button onClick={salvar} style={btn('#546e7a')}>Salvar ajuste</button>
        </div>
      </div>
    </div>
  )
}
