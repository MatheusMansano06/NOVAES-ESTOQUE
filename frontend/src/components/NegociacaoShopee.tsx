import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const ROTA = `${API_BASE}/api/negociacoes-shopee`

interface Arquivo { nome: string; original: string; preenchido: string }
interface Negociacao {
  id: number
  nome: string
  competencia: string
  status: 'preenchida' | 'pendente'
  total_linhas: number
  total_zerados: number
  total_multi_campanha: number
  erro: string
  arquivos: Arquivo[]
  criado_em: string | null
}
interface Resumo {
  id: number
  nome: string
  status: 'preenchida' | 'pendente'
  erro?: string
  linhas_gravadas?: number
  total_linhas?: number
  total_zerados?: number
  total_multi_campanha?: number
  sem_preco?: string[]
  sem_estoque?: string[]
}
interface LinhaRuptura {
  item_id: string; sku: string; descricao: string
  estoque: number | null; estoque_full: number | null; preco: number | null
}
interface LinhaPreco {
  item_id: string; sku: string; descricao: string; campanha: string
  preco: number; referencia: number | null; site_d1: number | null
  base_tipo: 'referencia' | 'site'; desvio_pct: number
}
interface LinhaGiro { item_id: string; sku: string; descricao: string }
interface BI {
  vazio: boolean
  negociacao?: { id: number; nome: string; competencia: string; total_linhas: number }
  ruptura?: LinhaRuptura[]
  preco?: LinhaPreco[]
  giro?: { anterior: { id: number; nome: string } | null; entraram: LinhaGiro[]; sairam: LinhaGiro[] }
}

type Aba = 'nova' | 'historico' | 'bi'

const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', color: '#667085', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.85rem', borderBottom: '1px solid #f2f2f2' }
const caixa: React.CSSProperties = { background: '#fff', borderRadius: '12px', border: '1px solid #eee', overflowX: 'auto' }
const vermelho: React.CSSProperties = { color: '#c62828', fontWeight: 700 }
const verde: React.CSSProperties = { color: '#2e7d32', fontWeight: 700 }

const botao = (primario = true): React.CSSProperties => ({
  padding: '0.55rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
  border: primario ? 'none' : '1px solid #cfd8dc',
  background: primario ? '#2d3277' : '#fff', color: primario ? '#fff' : '#444',
})
const chip = (ativo: boolean): React.CSSProperties => ({
  padding: '0.35rem 0.9rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
  border: ativo ? '1px solid #2d3277' : '1px solid #dfe3e8',
  background: ativo ? '#2d3277' : '#fff', color: ativo ? '#fff' : '#444',
})

const reais = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAtual = () => new Date().toISOString().slice(0, 7)

function Cartao({ rotulo, valor, destaque }: { rotulo: string; valor: React.ReactNode; destaque?: boolean }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: '12px', padding: '0.9rem 1.1rem', minWidth: '130px' }}>
      <div style={{ fontSize: '0.75rem', color: '#667085' }}>{rotulo}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: destaque ? '#c62828' : '#2d3277' }}>{valor}</div>
    </div>
  )
}

