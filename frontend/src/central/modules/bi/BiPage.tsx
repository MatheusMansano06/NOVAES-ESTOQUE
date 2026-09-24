import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { MOTIVO, PLATAFORMA, type Plataforma } from "../../shared/devolucao";
import { reais } from "../../shared/formato";
import { BarrasPorDia, Legenda, LinhasNoTempo, Rosca, type Serie } from "../../shared/graficos";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { usarDados } from "../../shared/usarDados";

interface Dinheiro {
  frete_reverso: number; perda_bancada?: number; perda_plataforma?: number; em_risco?: number; recuperado: number;
  custo_total: number; prejuizo_liquido: number; taxa_recuperacao: number; sem_custo: number;
}
interface Resumo {
  total: number; total_anterior: number; dinheiro: Dinheiro; dinheiro_anterior: Dinheiro;
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
  const perdido = (x?: Dinheiro) => (x?.perda_bancada ?? 0) + (x?.perda_plataforma ?? 0);
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
        <Metrica rotulo="Frete reverso cobrado" valor={reais(d?.frete_reverso)} v={d && a && variacao(d.frete_reverso, a.frete_reverso)} />
        <Metrica rotulo="Produtos quebrados ou perdidos" valor={reais(perdido(d))} v={d && a && variacao(perdido(d), perdido(a))}
                 nota={d?.em_risco ? `+ ${reais(d.em_risco)} em risco, a conferir` : "Confirmado na bancada ou pela plataforma"} />
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

      <section className="cartao financeiro-detalhe">
        <header><h2>Detalhamento financeiro</h2>
          {d && d.sem_custo > 0 && <span className="sub">{d.sem_custo} perdas sem custo cadastrado no estoque não entram na conta</span>}</header>
        <table className="tabela compacta">
          <thead><tr><th scope="col">Descrição</th>{PLATAFORMAS.map((p) => <th key={p} scope="col" className="num"><LogoPlataforma plataforma={p} tamanho={16} comNome /></th>)}
            <th scope="col" className="num">Total</th><th scope="col" className="num">% do custo</th></tr></thead>
          <tbody>
            {([
              ["Frete reverso cobrado", "frete_reverso"],
              ["Produto quebrado, conferido na bancada", "perda_bancada"],
              ["Produto sem condição de venda, segundo o ML", "perda_plataforma"],
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
            <tr className="linha-risco"><td>Em risco: comprador disse que chegou quebrado (a conferir)</td>
              {PLATAFORMAS.map((p) => <td key={p} className="num">{reais(r?.por_plataforma[p]?.em_risco ?? 0)}</td>)}
              <td className="num">{reais(d?.em_risco ?? 0)}</td><td className="num">fora do custo</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
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
