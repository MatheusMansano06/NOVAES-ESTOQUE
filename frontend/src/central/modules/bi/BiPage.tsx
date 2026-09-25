import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { MOTIVO, PLATAFORMA, type Plataforma } from "../../shared/devolucao";
import { reais } from "../../shared/formato";
import { BarrasPorDia, Legenda, LinhasNoTempo, Rosca, type Serie } from "../../shared/graficos";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { usarDados } from "../../shared/usarDados";

interface Dinheiro {
  frete_reverso: number; frete_cobrado?: number; frete_em_mediacao?: number; perda_bancada?: number; perda_motivo?: number; recuperado: number;
  custo_total: number; prejuizo_liquido: number; taxa_recuperacao: number; sem_custo: number;
}
interface Contagem { full: number; organica: number; sem_info: number }
interface Celula { quantidade: number; valor: number; sem_custo: number }
interface Quebrados {
  segmentos: (Celula & { origem: "bancada" | "motivo"; tipo: string; nome: string; por_plataforma: Record<Plataforma, Celula> })[];
  por_origem: Record<"bancada" | "motivo", Celula>;
  total: Celula;
}
interface Resumo {
  total: number; total_anterior: number; dias: number; inicio: string; fim: string; dinheiro: Dinheiro; dinheiro_anterior: Dinheiro; quebrados: Quebrados;
  serie: { dia: string; total: number; resolvidas: number; em_aberto: number; custo: number; recuperado: number }[];
  por_plataforma: Partial<Record<Plataforma, Dinheiro & { devolucoes: number }>>;
  motivos: { motivo: string; quantidade: number; pct: number }[];
  produtos: Partial<Record<Plataforma, { sku: string | null; nome: string | null; imagem: string | null; plataforma: Plataforma; quantidade: number; pct: number; prejuizo: number }[]>>;
  logistica_total: Record<Plataforma, Contagem>;
  por_logistica: { motivo: string; quantidade: number; pct: number;
    por_plataforma: Record<Plataforma, { full: number; organica: number; sem_info: number }> }[];
  mediacoes: { ganha: number; perdida: number; parcial: number; em_andamento: number; recuperado: number;
    abertas_por?: Record<"vendedor" | "comprador" | "plataforma" | "desconhecido" | "sem_info", number> };
}

interface Mes {
  fatura: string; inicio: string; fim: string; aberto: boolean; fatura_lida: boolean;
  frete_ml: { cobrado: number; estornado: number; liquido: number };
  frete_shopee: number; quebrado_bancada: number; quebrado_motivo: number; sem_custo: number; total: number;
  devolucoes: Record<Plataforma, number>;
}
const NOME_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Chave da fatura do ML que contém o dia (fecha no dia 12): 13/set → "2026-10-01". */
function faturaDoDia(d: Date): string {
  const m = d.getDate() <= 12 ? d.getMonth() : d.getMonth() + 1;
  const ano = d.getFullYear() + Math.floor(m / 12);
  return `${ano}-${String((m % 12) + 1).padStart(2, "0")}-01`;
}
function ultimasFaturas(n: number): string[] {
  const hoje = new Date();
  return Array.from({ length: n }, (_, i) => faturaDoDia(new Date(hoje.getFullYear(), hoje.getMonth() - i, hoje.getDate() <= 12 ? 1 : 20)));
}
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${NOME_MES[Number(iso.slice(5, 7)) - 1]}`;
const LINHAS_MES: [string, (m: Mes) => number, string?][] = [
  ["Frete reverso ML cobrado (fatura)", (m) => m.frete_ml.cobrado],
  ["Estornos do ML (fatura)", (m) => -m.frete_ml.estornado, "bom"],
  ["Frete reverso ML líquido", (m) => m.frete_ml.liquido, "sub-total"],
  ["Frete reverso Shopee", (m) => m.frete_shopee],
  ["Quebrado, conferido na bancada", (m) => m.quebrado_bancada],
  ["Quebrado, estimado pelo motivo", (m) => m.quebrado_motivo],
  ["Total do mês", (m) => m.total, "total-linha"],
];

// Cores validadas (scripts/validate_palette.js da skill de dataviz): categóricas por série, status para mediação.
const EVOLUCAO: Serie[] = [
  { chave: "total", nome: "Total", cor: "#2a78d6" },
  { chave: "resolvidas", nome: "Resolvidas", cor: "#1baf7a" },
  { chave: "em_aberto", nome: "Em aberto", cor: "#4a3aa7" },
];
const DINHEIRO: Serie[] = [
  { chave: "custo", nome: "Custo com devoluções", cor: "#eb6834" },
  { chave: "recuperado", nome: "Recuperado em mediações", cor: "#1baf7a" },
];
const COR_PLATAFORMA: Record<Plataforma, string> = { mercado_livre: "#d99a00", shopee: "#e5482a" };
const PLATAFORMAS: Plataforma[] = ["mercado_livre", "shopee"];
const reaisCurto = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v)}`);

