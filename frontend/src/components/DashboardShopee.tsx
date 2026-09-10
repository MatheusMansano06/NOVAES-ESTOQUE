import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface Metrica {
  chave: string
  nome: string
  dimensao: 'envio' | 'anuncios' | 'atendimento' | 'outros'
  valor: number | null
  anterior: number | null
  unidade: string
  alvo: number | null
  comparador: string
  menor_e_melhor: boolean
  fora_da_meta: boolean
  tendencia: 'melhorou' | 'piorou' | 'estavel'
  uso_da_meta: number | null
}

interface Repasse {
  order_sn: string
  payout_amount: number
  escrow_release_time: number
}

interface DadosDashboard {
  rating: number | null
  falhas: { envio: number; anuncios: number; atendimento: number }
  metricas: Metrica[]
  repasses: { quantidade: number; total: number; ultimos: Repasse[] }
  erro?: string
  mensagem?: string
}

const RATING = {
  1: { texto: 'Excelente', cor: '#12a150' },
  2: { texto: 'Boa', cor: '#12a150' },
  3: { texto: 'Precisa melhorar', cor: '#d97706' },
  4: { texto: 'Em risco', cor: '#c53434' },
} as const

const DIMENSOES: Array<{ id: Metrica['dimensao']; titulo: string; resumo: string }> = [
  { id: 'envio', titulo: 'Envio', resumo: 'Prazo de postagem e entrega' },
  { id: 'anuncios', titulo: 'Anúncios', resumo: 'Conformidade do catálogo' },
  { id: 'atendimento', titulo: 'Atendimento', resumo: 'Resposta e satisfação' },
]

function fmt(v: number | null, unidade: string) {
  if (v == null) return '—'
  const n = Number.isInteger(v) ? v : Number(v.toFixed(2))
  return `${n.toLocaleString('pt-BR')}${unidade}`
}

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function Tendencia({ m }: { m: Metrica }) {
  if (m.tendencia === 'estavel' || m.anterior == null) {
    return <span className="dsh__tend dsh__tend--igual">estável</span>
  }
  const bom = m.tendencia === 'melhorou'
  return (
    <span className={`dsh__tend ${bom ? 'dsh__tend--bom' : 'dsh__tend--ruim'}`}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {(m.valor ?? 0) > (m.anterior ?? 0)
          ? <path d="M12 19V5M5 12l7-7 7 7" />
          : <path d="M12 5v14M5 12l7 7 7-7" />}
      </svg>
      {fmt(m.anterior, m.unidade)}
    </span>
  )
}

/* A barra mostra a folga até a meta: em limite superior ela enche conforme
   você se aproxima do teto; em piso, conforme você alcança o mínimo. */
function BarraMeta({ m }: { m: Metrica }) {
  if (m.uso_da_meta == null || m.alvo == null) return null

  const pct = Math.max(0, Math.min(100, m.uso_da_meta * 100))
  const cor = m.fora_da_meta
    ? '#c53434'
    : m.menor_e_melhor
      ? (pct > 70 ? '#d97706' : '#12a150')
      : (pct < 115 ? '#d97706' : '#12a150')

  return (
    <div className="dsh__barra" title={`Meta: ${m.comparador}${m.alvo}${m.unidade}`}>
      <div className="dsh__barra-trilho">
        <div className="dsh__barra-fill" style={{ width: `${pct}%`, background: cor }} />
        {m.menor_e_melhor && <span className="dsh__barra-teto" />}
      </div>
      <span className="dsh__barra-alvo">
        meta {m.comparador}{fmt(m.alvo, m.unidade)}
      </span>
    </div>
  )
}

