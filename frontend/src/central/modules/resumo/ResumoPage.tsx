import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { MOTIVO, PLATAFORMA, type Plataforma } from "../../shared/devolucao";
import { quando, reais } from "../../shared/formato";
import { Rosca } from "../../shared/graficos";
import { Icone, type NomeIcone } from "../../shared/Icone";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { codigoDe, STATUS, type Status } from "../../shared/operacao";
import { usarDados } from "../../shared/usarDados";

interface Dinheiro {
  frete_reverso: number; perda_bancada?: number; perda_plataforma?: number; em_risco?: number;
  recuperado: number; custo_total: number;
}
interface Resumo {
  total: number;
  total_anterior: number;
  status: Partial<Record<Status, number>>;
  por_plataforma: Partial<Record<Plataforma, Dinheiro & { devolucoes: number }>>;
  dinheiro: Dinheiro;
  dinheiro_anterior: Dinheiro;
}
interface Atencao { contestar: number; chamados_manuais: number; lancar_estoque: number; aguardando_conferencia: number; prazo_em_24h: number }
interface Ultima { id: number; plataforma: Plataforma; pedido: string; pacote: string | null; rastreio: string | null;
  id_externo: string; status: Status; itens: { sku?: string | null }[]; atualizada_em: string; motivo: string }
type Sinc = Record<string, { ok: boolean; erro?: string }>;

const FUNIL: Status[] = ["a_caminho", "aguardando_conferencia", "precisa_acao", "em_mediacao", "resolvida", "finalizada"];
const ICONE_FUNIL: Record<string, NomeIcone> = {
  a_caminho: "caminhao", aguardando_conferencia: "lupa", precisa_acao: "alerta", em_mediacao: "balao", resolvida: "ok", finalizada: "caixa",
};
const PLATAFORMAS: Plataforma[] = ["mercado_livre", "shopee"];
const COR_PLATAFORMA: Record<Plataforma, string> = { mercado_livre: "#d99a00", shopee: "#e5482a" };