function variacao(atual: number, anterior: number, bomQuandoSobe = false) {
  if (!anterior) return null;
  const p = Math.round(((atual - anterior) / anterior) * 100);
  return { texto: `${p > 0 ? "+" : ""}${p}%`, bom: bomQuandoSobe ? p >= 0 : p <= 0 };
}

export function BiPage({ nav }: { nav: Navegacao }) {
  // Período: ciclo da fatura do ML (13 ao 12), padrão a fatura aberta; ou os últimos N dias. Conta pela data de abertura.
  const [periodo, setPeriodo] = useState(faturaDoDia(new Date()));
  const { dados: r, erro } = usarDados<Resumo>(`/bi/resumo?${periodo.includes("-") ? `fatura=${periodo}` : `dias=${periodo}`}`, nav.versao);
  const dias = r?.dias ?? 30;
  const { dados: mensal } = usarDados<{ meses: Mes[] }>("/bi/mensal", nav.versao);
  const d = r?.dinheiro, a = r?.dinheiro_anterior;
  const perdido = (x?: Dinheiro) => (x?.perda_bancada ?? 0) + (x?.perda_motivo ?? 0);
  const q = r?.quebrados;
  const maiorMotivo = Math.max(1, ...(r?.motivos.map((m) => m.quantidade) ?? [1]));
  const semInfo = r?.por_logistica.reduce((t, m) => t + PLATAFORMAS.reduce((s, p) => s + m.por_plataforma[p].sem_info, 0), 0) ?? 0;
  const mediacoesTotal = r ? r.mediacoes.ganha + r.mediacoes.perdida + r.mediacoes.parcial + r.mediacoes.em_andamento : 0;

  return (
    <div className="tela bi">
      <header className="cabecalho">
        <div>
          <h1>Inteligência</h1>
          <p className="sub">{r ? `${r.total} devoluções abertas de ${diaMes(r.inicio)} a ${diaMes(r.fim)}, ${r.total_anterior} no período anterior` : "Carregando…"}</p>
        </div>
        <select className="seletor" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {ultimasFaturas(3).map((f) => (
            <option key={f} value={f}>Fatura {NOME_MES[Number(f.slice(5, 7)) - 1]}/{f.slice(2, 4)}{f === faturaDoDia(new Date()) ? " (aberta)" : ""}</option>
          ))}
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
      </header>
      {erro && <p className="aviso erro">{erro}</p>}

      <section className="metricas">
        <Metrica rotulo="Custo total com devoluções" valor={reais(d?.custo_total)} v={d && a && variacao(d.custo_total, a.custo_total)} />
        <Metrica rotulo="Recuperado em mediações" valor={reais(d?.recuperado)} v={d && a && variacao(d.recuperado, a.recuperado, true)}
                 nota="Estimado pelas mediações ganhas" />
        <Metrica rotulo="Frete reverso cobrado" valor={reais(d?.frete_cobrado)} v={d && a && variacao(d.frete_cobrado ?? 0, a.frete_cobrado ?? 0)} />
        <Metrica rotulo="Mercadoria quebrada" valor={reais(perdido(d))} v={d && a && variacao(perdido(d), perdido(a))}
                 nota="Da bancada + do motivo da devolução" />
        <Metrica rotulo="Taxa de recuperação" valor={`${(d?.taxa_recuperacao ?? 0).toLocaleString("pt-BR")}%`} />
      </section>

      <section className="cartao financeiro-detalhe">
        <header><h2>Custo das devoluções por mês</h2>
          <span className="sub">ciclo da fatura do ML: dia 13 ao dia 12 · frete do ML vem da fatura; o resto, das devoluções importadas na Central</span></header>
        <table className="tabela compacta">
          <thead><tr><th scope="col">Custo</th>
            {mensal?.meses.map((m) => (
              <th key={m.fatura} scope="col" className="num">
                Fatura {NOME_MES[Number(m.fatura.slice(5, 7)) - 1]}/{m.fatura.slice(2, 4)}{m.aberto && " (aberta)"}
                <span className="sub" style={{ display: "block", fontWeight: 400 }}>{diaMes(m.inicio)} a {diaMes(m.fim)}</span>
              </th>
            ))}</tr></thead>
          <tbody>
            {LINHAS_MES.map(([rotulo, valor, classe]) => (
              <tr key={rotulo} className={classe === "total-linha" ? "total-linha" : ""}>
                <td>{classe === "sub-total" ? <strong>{rotulo}</strong> : rotulo}</td>
                {mensal?.meses.map((m) => (
                  <td key={m.fatura} className="num" style={classe === "bom" ? { color: "#1baf7a" } : undefined}>
                    {!m.fatura_lida && rotulo.includes("ML") ? "—" : classe === "sub-total" ? <strong>{reais(valor(m))}</strong> : reais(valor(m))}
                  </td>
                ))}
              </tr>
            ))}
            <tr><td className="sub">Devoluções na Central (ML / Shopee)</td>
              {mensal?.meses.map((m) => <td key={m.fatura} className="num sub">{m.devolucoes.mercado_livre} / {m.devolucoes.shopee}
                {m.sem_custo > 0 && ` · ${m.sem_custo} sem custo`}</td>)}</tr>
          </tbody>
        </table>
      </section>

      <section className="cartao">
        <header><h2>Evolução das devoluções</h2><Legenda series={EVOLUCAO} /></header>
        {r && <BarrasPorDia dados={r.serie as never} series={EVOLUCAO} />}
      </section>
      <section className="cartao">
        <header><h2>Custo x recuperado</h2><Legenda series={DINHEIRO} /></header>
        {r && <LinhasNoTempo dados={r.serie as never} series={DINHEIRO} formatar={reaisCurto} />}
      </section>
      <section className="cartao">
        <header><h2>Por marketplace</h2></header>
        <div className="rosca-e-legenda">
          <Rosca centro={String(r?.total ?? 0)} rotulo="devoluções"
                 fatias={PLATAFORMAS.map((p) => ({ nome: PLATAFORMA[p], valor: r?.por_plataforma[p]?.devolucoes ?? 0, cor: COR_PLATAFORMA[p] }))} />
          <ul className="lista-valores">
            {PLATAFORMAS.map((p) => {
              const v = r?.por_plataforma[p];
              return (
                <li key={p}><span className="legenda-marca" style={{ background: COR_PLATAFORMA[p] }} />
                  <LogoPlataforma plataforma={p} tamanho={18} comNome />
                  <strong>{v?.devolucoes ?? 0}</strong>
                  <span className="sub">{r?.total ? Math.round(((v?.devolucoes ?? 0) / r.total) * 100) : 0}%</span></li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="cartao">
        <header><h2>Principais motivos</h2></header>
        <ul className="barras-motivo">
          {r?.motivos.slice(0, 6).map((m) => (
            <li key={m.motivo}>
              <span className="rotulo">{MOTIVO[m.motivo] ?? m.motivo}</span>
              <span className="trilho"><span style={{ width: `${(m.quantidade / maiorMotivo) * 100}%` }} /></span>
              <strong>{m.quantidade}</strong><span className="sub">{m.pct.toLocaleString("pt-BR")}%</span>
            </li>
          ))}
        </ul>
      </section>
      {PLATAFORMAS.map((plat) => (
      <section key={plat} className="cartao">
        <header><h2>Produtos que mais voltam</h2><LogoPlataforma plataforma={plat} tamanho={18} comNome /></header>
        {r && !r.produtos[plat]?.length && <p className="sub">Nenhuma devolução no período.</p>}
        <ol className="ranking">
          {r?.produtos[plat]?.map((p, i) => (
            <li key={`${p.plataforma}-${p.sku}-${i}`}>
              <span className="posicao">{i + 1}</span>
              {p.imagem ? <img src={p.imagem} alt="" loading="lazy" /> : <span className="foto-vazia" />}
              <span className="produto-nome"><strong>{p.nome ?? p.sku}</strong><span className="sub">SKU {p.sku ?? "—"}</span></span>
              <LogoPlataforma plataforma={p.plataforma} tamanho={16} />
              <strong className="num">{p.quantidade}</strong><span className="sub num">{p.pct.toLocaleString("pt-BR")}%</span>
            </li>
          ))}
        </ol>
      </section>
      ))}
      <section className="cartao">
        <header><h2>Mediações que a Novaes abriu</h2>
          <span className="sub">{mediacoesTotal} em {dias} dias · {(mediacoesTotal / dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia</span></header>
        <div className="rosca-e-legenda">
          <Rosca centro={String(mediacoesTotal)} rotulo="mediações" fatias={[
            { nome: "Ganhas", valor: r?.mediacoes.ganha ?? 0, cor: "#0ca30c" },
            { nome: "Parciais", valor: r?.mediacoes.parcial ?? 0, cor: "#fab219" },
            { nome: "Perdidas", valor: r?.mediacoes.perdida ?? 0, cor: "#d03b3b" },
            { nome: "Em andamento", valor: r?.mediacoes.em_andamento ?? 0, cor: "#98a2b3" },
          ]} />
          <ul className="lista-valores">
            <li><span className="legenda-marca" style={{ background: "#0ca30c" }} />Ganhas<strong>{r?.mediacoes.ganha ?? 0}</strong></li>
            <li><span className="legenda-marca" style={{ background: "#fab219" }} />Parciais<strong>{r?.mediacoes.parcial ?? 0}</strong></li>
            <li><span className="legenda-marca" style={{ background: "#d03b3b" }} />Perdidas<strong>{r?.mediacoes.perdida ?? 0}</strong></li>
            <li><span className="legenda-marca" style={{ background: "#98a2b3" }} />Em andamento<strong>{r?.mediacoes.em_andamento ?? 0}</strong></li>
          </ul>
        </div>
        <p className="recuperado">{reais(r?.mediacoes.recuperado)} <span className="sub">recuperados nas mediações ganhas (estimado)</span></p>
        {r?.mediacoes.abertas_por && (
          <p className="sub">Todas as reclamações que foram para mediação: {Object.values(r.mediacoes.abertas_por).reduce((a, b) => a + b, 0)}
            {" "}· abertas pela Novaes {r.mediacoes.abertas_por.vendedor} · pelo comprador {r.mediacoes.abertas_por.comprador}
            {" "}· pela plataforma {r.mediacoes.abertas_por.plataforma}
            {r.mediacoes.abertas_por.sem_info + r.mediacoes.abertas_por.desconhecido > 0 &&
              ` · ainda sem consulta ${r.mediacoes.abertas_por.sem_info + r.mediacoes.abertas_por.desconhecido}`}</p>
        )}
      </section>

      <section className="cartao financeiro-detalhe">
        <header><h2>Todas as devoluções: venda Full x orgânica</h2>
          <span className="sub">% sobre as devoluções já consultadas na plataforma</span></header>
        <div className="motivos-logistica">
          {r?.logistica_total && [...PLATAFORMAS.map((p) => [PLATAFORMA[p], r.logistica_total[p]] as const),
                 ["Total geral", somarContagem(PLATAFORMAS.map((p) => r.logistica_total[p]))] as const].map(([titulo, v]) => (
            <BlocoLogistica key={titulo} titulo={titulo} v={v} />
          ))}
        </div>
      </section>

      <section className="cartao financeiro-detalhe">
        <header><h2>Motivos do produto: venda Full x orgânica</h2>
          <span className="sub">% = parte de todas as devoluções do período{semInfo > 0 && ` · ${semInfo} ainda sem consulta de Full na plataforma`}</span></header>
        <div className="motivos-logistica">
          {r?.por_logistica.map((m) => (
            <article key={m.motivo} className={m.motivo === "diferente" ? "motivo-bloco destaque" : "motivo-bloco"}>
              <header><h3>{MOTIVO[m.motivo] ?? m.motivo}</h3>
                <span><span className="motivo-total">{m.quantidade}</span> <span className="sub">{m.pct.toLocaleString("pt-BR")}% das devoluções</span></span></header>
              {PLATAFORMAS.map((p) => {
                const v = m.por_plataforma[p], soma = v.full + v.organica;
                return (
                  <div key={p} className="motivo-plataforma">
                    <LogoPlataforma plataforma={p} tamanho={16} comNome />
                    <div className="barra-full" role="img" aria-label={`${v.full} Full, ${v.organica} orgânica`}>
                      {soma > 0 && <><span className="full" style={{ width: `${(v.full / soma) * 100}%` }} />
                        <span className="organica" style={{ width: `${(v.organica / soma) * 100}%` }} /></>}
                    </div>
                    <div className="numeros">
                      <span><span className="ponto" style={{ background: "#2a78d6" }} />Full <strong>{v.full}</strong>{soma > 0 && ` (${Math.round((v.full / soma) * 100)}%)`}</span>
                      <span><span className="ponto" style={{ background: "#1baf7a" }} />Orgânica <strong>{v.organica}</strong>{soma > 0 && ` (${Math.round((v.organica / soma) * 100)}%)`}</span>
                      {v.sem_info > 0 && <span className="sub">sem consulta <strong>{v.sem_info}</strong></span>}
                    </div>
                  </div>
                );
              })}
            </article>
          ))}
        </div>
      </section>

      <section className="cartao financeiro-detalhe quebrados">
        <header><h2>Mercadoria quebrada</h2>
          <span className="sub">só entra o que a Novaes conferiu e não vende, ou o que já veio como danificado ou com defeito no motivo</span></header>
        <div className="quebrados-totais">
          <div className="quebrado-total"><span className="sub">Da bancada: conferimos e não dá para vender</span>
            <strong>{reais(q?.por_origem.bancada.valor)}</strong><span className="sub">{q?.por_origem.bancada.quantidade ?? 0} devoluções</span></div>
          <div className="quebrado-total"><span className="sub">Do motivo: a devolução já veio como quebrada</span>
            <strong>{reais(q?.por_origem.motivo.valor)}</strong><span className="sub">{q?.por_origem.motivo.quantidade ?? 0} devoluções</span></div>
          <div className="quebrado-total geral"><span className="sub">Total de mercadoria quebrada</span>
            <strong>{reais(q?.total.valor)}</strong><span className="sub">{q?.total.quantidade ?? 0} devoluções</span></div>
        </div>
        <table className="tabela compacta">
          <thead><tr><th scope="col">Origem e tipo</th>{PLATAFORMAS.map((p) => <th key={p} scope="col" className="num"><LogoPlataforma plataforma={p} tamanho={16} comNome /></th>)}
            <th scope="col" className="num">Total</th></tr></thead>
          <tbody>
            {q?.segmentos.map((s) => (
              <tr key={`${s.origem}-${s.tipo}`}>
                <td>{s.nome}</td>
                {PLATAFORMAS.map((p) => <td key={p} className="num">{textoCelula(s.por_plataforma[p])}</td>)}
                <td className="num">{textoCelula(s)}</td>
              </tr>
            ))}
            <tr className="total-linha"><td>Total</td>
              {PLATAFORMAS.map((p) => <td key={p} className="num">{textoCelula(somar(q?.segmentos.map((s) => s.por_plataforma[p])))}</td>)}
              <td className="num">{textoCelula(q?.total)}</td></tr>
          </tbody>
        </table>
        {q && q.total.sem_custo > 0 && <p className="sub">* {q.total.sem_custo} devoluções sem custo cadastrado no estoque: contam na quantidade, mas não no valor</p>}
      </section>

      <section className="cartao financeiro-detalhe">
        <header><h2>Detalhamento financeiro</h2>
          {d && d.sem_custo > 0 && <span className="sub">{d.sem_custo} perdas sem custo cadastrado no estoque não entram na conta</span>}</header>
        <table className="tabela compacta">
          <thead><tr><th scope="col">Descrição</th>{PLATAFORMAS.map((p) => <th key={p} scope="col" className="num"><LogoPlataforma plataforma={p} tamanho={16} comNome /></th>)}
            <th scope="col" className="num">Total</th><th scope="col" className="num">% do custo</th></tr></thead>
          <tbody>
            {([
              ["Frete reverso cobrado", "frete_cobrado"],
              ["Frete em mediação (cobra se perder)", "frete_em_mediacao"],
              ["Mercadoria quebrada, conferida na bancada", "perda_bancada"],
              ["Mercadoria quebrada, pelo motivo da devolução", "perda_motivo"],
              ["Recuperado em mediações", "recuperado"],
              ["Prejuízo líquido", "prejuizo_liquido"],
            ] as [string, keyof Dinheiro][]).map(([rotulo, k]) => (
              <tr key={k} className={k === "prejuizo_liquido" ? "total-linha" : ""}>
                <td>{rotulo}</td>
                {PLATAFORMAS.map((p) => <td key={p} className="num">{reais(Number(r?.por_plataforma[p]?.[k] ?? 0))}</td>)}
                <td className="num">{reais(Number(d?.[k] ?? 0))}</td>
                <td className="num">{d?.custo_total ? `${Math.round((Number(d[k] ?? 0) / d.custo_total) * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** "3 · R$ 120,00" (quantidade de devoluções e custo); * quando alguma não tem custo cadastrado. */
function textoCelula(c?: Celula) {
  if (!c || !c.quantidade) return "—";
  return `${c.quantidade} · ${reais(c.valor)}${c.sem_custo ? "*" : ""}`;
}

function somar(cs?: Celula[]): Celula {
  return (cs ?? []).reduce((t, c) => ({ quantidade: t.quantidade + c.quantidade, valor: t.valor + c.valor, sem_custo: t.sem_custo + c.sem_custo }),
                           { quantidade: 0, valor: 0, sem_custo: 0 });
}

function Metrica({ rotulo, valor, v, nota }: { rotulo: string; valor: string; v?: { texto: string; bom: boolean } | null | 0; nota?: string }) {
  return (
    <div className="metrica">
      <span className="metrica-rotulo">{rotulo}</span>
      <strong className="metrica-valor">{valor}</strong>
      <span className="metrica-rodape">
        {v ? <span className={v.bom ? "bom" : "ruim"}>{v.texto} vs. período anterior</span> : nota && <span className="sub">{nota}</span>}
      </span>
    </div>
  );
}

function somarContagem(cs: Contagem[]): Contagem {
  return cs.reduce((t, c) => ({ full: t.full + c.full, organica: t.organica + c.organica, sem_info: t.sem_info + c.sem_info }),
                   { full: 0, organica: 0, sem_info: 0 });
}

function BlocoLogistica({ titulo, v }: { titulo: string; v: Contagem }) {
  const soma = v.full + v.organica;
  const pct = (n: number) => (soma ? `${Math.round((n / soma) * 100)}%` : "—");
  return (
    <article className="motivo-bloco">
      <header><h3>{titulo}</h3>
        <span><span className="motivo-total">{soma + v.sem_info}</span> <span className="sub">devoluções</span></span></header>
      <div className="barra-full" role="img" aria-label={`${v.full} Full, ${v.organica} orgânica`}>
        {soma > 0 && <><span className="full" style={{ width: pct(v.full) }} /><span className="organica" style={{ width: pct(v.organica) }} /></>}
      </div>
      <div className="numeros-total">
        <span><span className="ponto" style={{ background: "#2a78d6" }} />Full <strong>{pct(v.full)}</strong> <span className="sub">({v.full})</span></span>
        <span><span className="ponto" style={{ background: "#1baf7a" }} />Orgânica <strong>{pct(v.organica)}</strong> <span className="sub">({v.organica})</span></span>
      </div>
      {v.sem_info > 0 && <span className="sub">{v.sem_info} ainda sem consulta</span>}
    </article>
  );
}
