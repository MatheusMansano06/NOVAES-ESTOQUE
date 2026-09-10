import { useEffect, useState } from 'react'

export type Platform = 'ml' | 'shopee' | 'operacao'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface PlataformaSelecaoProps {
  onEscolher: (p: Platform) => void
  atual?: Platform | null
  onVoltar?: () => void
  mlConectado?: boolean
  inboundsAtivos?: number
  notas?: number
  divergencias?: number
  /** Últimas notas processadas, para a faixa de atividade recente. */
  recentes?: Array<{ id: number; titulo: string; quando: string | null }>
}

/* Moeda oficial do Mercado Livre, recortada do logo horizontal da CDN da
   marca. O wordmark fica de fora porque o nome já aparece no card. */
function LogoMercadoLivre() {
  return (
    <span className="cop__moeda-ml">
      <img src="/assets/marcas/mercado-livre.png" alt="" />
    </span>
  )
}

function LogoShopee() {
  return <img className="cop__marca-shopee" src="/assets/marcas/shopee.svg" alt="" />
}

function LogoOperacao() {
  return (
    <svg className="cop__marca-op" viewBox="0 0 160 140" aria-hidden="true">
      <defs>
        <linearGradient id="cop-op" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f9bff" />
          <stop offset="100%" stopColor="#0552b5" />
        </linearGradient>
      </defs>
      <path d="M80 22 128 46v48L80 118 32 94V46z" fill="url(#cop-op)" />
      <path d="M80 22 128 46 80 70 32 46z" fill="#7cc2ff" />
      <path d="M80 70v48L32 94V46z" fill="#00102e" opacity="0.2" />
      <circle cx="80" cy="82" r="17" fill="none" stroke="#fff" strokeWidth="6" />
      <circle cx="80" cy="82" r="5" fill="#fff" />
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round">
        <path d="M80 57v8M80 99v8M55 82h8M97 82h8" />
      </g>
    </svg>
  )
}

function IconeLista() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

function IconeCaixa() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function IconeCaminhao() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 17V5a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" />
      <path d="M14 8h4l3 3v5a1 1 0 0 1-1 1h-1" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  )
}

function Seta() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

interface ContaML {
  anuncios?: { ativos?: number | null } | null
  transacoes?: { total?: number | null } | null
}

function numBR(v?: number | null): string {
  if (v == null || Number.isNaN(Number(v))) return '--'
  return Number(v).toLocaleString('pt-BR')
}

