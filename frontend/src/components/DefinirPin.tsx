import { useState } from 'react'
import './login-theme.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface DefinirPinProps {
  nome: string
  onDefinido: () => void
  onSair: () => void
}

/** Primeiro acesso com o PIN inicial: o operador escolhe o PIN pessoal antes de usar o sistema. */
export function DefinirPin({ nome, onDefinido, onSair }: DefinirPinProps) {
  const [pin, setPin] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    if (pin !== confirmacao) return setErro('Os dois PINs não são iguais.')
    setSalvando(true)
    setErro('')
    try {
      const res = await fetch(`${API_BASE}/api/sessao/trocar-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_novo: pin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Não foi possível salvar o PIN.')
      onDefinido()
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível salvar o PIN.')
    } finally {
      setSalvando(false)
    }
  }

  const campo = (rotulo: string, valor: string, mudar: (v: string) => void) => (
    <label className="lg__campo">
      <span>{rotulo}</span>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={8}
        autoComplete="new-password"
        value={valor}
        onChange={(e) => mudar(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter' && pin && confirmacao) salvar() }}
        disabled={salvando}
      />
    </label>
  )

  return (
    <div className="lg">
      <div className="lg__cena" aria-hidden="true" />
      <main className="lg__conteudo">
        <section className="lg__cartao">
          <span className="lg__cartao-marca">NVS Tech</span>
          <h2 className="lg__cartao-titulo">Olá, {nome}.</h2>
          <p className="lg__cartao-sub">Primeiro acesso: crie seu PIN pessoal (4 a 8 números). Ele substitui o PIN inicial.</p>
          {campo('Novo PIN', pin, setPin)}
          {campo('Repita o novo PIN', confirmacao, setConfirmacao)}
          <button type="button" className="lg__btn" onClick={salvar} disabled={salvando || !pin || !confirmacao}>
            <span>{salvando ? 'Salvando...' : 'Salvar e entrar'}</span>
          </button>
          {erro && <p className="lg__erro">{erro}</p>}
          <p className="lg__ajuda">
            Não é você? <span role="button" tabIndex={0} onClick={onSair} style={{ cursor: 'pointer' }}>Voltar ao login</span>
          </p>
        </section>
      </main>
    </div>
  )
}
