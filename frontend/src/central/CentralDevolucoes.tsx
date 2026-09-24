import { Component, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { BiPage } from "./modules/bi/BiPage";
import { ConferenciaModal } from "./modules/conferencia/ConferenciaModal";
import { HistoricoPage } from "./modules/historico/HistoricoPage";
import { OperacaoPage } from "./modules/operacao/OperacaoPage";
import { ResumoPage } from "./modules/resumo/ResumoPage";
import { Icone } from "./shared/Icone";
import "./shared/estilo.css";

const TELAS = [
  { id: "resumo", nome: "Resumo" },
  { id: "operacao", nome: "Operação" },
  { id: "bi", nome: "B.I" },
  { id: "historico", nome: "Histórico" },
] as const;
export type IdTela = (typeof TELAS)[number]["id"];

export interface Navegacao {
  abrir: (codigo: string) => void;
  irPara: (tela: IdTela, statusFiltro?: string) => void;
  /** Muda depois de qualquer ação no modal: as telas recarregam os números. */
  versao: number;
  statusInicial?: string;
}

function Central({ onVoltar }: { onVoltar: () => void }) {
  const [tela, setTela] = useState<IdTela>("resumo");
  const [statusInicial, setStatusInicial] = useState<string | undefined>();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [busca, setBusca] = useState("");
  const campoBusca = useRef<HTMLInputElement>(null);

  const abrir = useCallback((c: string) => setCodigo(c.trim()), []);
  const irPara = useCallback((t: IdTela, s?: string) => { setStatusInicial(s); setTela(t); }, []);
  const fechar = useCallback(() => { setCodigo(null); setVersao((v) => v + 1); }, []);

  // Painel vivo: a sincronização roda no servidor a cada 10 min; a tela busca os números a cada minuto.
  // Com o modal aberto não recarrega, para não mexer na conferência em andamento.
  useEffect(() => {
    if (codigo) return;
    const t = setInterval(() => setVersao((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, [codigo]);

  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        campoBusca.current?.focus();
      }
    }
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  function buscar(e: FormEvent) {
    e.preventDefault();
    if (busca.trim()) abrir(busca);
    setBusca("");
  }

  const nav: Navegacao = { abrir, irPara, versao, statusInicial };

  return (
    <div className="cd-app">
      <header className="topo">
        <button className="voltar" onClick={onVoltar} aria-label="Voltar para o início">←</button>
        <div className="marca" aria-label="NVS Tech, Central de Devolução">
          <span className="marca-nvs">NVS<small>TECH</small></span>
          <span className="marca-produto">Central de<strong>Devolução</strong></span>
        </div>
        <nav aria-label="Telas">
          {TELAS.map((t) => (
            <button key={t.id} aria-current={tela === t.id ? "page" : undefined} onClick={() => irPara(t.id)}>{t.nome}</button>
          ))}
        </nav>
        <form className="busca-global" onSubmit={buscar} role="search">
          <Icone nome="lupa" tamanho={18} />
          <input ref={campoBusca} value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar devolução"
                 placeholder="Bipar ou buscar rastreio, pedido…" autoComplete="off" />
          <kbd>Ctrl K</kbd>
        </form>
      </header>

      <main className="conteudo">
        {tela === "resumo" && <ResumoPage nav={nav} />}
        {tela === "operacao" && <OperacaoPage nav={nav} />}
        {tela === "bi" && <BiPage nav={nav} />}
        {tela === "historico" && <HistoricoPage nav={nav} />}
      </main>

      {codigo && <ConferenciaModal codigo={codigo} onFechar={fechar} onMudou={() => setVersao((v) => v + 1)} />}
    </div>
  );
}

class Protecao extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }
  render() {
    return this.state.erro ? (
      <p className="nota erro" role="alert">A tela travou: {this.state.erro.message}. Recarregue a página.</p>
    ) : this.props.children;
  }
}

/** Central de Devoluções: página própria do estoque. `.central-dev` isola o CSS da Central do resto do app. */
export function CentralDevolucoes({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="central-dev">
      <Protecao><Central onVoltar={onVoltar} /></Protecao>
    </div>
  );
}