function variacao(atual: number, anterior: number) {
  if (!anterior) return null;
  const p = Math.round(((atual - anterior) / anterior) * 100);
  return { texto: `${p > 0 ? "+" : ""}${p}% vs. período anterior`, sobe: p > 0 };
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function ResumoPage({ nav }: { nav: Navegacao }) {
  const [dias, setDias] = useState(30);
  const { dados: r, erro } = usarDados<Resumo>(`/bi/resumo?dias=${dias}`, nav.versao);
  const { dados: at } = usarDados<Atencao>("/operacao/atencao", nav.versao);
  const { dados: ultimas } = usarDados<Ultima[]>("/operacao/ultimas?limite=5", nav.versao);
  const { dados: sinc } = usarDados<Sinc>("/sincronizacao", nav.versao);

  const st = r?.status ?? {};
  const emAberto = (r?.total ?? 0) - (st.finalizada ?? 0) - (st.com_a_plataforma ?? 0);
  const d = r?.dinheiro;
  const perdido = (d?.perda_bancada ?? 0) + (d?.perda_plataforma ?? 0);
  const varCusto = r && variacao(r.dinheiro.custo_total, r.dinheiro_anterior.custo_total);

  return (
    <div className="tela resumo">
      <section className="hero">
        <div>
          <p className="hero-saudacao">{saudacao()}</p>
          <h1>Panorama das devoluções</h1>
          <p className="sub">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {PLATAFORMAS.map((p) => <Marketplace key={p} plataforma={p} dados={r?.por_plataforma[p]} sinc={sinc?.[p]} />)}
        <select className="seletor" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </section>

      {erro && <p className="aviso erro">{erro}</p>}

      <section className="kpis" aria-label="Números do período">
        <Kpi icone="caixa" cor="azul" valor={emAberto} rotulo="Devoluções em aberto" onClick={() => nav.irPara("operacao")} />
        <Kpi icone="alerta" cor="vermelho" valor={st.precisa_acao ?? 0} rotulo="Precisam de ação" onClick={() => nav.irPara("operacao", "precisa_acao")} />
        <Kpi icone="caminhao" cor="azul" valor={st.a_caminho ?? 0} rotulo="A caminho da Novaes" onClick={() => nav.irPara("operacao", "a_caminho")} />
        <Kpi icone="balao" cor="roxo" valor={st.em_mediacao ?? 0} rotulo="Em mediação" onClick={() => nav.irPara("operacao", "em_mediacao")} />
        <Kpi icone="ok" cor="verde" valor={st.finalizada ?? 0} rotulo="Finalizadas" onClick={() => nav.irPara("historico")} />
        <div className="financeiro">
          <p className="financeiro-titulo"><Icone nome="moeda" tamanho={18} /> Custo das devoluções</p>
          <p className="financeiro-valor">{reais(d?.custo_total)}</p>
          {varCusto && <p className={varCusto.sobe ? "financeiro-var ruim" : "financeiro-var bom"}>{varCusto.texto}</p>}
          <dl>
            <div><dt>Frete reverso</dt><dd>{reais(d?.frete_reverso)}</dd></div>
            <div><dt>Produtos quebrados ou perdidos</dt><dd>{reais(perdido)}</dd></div>
            <div><dt>Em risco, a conferir</dt><dd>{reais(d?.em_risco ?? 0)}</dd></div>
          </dl>
        </div>
      </section>

      <section className="cartao funil" aria-labelledby="t-funil">
        <header><h2 id="t-funil">Devoluções por etapa</h2>
          <button className="link" onClick={() => nav.irPara("operacao")}>Abrir operação</button></header>
        <ol>
          {FUNIL.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => nav.irPara("operacao", s)}>
                <span className={`funil-icone cor-${STATUS[s].cor}`}><Icone nome={ICONE_FUNIL[s]} /></span>
                <span className="funil-nome">{STATUS[s].nome}</span>
                <strong>{st[s] ?? 0}</strong>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="cartao donut-painel" aria-labelledby="t-marketplace">
        <header><h2 id="t-marketplace">Devoluções por marketplace</h2></header>
        <div className="rosca-e-legenda">
          <Rosca centro={String(r?.total ?? 0)} rotulo="total"
                 fatias={PLATAFORMAS.map((p) => ({ nome: PLATAFORMA[p], valor: r?.por_plataforma[p]?.devolucoes ?? 0, cor: COR_PLATAFORMA[p] }))} />
          <ul className="lista-valores">
            {PLATAFORMAS.map((p) => (
              <li key={p}><span className="legenda-marca" style={{ background: COR_PLATAFORMA[p] }} />
                <LogoPlataforma plataforma={p} tamanho={20} comNome />
                <strong>{r?.por_plataforma[p]?.devolucoes ?? 0}</strong>
                <span className="sub">{r?.total ? Math.round(((r.por_plataforma[p]?.devolucoes ?? 0) / r.total) * 100) : 0}%</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="cartao ultimas" aria-labelledby="t-ultimas">
        <header><h2 id="t-ultimas">Últimas movimentações</h2>
          <button className="link" onClick={() => nav.irPara("historico")}>Ver histórico</button></header>
        <ul className="lista-mov">
          {ultimas?.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => nav.abrir(codigoDe(u))}>
                <LogoPlataforma plataforma={u.plataforma} tamanho={22} />
                <span className="forte">{u.itens.map((i) => i.sku).filter(Boolean).join(", ") || `#${u.pacote ?? u.pedido}`}</span>
                <span className="sub">{MOTIVO[u.motivo] ?? u.motivo}</span>
                <span className="status"><span className="ponto-etapa" data-cor={STATUS[u.status].cor} />{STATUS[u.status].nome}</span>
                <span className="sub">{quando(u.atualizada_em)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="cartao atencao" aria-labelledby="t-atencao">
        <header><h2 id="t-atencao">O que precisa da sua atenção</h2></header>
        <ul>
          <Alerta n={at?.aguardando_conferencia} cor="amarelo" texto="chegaram e aguardam conferência" onClick={() => nav.irPara("operacao", "aguardando_conferencia")} />
          <Alerta n={at?.contestar} cor="vermelho" texto="devoluções para contestar" onClick={() => nav.irPara("operacao", "precisa_acao")} />
          <Alerta n={at?.chamados_manuais} cor="roxo" texto="chamados manuais para abrir" onClick={() => nav.irPara("operacao", "precisa_acao")} />
          <Alerta n={at?.lancar_estoque} cor="azul" texto="lançamentos de estoque pendentes" onClick={() => nav.irPara("operacao", "precisa_acao")} />
          <Alerta n={at?.prazo_em_24h} cor="vermelho" texto="prazos da plataforma vencem em 24 h" onClick={() => nav.irPara("operacao")} />
        </ul>
      </section>
    </div>
  );
}

function Marketplace({ plataforma, dados, sinc }: { plataforma: Plataforma; dados?: { devolucoes: number; frete_reverso: number };
  sinc?: { ok: boolean; erro?: string } }) {
  return (
    <div className="marketplace">
      <LogoPlataforma plataforma={plataforma} tamanho={40} />
      <div>
        <p className="forte">{PLATAFORMA[plataforma]}</p>
        <p className="conexao" title={sinc?.erro}>
          <span className={`ponto-status ${!sinc ? "" : sinc.ok ? "ok" : "falha"}`} />
          {!sinc ? "Sincronizando" : sinc.ok ? "Conectado" : "Sem conexão"}
        </p>
      </div>
      <div className="marketplace-num">
        <strong>{dados?.devolucoes ?? 0}</strong>
        <span className="sub">devoluções, {reais(dados?.frete_reverso ?? 0)} de frete</span>
      </div>
    </div>
  );
}

function Kpi({ icone, cor, valor, rotulo, onClick }: { icone: NomeIcone; cor: string; valor: number; rotulo: string; onClick: () => void }) {
  return (
    <button type="button" className="kpi" onClick={onClick}>
      <span className={`kpi-icone cor-${cor}`}><Icone nome={icone} tamanho={22} /></span>
      <strong>{valor}</strong>
      <span className="kpi-rotulo">{rotulo}</span>
    </button>
  );
}

function Alerta({ n, cor, texto, onClick }: { n?: number; cor: string; texto: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={!n}>
        <span className="ponto-etapa" data-cor={cor} /><strong>{n ?? "…"}</strong> {texto}
      </button>
    </li>
  );
}
