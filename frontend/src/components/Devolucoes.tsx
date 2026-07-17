import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './Devolucoes.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Bucket = 'para_revisao' | 'para_retirar' | 'outros_problemas'

/** Linha da tabela `devolucoes` — alimenta o painel flutuante, os chips e as tarifas. */
interface Devolucao {
  id: number
  pedido_id: string
  cliente_nome: string
  produto_nome: string
  produto_imagem?: string | null
  status: string
  requer_acao: number
  prioridade_prazo?: string | null
  prazo_resolucao?: string | null
  ml_claim_id?: string | null
  ml_return_id?: string | null
  ml_tipo_logistica?: string | null
  ml_tarifa_devolucao?: number | null
  etapa_checklist_atual?: number | null
  motivo_devolucao?: string | null
  acao_recomendada?: string | null
  /** Derivado por /api/devolucoes/mediacoes, não é coluna. */
  situacao_mediacao?: 'processando' | 'concluida'
}

/** Card do cache de classificação — alimenta os números do resumo. */
interface CardML {
  claim_id: string
  pedido_id: string
  bucket: Bucket
  motivo_label: string
  produto_nome: string
  produto_imagem: string
  valor_pago: number
  ml_tipo_logistica: string
  mandatory: number
  due_date: string
}

interface Resumo {
  para_revisao: number
  para_retirar: number
  outros_problemas: number
  total: number
  fonte: string
}

const IMG_VAZIA =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='8' fill='%23f1f5f9'/%3E%3Cpath d='M25 64h46L58 43l-10 13-7-9-16 17Z' fill='%23cbd5e1'/%3E%3Ccircle cx='35' cy='34' r='8' fill='%23dbe4ef'/%3E%3C/svg%3E"

const STATUS_LABEL: Record<string, string> = {
  aprovado: 'Aprovado', parcial: 'Parcial', reprovado: 'Reprovado',
  encerrado: 'Encerrado', sem_divergencia: 'Sem divergência',
  aguardando_plataforma: 'Aguardando plataforma', aguardando_produto: 'Aguardando produto',
  produto_recebido: 'Produto recebido', em_analise: 'Em análise',
  divergencia_encontrada: 'Divergência encontrada', contestacao_aberta: 'Contestação aberta',
  nao_recebido: 'Não recebido',
}

const money = (v?: number | null) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const label = (v?: string | null) => STATUS_LABEL[String(v || '')] || String(v || '-')

const isFinal = (i: Devolucao) =>
  ['aprovado', 'parcial', 'reprovado', 'encerrado', 'sem_divergencia'].includes(i.status)
const isFull = (i: Devolucao) => i.ml_tipo_logistica === 'full_ml'
const needsReview = (i: Devolucao) =>
  ['produto_recebido', 'divergencia_encontrada', 'em_analise'].includes(i.status) &&
  Number(i.requer_acao ?? 1) === 1
const hasReputationRisk = (i: Devolucao) =>
  i.motivo_devolucao === 'PDD9952' ||
  String(i.acao_recomendada || '').toLowerCase().includes('reputa')

// Dias de calendário: um prazo às 23:33 de hoje é "critica", não "alta".
const diasAte = (iso?: string | null): number | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const hoje = new Date()
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const b = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

const calcularUrgencia = (i: Devolucao) => {
  if (isFinal(i)) return 'finalizado'
  const dias = diasAte(i.prazo_resolucao)
  if (dias === null) return 'baixa'
  if (dias <= 1) return 'critica'
  if (dias <= 3) return 'alta'
  if (dias <= 7) return 'media'
  return 'baixa'
}

const mlPrimaryId = (i: Devolucao) =>
  `#${String(i.ml_claim_id || i.ml_return_id || i.pedido_id || '-').replace(/\D/g, '') || '-'}`
const mlDetailUrl = (i: Devolucao) =>
  `https://www.mercadolivre.com.br/vendas/${String(i.pedido_id || '').replace(/\D/g, '')}/detalhe`

type PainelFlutuante =
  | { tipo: 'todas'; titulo: string; itens: Devolucao[] }
  | { tipo: 'mediacoes'; titulo: string }
  | { tipo: 'pendencias'; titulo: string }
  | { tipo: 'bucket'; titulo: string; bucket: Bucket }
  | null

