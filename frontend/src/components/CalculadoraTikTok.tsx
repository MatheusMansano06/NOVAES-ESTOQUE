import { useEffect, useMemo, useState } from 'react'
import './CalculadoraTikTok.css'
import logoMl from '../central/assets/logos/ml-icone.svg'
import logoShopee from '../central/assets/logos/shopee-icone.svg'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

// Taxas vigentes do TikTok Shop Brasil desde 15/07/2026:
// abaixo de R$50 = 10% + R$4 por item; a partir de R$50 = 6% + R$6 por item.
const taxasTikTok = (preco: number) => (preco >= 50 ? { comissao: 6, fixa: 6 } : { comissao: 10, fixa: 4 })

type Campos = {
  preco: number; custo: number; embalagem: number; comissao: number; imposto: number
  fixa: number; afiliado: number; frete: number; ads: number; outros: number; margemAlvo: number
}

const INICIAL: Campos = {
  preco: 0, custo: 0, embalagem: 0, comissao: 10, imposto: 9, fixa: 4,
  afiliado: 0, frete: 0, ads: 0, outros: 0, margemAlvo: 20,
}

interface Salvo {
  id: number; sku: string; produto: string; preco_venda: number; custo: number
  lucro: number; margem_pct: number; classificacao: string; criado_em: string
  embalagem: number; comissao_pct: number; imposto_pct: number; taxa_fixa: number
  afiliado_pct: number; frete: number; ads_pct: number; outros: number
}

interface Plat {
  achou: boolean; titulo?: string; link?: string; regra?: string; preco_cheio?: number | null; promo?: string | null; tarifa_incompleta?: boolean
  preco?: number; custo?: number; embalagem?: number; comissao?: number; taxa_fixa?: number
  imposto?: number; frete?: number; afiliado_ads?: number; outros?: number; lucro?: number; margem_pct?: number
}
interface Comp { sku: string; foto: string | null; custo_cadastrado: number | null; ml: Plat; shopee: Plat; tiktok: Plat; shopee_configurada: boolean }

export function classificar(margem: number) {
  if (margem < 0) return { nome: 'Prejuízo', cor: 'prejuizo' }
  if (margem < 5) return { nome: 'Crítica', cor: 'critica' }
  if (margem < 10) return { nome: 'Baixa', cor: 'baixa' }
  if (margem < 20) return { nome: 'Boa', cor: 'boa' }
  return { nome: 'Excelente', cor: 'excelente' }
}

// Todas as taxas % incidem sobre o valor TOTAL da venda (somadas, nunca em cascata).
export function calcular(c: Campos) {
  const pct = (c.comissao + c.imposto + c.afiliado + c.ads) / 100
  const fixos = c.custo + c.embalagem + c.fixa + c.frete + c.outros
  const taxasRs = c.preco * pct
  const sobra = c.preco - taxasRs
  const custoTotal = fixos + taxasRs
  const lucro = c.preco - custoTotal
  const margemPct = c.preco > 0 ? (lucro / c.preco) * 100 : 0
  const baseProduto = c.custo + c.embalagem
  const markup = baseProduto > 0 ? (lucro / baseProduto) * 100 : 0
  const precoMinimo = pct < 1 ? fixos / (1 - pct) : null
  const denIdeal = 1 - pct - c.margemAlvo / 100
  const precoIdeal = denIdeal > 0 ? fixos / denIdeal : null
  return { taxasRs, sobra, custoTotal, lucro, margemPct, markup, precoMinimo, precoIdeal }
}

const brl = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pctFmt = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

function Campo({ rotulo, valor, onChange, sufixo }: { rotulo: string; valor: number; onChange: (v: number) => void; sufixo: string }) {
  const rs = sufixo === 'R$'
  return (
    <label className="ctt__campo">
      <span>{rotulo}</span>
      <div className={`ctt__input ${rs ? 'ctt__input--rs' : 'ctt__input--pct'}`}>
        {rs && <i>R$</i>}
        <input type="number" step="0.01" min="0" value={valor || ''} placeholder="0,00"
          onChange={e => onChange(parseFloat(e.target.value) || 0)} />
        {!rs && <i>%</i>}
      </div>
    </label>
  )
}

