import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { PLATAFORMA, type Plataforma } from "../../shared/devolucao";
import { quando } from "../../shared/formato";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { STATUS, type Status } from "../../shared/operacao";
import { usarDados } from "../../shared/usarDados";

interface Item {
  operador: string; horario: string; plataforma: Plataforma; pedido: string | null;
  classe: string | null; contestar: boolean | null; status: string | null;
}
interface Atividade {
  dia: string; total: number;
  por_operador: Record<string, { total: number; por_plataforma: Partial<Record<Plataforma, number>> }>;
  itens: Item[];
}

const hoje = () => new Date().toLocaleDateString("sv-SE"); // yyyy-mm-dd, sem fuso a mais

export function OperadoresPage({ nav }: { nav: Navegacao }) {
  const [dia, setDia] = useState(hoje());
  const { dados: a, erro } = usarDados<Atividade>(`/operadores/atividade?dia=${dia}`, nav.versao);
  const operadores = Object.entries(a?.por_operador ?? {}).sort(([, x], [, y]) => y.total - x.total);

  return (
    <div className="tela operadores">
      <header className="cabecalho">
        <h1>Devoluções por operador</h1>
        <input type="date" value={dia} max={hoje()} onChange={(e) => setDia(e.target.value)} aria-label="Dia" />
      </header>

      {erro && <p className="aviso erro">{erro}</p>}
      {a && a.total === 0 && <p className="aviso">Nenhuma conferência registrada nesse dia.</p>}

      <section className="cartao resumo-operadores" aria-label="Resumo por operador">
        {operadores.map(([nome, r]) => (
          <div key={nome} className="linha-resumo-operador">
            <strong>{nome}</strong>
            <span className="contagem">{r.total}</span>
            <span className="sub">
              {Object.entries(r.por_plataforma).map(([p, n]) => `${PLATAFORMA[p as Plataforma] ?? p}: ${n}`).join(" · ")}
            </span>
          </div>
        ))}
      </section>

      <section className="cartao tabela-area" aria-label="Conferências do dia">
        <table className="tabela">
          <thead>
            <tr><th>Horário</th><th>Operador</th><th>Plataforma</th><th>Pedido</th><th>Classe</th><th>Resultado</th></tr>
          </thead>
          <tbody>
            {a?.itens.map((i, idx) => (
              <tr key={idx} onClick={() => i.pedido && nav.abrir(i.pedido)}>
                <td>{quando(i.horario)}</td>
                <td>{i.operador}</td>
                <td><LogoPlataforma plataforma={i.plataforma} tamanho={18} comNome /></td>
                <td>{i.pedido ?? "—"}</td>
                <td>{i.classe ?? "—"}</td>
                <td>
                  {i.status && STATUS[i.status as Status]
                    ? <span className="check"><span className="ponto-etapa" data-cor={STATUS[i.status as Status].cor} />{STATUS[i.status as Status].nome}</span>
                    : (i.status ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
