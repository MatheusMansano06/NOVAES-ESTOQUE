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
   O wordmark fica de fora porque o nome já aparece no posto, em português. */
function LogoMercadoLivre() {
  return (
    <span className="posto__moeda-ml">
      <img src="/assets/marcas/mercado-livre.png" alt="" />
    </span>
  )
}

function LogoShopee() {
  return <img className="posto__marca-shopee" src="/assets/marcas/shopee.svg" alt="" />
}

function LogoOperacao() {
  return (
    <svg viewBox="0 0 160 140" width="104" height="91" aria-hidden="true">
      <defs>
        <linearGradient id="op-cx" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5cb0ff" />
          <stop offset="100%" stopColor="#0552b5" />
        </linearGradient>
      </defs>
      <path d="M80 22 128 46v48L80 118 32 94V46z" fill="url(#op-cx)" />
      <path d="M80 22 128 46 80 70 32 46z" fill="#7cc2ff" />
      <path d="M80 70v48L32 94V46z" fill="#000" opacity="0.16" />
      <circle cx="80" cy="82" r="17" fill="none" stroke="#fff" strokeWidth="6" opacity="0.92" />
      <circle cx="80" cy="82" r="5" fill="#fff" />
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.92">
        <path d="M80 57v8M80 99v8M55 82h8M97 82h8" />
      </g>
    </svg>
  )
}

const POSTOS: Array<{
  id: Platform
  numero: string
  nome: string
  linhas: string[]
  logo: () => JSX.Element
}> = [
  {
    id: 'ml',
    numero: '01',
    nome: 'Mercado Livre',
    linhas: ['Anúncios', 'Inbound FULL', 'Devoluções'],
    logo: LogoMercadoLivre,
  },
  {
    id: 'shopee',
    numero: '02',
    nome: 'Shopee',
    linhas: ['Catálogo', 'Pedidos', 'Repasses'],
    logo: LogoShopee,
  },
  {
    id: 'operacao',
    numero: '03',
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
  const carimbo = agora
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace('.', '')
    .toUpperCase()

  return (
    <div className="posto">
      <header className="posto__barra">
        <span className="posto__barra-marca">NVS TECH</span>
        <span className="posto__barra-sep" />
        <span className="posto__barra-titulo">Controle de operação</span>
        <span className="posto__barra-dir">
          {operadorNome && <span className="posto__barra-op">{operadorNome}</span>}
          <span className="posto__barra-hora">{carimbo}</span>
        </span>
      </header>

      <div className="posto__intro">
        <h1 className="posto__h1">Assuma um posto</h1>
        <p className="posto__sub">O painel abre só com as ferramentas dele.</p>
      </div>

      <div className="posto__baias">
        {POSTOS.map((p, i) => {
          const Logo = p.logo
          const eAtual = atual === p.id
          return (
            <button
              key={p.id}
              className={`posto__baia posto__baia--${p.id}${eAtual ? ' is-atual' : ''}`}
              style={{ ['--baia-i' as string]: String(i) }}
              onClick={() => onEscolher(p.id)}
            >
              <span className="posto__luz" aria-hidden="true" />

              <span className="posto__num">{p.numero}</span>

              <span className="posto__palco">
                <span className="posto__logo">
                  <Logo />
                </span>
                <span className="posto__sombra" aria-hidden="true" />
              </span>

              <span className="posto__nome">{p.nome}</span>

              <span className="posto__status">
                <span className="posto__led" aria-hidden="true" />
                {resumo?.[p.id] ?? '—'}
              </span>

              <ul className="posto__lista">
                {p.linhas.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>

              <span className="posto__acao">
                {eAtual ? 'Continuar' : 'Assumir'}
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </span>

              {eAtual && <span className="posto__faixa" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <footer className="posto__rodape">
        {onVoltar && atual ? (
          <button className="posto__cancelar" onClick={onVoltar}>
            Voltar ao painel
          </button>
        ) : (
          <span className="posto__rodape-nota">Dá para trocar de posto a qualquer momento.</span>
        )}
      </footer>
    </div>
  )
}