export function Devolucoes() {
  const [devolucoes, setDevolucoes] = useState<Devolucao[]>([])
  const [mediacoes, setMediacoes] = useState<Devolucao[]>([])
  const [cards, setCards] = useState<Record<Bucket, CardML[]>>({
    para_revisao: [], para_retirar: [], outros_problemas: [],
  })
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState<'' | 'rapido' | 'completo'>('')
  const [feedback, setFeedback] = useState('')
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [painel, setPainel] = useState<PainelFlutuante>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const buckets: Bucket[] = ['para_revisao', 'para_retirar', 'outros_problemas']
      const [lista, meds, r, ...cs] = await Promise.all([
        fetch(`${API_BASE}/api/devolucoes`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API_BASE}/api/devolucoes/mediacoes`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API_BASE}/api/resumo-ml`, { cache: 'no-store' }).then(x => x.json()),
        ...buckets.map(b =>
          fetch(`${API_BASE}/api/devolucoes/cards?bucket=${b}`, { cache: 'no-store' }).then(x => x.json())),
      ])
      setDevolucoes(Array.isArray(lista) ? lista : [])
      setMediacoes(Array.isArray(meds) ? meds : [])
      setResumo(r)
      setCards({
        para_revisao: cs[0]?.cards || [],
        para_retirar: cs[1]?.cards || [],
        outros_problemas: cs[2]?.cards || [],
      })
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (painel && !d.open) d.showModal()
    if (!painel && d.open) d.close()
  }, [painel])

  const sincronizar = async (modo: 'rapido' | 'completo') => {
    setSincronizando(modo)
    setErro('')
    setFeedback(modo === 'completo'
      ? 'Trazendo todas as devoluções do ML (abertas e fechadas). Leva alguns minutos…'
      : 'Atualizando a fila no Mercado Livre…')
    try {
      const rota = modo === 'completo'
        ? '/api/devolucoes/sincronizar-ml-completo'
        : '/api/devolucoes/sincronizar-ml'
      const r = await fetch(`${API_BASE}${rota}`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro || d.mensagem || 'Falha ao sincronizar')
      setFeedback(modo === 'completo'
        ? `Pronto: ${d.criadas ?? 0} criadas, ${d.atualizadas ?? 0} atualizadas.`
        : `Fila atualizada: ${d.resumo?.total ?? 0} na fila.`)
      await carregar()
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
      setFeedback('')
    } finally {
      setSincronizando('')
    }
  }

  const buscarPedido = (e: React.FormEvent) => {
    e.preventDefault()
    const q = busca.trim().toLowerCase()
    if (!q) return
    const achados = devolucoes.filter(i =>
      `${i.pedido_id} ${i.cliente_nome} ${i.produto_nome} ${i.ml_claim_id || ''}`
        .toLowerCase().includes(q))
    setPainel({ tipo: 'todas', titulo: `Resultado para "${busca.trim()}"`, itens: achados })
  }

  // Chamados/Reembolso vêm das mediações (situacao_mediacao), como no original.
  const chamados = useMemo(
    () => mediacoes.filter(i => i.situacao_mediacao === 'processando').length, [mediacoes])
  const reembolsos = useMemo(
    () => mediacoes.filter(i => i.situacao_mediacao === 'concluida').length, [mediacoes])
  const riscos = useMemo(
    () => devolucoes.filter(i => hasReputationRisk(i) && !isFinal(i)).length, [devolucoes])
  const totalTarifas = useMemo(
    () => devolucoes.reduce((s, i) => s + Math.abs(Number(i.ml_tarifa_devolucao || 0)), 0), [devolucoes])

  const checklistsAtivos = useMemo(
    () => devolucoes.filter(i => Number(i.etapa_checklist_atual || 0) > 0 && !isFinal(i)), [devolucoes])
  const aguardando = useMemo(() => devolucoes.filter(needsReview).length, [devolucoes])
  const perto = useMemo(
    () => devolucoes.filter(i => ['critica', 'alta'].includes(calcularUrgencia(i))).length, [devolucoes])
  const pctPendencias = devolucoes.length
    ? Math.round((checklistsAtivos.length / devolucoes.length) * 100) : 0

  const itemResumo = (b: Bucket, cls: string, icone: string, texto: string, tag: string) => (
    <button type="button" className={`summary-item ${cls}`}
            onClick={() => setPainel({ tipo: 'bucket', titulo: texto, bucket: b })}>
      <span className={`summary-icon summary-icon-${icone}`} aria-hidden="true" />
      <strong className="item-count">{resumo ? resumo[b] ?? 0 : 0}</strong>
      <span className="item-label">{texto}</span>
      <small className="item-tag">{tag}</small>
    </button>
  )

  const cardFlutuante = (i: Devolucao, extra?: string) => (
    <article className="floating-card" key={i.id}>
      <img src={i.produto_imagem || IMG_VAZIA} alt="" loading="lazy" />
      <b>{mlPrimaryId(i)}</b>
      <strong>{i.produto_nome}</strong>
      <small>{extra ?? `${isFull(i) ? 'FULL' : 'ORGANICA'} · ${label(i.status)}`}</small>
      <span className="floating-card-actions">
        <a href={mlDetailUrl(i)} target="_blank" rel="noreferrer">Ver detalhe ML</a>
      </span>
    </article>
  )

  const conteudoPainel = () => {
    if (!painel) return null
    if (painel.tipo === 'mediacoes') {
      const processando = mediacoes.filter(i => i.situacao_mediacao === 'processando')
      const concluidas = mediacoes.filter(i => i.situacao_mediacao === 'concluida')
      return (
        <>
          <div className="mediacoes-group">
            <h3>Processando no Mercado Livre ({processando.length})</h3>
            {processando.length ? (
              <div className="floating-grid">
                {processando.map(i => cardFlutuante(i, 'Status: processando'))}
              </div>
            ) : <p className="mediacoes-empty">Nenhuma mediação em processamento.</p>}
          </div>
          <div className="mediacoes-group">
            <h3>Concluídas ({concluidas.length})</h3>
            {concluidas.length ? (
              <div className="floating-grid">
                {concluidas.map(i => cardFlutuante(i,
                  `Resultado: ${label(i.status)} · Tarifa: ${money(i.ml_tarifa_devolucao || 0)}`))}
              </div>
            ) : <p className="mediacoes-empty">Nenhuma mediação concluída.</p>}
          </div>
        </>
      )
    }
    if (painel.tipo === 'pendencias') {
      return checklistsAtivos.length ? (
        <div className="floating-grid compact-grid">
          {checklistsAtivos.map(i => cardFlutuante(i, `Etapa ${i.etapa_checklist_atual}`))}
        </div>
      ) : (
        <div className="empty compact">
          <h2>Nada em andamento</h2>
          <p>Checklists pausados aparecem aqui.</p>
        </div>
      )
    }
    if (painel.tipo === 'bucket') {
      const lista = cards[painel.bucket] || []
      if (!lista.length) {
        return (
          <div className="empty compact">
            <h2>Nenhuma devolução neste filtro</h2>
            <p>Use “Atualizar ML” para refazer a fila.</p>
          </div>
        )
      }
      return (
        <div className="floating-grid">
          {lista.map(c => {
            const dias = diasAte(c.due_date)
            const prazo = dias === null ? ''
              : dias < 0 ? ' · VENCIDO'
              : dias === 0 ? ' · vence HOJE'
              : dias === 1 ? ' · vence amanhã' : ` · ${dias} dias`
            return (
              <article className="floating-card" key={c.claim_id}>
                <img src={c.produto_imagem || IMG_VAZIA} alt="" loading="lazy" />
                <b>#{c.claim_id}</b>
                <strong>{c.produto_nome || '(sem título)'}</strong>
                <small>
                  {c.motivo_label || '—'}{prazo}
                  {c.mandatory ? ' · obrigatório' : ''}
                  {c.ml_tipo_logistica === 'full_ml' ? ' · FULL' : ''}
                  {` · ${money(c.valor_pago)}`}
                </small>
                <span className="floating-card-actions">
                  <a href={`https://www.mercadolivre.com.br/vendas/${c.pedido_id}/detalhe`}
                     target="_blank" rel="noreferrer">Ver detalhe ML</a>
                </span>
              </article>
            )
          })}
        </div>
      )
    }
    // todas / resultado de busca
    return painel.itens.length ? (
      <div className="floating-grid">{painel.itens.map(i => cardFlutuante(i))}</div>
    ) : (
      <div className="empty compact">
        <h2>Nenhuma devolução encontrada</h2>
        <p>
          {devolucoes.length
            ? 'Nada bate com essa busca.'
            : 'Rode “Sincronizar tudo” para trazer as devoluções do Mercado Livre.'}
        </p>
      </div>
    )
  }

  return (
    <div className="devolucoes-page">
      <main className="meli-shell reference-shell triage-layout">
        <section className="center-workspace">
          <section className="dashboard-hero">
            <p>BEM-VINDO DE VOLTA</p>
            <h1>Gerencie suas <span>devoluções</span></h1>
            <small>Acompanhe, revise e resolva pendências de devolução de forma rápida e inteligente.</small>
          </section>

          <section className="order-entry-panel">
            <div>
              <p className="eyebrow">Entrada de devolucao</p>
              <h1>Leia ou digite o ID do pedido</h1>
              <span>Use a pistola de QR code/codigo de barras ou digite o numero manualmente.</span>
            </div>
            <div className="order-entry-actions">
              <form className="search-pill-form" onSubmit={buscarPedido}>
                <span className="input-chip">ID ML</span>
                <input className="read-input" value={busca} onChange={e => setBusca(e.target.value)}
                       inputMode="search" autoComplete="off"
                       placeholder="Pedido, pacote ou rastreio" autoFocus />
                <button type="submit">Buscar venda</button>
              </form>
              <button type="button" className="update-ml-button"
                      onClick={() => sincronizar('rapido')} disabled={!!sincronizando}>
                {sincronizando === 'rapido' ? 'Atualizando…' : 'Atualizar ML'}
              </button>
              <button type="button" className="update-ml-button"
                      onClick={() => sincronizar('completo')} disabled={!!sincronizando}
                      title="Traz todas as devoluções (abertas e fechadas) do ML para o banco. Leva minutos.">
                {sincronizando === 'completo' ? 'Sincronizando…' : 'Sincronizar tudo'}
              </button>
            </div>
            {(feedback || erro) && (
              <div className="import-feedback">{erro ? `⚠️ ${erro}` : feedback}</div>
            )}
          </section>

          <section className="summary-consolidated">
            <div className="summary-card">
              <div className="summary-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2>Próximas a serem atendidas</h2>
                    <p>Organize e priorize suas pendências</p>
                  </div>
                  <strong className="sr-total">{resumo?.total ?? 0}</strong>
                  <div className="summary-header-actions">
                    <div className="summary-shortcuts">
                      <button type="button" className="shortcut-chip"
                              onClick={() => setPainel({ tipo: 'mediacoes', titulo: 'Acompanhamento de mediações' })}>
                        Chamados <b>{chamados}</b>
                      </button>
                      <button type="button" className="shortcut-chip"
                              onClick={() => setPainel({
                                tipo: 'todas', titulo: 'Aguardando reembolso',
                                itens: mediacoes.filter(i => i.situacao_mediacao === 'concluida'),
                              })}>
                        Reembolso <b>{reembolsos}</b>
                      </button>
                      <button type="button" className="shortcut-chip"
                              onClick={() => setPainel({
                                tipo: 'todas', titulo: 'Risco de reputação',
                                itens: devolucoes.filter(i => hasReputationRisk(i) && !isFinal(i)),
                              })}>
                        Reputação <b>{riscos}</b>
                      </button>
                    </div>
                    <button type="button" className="summary-link"
                            onClick={() => setPainel({
                              tipo: 'todas', titulo: 'Todas as devolucoes', itens: devolucoes,
                            })}>
                      Ver todas
                    </button>
                  </div>
                </div>
              </div>
              <div className="summary-list">
                {itemResumo('para_revisao', 'card-blue', 'review', 'Para sua revisão', 'Atenção necessária')}
                {itemResumo('para_retirar', 'card-orange', 'mail', 'Para retirar no correio', 'Aguardando envio')}
                {itemResumo('outros_problemas', 'card-purple', 'alert', 'Outros problemas', 'Demais pendências')}
                <button type="button" className="summary-item card-teal">
                  <span className="summary-icon summary-icon-chart" aria-hidden="true" />
                  <strong className="item-count">{money(totalTarifas)}</strong>
                  <span className="item-label">Tarifa de devolução</span>
                  <small className="item-tag">Valor descontado</small>
                </button>
              </div>
            </div>
          </section>

          <section className="pending-card">
            <div className="pending-col left">
              <h3>Pendências</h3>
              <p>Checklists iniciados</p>
              <button type="button" className="ghost-outline"
                      onClick={() => setPainel({ tipo: 'pendencias', titulo: 'Checklists em andamento' })}>
                Visualizar pendências
              </button>
            </div>
            <div className="pending-col center">
              <div className="progress-ring"><span>{pctPendencias}%</span></div>
              <div>
                <h4>Em andamento</h4>
                <p>Checklists iniciados</p>
                <small>
                  {carregando ? 'Carregando…'
                    : checklistsAtivos.length
                      ? `${checklistsAtivos.length} checklist(s) em andamento.`
                      : 'Nenhum checklist em andamento no momento.'}
                </small>
              </div>
            </div>
            <div className="pending-col right">
              <article><strong>{checklistsAtivos.length}</strong><span>Checklists ativos</span></article>
              <article><strong>{aguardando}</strong><span>Aguardando sua ação</span></article>
              <article><strong>{perto}</strong><span>Perto do vencimento</span></article>
            </div>
          </section>

          <footer className="dashboard-footer">
            <p>Precisa de ajuda? Nossa central de ajuda está disponível 24/7.</p>
            <button type="button" className="ghost-outline">Abrir suporte</button>
          </footer>
        </section>
      </main>

      <dialog ref={dialogRef} className="floating-page-dialog"
              onClose={() => setPainel(null)}
              onClick={e => { if (e.target === dialogRef.current) setPainel(null) }}>
        <div className="floating-page">
          <header>
            <div>
              <p className="eyebrow">
                {painel?.tipo === 'pendencias' ? 'Pendencias' : 'Atendimento'}
              </p>
              <h2>{painel?.titulo || 'Atendimento'}</h2>
            </div>
            <button type="button" className="dialog-close" aria-label="Fechar"
                    onClick={() => setPainel(null)}>x</button>
          </header>
          <div className="floating-panel-content">{conteudoPainel()}</div>
        </div>
      </dialog>
    </div>
  )
}
