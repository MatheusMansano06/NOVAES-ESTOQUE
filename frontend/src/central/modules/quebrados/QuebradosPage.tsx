import { Fragment, useEffect, useState, type FormEvent } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { api } from "../../shared/api";
import type { Plataforma } from "../../shared/devolucao";
import { reais } from "../../shared/formato";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { usarDados } from "../../shared/usarDados";
import { diaMes, faturaDoDia, NOME_MES, ultimasFaturas } from "../bi/BiPage";

interface Celula { quantidade: number; valor: number }
interface Produto extends Record<Plataforma, Celula> {
  sku: string; nome: string | null; imagem: string | null; quantidade: number; valor: number; sem_custo: number;
  custo_atual: number | null;
}
interface Resposta {
  inicio: string; fim: string; produtos: Produto[];
  total: Celula & { sem_custo: number } & Record<Plataforma, Celula>;
}
interface Vigencia { custo: number; vigente_desde: string; registrado_em: string; registrado_por: string | null }

const PLATAFORMAS: Plataforma[] = ["mercado_livre", "shopee"];
const hoje = () => new Date().toLocaleDateString("sv-SE");
const ANTES_DE_TUDO = "2000-01-01";

export function QuebradosPage({ nav }: { nav: Navegacao }) {
  const [periodo, setPeriodo] = useState(faturaDoDia(new Date()));
  const [recarga, setRecarga] = useState(0);
  const [editando, setEditando] = useState<string | null>(null);
  const { dados: r, erro } = usarDados<Resposta>(
    `/produtos-quebrados?${periodo.includes("-") ? `fatura=${periodo}` : `dias=${periodo}`}`, nav.versao + recarga);
  const t = r?.total;

  return (
    <div className="tela quebrados-pg">
      <header className="cabecalho">
        <div>
          <h1>Produtos quebrados</h1>
          <p className="sub">{r ? `Conferidos na bancada como avaria, devoluções abertas de ${diaMes(r.inicio)} a ${diaMes(r.fim)}` : "Carregando…"}</p>
        </div>
        <select className="seletor" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {ultimasFaturas(3).map((f) => (
            <option key={f} value={f}>Fatura {NOME_MES[Number(f.slice(5, 7)) - 1]}/{f.slice(2, 4)}{f === faturaDoDia(new Date()) ? " (aberta)" : ""}</option>
          ))}
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="365">Últimos 12 meses</option>
        </select>
      </header>

      {erro && <p className="aviso erro">{erro}</p>}

      <section className="op-cartoes" aria-label="Resumo do período">
        <article className="cartao op-cartao op-total">
          <span className="op-rotulo">Unidades quebradas</span>
          <strong className="op-numero">{t?.quantidade ?? "…"}</strong>
          <div className="op-plataformas">
            {PLATAFORMAS.map((p) => <span key={p}><LogoPlataforma plataforma={p} tamanho={16} /> {t?.[p].quantidade ?? 0}</span>)}
          </div>
        </article>
        <article className="cartao op-cartao">
          <span className="op-rotulo">Prejuízo em mercadoria</span>
          <strong className="op-numero">{reais(t?.valor)}</strong>
          <div className="op-plataformas">
            {PLATAFORMAS.map((p) => <span key={p}><LogoPlataforma plataforma={p} tamanho={16} /> {reais(t?.[p].valor ?? 0)}</span>)}
          </div>
        </article>
        {!!t?.sem_custo && (
          <article className="cartao op-cartao qb-alerta">
            <span className="op-rotulo">Sem custo cadastrado</span>
            <strong className="op-numero">{t.sem_custo}</strong>
            <span className="sub">unidades fora do prejuízo: cadastre o custo na linha do produto</span>
          </article>
        )}
      </section>

      <section className="cartao op-lista" aria-label="Produtos">
        <header><h2>Por produto</h2><span className="sub">prejuízo pelo custo vigente no dia da conferência</span></header>
        {r && r.produtos.length === 0 ? (
          <div className="op-vazio">
            <strong>Nenhum produto quebrado no período</strong>
            <span className="sub">Aparece aqui o que a bancada conferir como avaria (classe B).</span>
          </div>
        ) : (
          <div className="tabela-area">
            <table className="tabela qb-tabela">
              <thead>
                <tr>
                  <th>Produto</th>
                  {PLATAFORMAS.map((p) => <th key={p} className="num"><LogoPlataforma plataforma={p} tamanho={16} comNome /></th>)}
                  <th className="num">Total</th>
                  <th className="num">Custo unitário</th>
                </tr>
              </thead>
              <tbody>
                {r?.produtos.map((s) => (
                  <Fragment key={s.sku}>
                    <tr className={editando === s.sku ? "qb-aberta" : ""}>
                      <td>
                        <div className="qb-produto">
                          {s.imagem ? <img src={s.imagem} alt="" loading="lazy" /> : <span className="qb-sem-foto" aria-hidden="true" />}
                          <div>
                            <strong>{s.sku}</strong>
                            <span className="sub qb-nome" title={s.nome ?? undefined}>{s.nome ?? "Produto sem nome no pedido"}</span>
                          </div>
                        </div>
                      </td>
                      {PLATAFORMAS.map((p) => <td key={p} className="num"><Numeros c={s[p]} /></td>)}
                      <td className="num"><Numeros c={s} forte /></td>
                      <td className="num">
                        <div className="qb-custo">
                          {s.custo_atual == null ? <span className="qb-falta">sem custo</span> : <strong>{reais(s.custo_atual)}</strong>}
                          <button type="button" className="link-botao" onClick={() => setEditando(editando === s.sku ? null : s.sku)}>
                            {editando === s.sku ? "fechar" : s.custo_atual == null ? "cadastrar" : "alterar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editando === s.sku && (
                      <tr className="qb-edicao">
                        <td colSpan={PLATAFORMAS.length + 3}>
                          <EditarCusto sku={s.sku} custoAtual={s.custo_atual} onSalvo={() => setRecarga((n) => n + 1)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Numeros({ c, forte }: { c: Celula; forte?: boolean }) {
  if (!c.quantidade) return <span className="sub">—</span>;
  return (
    <span className="qb-numeros">
      {forte ? <strong>{c.quantidade} un.</strong> : <span>{c.quantidade} un.</span>}
      <span className="sub">{reais(c.valor)}</span>
    </span>
  );
}

const dataBr = (iso: string) => new Date(`${iso}Z`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Custo novo com vigência: quebras de antes da data mantêm o custo antigo, as de depois são recalculadas. */
function EditarCusto({ sku, custoAtual, onSalvo }: { sku: string; custoAtual: number | null; onSalvo: () => void }) {
  const [valor, setValor] = useState(custoAtual == null ? "" : String(custoAtual).replace(".", ","));
  const [desde, setDesde] = useState(hoje());
  const [historico, setHistorico] = useState<Vigencia[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const caminho = `/custos/${encodeURIComponent(sku)}`;

  useEffect(() => {
    let ativo = true;
    api.get<Vigencia[]>(`${caminho}/historico`).then((h) => ativo && setHistorico(h)).catch(() => ativo && setHistorico([]));
    return () => { ativo = false; };
  }, [caminho, msg]);

  // "1.234,56" (pt-BR) ou "12.50": com vírgula, ponto é milhar; sem vírgula, ponto é decimal.
  const numero = Number(valor.includes(",") ? valor.replace(/\./g, "").replace(",", ".") : valor);
  const valido = valor.trim() !== "" && Number.isFinite(numero) && numero > 0;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    const quando = desde === hoje() ? "hoje" : new Date(`${desde}T12:00:00`).toLocaleDateString("pt-BR");
    if (!window.confirm(`Custo de ${sku} passa a ser ${reais(numero)} a partir de ${quando}. Quebras de antes continuam com o custo antigo. Confirma?`)) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await api.post<{ conferencias_recalculadas: number }>(caminho, { custo: numero, desde });
      setMsg({ ok: true, texto: `Custo salvo. ${r.conferencias_recalculadas} conferência(s) desde essa data recalculada(s).` });
      onSalvo();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="qb-editar">
      <form onSubmit={salvar}>
        <label className="campo">
          <span>Novo custo unitário (R$)</span>
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus />
        </label>
        <label className="campo">
          <span>Vale a partir de</span>
          <input type="date" value={desde} max={hoje()} onChange={(e) => e.target.value && setDesde(e.target.value)} />
        </label>
        <button type="submit" className="botao principal" disabled={!valido || enviando}>{enviando ? "Salvando…" : "Salvar custo"}</button>
        <p className="sub qb-ajuda">
          Quebras conferidas antes dessa data continuam valendo o custo antigo; as de depois passam a usar o novo.
          O custo atual também é o usado na margem dos anúncios do Mercado Livre.
        </p>
      </form>
      {msg && <p className={msg.ok ? "aviso ok" : "aviso erro"} role="status">{msg.texto}</p>}
      <div className="qb-historico">
        <h3>Histórico de custo</h3>
        {historico === null ? <p className="sub">Carregando…</p> : historico.length === 0 ? (
          <p className="sub">Nenhuma mudança registrada ainda{custoAtual != null ? `: vale ${reais(custoAtual)} desde sempre` : ""}.</p>
        ) : (
          <ol>
            {historico.map((h, i) => (
              <li key={`${h.vigente_desde}-${i}`}>
                <strong>{reais(h.custo)}</strong>
                <span>{h.vigente_desde.startsWith(ANTES_DE_TUDO) ? "antes das mudanças" : `a partir de ${dataBr(h.vigente_desde)}`}</span>
                <span className="sub">{h.registrado_por && h.registrado_por !== "custo anterior" ? `por ${h.registrado_por}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
