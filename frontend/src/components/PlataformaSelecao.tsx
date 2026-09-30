import { type ReactNode, useEffect, useState } from 'react'

export type Platform = 'ml' | 'shopee' | 'operacao'
export type Atalho = 'lista-compra' | 'estoque-embalagens' | 'radar-full'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface PlataformaSelecaoProps {
  onEscolher: (p: Platform) => void
  atual?: Platform | null
  /** Encerra a sessão do operador e volta para a tela de login. */
  onSair?: () => void
  /** Abre uma ferramenta da operação direto pelo acesso rápido. */
  onAtalho?: (destino: Atalho) => void
  /** Abre a Central de Devoluções (página própria, fora das plataformas). */
  onDevolucoes?: () => void
  operadorNome?: string
  operadorCargo?: string
  mlConectado?: boolean
  inboundsAtivos?: number
  fluxoOk?: boolean
}

/* Moeda oficial do Mercado Livre, recortada do logo horizontal da CDN da
   marca. O wordmark fica de fora porque o nome já aparece no card.
   Exportadas para o AppShell trocar a marca da sidebar pela da
   plataforma ativa. */
export function LogoMercadoLivre() {
  return (
    <span className="cop__moeda-ml">
      <img src="/assets/marcas/mercado-livre.png" alt="" />
    </span>
  )
}

export function LogoShopee() {
  return <img className="cop__marca-shopee" src="/assets/marcas/shopee.svg" alt="" />
}

export function LogoOperacao() {
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
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

function IconeDevolucao() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

function IconeCaixa() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function IconeCaminhao() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
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

function Chevron({ dir = 'right' }: { dir?: 'right' | 'down' }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'right' ? <path d="m9 6 6 6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  )
}

function IconeElo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.1.1l3-3a5 5 0 0 0-7.1-7.1L11.5 4.5" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-3 3a5 5 0 0 0 7.1 7.1l1.4-1.4" />
    </svg>
  )
}

function IconeSair() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

interface ContaML {
  anuncios?: { ativos?: number | null } | null
}

function numBR(v?: number | null): string {
  if (v == null || Number.isNaN(Number(v))) return '--'
  return Number(v).toLocaleString('pt-BR')
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return 'NV'
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (partes[0][0] + ultima).toUpperCase()
}