export function DashboardShopee() {
  const [dados, setDados] = useState<DadosDashboard | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando')

  useEffect(() => {
    let ativo = true
    fetch(`${API_BASE}/api/shopee/dashboard`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!ativo) return
        if (d?.erro) { setEstado('erro'); setDados(d) }
        else { setDados(d); setEstado('ok') }
      })
      .catch(() => ativo && setEstado('erro'))
    return () => { ativo = false }
  }, [])

  if (estado === 'carregando') {
    return <div className="dsh__vazio">Carregando saúde da conta…</div>
  }

  if (estado === 'erro' || !dados) {
    return (
      <div className="dsh__vazio">
        Não consegui ler a saúde da conta agora.
        {dados?.mensagem && <span className="dsh__vazio-det">{dados.mensagem}</span>}
      </div>
    )
  }

  const criticas = dados.metricas.filter((m) => m.fora_da_meta)
  const piorando = dados.metricas.filter((m) => !m.fora_da_meta && m.tendencia === 'piorou')
  const rating = RATING[(dados.rating ?? 4) as 1 | 2 | 3 | 4] ?? RATING[4]

  return (
    <div className="dsh">
      {/* O que exige ação vem primeiro, com o motivo explícito. */}
      {criticas.length > 0 ? (
        <section className="dsh__alerta">
          <div className="dsh__alerta-topo">
            <span className="dsh__alerta-tag">Exige ação</span>
            <h2>
              {criticas.length === 1
                ? '1 métrica está fora da meta'
                : `${criticas.length} métricas estão fora da meta`}
            </h2>
            <p>Fora da meta a Shopee penaliza a loja e desprioriza os anúncios.</p>
          </div>
          <ul className="dsh__alerta-lista">
            {criticas.map((m) => (
              <li key={m.chave}>
                <span className="dsh__alerta-nome">{m.nome}</span>
                <span className="dsh__alerta-valor">
                  {fmt(m.valor, m.unidade)}
                  <em>meta {m.comparador}{fmt(m.alvo, m.unidade)}</em>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="dsh__alerta dsh__alerta--ok">
          <div className="dsh__alerta-topo">
            <span className="dsh__alerta-tag">Tudo dentro da meta</span>
            <h2>Nenhuma métrica em violação</h2>
            <p>Nada que a Shopee esteja penalizando neste período.</p>
          </div>
        </section>
      )}

      <div className="dsh__resumo">
        <div className="dsh__resumo-item">
          <span className="dsh__resumo-label">Avaliação da loja</span>
          <strong style={{ color: rating.cor }}>{rating.texto}</strong>
          <span className="dsh__resumo-nota">nível {dados.rating} de 4</span>
        </div>
        <div className="dsh__resumo-item">
          <span className="dsh__resumo-label">Repassado em 14 dias</span>
          <strong>{fmtMoeda(dados.repasses.total)}</strong>
          <span className="dsh__resumo-nota">{dados.repasses.quantidade} pedidos liquidados</span>
        </div>
        <div className="dsh__resumo-item">
          <span className="dsh__resumo-label">Piorando sem estourar</span>
          <strong>{piorando.length}</strong>
          <span className="dsh__resumo-nota">
            {piorando.length ? 'ainda dentro, mas caindo' : 'nenhuma em queda'}
          </span>
        </div>
      </div>

      <div className="dsh__grid">
        {DIMENSOES.map((dim) => {
          const doGrupo = dados.metricas.filter((m) => m.dimensao === dim.id)
          if (!doGrupo.length) return null
          const falhas = doGrupo.filter((m) => m.fora_da_meta).length
          return (
            <section key={dim.id} className="dsh__bloco">
              <header className="dsh__bloco-topo">
                <div>
                  <h3>{dim.titulo}</h3>
                  <p>{dim.resumo}</p>
                </div>
                <span className={`dsh__pill${falhas ? ' dsh__pill--erro' : ''}`}>
                  {falhas ? `${falhas} fora` : 'ok'}
                </span>
              </header>

              <ul className="dsh__metricas">
                {doGrupo.map((m) => (
                  <li key={m.chave} className={m.fora_da_meta ? 'is-fora' : undefined}>
                    <div className="dsh__metrica-topo">
                      <span className="dsh__metrica-nome">{m.nome}</span>
                      <span className="dsh__metrica-valor">{fmt(m.valor, m.unidade)}</span>
                    </div>
                    <BarraMeta m={m} />
                    <Tendencia m={m} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {dados.repasses.ultimos.length > 0 && (
        <section className="dsh__repasses">
          <header>
            <h3>Últimos repasses</h3>
            <p>Pedidos que a Shopee liquidou na quinzena.</p>
          </header>
          <ul>
            {dados.repasses.ultimos.map((r) => (
              <li key={r.order_sn}>
                <span className="dsh__repasse-pedido">{r.order_sn}</span>
                <span className="dsh__repasse-data">
                  {new Date(r.escrow_release_time * 1000).toLocaleDateString('pt-BR')}
                </span>
                <span className="dsh__repasse-valor">{fmtMoeda(r.payout_amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
