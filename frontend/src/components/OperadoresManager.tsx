import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

interface OperadorItem {
  id: number
  nome: string
  ativo: number
  criado_em?: string | null
}

interface LogAcao {
  id: number
  acao: string
  entidade_tipo?: string | null
  entidade_id?: string | null
  descricao?: string | null
  detalhes?: Record<string, any> | null
  criado_em?: string | null
}

interface OperadorHistorico {
  operador_nome: string
  operador_role: string
  total_acoes: number
  ultima_acao?: string | null
  acoes: LogAcao[]
}

function fmtDataHora(valor?: string | null) {
  if (!valor) return 'Sem registro'
  const dt = new Date(valor)
  return Number.isNaN(dt.getTime()) ? valor : dt.toLocaleString('pt-BR')
}

export function OperadoresManager() {
  const [operadores, setOperadores] = useState<OperadorItem[]>([])
  const [historico, setHistorico] = useState<OperadorHistorico[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nomeNovoOperador, setNomeNovoOperador] = useState('')
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  const carregar = async () => {
    setLoading(true)
    setErro('')
    try {
      const [operadoresRes, historicoRes] = await Promise.all([
        fetch(`${API_BASE}/api/operadores`, { cache: 'no-store' }),
        fetch(`${API_BASE}/api/operadores/historico?limit=400`, { cache: 'no-store' }),
      ])

      const operadoresJson = await operadoresRes.json()
      const historicoJson = await historicoRes.json()

      if (!operadoresRes.ok) throw new Error(operadoresJson.erro || 'Falha ao carregar operadores')
      if (!historicoRes.ok) throw new Error(historicoJson.erro || 'Falha ao carregar histórico')

      setOperadores(operadoresJson.operadores || [])
      setHistorico(historicoJson.operadores || [])
    } catch (err: any) {
      setErro(err?.message || 'Falha ao carregar operadores')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const criarOperador = async () => {
    const nome = nomeNovoOperador.trim()
    if (!nome) {
      setErro('Digite o nome do operador.')
      return
    }

    setSaving(true)
    setErro('')
    setMensagem('')
    try {
      const res = await fetch(`${API_BASE}/api/operadores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Falha ao criar operador')

      setMensagem(data.mensagem || 'Operador salvo')
      setNomeNovoOperador('')
      await carregar()
    } catch (err: any) {
      setErro(err?.message || 'Falha ao criar operador')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="card">
        <div className="card-body" style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, color: '#0b2050' }}>Cadastro de operadores</h3>
              <p style={{ margin: '0.35rem 0 0 0', color: '#667085' }}>
                O master pode incluir novos nomes e acompanhar tudo por pessoa.
              </p>
            </div>
            <button
              type="button"
              onClick={carregar}
              style={{ padding: '0.7rem 1rem', borderRadius: '10px', border: '1px solid #cdd5df', background: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              Atualizar
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: '0.75rem' }}>
            <input
              value={nomeNovoOperador}
              onChange={(e) => setNomeNovoOperador(e.target.value)}
              placeholder="Novo operador"
              style={{ padding: '0.95rem 1rem', borderRadius: '12px', border: '1px solid #cdd5df', fontSize: '0.98rem' }}
            />
            <button
              type="button"
              onClick={criarOperador}
              disabled={saving}
              style={{ padding: '0.95rem 1.2rem', borderRadius: '12px', border: 'none', background: saving ? '#9bbcf7' : '#1f6fff', color: '#fff', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}
            >
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>

          {erro && <div style={{ color: '#c62828', fontWeight: 700 }}>{erro}</div>}
          {mensagem && <div style={{ color: '#2e7d32', fontWeight: 700 }}>{mensagem}</div>}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {operadores.map((operador) => (
              <div key={operador.id} style={{ padding: '0.7rem 1rem', borderRadius: '999px', background: '#eef4ff', color: '#174ea6', fontWeight: 700 }}>
                {operador.nome}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body" style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#0b2050' }}>Histórico por operador</h3>
            <p style={{ margin: '0.35rem 0 0 0', color: '#667085' }}>
              Upload de nota, inbound, baixa, balanço, vínculos e ajustes ficam registrados aqui.
            </p>
          </div>

          {loading ? (
            <div style={{ color: '#667085' }}>Carregando histórico...</div>
          ) : historico.length === 0 ? (
            <div style={{ color: '#667085' }}>Ainda não há ações registradas.</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {historico.map((grupo) => (
                <div key={grupo.operador_nome} style={{ border: '1px solid #dfe6ee', borderRadius: '16px', background: '#fff' }}>
                  <div style={{ padding: '1rem 1.1rem', borderBottom: '1px solid #eef2f6', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0b2050' }}>{grupo.operador_nome}</div>
                      <div style={{ color: '#667085', fontSize: '0.9rem' }}>
                        {grupo.operador_role === 'master' ? 'Master' : 'Operador'} • {grupo.total_acoes} ações
                      </div>
                    </div>
                    <div style={{ color: '#667085', fontSize: '0.88rem' }}>
                      Última ação: <strong>{fmtDataHora(grupo.ultima_acao)}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '0.85rem', padding: '1rem 1.1rem' }}>
                    {grupo.acoes.slice(0, 25).map((acao) => (
                      <div key={acao.id} style={{ border: '1px solid #edf1f6', borderRadius: '14px', padding: '0.9rem 1rem', background: '#fafcff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ color: '#0b2050', fontWeight: 800 }}>{acao.descricao || acao.acao}</div>
                          <div style={{ color: '#667085', fontSize: '0.85rem' }}>{fmtDataHora(acao.criado_em)}</div>
                        </div>
                        <div style={{ marginTop: '0.4rem', color: '#667085', fontSize: '0.88rem' }}>
                          {acao.entidade_tipo || 'ação'} {acao.entidade_id ? `#${acao.entidade_id}` : ''}
                        </div>
                      </div>
                    ))}
                    {grupo.acoes.length > 25 && (
                      <div style={{ color: '#667085', fontSize: '0.88rem' }}>
                        Mostrando 25 de {grupo.acoes.length} ações desse operador.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
