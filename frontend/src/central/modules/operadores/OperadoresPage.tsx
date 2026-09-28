import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import type { Plataforma } from "../../shared/devolucao";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { STATUS, type Status } from "../../shared/operacao";
import { usarDados } from "../../shared/usarDados";
import { CLASSE } from "../conferencia/tipos";

interface Item {
  operador: string; horario: string; plataforma: Plataforma; pedido: string | null;
  classe: string | null; contestar: boolean | null; status: string | null;
}
interface Atividade {
  dia: string; total: number;
  por_operador: Record<string, { total: number; por_plataforma: Partial<Record<Plataforma, number>> }>;
  itens: Item[];
}

const PLATAFORMAS: Plataforma[] = ["mercado_livre", "shopee"];
const hoje = () => new Date().toLocaleDateString("sv-SE"); // yyyy-mm-dd no fuso local
const hora = (iso: string) => new Date(`${iso}Z`).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); // log grava UTC sem fuso
const diaExtenso = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

export function OperadoresPage({ nav }: { nav: Navegacao }) {
  const [dia, setDia] = useState(hoje());
  const { dados: a, erro } = usarDados<Atividade>(`/operadores/atividade?dia=${dia}`, nav.versao);
  const operadores = Object.entries(a?.por_operador ?? {}).sort(([, x], [, y]) => y.total - x.total);
  const porPlataforma = (p: Plataforma) => operadores.reduce((s, [, r]) => s + (r.por_plataforma[p] ?? 0), 0);

  return (
    <div className="tela operadores">
      <header className="cabecalho">
        <div>
          <h1>Devoluções por operador</h1>
          <p className="sub">{diaExtenso(dia)}</p>
        </div>
        {dia !== hoje() && <button type="button" className="botao" onClick={() => setDia(hoje())}>Hoje</button>}
        <input className="seletor op-data" type="date" value={dia} max={hoje()} onChange={(e) => e.target.value && setDia(e.target.value)}
               aria-label="Dia" />
      </header>

      {erro && <p className="aviso erro">{erro}</p>}

      <section className="op-cartoes" aria-label="Resumo do dia">
        <article className="cartao op-cartao op-total">
          <span className="op-rotulo">Conferências no dia</span>
          <strong className="op-numero">{a?.total ?? "…"}</strong>
          <div className="op-plataformas">
            {PLATAFORMAS.map((p) => (
              <span key={p}><LogoPlataforma plataforma={p} tamanho={16} /> {porPlataforma(p)}</span>
            ))}
          </div>
        </article>
        {operadores.map(([nome, r]) => (
          <article key={nome} className="cartao op-cartao">
            <div className="op-pessoa">
              <span className="op-avatar" aria-hidden="true">{nome.trim().charAt(0).toUpperCase()}</span>
              <span className="op-nome">{nome}</span>
            </div>
            <strong className="op-numero">{r.total}</strong>
            <div className="op-barra" aria-hidden="true">
              {PLATAFORMAS.map((p) => (
                <span key={p} className={`op-barra-${p}`} style={{ flexGrow: r.por_plataforma[p] ?? 0 }} />
              ))}
            </div>
            <div className="op-plataformas">
              {PLATAFORMAS.map((p) => (
                <span key={p}><LogoPlataforma plataforma={p} tamanho={16} /> {r.por_plataforma[p] ?? 0}</span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="cartao op-lista" aria-label="Conferências do dia">
        <header><h2>Conferências</h2>{a && a.total > 0 && <span className="sub">clique numa linha para abrir a devolução</span>}</header>
        {a && a.total === 0 ? (
          <div className="op-vazio">
            <strong>Nenhuma conferência nesse dia</strong>
            <span className="sub">Assim que alguém registrar uma conferência na bancada, ela aparece aqui.</span>
          </div>
        ) : (
          <div className="tabela-area">
            <table className="tabela">
              <thead>
                <tr><th>Horário</th><th>Operador</th><th>Plataforma</th><th>Pedido</th><th>Classe</th><th>Resultado</th></tr>
              </thead>
              <tbody>
                {a?.itens.map((i, idx) => {
                  const st = i.status ? STATUS[i.status as Status] : undefined;
                  const classe = i.classe ? CLASSE[i.classe as keyof typeof CLASSE] : undefined;
                  return (
                    <tr key={idx} onClick={() => i.pedido && nav.abrir(i.pedido)}>
                      <td className="op-hora">{hora(i.horario)}</td>
                      <td><span className="op-pessoa">
                        <span className="op-avatar pequeno" aria-hidden="true">{i.operador.trim().charAt(0).toUpperCase()}</span>{i.operador}
                      </span></td>
                      <td><LogoPlataforma plataforma={i.plataforma} tamanho={18} comNome /></td>
                      <td className="op-pedido">{i.pedido ?? "—"}</td>
                      <td>{classe ? <span className={`op-classe classe-${i.classe}`}>{i.classe} · {classe.nome}</span> : "—"}</td>
                      <td>{st
                        ? <span className="check"><span className="ponto-etapa" data-cor={st.cor} />{st.nome}</span>
                        : (i.status ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
