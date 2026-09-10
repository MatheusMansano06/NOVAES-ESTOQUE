import { useState } from 'react'
import './login-theme.css'

export interface OperadorOpcao {
  id: number
  nome: string
}

interface LoginNVSProps {
  operadores: OperadorOpcao[]
  operadorSelecionadoId: string
  onSelecionarOperador: (id: string) => void
  onEntrarComoOperador: () => void
  masterPin: string
  onMasterPinChange: (pin: string) => void
  onEntrarComoMaster: () => void
  carregandoOperadores?: boolean
  entrando?: boolean
  erro?: string
}

function IconeGrafico() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}

function IconeEstoque() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function IconeEnvio() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 17V5a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" />
      <path d="M14 8h4l3 3v5a1 1 0 0 1-1 1h-1" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  )
}

function IconeLucro() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 0 9 9h-9V3z" />
      <path d="M15.5 3.5A9 9 0 0 1 20.5 8.5L15.5 10z" />
    </svg>
  )
}

function IconeCadeado() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function Seta() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

const VANTAGENS = [
  { icone: <IconeGrafico />, titulo: 'Marketplaces', complemento: 'integrados' },
  { icone: <IconeEstoque />, titulo: 'Estoque', complemento: 'em tempo real' },
  { icone: <IconeEnvio />, titulo: 'Envio mais', complemento: 'rápido' },
  { icone: <IconeLucro />, titulo: 'Operação', complemento: 'com mais lucro' },
]

export function LoginNVS({
  operadores,
  operadorSelecionadoId,
  onSelecionarOperador,
  onEntrarComoOperador,
  masterPin,
  onMasterPinChange,
  onEntrarComoMaster,
  carregandoOperadores = false,
  entrando = false,
  erro,
}: LoginNVSProps) {
  // O mockup mostra só o botão de master; o PIN aparece quando ele é aberto.
  const [masterAberto, setMasterAberto] = useState(false)

  const bloqueado = carregandoOperadores || entrando

  return (
    <div className="lg">
      <div className="lg__cena" aria-hidden="true" />

      <header className="lg__topbar">
        <div className="lg__marca">
          <img className="lg__marca-logo" src="/assets/nvs-tech-logo.jpeg" alt="NVS Tech" />
          <span className="lg__marca-risco" aria-hidden="true" />
          <div className="lg__marca-txt">
            <strong>Central de Operações</strong>
            <span>Marketplaces · Processos · Resultados</span>
          </div>
        </div>

        <div className="lg__lema">
          <span>Operação</span>
          <span>em movimento</span>
          <i aria-hidden="true" />
        </div>
      </header>

      <main className="lg__conteudo">
        <section className="lg__pitch">
          <h1 className="lg__h1">
            Mais
            <br />
            controle
            <br />
            <em>mais</em>
            <br />
            <em>resultados.</em>
          </h1>
          <span className="lg__risco" aria-hidden="true" />
          <p className="lg__sub">
            Tudo o que você precisa para gerenciar sua operação em um só lugar.
          </p>

          <ul className="lg__vantagens">
            {VANTAGENS.map((v) => (
              <li key={v.titulo}>
                {v.icone}
                <div>
                  <strong>{v.titulo}</strong>
                  <span>{v.complemento}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="lg__cartao">
          <span className="lg__cartao-marca">NVS Tech</span>
          <h2 className="lg__cartao-titulo">Bem-vindo de volta.</h2>
          <p className="lg__cartao-sub">Acesse sua central de operações.</p>

          <label className="lg__campo">
            <span>Selecione seu usuário</span>
            <select
              value={operadorSelecionadoId}
              onChange={(e) => onSelecionarOperador(e.target.value)}
              disabled={bloqueado}
            >
              <option value="">
                {carregandoOperadores ? 'Carregando operadores...' : 'Selecionar operador'}
              </option>
              {operadores.map((operador) => (
                <option key={operador.id} value={String(operador.id)}>
                  {operador.nome}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="lg__btn"
            onClick={onEntrarComoOperador}
            disabled={bloqueado || !operadorSelecionadoId}
          >
            <span>{entrando ? 'Entrando...' : 'Continuar'}</span>
            <Seta />
          </button>

          <div className="lg__ou">
            <i aria-hidden="true" />
            <span>ou</span>
            <i aria-hidden="true" />
          </div>

          {!masterAberto ? (
            <button
              type="button"
              className="lg__btn lg__btn--fantasma"
              onClick={() => setMasterAberto(true)}
            >
              <IconeCadeado />
              <span>Acesso master</span>
              <Seta />
            </button>
          ) : (
            <div className="lg__master">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                autoFocus
                placeholder="PIN numérico"
                value={masterPin}
                onChange={(e) => onMasterPinChange(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && masterPin) onEntrarComoMaster()
                }}
              />
              <button type="button" onClick={onEntrarComoMaster} disabled={entrando || !masterPin}>
                {entrando ? '...' : 'Entrar'}
              </button>
            </div>
          )}

          {erro && <p className="lg__erro">{erro}</p>}

          <p className="lg__ajuda">
            Precisa de ajuda? <span>Fale com o suporte</span>
          </p>
        </section>
      </main>

      <footer className="lg__rodape">
        <div>
          <i aria-hidden="true" />
          <span>Tecnologia que impulsiona resultados.</span>
        </div>
        <div>
          <i aria-hidden="true" />
          <span>v1.0.0</span>
        </div>
      </footer>
    </div>
  )
}
