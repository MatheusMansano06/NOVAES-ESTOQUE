import { useState, useEffect, useCallback, Fragment } from 'react'
import '../negociacao-shopee.css'

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
  total_linhas?: number
  total_zerados?: number
  total_multi_campanha?: number
  sem_preco?: string[]
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
type FiltroPreco = 'todos' | 'abaixo' | 'acima'

const reais = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAtual = () => new Date().toISOString().slice(0, 7)
const nomeDoMes = (competencia: string) => {
  const [ano, mes] = competencia.split('-').map(Number)
  if (!ano || !mes) return competencia
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}
// desvio a partir do qual a barra enche — acima disso ela satura
const DESVIO_TETO = 40

function Produto({ descricao, sku }: { descricao: string; sku: string }) {
  return (
    <div className="ngs__produto">
      {descricao}
      {sku && <span className="ngs__sku">SKU {sku}</span>}
    </div>
  )
}

function PlanilhaAlvo() {
  const linhas = [
    ['23893446809', 'Protetor escapamento Twister', '608'],
    ['21598020157', 'Protetor escapamento Titan 160', '285'],
  ]
  return (
    <div className="ngs__planilha" aria-hidden="true">
      <span className="is-cab">Item ID</span>
      <span className="is-cab">Produto</span>
      <span className="is-cab is-opcional">Estoque D-1</span>
      <span className="is-cab is-alvo">AD Preço</span>
      <span className="is-cab is-alvo">AE Estoque</span>
      {linhas.map(([id, nome, d1]) => (
        <Fragment key={id}>
          <span>{id}</span>
          <span>{nome}</span>
          <span className="is-opcional">{d1}</span>
          <span className="is-alvo">preenche</span>
          <span className="is-alvo">preenche</span>
        </Fragment>
      ))}
    </div>
  )
}