export function PlataformaSelecao({
  onEscolher,
  atual,
  onVoltar,
  mlConectado,
  inboundsAtivos = 0,
  notas = 0,
  divergencias = 0,
  recentes = [],
}: PlataformaSelecaoProps) {
  const [conta, setConta] = useState<ContaML | null>(null)

  // O botão cheio marca onde você está. Sem plataforma escolhida ainda,
  // o Mercado Livre é o caminho padrão.
  const destaque: Platform = atual ?? 'ml'
  const classeBtn = (p: Platform) =>
    `cop__btn${destaque === p ? ' cop__btn--primario' : ''}`

  useEffect(() => {
    let ativo = true
    fetch(`${API_BASE}/api/ml/conta`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (ativo && d && !d.erro) setConta(d)
      })
      .catch(() => {})
    return () => {
      ativo = false
    }
  }, [])

  return (
    <div className="cop">
      <div className="cop__wrap">
        <header className="cop__topo">
          <div>
            <h1 className="cop__h1">Central de Operações</h1>
            <p className="cop__sub">Escolha a plataforma que você deseja acessar hoje.</p>
          </div>
          <div className="cop__lema">
            <span>Disciplina</span>
            <span>Processo</span>
            <span>Resultado</span>
            <i aria-hidden="true" />
          </div>
        </header>

        <div className="cop__grid">
          {/* ---------------- Mercado Livre ---------------- */}
          <article className={`cop__card${atual === 'ml' ? ' is-atual' : ''}`}>
            <div className="cop__card-topo">
              <LogoMercadoLivre />
              <span className={`cop__badge${mlConectado ? ' is-ok' : ' is-off'}`}>
                {mlConectado ? 'Conectado' : 'Desconectado'}
              </span>
            </div>

            <h2 className="cop__card-nome">Mercado Livre</h2>
            <p className="cop__card-desc">
              Gerencie anúncios, pedidos, estoque e desempenho da conta.
            </p>

            <div className="cop__metricas">
              <div className="cop__metrica">
                <strong>{numBR(conta?.anuncios?.ativos)}</strong>
                <span>Anúncios ativos</span>
              </div>
              <div className="cop__metrica">
                <strong>{numBR(inboundsAtivos)}</strong>
                <span>Inbounds abertos</span>
              </div>
            </div>

            <button className={classeBtn('ml')} onClick={() => onEscolher('ml')}>
              {atual === 'ml' ? 'Continuar na plataforma' : 'Acessar plataforma'}
              <Seta />
            </button>
          </article>

          {/* ---------------- Shopee ---------------- */}
          <article className={`cop__card${atual === 'shopee' ? ' is-atual' : ''}`}>
            <div className="cop__card-topo">
              <LogoShopee />
              <span className="cop__badge is-prep">Em configuração</span>
            </div>

            <h2 className="cop__card-nome">Shopee</h2>
            <p className="cop__card-desc">
              Acompanhe pedidos, catálogo, repasses e performance da loja.
            </p>

            {/* Sem loja autorizada não há número real para mostrar. */}
            <div className="cop__aviso">
              <strong>Loja ainda não autorizada</strong>
              <span>O webhook já responde. Falta conectar a conta para trazer os dados.</span>
            </div>

            <button className={classeBtn('shopee')} onClick={() => onEscolher('shopee')}>
              {atual === 'shopee' ? 'Continuar na plataforma' : 'Acessar plataforma'}
              <Seta />
            </button>
          </article>

          {/* ---------------- Operação ---------------- */}
          <article className={`cop__card${atual === 'operacao' ? ' is-atual' : ''}`}>
            <div className="cop__card-topo">
              <LogoOperacao />
              <span className="cop__badge is-ok">Disponível</span>
            </div>

            <h2 className="cop__card-nome">Operação</h2>
            <p className="cop__card-desc">
              Acesse a lista de compra, embalagens, radar de envio e demais processos.
            </p>

            <div className="cop__ferramentas">
              <div className="cop__ferramenta">
                <IconeLista />
                <span>Lista de compra</span>
              </div>
              <div className="cop__ferramenta">
                <IconeCaixa />
                <span>Embalagens</span>
              </div>
              <div className="cop__ferramenta">
                <IconeCaminhao />
                <span>Radar de envio</span>
              </div>
            </div>

            <button className={classeBtn('operacao')} onClick={() => onEscolher('operacao')}>
              {atual === 'operacao' ? 'Continuar no módulo' : 'Acessar módulo'}
              <Seta />
            </button>
          </article>
        </div>

        {/* ---------------- Atividade recente ---------------- */}
        {recentes.length > 0 && (
          <section className="cop__atividade">
            <div className="cop__atividade-topo">
              <div>
                <h3>Notas recentes</h3>
                <p>As últimas notas fiscais processadas no sistema.</p>
              </div>
              {divergencias > 0 && (
                <span className="cop__alerta">
                  {divergencias} {divergencias === 1 ? 'item divergente' : 'itens divergentes'}
                </span>
              )}
            </div>

            <ul className="cop__atividade-lista">
              {recentes.slice(0, 3).map((r) => (
                <li key={r.id}>
                  <span className="cop__atividade-titulo">{r.titulo}</span>
                  <span className="cop__atividade-quando">{r.quando ?? '—'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {onVoltar && atual && (
          <div className="cop__rodape">
            <button className="cop__voltar" onClick={onVoltar}>
              Voltar ao painel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
