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
interface Celula { quantidade: number; valor: number; sem_custo: number }
interface Quebrados {
  segmentos: (Celula & { origem: "bancada" | "motivo"; tipo: string; nome: string; por_plataforma: Record<Plataforma, Celula> })[];
  por_origem: Record<"bancada" | "motivo", Celula>;
  total: Celula;
}
interface Resumo {
  total: number; total_anterior: number; dinheiro: Dinheiro; dinheiro_anterior: Dinheiro; quebrados: Quebrados;
  serie: { dia: string; total: number; resolvidas: number; em_aberto: number; custo: number; recuperado: number }[];
  por_plataforma: Partial<Record<Plataforma, Dinheiro & { devolucoes: number }>>;
  motivos: { motivo: string; quantidade: number; pct: number }[];
  produtos: { sku: string | null; nome: string | null; imagem: string | null; plataforma: Plataforma; quantidade: number; pct: number; prejuizo: number }[];
  mediacoes: { ganha: number; perdida: number; parcial: number; em_andamento: number; recuperado: number };
}

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
  const [dias, setDias] = useState(30);
  const { dados: r, erro } = usarDados<Resumo>(`/bi/resumo?dias=${dias}`, nav.versao);
  const d = r?.dinheiro, a = r?.dinheiro_anterior;
  const perdido = (x?: Dinheiro) => (x?.perda_bancada ?? 0) + (x?.perda_motivo ?? 0);
  const q = r?.quebrados;
  const maiorMotivo = Math.max(1, ...(r?.motivos.map((m) => m.quantidade) ?? [1]));
  const mediacoesTotal = r ? r.mediacoes.ganha + r.mediacoes.perdida + r.mediacoes.parcial + r.mediacoes.em_andamento : 0;

  return (
    <div className="tela bi">
      <header className="cabecalho">
        <div>
          <h1>Inteligência</h1>
          <p className="sub">{r ? `${r.total} devoluções nos últimos ${dias} dias, ${r.total_anterior} no período anterior` : "Carregando…"}</p>
        </div>
        <select className="seletor" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
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
      <section className="cartao">
        <header><h2>Produtos que mais voltam</h2></header>
        <ol className="ranking">
          {r?.produtos.map((p, i) => (
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
      <section className="cartao">
        <header><h2>Resultado das mediações</h2></header>
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