const LOGOS: Record<string, JSX.Element> = {
  ml: <img src={logoMl} alt="Mercado Livre" />,
  shopee: <img src={logoShopee} alt="Shopee" />,
  tiktok: <span className="ctt__tt" title="TikTok Shop">♪</span>,
}

function ChipPlataforma({ id, nome, p }: { id: 'ml' | 'shopee' | 'tiktok'; nome: string; p?: Plat }) {
  if (!p?.achou) {
    return <div className="ctt__chip ctt__chip--vazio"><span className="ctt__logo">{LOGOS[id]}</span><b>—</b><small>sem anúncio</small></div>
  }
  const m = p.margem_pct ?? 0
  const linhas: [string, number | undefined, boolean?][] = [
    ['Preço de venda', p.preco], ['Custo do produto', p.custo], ['Embalagem', p.embalagem],
    ['Comissão / tarifa', p.comissao], ['Taxa fixa', p.taxa_fixa], ['Imposto', p.imposto],
    ['Frete', p.frete], ['Afiliado + Ads', p.afiliado_ads], ['Outros', p.outros],
  ]
  return (
    <div className={`ctt__chip ctt__chip--${classificar(m).cor}`}>
      <span className="ctt__logo">{LOGOS[id]}</span>
      <b>{pctFmt(m)}</b>
      <small>{brl(p.lucro ?? 0)}</small>
      <div className="ctt__tip">
        <strong>{nome}</strong>
        <p>{p.titulo || '—'}</p>
        {p.regra && <div className="ctt__tip-regra">{p.regra}</div>}
        {p.promo && <div className="ctt__tip-promo">🏷 {p.promo}{p.preco_cheio ? ` · de ${brl(p.preco_cheio)}` : ''}</div>}
        {linhas.filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><span>{brl(v ?? 0)}</span></div>)}
        <div className="ctt__tip-total"><span>Lucro</span><span>{brl(p.lucro ?? 0)}</span></div>
        {p.tarifa_incompleta && <em>tarifa do ML ainda não sincronizada</em>}
      </div>
    </div>
  )
}