export function PlataformaSelecao({
  onEscolher,
  atual,
  onSair,
  onAtalho,
  onDevolucoes,
  operadorNome = 'NVS Tech',
  operadorCargo = 'Operador',
  mlConectado,
  inboundsAtivos = 0,
  fluxoOk = true,
}: PlataformaSelecaoProps) {
  const [conta, setConta] = useState<ContaML | null>(null)
  const [menuAberto, setMenuAberto] = useState(false)

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

  // Clique em qualquer outro lugar fecha o menu do perfil.
  useEffect(() => {
    if (!menuAberto) return
    const fechar = () => setMenuAberto(false)
    window.addEventListener('click', fechar)
    return () => window.removeEventListener('click', fechar)
  }, [menuAberto])

  const primeiroNome = operadorNome.trim().split(/\s+/)[0] || 'operador'
  const ferramentas: Array<{ chave: Atalho; nome: string; icone: ReactNode }> = [
    { chave: 'lista-compra', nome: 'Lista de compra', icone: <IconeLista /> },
    { chave: 'estoque-embalagens', nome: 'Embalagens', icone: <IconeCaixa /> },
    { chave: 'radar-full', nome: 'Radar de envio', icone: <IconeCaminhao /> },
  ]

  return (
    <div className="cop">
      <div className="cop__fundo" aria-hidden="true" />

      <header className="cop__topbar">
        <div className="cop__marca">
          <img className="cop__marca-logo" src="/assets/nvs-tech-logo.jpeg" alt="NVS Tech" />
          <span className="cop__marca-risco" aria-hidden="true" />
          <div className="cop__marca-txt">
            <strong>Central de Operações</strong>
            <span>Plataformas · Processos · Resultados</span>
          </div>
        </div>

        <div className="cop__topbar-dir">
          <div className={`cop__sistema${fluxoOk ? '' : ' is-off'}`}>
            <i aria-hidden="true" />
            <div>
              <strong>{fluxoOk ? 'Sistema online' : 'Verificando'}</strong>
              <span>{fluxoOk ? 'Tudo funcionando' : 'Checando integrações'}</span>
            </div>
          </div>

          <div className="cop__perfil-area" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="cop__perfil"
              onClick={() => setMenuAberto((v) => !v)}
              title="Conta do operador"
            >
              <span className="cop__perfil-avatar">{iniciais(operadorNome)}</span>
              <span className="cop__perfil-txt">
                <strong>{operadorNome}</strong>
                <span>{operadorCargo}</span>
              </span>
              <Chevron dir="down" />
            </button>

            {menuAberto && onSair && (
              <div className="cop__perfil-menu">
                <button type="button" onClick={onSair}>
                  <IconeSair />
                  <span>Sair</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="cop__conteudo">
        <section className="cop__hero">
          <div className="cop__hero-txt">
            <span className="cop__hero-ola">Bem-vindo(a), {primeiroNome}</span>
            <h1 className="cop__hero-h1">
              Onde vamos
              <br />
              <em>operar hoje?</em>
            </h1>
            <p className="cop__hero-sub">Escolha a plataforma e acesse todas as suas ferramentas.</p>
          </div>

          <div className="cop__hero-lemas">
            <div className="cop__lema">
              <span>Disciplina</span>
              <span>Processo</span>
              <span>Resultado</span>
              <i aria-hidden="true" />
            </div>
            <div className="cop__lema cop__lema--fim">
              <span>Operação</span>
              <span>que gera</span>
              <strong>Liberdade</strong>
            </div>
          </div>
        </section>

        <div className="cop__grid">
          {/* ---------------- Mercado Livre ---------------- */}
          <article className={`cop__card cop__card--ml${atual === 'ml' ? ' is-atual' : ''}`}>
            <span className="cop__card-bg" aria-hidden="true" />
            <div className="cop__card-corpo">
              <span className={`cop__status${mlConectado ? ' is-ok' : ' is-off'}`}>
                <i aria-hidden="true" />
                {mlConectado ? 'Conectado' : 'Desconectado'}
                <Chevron />
              </span>

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
                  <span>Inbounds pendentes</span>
                </div>
              </div>

              <div className="cop__card-acoes">
                <button className="cop__btn" onClick={() => onEscolher('ml')}>
                  {atual === 'ml' ? 'Continuar no Mercado Livre' : 'Acessar Mercado Livre'}
                  <Seta />
                </button>
                <a
                  className="cop__btn-elo"
                  href={`${API_BASE}/api/ml/conectar`}
                  title={mlConectado ? 'Reconectar integração' : 'Conectar integração'}
                >
                  <IconeElo />
                </a>
              </div>
            </div>
          </article>

          {/* ---------------- Shopee ---------------- */}
          <article className={`cop__card cop__card--shopee${atual === 'shopee' ? ' is-atual' : ''}`}>
            <span className="cop__card-bg" aria-hidden="true" />
            <div className="cop__card-corpo">
              <span className="cop__status is-prep">
                <i aria-hidden="true" />
                Em configuração
                <Chevron />
              </span>

              <h2 className="cop__card-nome">Shopee</h2>
              <p className="cop__card-desc">
                Acompanhe pedidos, catálogo, repasses e performance da loja.
              </p>

              <div className="cop__aviso">
                <strong>Integração ainda não autorizada</strong>
                <span>O webhook já responde. Falta conectar a conta para trazer os dados.</span>
              </div>

              <div className="cop__card-acoes">
                <button className="cop__btn" onClick={() => onEscolher('shopee')}>
                  {atual === 'shopee' ? 'Continuar na Shopee' : 'Acessar Shopee'}
                  <Seta />
                </button>
                <a
                  className="cop__btn-elo"
                  href={`${API_BASE}/api/shopee/conectar`}
                  title="Conectar loja Shopee"
                >
                  <IconeElo />
                </a>
              </div>
            </div>
          </article>

          {/* ---------------- Operação ---------------- */}
          <article className={`cop__card cop__card--op${atual === 'operacao' ? ' is-atual' : ''}`}>
            <span className="cop__card-bg" aria-hidden="true" />
            <div className="cop__card-corpo">
              <span className="cop__status is-ok">
                <i aria-hidden="true" />
                Disponível
                <Chevron />
              </span>

              <h2 className="cop__card-nome">Operação NVS</h2>
              <p className="cop__card-desc">
                Acesse suas ferramentas operacionais em um só lugar.
              </p>

              <div className="cop__ferramentas">
                {ferramentas.map((f) => (
                  <div className="cop__ferramenta" key={f.chave}>
                    {f.icone}
                    <span>{f.nome}</span>
                  </div>
                ))}
              </div>

              <div className="cop__card-acoes">
                <button className="cop__btn" onClick={() => onEscolher('operacao')}>
                  {atual === 'operacao' ? 'Continuar na operação' : 'Abrir operação'}
                  <Seta />
                </button>
              </div>
            </div>
          </article>
        </div>

        {/* ---------------- Acesso rápido ---------------- */}
        {onAtalho && (
          <section className="cop__rapido">
            <div className="cop__rapido-tit">
              <i aria-hidden="true" />
              <div>
                <strong>Acesso rápido</strong>
                <span>Ferramentas mais utilizadas no dia a dia.</span>
              </div>
            </div>

            <div className="cop__rapido-btns">
              {onDevolucoes && (
                <button className="cop__atalho cop__atalho--devolucoes" onClick={onDevolucoes}>
                  <IconeDevolucao />
                  <span>Devoluções</span>
                  <Chevron />
                </button>
              )}
              {ferramentas.map((f) => (
                <button key={f.chave} className="cop__atalho" onClick={() => onAtalho(f.chave)}>
                  {f.icone}
                  <span>{f.nome}</span>
                  <Chevron />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="cop__rodape">
        <div className="cop__rodape-esq">
          <strong>NVS Tech</strong>
          <i aria-hidden="true" />
          <span>Tecnologia que impulsiona resultados.</span>
        </div>
        <div className="cop__rodape-dir">
          <Seta />
          <span>v.1.0.0</span>
        </div>
      </footer>
    </div>
  )
}
