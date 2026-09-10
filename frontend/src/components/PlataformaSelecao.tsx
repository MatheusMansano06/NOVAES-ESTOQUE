import { useEffect, useState } from 'react'

export type Platform = 'ml' | 'shopee' | 'operacao'

interface PlataformaSelecaoProps {
  onEscolher: (p: Platform) => void
  operadorNome?: string
  atual?: Platform | null
  onVoltar?: () => void
  resumo?: {
    ml?: string
    shopee?: string
    operacao?: string
  }
}

/* Moeda oficial do Mercado Livre, recortada do logo horizontal da CDN da marca.
   O wordmark fica de fora porque o nome já aparece no módulo, em português. */
function LogoMercadoLivre() {
  return (
    <span className="nvsp__moeda-ml">
      <img src="/assets/marcas/mercado-livre.png" alt="" />
    </span>
  )
}

function LogoShopee() {
  return <img className="nvsp__marca-shopee" src="/assets/marcas/shopee.svg" alt="" />
}

function LogoOperacao() {
  return (
    <svg viewBox="0 0 160 140" width="96" height="84" aria-hidden="true">
      <defs>
        <linearGradient id="op-cx" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5ba4ff" />
          <stop offset="100%" stopColor="#0a3fa8" />
        </linearGradient>
      </defs>
      <path d="M80 22 128 46v48L80 118 32 94V46z" fill="url(#op-cx)" />
      <path d="M80 22 128 46 80 70 32 46z" fill="#7cc2ff" />
      <path d="M80 70v48L32 94V46z" fill="#00102e" opacity="0.24" />
      <circle cx="80" cy="82" r="17" fill="none" stroke="#fff" strokeWidth="6" opacity="0.92" />
      <circle cx="80" cy="82" r="5" fill="#fff" />
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.92">
        <path d="M80 57v8M80 99v8M55 82h8M97 82h8" />
      </g>
    </svg>
  )
}

/* Marca NVS TECH redesenhada em tipo: o V em azul elétrico com a cunha
   amarela por cima, e o TECH espacejado, como no logotipo. */
function MarcaNVS() {
  return (
    <span className="nvsp__marca">
      <span className="nvsp__marca-nvs">
        N
        <span className="nvsp__marca-v">
          V<span className="nvsp__marca-cunha" aria-hidden="true" />
        </span>
        S
      </span>
      <span className="nvsp__marca-tech">Tech</span>
    </span>
  )
}

/* Barramento: as trilhas saem da marca e descem até cada módulo, com as
   dobras em 45 graus e os nós vazados do logotipo. Cada ramo tem uma
   camada viva que acende quando o módulo é apontado ou está assumido. */
function Barramento() {
  const ramos: Array<{ id: Platform; d: string; nos: Array<[number, number]> }> = [
    {
      id: 'ml',
      d: 'M600 0 V26 L574 52 H226 L200 78 V120',
      nos: [
        [226, 52],
        [200, 96],
      ],
    },
    {
      id: 'shopee',
      d: 'M600 0 V120',
      nos: [[600, 96]],
    },
    {
      id: 'operacao',
      d: 'M600 0 V26 L626 52 H974 L1000 78 V120',
      nos: [
        [974, 52],
        [1000, 96],
      ],
    },
  ]

  return (
    <svg
      className="nvsp__barramento"
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {ramos.map((r) => (
        <g key={r.id} className={`nvsp__ramo nvsp__ramo--${r.id}`}>
          <path className="nvsp__trilha" d={r.d} vectorEffect="non-scaling-stroke" />
          <path className="nvsp__pulso" d={r.d} vectorEffect="non-scaling-stroke" />
          {r.nos.map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              className="nvsp__no"
              cx={cx}
              cy={cy}
              r="5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}

const MODULOS: Array<{
  id: Platform
  ref: string
  nome: string
  linhas: string[]
  logo: () => JSX.Element
}> = [
  {
    id: 'ml',
    ref: 'MOD-01',
    nome: 'Mercado Livre',
    linhas: ['Anúncios', 'Inbound FULL', 'Devoluções'],
    logo: LogoMercadoLivre,
  },
  {
    id: 'shopee',
    ref: 'MOD-02',
    nome: 'Shopee',
    linhas: ['Catálogo', 'Pedidos', 'Repasses'],
    logo: LogoShopee,
  },
  {
    id: 'operacao',
    ref: 'MOD-03',
    nome: 'Operação',
    linhas: ['Lista de compra', 'Embalagens', 'Radar de envio'],
    logo: LogoOperacao,
  },
]

function useRelogio() {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return agora
}

export function PlataformaSelecao({
  onEscolher,
  operadorNome,
  atual,
  onVoltar,
  resumo,
}: PlataformaSelecaoProps) {
  const agora = useRelogio()
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`nvsp${atual ? ` nvsp--atual-${atual}` : ''}`}>
      <header className="nvsp__topo">
        <MarcaNVS />
        <span className="nvsp__topo-dir">
          {operadorNome && <span className="nvsp__topo-op">{operadorNome}</span>}
          <span className="nvsp__topo-hora">{hora}</span>
        </span>
      </header>

      <div className="nvsp__chamada">
        <p className="nvsp__eyebrow">Central de operação</p>
        <h1 className="nvsp__h1">Escolha o módulo</h1>
      </div>

      <Barramento />

      <div className="nvsp__modulos">
        {MODULOS.map((m, i) => {
          const Logo = m.logo
          const eAtual = atual === m.id
          return (
            <button
              key={m.id}
              className={`nvsp__mod nvsp__mod--${m.id}${eAtual ? ' is-atual' : ''}`}
              style={{ ['--i' as string]: String(i) }}
              onClick={() => onEscolher(m.id)}
            >
              <span className="nvsp__mod-luz" aria-hidden="true" />

              <span className="nvsp__mod-topo">
                <span className="nvsp__mod-ref">{m.ref}</span>
                {eAtual && <span className="nvsp__mod-cunha" aria-hidden="true" />}
              </span>

              <span className="nvsp__palco">
                <span className="nvsp__logo">
                  <Logo />
                </span>
                <span className="nvsp__reflexo" aria-hidden="true" />
              </span>

              <span className="nvsp__mod-nome">{m.nome}</span>

              <span className="nvsp__mod-status">
                <span className="nvsp__led" aria-hidden="true" />
                {resumo?.[m.id] ?? '—'}
              </span>

              <ul className="nvsp__mod-lista">
                {m.linhas.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>

              <span className="nvsp__mod-acao">
                {eAtual ? 'Continuar' : 'Abrir'}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          )
        })}
      </div>

      <footer className="nvsp__rodape">
        {onVoltar && atual ? (
          <button className="nvsp__voltar" onClick={onVoltar}>
            Voltar ao painel
          </button>
        ) : (
          <span className="nvsp__rodape-nota">Dá para trocar de módulo a qualquer momento.</span>
        )}
      </footer>
    </div>
  )
}
