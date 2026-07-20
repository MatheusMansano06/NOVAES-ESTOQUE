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

/** Uma linha do diff contra o Seller Center. */
interface DiffItem {
  id?: string
  claim_id: string
  pedido_id?: string
  bucket: string
  regra: string
  produto_nome: string
  destino?: string
}
interface DiffResultado {
  recebidos: number
  ml_mostra_nos_escondemos: DiffItem[]
  nos_mostramos_ml_nao: DiffItem[]
  nao_encontrados_no_cache: string[]
  resumo: { ml_mostra_nos_escondemos: number; nos_mostramos_ml_nao: number; nao_encontrados: number }
}

/** Item da esteira "Chegando hoje" — vem de /api/devolucoes/chegando-hoje. */
interface ChegandoCard {
  claim_id: string
  pedido_id: string
  pack_id?: string
  produto_nome: string
  produto_imagem: string
  valor_pago: number
  motivo_label: string
  ml_tipo_logistica: string
  previsao_chegada: string
  recebido?: boolean  // marcado no cliente logo após bipar
}

/** Contadores do painel, já agregados no backend (/api/devolucoes/painel). */
interface Painel {
  total: number
  chamados: number
  reembolsos: number
  riscos: number
  total_tarifas: number
  checklists_ativos: number
  aguardando: number
  perto: number
  pct_pendencias: number
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

/**
 * O painel guarda o QUE mostrar, não os itens: a lista chega depois da
 * abertura (é buscada sob demanda), então capturar o array no clique deixaria
 * o painel preso num estado vazio.
 */
type PainelFlutuante =
  | { tipo: 'todas'; titulo: string }
  | { tipo: 'busca'; titulo: string; termo: string }
  | { tipo: 'reembolso'; titulo: string }
  | { tipo: 'reputacao'; titulo: string }
  | { tipo: 'mediacoes'; titulo: string }
  | { tipo: 'pendencias'; titulo: string }
  | { tipo: 'diff'; titulo: string }
  | { tipo: 'bucket'; titulo: string; bucket: Bucket; prazo?: 'urgente' | 'retirar' }
  | null

export function Devolucoes() {
  const [devolucoes, setDevolucoes] = useState<Devolucao[]>([])
  const [mediacoes, setMediacoes] = useState<Devolucao[]>([])
  const [listaCarregada, setListaCarregada] = useState(false)
  const [carregandoLista, setCarregandoLista] = useState(false)
  const [cards, setCards] = useState<Record<Bucket, CardML[]>>({
    para_revisao: [], para_retirar: [], outros_problemas: [],
  })
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [painelDados, setPainelDados] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [sincAutomatico, setSincAutomatico] = useState(true)
  const [erro, setErro] = useState('')
  const [chegando, setChegando] = useState<ChegandoCard[]>([])
  const [carregandoChegando, setCarregandoChegando] = useState(true)
  const [codigoBip, setCodigoBip] = useState('')
  const [bipMsg, setBipMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [busca, setBusca] = useState('')
  const [diffTexto, setDiffTexto] = useState('')
  const [diffRes, setDiffRes] = useState<DiffResultado | null>(null)
  const [diffLoad, setDiffLoad] = useState(false)
  const [painel, setPainel] = useState<PainelFlutuante>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const syncRodouRef = useRef(false)
  const bipInputRef = useRef<HTMLInputElement>(null)

  /** Só o que o painel mostra: contadores + buckets. Poucos KB, abre instantâneo. */
  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const buckets: Bucket[] = ['para_revisao', 'para_retirar', 'outros_problemas']
      const [p, r, ch, ...cs] = await Promise.all([
        fetch(`${API_BASE}/api/devolucoes/painel`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API_BASE}/api/resumo-ml`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API_BASE}/api/devolucoes/chegando-hoje`, { cache: 'no-store' }).then(x => x.json()),
        ...buckets.map(b =>
          fetch(`${API_BASE}/api/devolucoes/cards?bucket=${b}`, { cache: 'no-store' }).then(x => x.json())),
      ])
      setPainelDados(p)
      setResumo(r)
      setChegando(Array.isArray(ch?.cards) ? ch.cards : [])
      setCards({
        para_revisao: cs[0]?.cards || [],
        para_retirar: cs[1]?.cards || [],
        outros_problemas: cs[2]?.cards || [],
      })
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregando(false)
      setCarregandoChegando(false)
    }
  }, [])

  /**
   * A lista completa (2,3 MB) e as mediações (1,7 MB) só descem quando o
   * operador abre o painel flutuante — carregá-las na abertura da aba era o
   * que fazia a tela demorar a aparecer.
   */
  const carregarLista = useCallback(async () => {
    if (listaCarregada || carregandoLista) return
    setCarregandoLista(true)
    try {
      const [lista, meds] = await Promise.all([
        fetch(`${API_BASE}/api/devolucoes`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API_BASE}/api/devolucoes/mediacoes`, { cache: 'no-store' }).then(x => x.json()),
      ])
      setDevolucoes(Array.isArray(lista) ? lista : [])
      setMediacoes(Array.isArray(meds) ? meds : [])
      setListaCarregada(true)
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setCarregandoLista(false)
    }
  }, [listaCarregada, carregandoLista])

  useEffect(() => { carregar() }, [carregar])

  // Sync automático em background ao abrir (apenas uma vez)
  useEffect(() => {
    if (syncRodouRef.current) return
    syncRodouRef.current = true

    const rodarSync = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/devolucoes/sincronizar-ml`, { method: 'POST' })
        if (r.ok || r.status === 202) {
          const d = await r.json()
          // Aguarda o sync terminar
          if (d.sync_run_id) {
            await acompanharSync(d.sync_run_id)
          }
        }
      } catch { /* rede falhou, segue com cache */ }
      finally {
        setSincAutomatico(false)
      }
    }

    rodarSync()
  }, [])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (painel && !d.open) d.showModal()
    if (!painel && d.open) d.close()
    // buckets saem dos cards (já em memória); diff usa endpoint próprio; o resto precisa da lista.
    if (painel && painel.tipo !== 'bucket' && painel.tipo !== 'diff') carregarLista()
  }, [painel, carregarLista])

  /** Polling do progresso — a conexão do POST não sobrevive ao sync inteiro. */
  const acompanharSync = async (syncRunId: number): Promise<void> => {
    if (!syncRunId) return
    const inicio = Date.now()
    const LIMITE_MS = 30 * 60 * 1000
    while (Date.now() - inicio < LIMITE_MS) {
      await new Promise(res => setTimeout(res, 4000))
      try {
        const r = await fetch(`${API_BASE}/api/devolucoes/sync-status/${syncRunId}`,
                              { cache: 'no-store' })
        if (!r.ok) continue
        const run = await r.json()
        if (run.status !== 'running') {
          // Sync terminou (sucesso ou erro); recarrega tudo
          await carregar()
          setListaCarregada(false)
          return
        }
      } catch { /* rede oscilou; tenta de novo */ }
    }
  }

  const biparCodigo = async (e: React.FormEvent) => {
    e.preventDefault()
    const codigo = codigoBip.trim()
    if (!codigo) return
    setBipMsg(null)
    try {
      const r = await fetch(`${API_BASE}/api/devolucoes/bipar-chegada`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      })
      const d = await r.json()
      if (!r.ok) {
        setBipMsg({ tipo: 'erro', texto: String(d.mensagem || 'Código não encontrado na fila.') })
      } else {
        setChegando(prev => {
          const naLista = prev.some(c => c.claim_id === d.claim_id)
          if (naLista) {
            return prev.map(c => c.claim_id === d.claim_id ? { ...c, recebido: true } : c)
          }
          // Chegou mas não estava previsto para hoje: entra já como recebido.
          return [{
            claim_id: d.claim_id, pedido_id: codigo, produto_nome: d.produto_nome || '',
            produto_imagem: d.produto_imagem || '', valor_pago: 0, motivo_label: '',
            ml_tipo_logistica: '', previsao_chegada: '', recebido: true,
          }, ...prev]
        })
        setBipMsg(d.ja_recebido
          ? { tipo: 'erro', texto: `Já bipado: ${d.produto_nome || 'item'}` }
          : { tipo: 'ok', texto: `✓ Recebido: ${d.produto_nome || 'item'}` })
      }
    } catch (err) {
      setBipMsg({ tipo: 'erro', texto: String(err instanceof Error ? err.message : err) })
    } finally {
      setCodigoBip('')
      bipInputRef.current?.focus()  // pistola bipa a próxima sem clicar
    }
  }

  const chegandoRestante = chegando.filter(c => !c.recebido).length
  const recebidosHoje = chegando.filter(c => c.recebido).length

  // O ML separa os pickups por prazo: "Urgentes" (retirar em <=3 dias) fica fora
  // de "Para retirar no correio". A classificação (bucket) é a mesma; a divisão
  // é só de apresentação, por due_date — por isso é feita aqui, não na Bíblia.
  const ehUrgente = (c: CardML) => {
    const d = diasAte(c.due_date)
    return d !== null && d <= 3
  }
  const urgentesCards = (cards.para_retirar || []).filter(ehUrgente)
  const retirarCards = (cards.para_retirar || []).filter(c => !ehUrgente(c))

  const buscarPedido = (e: React.FormEvent) => {
    e.preventDefault()
    const q = busca.trim()
    if (!q) return
    setPainel({ tipo: 'busca', titulo: `Resultado para "${q}"`, termo: q })
  }

  const compararSellerCenter = async () => {
    const ids = diffTexto.split(/[^0-9]+/).filter(Boolean)
    if (!ids.length) { setDiffRes(null); return }
    setDiffLoad(true)
    try {
      const r = await fetch(`${API_BASE}/api/devolucoes/diff-seller-center`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      setDiffRes(await r.json())
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    } finally {
      setDiffLoad(false)
    }
  }

  // Contadores agregados no backend (as regras são as mesmas do original).
  const chamados = painelDados?.chamados ?? 0
  const reembolsos = painelDados?.reembolsos ?? 0
  const riscos = painelDados?.riscos ?? 0
  const totalTarifas = painelDados?.total_tarifas ?? 0
  const nChecklistsAtivos = painelDados?.checklists_ativos ?? 0
  const aguardando = painelDados?.aguardando ?? 0
  const perto = painelDados?.perto ?? 0
  const pctPendencias = painelDados?.pct_pendencias ?? 0

  /** Só para o painel flutuante de pendências — depende da lista carregada. */
  const checklistsAtivos = useMemo(
    () => devolucoes.filter(i => Number(i.etapa_checklist_atual || 0) > 0 && !isFinal(i)), [devolucoes])

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
    if (painel.tipo === 'diff') {
      const linha = (d: DiffItem) => (
        <article className="diff-row" key={d.claim_id}>
          <b>#{d.claim_id}</b>
          <strong>{d.produto_nome || '(sem título)'}</strong>
          <small>balde: <code>{d.bucket}</code>{d.destino ? ` · ${d.destino}` : ''}</small>
          <small className="diff-regra">regra: {d.regra || '—'}</small>
        </article>
      )
      return (
        <div className="diff-panel">
          <p className="diff-help">
            Cole os números que o ML mostra em “Próximas a serem atendidas” (venda, pacote ou claim).
            Separe por espaço, vírgula ou quebra de linha.
          </p>
          <textarea className="diff-input" value={diffTexto} rows={4}
                    onChange={e => setDiffTexto(e.target.value)}
                    placeholder="2000012345  2000067890  5417..." />
          <button type="button" className="update-ml-button" onClick={compararSellerCenter}
                  disabled={diffLoad}>
            {diffLoad ? 'Comparando…' : 'Comparar'}
          </button>
          {diffRes && (
            <div className="diff-result">
              <p className="diff-summary">
                {diffRes.recebidos} ID(s) · <b>{diffRes.resumo.ml_mostra_nos_escondemos}</b> o ML mostra e nós escondemos ·
                {' '}<b>{diffRes.resumo.nos_mostramos_ml_nao}</b> nós mostramos e o ML não ·
                {' '}<b>{diffRes.resumo.nao_encontrados}</b> fora do cache
              </p>
              <div className="diff-group">
                <h3>ML mostra, nós escondemos ({diffRes.ml_mostra_nos_escondemos.length})</h3>
                {diffRes.ml_mostra_nos_escondemos.length
                  ? diffRes.ml_mostra_nos_escondemos.map(linha)
                  : <p className="mediacoes-empty">Nada aqui — não escondemos nenhum que o ML lista.</p>}
              </div>
              <div className="diff-group">
                <h3>Nós mostramos, ML não ({diffRes.nos_mostramos_ml_nao.length})</h3>
                {diffRes.nos_mostramos_ml_nao.length
                  ? diffRes.nos_mostramos_ml_nao.map(linha)
                  : <p className="mediacoes-empty">Nada aqui — tudo que exibimos está na lista do ML.</p>}
              </div>
              {diffRes.nao_encontrados_no_cache.length > 0 && (
                <div className="diff-group">
                  <h3>Fora do cache ({diffRes.nao_encontrados_no_cache.length})</h3>
                  <p className="diff-regra">{diffRes.nao_encontrados_no_cache.join(', ')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )
    }
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
      let lista = cards[painel.bucket] || []
      if (painel.bucket === 'para_retirar' && painel.prazo) {
        lista = lista.filter(painel.prazo === 'urgente' ? ehUrgente : c => !ehUrgente(c))
      }
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
    // todas / busca / reembolso / reputação — todos saem da lista
    if (carregandoLista && !listaCarregada) {
      return <div className="empty compact"><p>Carregando devoluções…</p></div>
    }
    let itens: Devolucao[] = devolucoes
    if (painel.tipo === 'busca') {
      const q = painel.termo.toLowerCase()
      itens = devolucoes.filter(i =>
        `${i.pedido_id} ${i.cliente_nome} ${i.produto_nome} ${i.ml_claim_id || ''}`
          .toLowerCase().includes(q))
    } else if (painel.tipo === 'reembolso') {
      itens = mediacoes.filter(i => i.situacao_mediacao === 'concluida')
    } else if (painel.tipo === 'reputacao') {
      itens = devolucoes.filter(i => hasReputationRisk(i) && !isFinal(i))
    }
    return itens.length ? (
      <div className="floating-grid">{itens.map(i => cardFlutuante(i))}</div>
    ) : (
      <div className="empty compact">
        <h2>Nenhuma devolução encontrada</h2>
        <p>
          {devolucoes.length
            ? 'Nada bate com esse filtro.'
            : 'A sincronização com o Mercado Livre roda sozinha ao abrir — aguarde alguns instantes.'}
        </p>
      </div>
    )
  }

  return (
    <div className="devolucoes-page">
      <main className="meli-shell reference-shell triage-layout">
        <section className="center-workspace">
          <section className="dashboard-hero">
            <h1>Gerencie suas <span>devoluções</span></h1>
            <small>Acompanhe, revise e resolva pendências de devolução de forma rápida e inteligente.</small>
          </section>

          <section className="order-entry-panel esteira-panel">
            <div className="esteira-top">
              <div className="esteira-head">
                <p className="eyebrow">A caminho do barracão</p>
                <h1 className="esteira-title">Bipe as devoluções que chegaram</h1>
                <span>Todas as devoluções vindo para você. Bipe cada uma conforme chega para dar entrada.</span>
                {sincAutomatico && <small className="esteira-sync">Sincronizando com o Mercado Livre…</small>}
              </div>
              <div className="esteira-stats">
                <div className="esteira-stat big">
                  <strong>{carregandoChegando ? '—' : chegandoRestante}</strong>
                  <span>a bipar</span>
                </div>
                <div className="esteira-stat ok">
                  <strong>{carregandoChegando ? '—' : recebidosHoje}</strong>
                  <span>já recebidas</span>
                </div>
              </div>
            </div>

            <div className="esteira-forms">
              <form className="search-pill-form bip" onSubmit={biparCodigo}>
                <span className="input-chip">Bipe</span>
                <input ref={bipInputRef} className="read-input" value={codigoBip}
                       onChange={e => setCodigoBip(e.target.value)}
                       inputMode="search" autoComplete="off"
                       placeholder="Venda, pacote ou rastreio" autoFocus />
                <button type="submit">Confirmar chegada</button>
              </form>
              <form className="search-pill-form busca" onSubmit={buscarPedido}>
                <span className="input-chip">Buscar</span>
                <input className="read-input" value={busca} onChange={e => setBusca(e.target.value)}
                       inputMode="search" autoComplete="off"
                       placeholder="Pedido, cliente ou produto" />
                <button type="submit">Buscar venda</button>
              </form>
            </div>
            {bipMsg && (
              <div className={`import-feedback bip-${bipMsg.tipo}`}>{bipMsg.texto}</div>
            )}
            {erro && (
              <div className="import-feedback">⚠️ {erro}</div>
            )}

            <div className="esteira-lista">
              {carregandoChegando ? (
                <p className="mediacoes-empty">Carregando fila de chegada…</p>
              ) : !chegando.length ? (
                <div className="esteira-vazio">
                  <span className="esteira-vazio-icone" aria-hidden="true">📦</span>
                  <strong>Nenhuma devolução a caminho</strong>
                  <small>Quando houver devoluções vindo para o seu endereço, elas aparecem aqui para bipar.</small>
                </div>
              ) : chegando.map((c, i) => (
                <article key={c.claim_id} className={`esteira-item ${c.recebido ? 'recebido' : ''}`}>
                  <span className="esteira-pos">{i + 1}</span>
                  <img src={c.produto_imagem || IMG_VAZIA} alt="" loading="lazy" />
                  <div className="esteira-item-info">
                    <b>#{String(c.pedido_id || '').replace(/\D/g, '') || '-'}</b>
                    <strong>{c.produto_nome || '(sem título)'}</strong>
                    <small>{c.motivo_label || 'Devolução'} · {money(c.valor_pago)}</small>
                  </div>
                  <span className={`esteira-tag ${c.recebido ? 'ok' : 'wait'}`}>
                    {c.recebido ? '✓ Recebido' : 'Aguardando'}
                  </span>
                </article>
              ))}
            </div>
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
                              onClick={() => setPainel({ tipo: 'reembolso', titulo: 'Aguardando reembolso' })}>
                        Reembolso <b>{reembolsos}</b>
                      </button>
                      <button type="button" className="shortcut-chip"
                              onClick={() => setPainel({ tipo: 'reputacao', titulo: 'Risco de reputação' })}>
                        Reputação <b>{riscos}</b>
                      </button>
                    </div>
                    <button type="button" className="summary-link"
                            onClick={() => setPainel({ tipo: 'todas', titulo: 'Todas as devolucoes' })}>
                      Ver todas
                    </button>
                    <button type="button" className="summary-link"
                            onClick={() => setPainel({ tipo: 'diff', titulo: 'Conferir vs Seller Center' })}>
                      Conferir ML
                    </button>
                  </div>
                </div>
              </div>
              <div className="summary-list">
                {itemResumo('para_revisao', 'card-blue', 'review', 'Para sua revisão', 'Atenção necessária')}
                <button type="button" className="summary-item card-red"
                        onClick={() => setPainel({ tipo: 'bucket', bucket: 'para_retirar', prazo: 'urgente', titulo: 'Urgentes — retirar em até 3 dias' })}>
                  <span className="summary-icon summary-icon-alert" aria-hidden="true" />
                  <strong className="item-count">{urgentesCards.length}</strong>
                  <span className="item-label">Urgentes (retirar)</span>
                  <small className="item-tag">Últimos 3 dias</small>
                </button>
                <button type="button" className="summary-item card-orange"
                        onClick={() => setPainel({ tipo: 'bucket', bucket: 'para_retirar', prazo: 'retirar', titulo: 'Para retirar no correio' })}>
                  <span className="summary-icon summary-icon-mail" aria-hidden="true" />
                  <strong className="item-count">{retirarCards.length}</strong>
                  <span className="item-label">Para retirar no correio</span>
                  <small className="item-tag">Prazo &gt; 3 dias</small>
                </button>
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
                    : nChecklistsAtivos
                      ? `${nChecklistsAtivos} checklist(s) em andamento.`
                      : 'Nenhum checklist em andamento no momento.'}
                </small>
              </div>
            </div>
            <div className="pending-col right">
              <article><strong>{nChecklistsAtivos}</strong><span>Checklists ativos</span></article>
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
