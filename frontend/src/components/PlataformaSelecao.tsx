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
   O wordmark fica de fora porque o nome já aparece no card, em português. */
function LogoMercadoLivre() {
  return (
    <span className="nvs-posto__moeda-ml">
      <img src="/assets/marcas/mercado-livre.png" alt="" />
    </span>
  )
}

function LogoShopee() {
  return <img className="nvs-posto__marca-shopee" src="/assets/marcas/shopee.svg" alt="" />
}

function LogoOperacao() {
  return (
    <svg viewBox="0 0 160 140" width="150" height="131" aria-hidden="true">
      <defs>
        <linearGradient id="op-cx" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f9bff" />
          <stop offset="100%" stopColor="#0552b5" />
        </linearGradient>
      </defs>
      <path d="M80 22 128 46v48L80 118 32 94V46z" fill="url(#op-cx)" />
      <path d="M80 22 128 46 80 70 32 46z" fill="#5cb0ff" />
      <path d="M80 70v48L32 94V46z" fill="#000" opacity="0.12" />
      <circle cx="80" cy="82" r="17" fill="none" stroke="#fff" strokeWidth="6" opacity="0.9" />
      <circle cx="80" cy="82" r="5" fill="#fff" />
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.9">
        <path d="M80 57v8M80 99v8M55 82h8M97 82h8" />
      </g>
    </svg>
  )
}

const CARDS: Array<{
  id: Platform
  nome: string
  papel: string
  logo: () => JSX.Element
  cor: string
  fundo: string
}> = [
  {
    id: 'ml',
    nome: 'Mercado Livre',
    papel: 'Anúncios, FULL e devoluções',
    logo: LogoMercadoLivre,
    cor: '#ffe600',
    fundo: 'linear-gradient(160deg, #fffdf0 0%, #fff6cc 100%)',
  },
  {
    id: 'shopee',
    nome: 'Shopee',
    papel: 'Catálogo e pedidos Shopee',
    logo: LogoShopee,
    cor: '#ee4d2d',
    fundo: 'linear-gradient(160deg, #fff7f4 0%, #ffe3da 100%)',
  },
  {
    id: 'operacao',
    nome: 'Operação',
    papel: 'Compras, embalagens e radar',
    logo: LogoOperacao,
    cor: '#0878ff',
    fundo: 'linear-gradient(160deg, #f2f8ff 0%, #d9ebff 100%)',
  },
]

export function PlataformaSelecao({
  onEscolher,
  operadorNome,
  atual,
  onVoltar,
  resumo,
}: PlataformaSelecaoProps) {
  return (
    <div className="nvs-posto">
      <div className="nvs-posto__topo">
        <p className="nvs-posto__eyebrow">NVS Tech</p>
        <h1 className="nvs-posto__titulo">
          {operadorNome ? `Onde você vai atuar, ${operadorNome.split(' ')[0]}?` : 'Onde você vai atuar?'}
        </h1>
        <p className="nvs-posto__sub">
          Escolha a plataforma. O painel abre já com as ferramentas dela.
        </p>
      </div>

      <div className="nvs-posto__cards">
        {CARDS.map((card, i) => {
          const Logo = card.logo
          const linhaResumo = resumo?.[card.id]
          return (
            <button
              key={card.id}
              className={`nvs-posto__card${atual === card.id ? ' is-atual' : ''}`}
              style={{
                background: card.fundo,
                ['--card-cor' as string]: card.cor,
                ['--card-delay' as string]: `${i * 0.9}s`,
              }}
              onClick={() => onEscolher(card.id)}
            >
              <div className="nvs-posto__palco">
                <div className="nvs-posto__logo">
                  <Logo />
                </div>
                <div className="nvs-posto__sombra" />
              </div>

              <div className="nvs-posto__info">
                <span className="nvs-posto__nome">{card.nome}</span>
                <span className="nvs-posto__papel">{card.papel}</span>
                {linhaResumo && <span className="nvs-posto__resumo">{linhaResumo}</span>}
              </div>

              <span className="nvs-posto__entrar">
                {atual === card.id ? 'Continuar aqui' : 'Entrar'}
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          )
        })}
      </div>

      {onVoltar && atual && (
        <button className="nvs-posto__cancelar" onClick={onVoltar}>
          Cancelar e voltar ao painel
        </button>
      )}
    </div>
  )
}