export function NegociacaoShopee() {
  const [aba, setAba] = useState<Aba>('nova')
  const [historico, setHistorico] = useState<Negociacao[]>([])
  const [bi, setBi] = useState<BI | null>(null)
  const [erro, setErro] = useState('')

  const [arquivos, setArquivos] = useState<FileList | null>(null)
  const [nome, setNome] = useState('')
  const [competencia, setCompetencia] = useState(mesAtual())
  const [processando, setProcessando] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)

  const carregarHistorico = useCallback(() => {
    fetch(ROTA)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHistorico)
      .catch((e) => setErro(`Falha ao carregar o histórico: ${e.message}`))
  }, [])

  useEffect(() => { carregarHistorico() }, [carregarHistorico])

  useEffect(() => {
    if (aba !== 'bi') return
    fetch(`${ROTA}/bi`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setBi)
      .catch((e) => setErro(`Falha ao carregar o BI: ${e.message}`))
  }, [aba])

  async function enviar() {
    if (!arquivos?.length) return
    setProcessando(true)
    setErro('')
    setResumo(null)
    try {
      const corpo = new FormData()
      Array.from(arquivos).forEach((a) => corpo.append('arquivos', a))
      corpo.append('nome', nome || `Negociação ${competencia}`)
      corpo.append('competencia', competencia)

      const resp = await fetch(ROTA, { method: 'POST', body: corpo })
      const dados = await resp.json()
      if (!resp.ok) throw new Error(dados.erro || `HTTP ${resp.status}`)
      setResumo(dados)
      carregarHistorico()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setProcessando(false)
    }
  }

  async function reprocessar(id: number) {
    setErro('')
    try {
      const resp = await fetch(`${ROTA}/${id}/reprocessar`, { method: 'POST' })
      const dados = await resp.json()
      if (!resp.ok) throw new Error(dados.erro || `HTTP ${resp.status}`)
      if (dados.status === 'pendente') setErro(`A Shopee ainda não respondeu: ${dados.erro}`)
      carregarHistorico()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const abas: [Aba, string][] = [['nova', 'Nova negociação'], ['historico', `Histórico (${historico.length})`], ['bi', 'BI']]

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        {abas.map(([chave, rotulo]) => (
          <button key={chave} type="button" style={chip(aba === chave)} onClick={() => setAba(chave)}>{rotulo}</button>
        ))}
      </div>

      {erro && (
        <div style={{ ...caixa, padding: '0.8rem 1rem', marginBottom: '1rem', borderColor: '#f3c2c2', background: '#fdf3f3', color: '#c62828' }}>
          {erro}
        </div>
      )}

      {aba === 'nova' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: '#667085', marginTop: 0 }}>
            Suba a planilha "Pontual - Nível Model" que o gerente de contas mandou. O sistema preenche a
            coluna <b>AD</b> com o preço da sua campanha ativa e a <b>AE</b> com o estoque do seu galpão —
            o do Full fica de fora. As fórmulas do arquivo são preservadas.
          </p>

          <div style={{ ...caixa, padding: '1.2rem', display: 'grid', gap: '0.9rem', maxWidth: '620px' }}>
            <label style={{ display: 'grid', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#667085' }}>Planilhas (.xlsx — pode marcar mais de uma)</span>
              <input type="file" accept=".xlsx" multiple onChange={(e) => setArquivos(e.target.files)} />
            </label>
            <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'grid', gap: '0.3rem', flex: 1, minWidth: '200px' }}>
                <span style={{ fontSize: '0.8rem', color: '#667085' }}>Nome</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`Negociação ${competencia}`}
                  style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#667085' }}>Competência</span>
                <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                  style={{ padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #cfd8dc' }} />
              </label>
            </div>
            <button type="button" style={{ ...botao(), opacity: !arquivos?.length || processando ? 0.5 : 1 }}
              disabled={!arquivos?.length || processando} onClick={enviar}>
              {processando ? 'Consultando a Shopee…' : 'Preencher pela API'}
            </button>
          </div>

          {resumo && resumo.status === 'pendente' && (
            <div style={{ ...caixa, padding: '1rem', marginTop: '1.2rem', borderColor: '#f0d6a8', background: '#fdf8ef' }}>
              <b>A planilha foi salva, mas a Shopee não respondeu.</b>
              <div style={{ fontSize: '0.85rem', color: '#667085', marginTop: '0.3rem' }}>{resumo.erro}</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.6rem' }}>
                Nada se perdeu — use "Reprocessar" no histórico quando a conexão voltar.
              </div>
            </div>
          )}

          {resumo && resumo.status === 'preenchida' && (
            <div style={{ marginTop: '1.2rem' }}>
              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <Cartao rotulo="Linhas preenchidas" valor={resumo.total_linhas ?? 0} />
                <Cartao rotulo="Estoque zerado" valor={resumo.total_zerados ?? 0} destaque={(resumo.total_zerados ?? 0) > 0} />
                <Cartao rotulo="Em 2+ campanhas" valor={resumo.total_multi_campanha ?? 0} />
              </div>

              {!!resumo.sem_preco?.length && (
                <p style={{ fontSize: '0.85rem', ...vermelho }}>
                  {resumo.sem_preco.length} produto(s) ficaram sem preço porque não estão em nenhuma campanha
                  ativa: {resumo.sem_preco.slice(0, 8).join(', ')}
                  {resumo.sem_preco.length > 8 && '…'}. Essas linhas ficaram em branco no arquivo.
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {(historico.find((h) => h.id === resumo.id)?.arquivos ?? []).map((arq, i) => (
                  <a key={arq.original} href={`${ROTA}/${resumo.id}/arquivo/${i}`} style={{ ...botao(), textDecoration: 'none' }}>
                    Baixar {arq.nome}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {aba === 'historico' && (
        <div style={caixa}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Negociação</th>
                <th style={th}>Competência</th>
                <th style={th}>Linhas</th>
                <th style={th}>Zerados</th>
                <th style={th}>Enviada em</th>
                <th style={th}>Arquivos</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((n) => (
                <tr key={n.id}>
                  <td style={td}>
                    <b>{n.nome}</b>
                    {n.status === 'pendente' && (
                      <div style={{ fontSize: '0.75rem', ...vermelho }}>pendente — {n.erro}</div>
                    )}
                  </td>
                  <td style={td}>{n.competencia}</td>
                  <td style={td}>{n.total_linhas}</td>
                  <td style={{ ...td, ...(n.total_zerados > 0 ? vermelho : {}) }}>{n.total_zerados}</td>
                  <td style={td}>{n.criado_em ? new Date(n.criado_em).toLocaleString('pt-BR') : '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {n.arquivos.map((arq, i) => (
                        <a key={arq.original} href={`${ROTA}/${n.id}/arquivo/${i}`}
                          style={{ fontSize: '0.8rem', fontWeight: 600 }}>{arq.nome}</a>
                      ))}
                      {n.status === 'pendente' && (
                        <button type="button" style={{ ...botao(false), padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
                          onClick={() => reprocessar(n.id)}>Reprocessar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {historico.length === 0 && (
                <tr><td style={td} colSpan={6}>Nenhuma negociação ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'bi' && bi?.vazio !== false && (
        <p style={{ fontSize: '0.85rem', color: '#667085' }}>
          {bi === null ? 'Carregando…' : 'Suba a primeira planilha para o BI ter o que mostrar.'}
        </p>
      )}

      {aba === 'bi' && bi?.vazio === false && (
        <div style={{ display: 'grid', gap: '1.6rem' }}>
          <p style={{ fontSize: '0.85rem', color: '#667085', margin: 0 }}>
            Baseado em <b>{bi.negociacao!.nome}</b> ({bi.negociacao!.competencia}), {bi.negociacao!.total_linhas} produtos.
          </p>

          <section>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
              Ruptura — sem estoque próprio ({bi.ruptura!.length})
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#667085', margin: '0 0 0.6rem' }}>
              Produtos negociados com zero no seu galpão. Os que têm Full alto seguem vendendo; os que não têm, param.
            </p>
            <div style={caixa}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Produto</th><th style={th}>SKU</th>
                    <th style={th}>Próprio</th><th style={th}>Full</th><th style={th}>Preço</th>
                  </tr>
                </thead>
                <tbody>
                  {bi.ruptura!.map((r) => (
                    <tr key={r.item_id}>
                      <td style={td}>{r.descricao}</td>
                      <td style={td}>{r.sku || '—'}</td>
                      <td style={{ ...td, ...vermelho }}>0</td>
                      <td style={{ ...td, ...((r.estoque_full ?? 0) > 0 ? verde : vermelho) }}>{r.estoque_full ?? 0}</td>
                      <td style={td}>{reais(r.preco)}</td>
                    </tr>
                  ))}
                  {bi.ruptura!.length === 0 && (
                    <tr><td style={td} colSpan={5}>Nenhum produto zerado. Bom sinal.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Preço — o seu contra a referência da Shopee</h3>
            <p style={{ fontSize: '0.82rem', color: '#667085', margin: '0 0 0.6rem' }}>
              Do maior desconto para o menor. Desvio negativo significa que você está abaixo da base de comparação —
              que é o Preço Referência da Shopee quando ela informa, e o preço que o produto tinha no site no resto.
            </p>
            <div style={caixa}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Produto</th><th style={th}>Campanha</th>
                    <th style={th}>Seu preço</th><th style={th}>Referência</th>
                    <th style={th}>Site D-1</th><th style={th}>Desvio</th>
                  </tr>
                </thead>
                <tbody>
                  {bi.preco!.map((p) => (
                    <tr key={p.item_id}>
                      <td style={td}>{p.descricao}</td>
                      <td style={td}>{p.campanha || '—'}</td>
                      <td style={td}>{reais(p.preco)}</td>
                      <td style={{ ...td, fontWeight: p.base_tipo === 'referencia' ? 700 : 400 }}>{reais(p.referencia)}</td>
                      <td style={{ ...td, fontWeight: p.base_tipo === 'site' ? 700 : 400 }}>{reais(p.site_d1)}</td>
                      <td style={{ ...td, ...(p.desvio_pct < 0 ? vermelho : verde) }}>
                        {p.desvio_pct > 0 ? '+' : ''}{p.desvio_pct}%
                        <span style={{ color: '#667085', fontWeight: 400, fontSize: '0.75rem' }}>
                          {' '}vs {p.base_tipo === 'referencia' ? 'ref.' : 'site'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Giro da lista</h3>
            {!bi.giro!.anterior ? (
              <p style={{ fontSize: '0.85rem', color: '#667085' }}>
                Só tem uma negociação no histórico. A partir da próxima dá para comparar.
              </p>
            ) : (
              <>
                <p style={{ fontSize: '0.82rem', color: '#667085', margin: '0 0 0.6rem' }}>
                  O que mudou desde <b>{bi.giro!.anterior.nome}</b>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                  {([['Entraram na lista', bi.giro!.entraram, verde], ['Saíram da lista', bi.giro!.sairam, vermelho]] as const).map(
                    ([titulo, linhas, cor]) => (
                      <div key={titulo} style={{ ...caixa, padding: '0.9rem 1.1rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, ...cor, marginBottom: '0.5rem' }}>
                          {titulo} ({linhas.length})
                        </div>
                        {linhas.length === 0 && <div style={{ fontSize: '0.82rem', color: '#667085' }}>Nenhum.</div>}
                        {linhas.map((l) => (
                          <div key={l.item_id} style={{ fontSize: '0.82rem', borderBottom: '1px solid #f2f2f2', padding: '0.35rem 0' }}>
                            {l.descricao}
                            <span style={{ color: '#667085' }}>{l.sku ? ` · ${l.sku}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