export function NegociacaoShopee() {
  const [aba, setAba] = useState<Aba>('nova')
  const [historico, setHistorico] = useState<Negociacao[]>([])
  const [bi, setBi] = useState<BI | null>(null)
  const [erro, setErro] = useState('')

  const [arquivos, setArquivos] = useState<File[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [nome, setNome] = useState('')
  const [competencia, setCompetencia] = useState(mesAtual())
  const [processando, setProcessando] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [filtroPreco, setFiltroPreco] = useState<FiltroPreco>('todos')

  const carregarHistorico = useCallback(() => {
    fetch(ROTA)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHistorico)
      .catch((e) => setErro(`Não foi possível carregar o histórico (${e.message}).`))
  }, [])

  useEffect(() => { carregarHistorico() }, [carregarHistorico])

  useEffect(() => {
    if (aba !== 'bi') return
    fetch(`${ROTA}/bi`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setBi)
      .catch((e) => setErro(`Não foi possível carregar o BI (${e.message}).`))
  }, [aba])

  function escolher(lista: FileList | null) {
    const xlsx = Array.from(lista ?? []).filter((f) => f.name.toLowerCase().endsWith('.xlsx'))
    setArquivos(xlsx)
    setResumo(null)
    if (lista?.length && !xlsx.length) setErro('Só dá para enviar arquivos .xlsx.')
    else setErro('')
  }

  async function enviar() {
    if (!arquivos.length) return
    setProcessando(true)
    setErro('')
    setResumo(null)
    try {
      const corpo = new FormData()
      arquivos.forEach((a) => corpo.append('arquivos', a))
      corpo.append('nome', nome.trim() || nomeDoMes(competencia))
      corpo.append('competencia', competencia)

      const resp = await fetch(ROTA, { method: 'POST', body: corpo })
      const dados = await resp.json()
      if (!resp.ok) throw new Error(dados.erro || `HTTP ${resp.status}`)
      setResumo(dados)
      setArquivos([])
      setNome('')
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

  const arquivosDoResumo = resumo ? historico.find((h) => h.id === resumo.id)?.arquivos ?? [] : []
  const precoFiltrado = (bi?.preco ?? []).filter((p) =>
    filtroPreco === 'todos' ? true : filtroPreco === 'abaixo' ? p.desvio_pct < 0 : p.desvio_pct > 0)
  const rupturaSemFull = (bi?.ruptura ?? []).filter((r) => !r.estoque_full).length
  const maiorFull = Math.max(1, ...(bi?.ruptura ?? []).map((r) => r.estoque_full ?? 0))

  return (
    <div className="ngs">
      <div className="ngs__abas" role="tablist">
        {([['nova', 'Nova negociação'], ['historico', 'Histórico'], ['bi', 'BI']] as const).map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" className="ngs__aba"
            aria-selected={aba === chave} onClick={() => setAba(chave)}>
            {rotulo}
            {chave === 'historico' && <span className="ngs__contador">{historico.length}</span>}
          </button>
        ))}
      </div>

      {erro && (
        <div className="ngs__faixa ngs__faixa--erro" role="alert">
          <div><h2>Algo não deu certo</h2><p>{erro}</p></div>
        </div>
      )}

      {aba === 'nova' && (
        <>
          <div className="ngs__envio">
            <label
              className={`ngs__alvo${arrastando ? ' ngs__alvo--ativo' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files) }}
            >
              <input type="file" accept=".xlsx" multiple onChange={(e) => escolher(e.target.files)} />
              <PlanilhaAlvo />
              <div className="ngs__alvo-texto">
                <strong>Solte aqui as planilhas do gerente de contas</strong>
                <span>Ou clique para escolher. Pode enviar mais de uma — elas viram uma única negociação.</span>
              </div>
              {arquivos.length > 0 && (
                <ul className="ngs__arquivos">
                  {arquivos.map((a) => <li key={a.name}>{a.name}</li>)}
                </ul>
              )}
            </label>

            <div className="ngs__form">
              <label className="ngs__campo">
                Mês da negociação
                <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
              </label>
              <label className="ngs__campo">
                Nome
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={nomeDoMes(competencia)} />
              </label>
              <button type="button" className="ngs__btn ngs__btn--principal"
                disabled={!arquivos.length || processando} onClick={enviar}>
                {processando ? 'Consultando a Shopee…' : 'Preencher planilhas'}
              </button>
              <ul className="ngs__regras">
                <li><b>AD</b> recebe o preço da sua campanha ativa na Shopee.</li>
                <li><b>AE</b> recebe o estoque do seu galpão. O do Full fica de fora.</li>
                <li>As fórmulas e os links do arquivo continuam intactos.</li>
              </ul>
            </div>
          </div>

          {resumo?.status === 'pendente' && (
            <div className="ngs__faixa ngs__faixa--aviso">
              <div>
                <h2>Planilha salva, mas a Shopee não respondeu</h2>
                <p>{resumo.erro}. Nada se perdeu: reprocesse pelo histórico quando a conexão voltar.</p>
              </div>
              <button type="button" className="ngs__btn ngs__btn--secundario" onClick={() => setAba('historico')}>
                Abrir histórico
              </button>
            </div>
          )}

          {resumo?.status === 'preenchida' && (
            <div className={`ngs__faixa ${resumo.sem_preco?.length ? 'ngs__faixa--aviso' : 'ngs__faixa--ok'}`}>
              <div>
                <h2>{resumo.nome} está pronta para enviar</h2>
                {resumo.sem_preco?.length ? (
                  <p>
                    {resumo.sem_preco.length} produto(s) não estão em nenhuma campanha ativa e ficaram com a
                    linha em branco: {resumo.sem_preco.slice(0, 6).join(', ')}{resumo.sem_preco.length > 6 && '…'}
                  </p>
                ) : (
                  <p>Todas as linhas receberam preço e estoque.</p>
                )}
                <div className="ngs__numeros" style={{ marginTop: 14 }}>
                  <div className="ngs__numero"><strong>{resumo.total_linhas}</strong><span>produtos preenchidos</span></div>
                  <div className={`ngs__numero${resumo.total_zerados ? ' ngs__numero--alerta' : ''}`}>
                    <strong>{resumo.total_zerados}</strong><span>sem estoque no galpão</span>
                  </div>
                  <div className="ngs__numero"><strong>{resumo.total_multi_campanha}</strong><span>em mais de uma campanha</span></div>
                </div>
              </div>
              <div className="ngs__acoes">
                {arquivosDoResumo.map((arq, i) => (
                  <a key={arq.original} className="ngs__btn ngs__btn--principal" href={`${ROTA}/${resumo.id}/arquivo/${i}`}>
                    Baixar {arq.nome.replace(/\.xlsx$/i, '')}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {aba === 'historico' && (
        <div className="ngs__bloco">
          <div className="ngs__rolagem">
            <table className="ngs__tabela">
              <thead>
                <tr>
                  <th>Negociação</th>
                  <th>Status</th>
                  <th className="num">Produtos</th>
                  <th className="num">Sem estoque</th>
                  <th>Enviada em</th>
                  <th>Arquivos</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <div className="ngs__produto">{n.nome}</div>
                      <span className="ngs__sku">{nomeDoMes(n.competencia)}</span>
                    </td>
                    <td>
                      {n.status === 'preenchida'
                        ? <span className="ngs__pill">Preenchida</span>
                        : <span className="ngs__pill ngs__pill--pendente">Pendente</span>}
                      {n.status === 'pendente' && n.erro && <span className="ngs__erro-linha">{n.erro}</span>}
                    </td>
                    <td className="num">{n.total_linhas}</td>
                    <td className="num" style={n.total_zerados ? { color: 'var(--vermelho)', fontWeight: 800 } : undefined}>
                      {n.total_zerados}
                    </td>
                    <td>{n.criado_em ? new Date(n.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    <td>
                      <div className="ngs__acoes">
                        {n.arquivos.map((arq, i) => (
                          <a key={arq.original} className="ngs__btn ngs__btn--secundario ngs__btn--mini"
                            href={`${ROTA}/${n.id}/arquivo/${i}`}>
                            {arq.nome.replace(/\.xlsx$/i, '')}
                          </a>
                        ))}
                        {n.status === 'pendente' && (
                          <button type="button" className="ngs__btn ngs__btn--principal ngs__btn--mini"
                            onClick={() => reprocessar(n.id)}>Reprocessar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {historico.length === 0 && (
              <div className="ngs__vazio">Nenhuma negociação ainda. Envie a primeira planilha na aba Nova negociação.</div>
            )}
          </div>
        </div>
      )}

      {aba === 'bi' && bi?.vazio !== false && (
        <div className="ngs__bloco">
          <div className="ngs__vazio">
            {bi === null ? 'Carregando…' : 'O BI aparece depois da primeira planilha preenchida.'}
          </div>
        </div>
      )}

      {aba === 'bi' && bi?.vazio === false && (
        <>
          <div className={`ngs__faixa ${bi.ruptura!.length ? 'ngs__faixa--erro' : 'ngs__faixa--ok'}`}>
            <div>
              <h2>
                {bi.ruptura!.length
                  ? `${bi.ruptura!.length} produtos negociados sem estoque no galpão`
                  : 'Todo produto negociado tem estoque no galpão'}
              </h2>
              <p>
                {nomeDoMes(bi.negociacao!.competencia)}, {bi.negociacao!.total_linhas} produtos na lista.
                {bi.ruptura!.length > 0 && (rupturaSemFull === 0
                  ? ' Todos ainda têm estoque no Full e seguem vendendo.'
                  : rupturaSemFull === 1
                    ? ' Um deles também está zerado no Full e para de vender.'
                    : ` ${rupturaSemFull} deles também estão zerados no Full e param de vender.`)}
              </p>
            </div>
          </div>

          {bi.ruptura!.length > 0 && (
            <div className="ngs__bloco">
              <div className="ngs__bloco-topo">
                <div>
                  <h3>Ruptura</h3>
                  <p>Zerados no galpão, do que mais tem no Full para o que menos tem.</p>
                </div>
              </div>
              <div className="ngs__rolagem ngs__rolagem--alta">
                <table className="ngs__tabela">
                  <thead>
                    <tr><th>Produto</th><th>Estoque no Full</th><th className="num">Preço negociado</th></tr>
                  </thead>
                  <tbody>
                    {bi.ruptura!.map((r) => {
                      const full = r.estoque_full ?? 0
                      return (
                        <tr key={r.item_id}>
                          <td><Produto descricao={r.descricao} sku={r.sku} /></td>
                          <td>
                            <div className={`ngs__full${full ? '' : ' ngs__full--zero'}`}>
                              <div className="ngs__full-trilho">
                                <span className="ngs__full-fill" style={{ width: `${(full / maiorFull) * 100}%` }} />
                              </div>
                              <span className="ngs__full-valor">{full}</span>
                            </div>
                          </td>
                          <td className="num">{reais(r.preco)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="ngs__bloco">
            <div className="ngs__bloco-topo">
              <div>
                <h3>Preço negociado contra a base</h3>
                <p>
                  A base é o Preço Referência da Shopee quando ela informa, e o preço que o produto tinha no
                  site no dia anterior nos demais casos.
                </p>
              </div>
              <div className="ngs__filtro" role="group" aria-label="Filtrar por desvio">
                {([['todos', 'Todos'], ['abaixo', 'Mais baratos'], ['acima', 'Mais caros']] as const).map(([chave, rotulo]) => (
                  <button key={chave} type="button" aria-pressed={filtroPreco === chave} onClick={() => setFiltroPreco(chave)}>
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div className="ngs__rolagem ngs__rolagem--alta">
              <table className="ngs__tabela">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Seu preço</th>
                    <th className="num">Base</th>
                    <th style={{ width: '30%' }}>Desvio</th>
                  </tr>
                </thead>
                <tbody>
                  {precoFiltrado.map((p) => {
                    const base = p.base_tipo === 'referencia' ? p.referencia : p.site_d1
                    const largura = (Math.min(Math.abs(p.desvio_pct), DESVIO_TETO) / DESVIO_TETO) * 50
                    return (
                      <tr key={p.item_id}>
                        <td>
                          <Produto descricao={p.descricao} sku={p.sku} />
                          {p.campanha && <span className="ngs__sku">Campanha {p.campanha}</span>}
                        </td>
                        <td className="num"><b>{reais(p.preco)}</b></td>
                        <td className="num">
                          {reais(base)}
                          <span className="ngs__base">{p.base_tipo === 'referencia' ? 'referência Shopee' : 'site no dia anterior'}</span>
                        </td>
                        <td>
                          <div className="ngs__desvio">
                            <div className="ngs__desvio-trilho">
                              {p.desvio_pct !== 0 && (
                                <span
                                  className={`ngs__desvio-barra ngs__desvio-barra--${p.desvio_pct < 0 ? 'abaixo' : 'acima'}`}
                                  style={{ width: `${largura}%` }}
                                />
                              )}
                            </div>
                            <span className="ngs__desvio-valor">{p.desvio_pct > 0 ? '+' : ''}{p.desvio_pct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {precoFiltrado.length === 0 && <div className="ngs__vazio">Nenhum produto nesse filtro.</div>}
            </div>
          </div>

          <div className="ngs__bloco">
            <div className="ngs__bloco-topo">
              <div>
                <h3>Giro da lista</h3>
                <p>
                  {bi.giro!.anterior
                    ? `O que a Shopee passou a pedir, e deixou de pedir, desde ${bi.giro!.anterior.nome}.`
                    : 'A comparação começa na próxima negociação — por enquanto só existe esta.'}
                </p>
              </div>
            </div>
            {bi.giro!.anterior && (
              <div className="ngs__giro">
                {([['Entraram', bi.giro!.entraram, false], ['Saíram', bi.giro!.sairam, true]] as const).map(([titulo, linhas, saiu]) => (
                  <div key={titulo} className="ngs__giro-coluna">
                    <h4><span className={`ngs__marca${saiu ? ' ngs__marca--saiu' : ''}`} />{titulo} ({linhas.length})</h4>
                    {linhas.length === 0
                      ? <div className="ngs__sku">Nenhum produto.</div>
                      : <ul>{linhas.map((l) => <li key={l.item_id}><Produto descricao={l.descricao} sku={l.sku} /></li>)}</ul>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