export function CalculadoraTikTok() {
  const [c, setC] = useState<Campos>(INICIAL)
  const [sku, setSku] = useState('')
  const [produto, setProduto] = useState('')
  const [auto, setAuto] = useState(true)
  const [salvos, setSalvos] = useState<Salvo[]>([])
  const [msg, setMsg] = useState('')
  const [comp, setComp] = useState<Record<string, Comp>>({})
  const [comparando, setComparando] = useState(false)
  const [aba, setAba] = useState<'calc' | 'salvos'>('calc')
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<{ id: number; valor: string } | null>(null)

  const set = (k: keyof Campos) => (v: number) => setC(p => ({ ...p, [k]: v }))
  const r = useMemo(() => calcular(c), [c])
  const cls = classificar(r.margemPct)

  // Com "taxas automáticas", comissão e taxa fixa seguem a faixa de preço do TikTok.
  useEffect(() => {
    if (!auto) return
    const t = taxasTikTok(c.preco)
    setC(p => (p.comissao === t.comissao && p.fixa === t.fixa ? p : { ...p, comissao: t.comissao, fixa: t.fixa }))
  }, [auto, c.preco])

  const comparar = (lista: Salvo[]) => {
    const skus = [...new Set(lista.map(s => s.sku))]
    if (!skus.length) return
    setComparando(true)
    fetch(`${API_BASE}/api/comparativo-skus?skus=${encodeURIComponent(skus.join(','))}`, { cache: 'no-store' })
      .then(res => res.json())
      .then(d => setComp(Object.fromEntries((d.itens ?? []).map((i: Comp) => [i.sku, i]))))
      .catch(() => setMsg('Não consegui buscar o comparativo.'))
      .finally(() => setComparando(false))
  }
  const carregar = () =>
    fetch(`${API_BASE}/api/tiktok/calculos`, { cache: 'no-store' })
      .then(res => res.json()).then(d => { setSalvos(d.calculos ?? []); comparar(d.calculos ?? []) })
      .catch(() => setMsg('Não consegui carregar os salvos.'))
  useEffect(() => { carregar() }, [])

  const salvar = async () => {
    if (!sku.trim()) { setMsg('Informe o SKU para salvar.'); return }
    const res = await fetch(`${API_BASE}/api/tiktok/calculos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku, produto, preco_venda: c.preco, custo: c.custo, embalagem: c.embalagem, comissao_pct: c.comissao,
        imposto_pct: c.imposto, taxa_fixa: c.fixa, afiliado_pct: c.afiliado, frete: c.frete, ads_pct: c.ads,
        outros: c.outros, lucro: r.lucro, margem_pct: r.margemPct, classificacao: cls.nome,
      }),
    })
    if (!res.ok) { setMsg('Erro ao salvar.'); return }
    setMsg('Salvo ✔'); setBusca(''); carregar()
  }

  // Novo custo recalcula lucro/margem/classificação do TikTok com as mesmas taxas salvas.
  const salvarCusto = async (s: Salvo) => {
    const custo = parseFloat((editando?.valor ?? '').replace(',', '.'))
    if (!Number.isFinite(custo) || custo < 0) { setMsg('Custo inválido.'); return }
    const r2 = calcular({
      preco: s.preco_venda, custo, embalagem: s.embalagem, comissao: s.comissao_pct, imposto: s.imposto_pct,
      fixa: s.taxa_fixa, afiliado: s.afiliado_pct, frete: s.frete, ads: s.ads_pct, outros: s.outros, margemAlvo: 0,
    })
    const res = await fetch(`${API_BASE}/api/tiktok/calculos/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custo, lucro: r2.lucro, margem_pct: r2.margemPct, classificacao: classificar(r2.margemPct).nome }),
    })
    if (!res.ok) { setMsg('Erro ao salvar o custo.'); return }
    setEditando(null); carregar()
  }

  const excluir = async (id: number) => {
    if (!confirm('Excluir este cálculo salvo?')) return
    await fetch(`${API_BASE}/api/tiktok/calculos/${id}`, { method: 'DELETE' })
    carregar()
  }

  const termo = busca.trim().toLowerCase()
  const filtrados = termo ? salvos.filter(s => s.sku.toLowerCase().includes(termo) || (s.produto || '').toLowerCase().includes(termo)) : salvos

  const tabela = (lista: Salvo[]) => (
    <div className="ctt__perfis">
      {lista.map(s => {
        const c = comp[s.sku]
        const carregando = comparando && !c
        return (
          <article key={s.id} className="ctt__perfil">
            <button className="ctt__x" onClick={() => excluir(s.id)} title="Excluir">✕</button>
            <div className="ctt__perfil-foto">
              {c?.foto ? <img src={c.foto} alt={s.produto} /> : <span>📦</span>}
            </div>
            <div className="ctt__perfil-info">
              <b title={s.sku}>{s.sku}</b>
              <small title={s.produto}>{s.produto || '—'}</small>
              {editando?.id === s.id ? (
                <div className="ctt__custo ctt__custo--edit">
                  <span>custo R$</span>
                  <input autoFocus type="number" step="0.01" min="0" value={editando.valor}
                    onChange={e => setEditando({ id: s.id, valor: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') salvarCusto(s); if (e.key === 'Escape') setEditando(null) }} />
                  <button onClick={() => salvarCusto(s)} title="Salvar">✓</button>
                  <button onClick={() => setEditando(null)} title="Cancelar">✕</button>
                </div>
              ) : (
                <button className="ctt__custo" onClick={() => setEditando({ id: s.id, valor: String(s.custo) })} title="Editar custo">
                  custo <b>{brl(s.custo)}</b> <span>✎</span>
                </button>
              )}
              {c?.custo_cadastrado != null && (
                <div className="ctt__alerta" title="O comparativo usa o custo desta calculadora. O cadastro do sistema tem outro valor.">
                  ⚠ custo cadastrado {brl(c.custo_cadastrado)} ≠ {brl(s.custo)}
                </div>
              )}
            </div>
            <div className="ctt__perfil-plats">
              {carregando ? <div className="ctt__carregando">buscando…</div> : <ChipPlataforma id="ml" nome="Mercado Livre" p={c?.ml} />}
              {carregando ? <div className="ctt__carregando">buscando…</div> : <ChipPlataforma id="shopee" nome="Shopee" p={c?.shopee} />}
              <ChipPlataforma id="tiktok" nome="TikTok Shop" p={c?.tiktok ?? { achou: true, titulo: s.produto, preco: s.preco_venda, custo: s.custo, lucro: s.lucro, margem_pct: s.margem_pct }} />
            </div>
            <div className="ctt__perfil-precos">
              {[c?.ml, c?.shopee, c?.tiktok ?? { achou: true, preco: s.preco_venda }].map((p, i) => (
                <div key={i} title={p?.promo ?? undefined}>{p?.achou && p.preco ? <>
                  <span>{p.preco_cheio ? <><s>{brl(p.preco_cheio)}</s> <em>promo</em></> : 'vendido a'}</span>
                  <b className={p.preco_cheio ? 'promo' : ''}>{brl(p.preco)}</b>
                </> : <span>—</span>}</div>
              ))}
            </div>
            <footer>salvo em {new Date(s.criado_em).toLocaleDateString('pt-BR')}</footer>
          </article>
        )
      })}
    </div>
  )

  return (
    <div className="ctt">
      <div className="ctt__abas">
        <button className={aba === 'calc' ? 'ativa' : ''} onClick={() => setAba('calc')}>Calculadora</button>
        <button className={aba === 'salvos' ? 'ativa' : ''} onClick={() => setAba('salvos')}>
          Produtos salvos <span>{salvos.length}</span>
        </button>
      </div>

      {aba === 'calc' && <div className="ctt__grade">
        <section className="ctt__card ctt__form">
          <div className="ctt__bloco">
            <h4>Produto</h4>
            <div className="ctt__linha2">
              <label className="ctt__campo"><span>SKU</span>
                <div className="ctt__input"><input value={sku} onChange={e => setSku(e.target.value)} placeholder="ABC-123" /></div></label>
              <label className="ctt__campo"><span>Nome do produto</span>
                <div className="ctt__input"><input value={produto} onChange={e => setProduto(e.target.value)} placeholder="Ex.: Garrafa térmica 500ml" /></div></label>
            </div>
          </div>

          <div className="ctt__bloco">
            <h4>Venda e custos</h4>
            <div className="ctt__linha3">
              <Campo rotulo="Valor da venda" sufixo="R$" valor={c.preco} onChange={set('preco')} />
              <Campo rotulo="Custo do produto" sufixo="R$" valor={c.custo} onChange={set('custo')} />
              <Campo rotulo="Embalagem" sufixo="R$" valor={c.embalagem} onChange={set('embalagem')} />
              <Campo rotulo="Frete" sufixo="R$" valor={c.frete} onChange={set('frete')} />
              <Campo rotulo="Outros custos" sufixo="R$" valor={c.outros} onChange={set('outros')} />
              <Campo rotulo="Margem desejada" sufixo="%" valor={c.margemAlvo} onChange={set('margemAlvo')} />
            </div>
          </div>

          <div className="ctt__bloco">
            <h4>
              Taxas
              <details className="ctt__info">
                <summary title="Detalhes das taxas">ⓘ</summary>
                <div className="ctt__info-box">
                  <p>Todas as taxas em % são calculadas sobre o <b>valor total da venda</b> (somadas, nunca uma em cima da outra).</p>
                  <p>Tabela TikTok Shop: abaixo de R$50 → 10% + R$4 · a partir de R$50 → 6% + R$6.</p>
                  <label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Preencher comissão e taxa fixa automaticamente</label>
                </div>
              </details>
              {auto && <span className="ctt__tag">auto</span>}
            </h4>
            <div className="ctt__linha3">
              <Campo rotulo="Comissão TikTok" sufixo="%" valor={c.comissao} onChange={v => { setAuto(false); set('comissao')(v) }} />
              <Campo rotulo="Taxa fixa por item" sufixo="R$" valor={c.fixa} onChange={v => { setAuto(false); set('fixa')(v) }} />
              <Campo rotulo="Imposto" sufixo="%" valor={c.imposto} onChange={set('imposto')} />
              <Campo rotulo="Afiliado" sufixo="%" valor={c.afiliado} onChange={set('afiliado')} />
              <Campo rotulo="Ads" sufixo="%" valor={c.ads} onChange={set('ads')} />
            </div>
          </div>
        </section>

        <section className="ctt__card ctt__res">
          <div className={`ctt__hero ctt__hero--${cls.cor}`}>
            <span className="ctt__hero-rot">Lucro por unidade</span>
            <strong>{brl(r.lucro)}</strong>
            <div className="ctt__hero-linha">
              <span className="ctt__hero-selo">{cls.nome}</span>
              <span>{pctFmt(r.margemPct)} de margem</span>
            </div>
            <div className="ctt__barra"><div style={{ width: `${Math.max(0, Math.min(100, r.margemPct * 2.5))}%` }} /></div>
          </div>

          <div className="ctt__kpis">
            <div><span>Preço mínimo</span><b>{brl(r.precoMinimo)}</b><small>lucro zero</small></div>
            <div><span>Preço ideal</span><b>{brl(r.precoIdeal)}</b><small>{pctFmt(c.margemAlvo)} de margem</small></div>
            <div><span>Markup</span><b>{pctFmt(r.markup)}</b><small>sobre custo + embalagem</small></div>
            <div><span>Custo total</span><b>{brl(r.custoTotal)}</b><small>operação completa</small></div>
          </div>

          <dl className="ctt__det">
            <dt>Taxas percentuais</dt><dd>{brl(r.taxasRs)}</dd>
            <dt>Sobra após as taxas</dt><dd>{brl(r.sobra)}</dd>
            <dt>Margem de contribuição</dt><dd>{brl(r.lucro)}</dd>
          </dl>

          <button className="ctt__salvar" onClick={salvar} disabled={c.preco <= 0}>Salvar cálculo</button>
          {msg && <p className="ctt__msg">{msg}</p>}
        </section>
      </div>}

      {aba === 'calc' ? (
        <section className="ctt__card">
          <div className="ctt__cab">
            <h3>Último cálculo</h3>
            <button className="ctt__link" onClick={() => setAba('salvos')}>Ver todos os produtos salvos ({salvos.length}) →</button>
          </div>
          {salvos.length === 0 ? <p className="ctt__vazio">Nenhum cálculo salvo ainda.</p> : tabela(salvos.slice(0, 1))}
        </section>
      ) : (
        <section className="ctt__card">
          <div className="ctt__cab">
            <h3>Produtos salvos</h3><span className="ctt__cont">{filtrados.length}</span>
            <small>passe o mouse na margem para ver os detalhes</small>
          </div>
          <div className="ctt__busca">
            <span>⌕</span>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por SKU ou nome do produto" autoFocus />
            {busca && <button onClick={() => setBusca('')} title="Limpar">✕</button>}
          </div>
          {filtrados.length === 0
            ? <p className="ctt__vazio">{salvos.length ? `Nenhum produto encontrado para "${busca}".` : 'Nenhum cálculo salvo ainda.'}</p>
            : tabela(filtrados)}
        </section>
      )}
    </div>
  )
}
