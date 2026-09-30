import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import type { Operacao } from "../../shared/operacao";
import { TabelaDevolucoes } from "../../shared/TabelaDevolucoes";
import { usarDados } from "../../shared/usarDados";

const POR_PAGINA = 11;

export function HistoricoPage({ nav }: { nav: Navegacao }) {
  const [pagina, setPagina] = useState(1);
  const { dados, erro } = usarDados<Operacao>(
    `/operacao?status=resolvida,finalizada&destino=&pagina=${pagina}&por_pagina=${POR_PAGINA}`, nav.versao);
  const paginas = Math.max(1, Math.ceil((dados?.total ?? 0) / POR_PAGINA));

  return (
    <div className="tela historico">
      <header className="cabecalho">
        <div>
          <h1>Histórico</h1>
          <p className="sub">Devoluções resolvidas e finalizadas. Abra qualquer uma para ver conferência, fotos, estoque e contestação.</p>
        </div>
      </header>
      <section className="cartao lista">
        {erro && <p className="aviso erro">{erro}</p>}
        <div className="tabela-area">
          {dados && <TabelaDevolucoes linhas={dados.itens} onAbrir={nav.abrir} />}
          {!dados && !erro && <p className="vazio">Carregando…</p>}
        </div>
        <nav className="paginacao" aria-label="Páginas">
          <span className="sub">{dados?.total ?? 0} devoluções</span>
          <button type="button" onClick={() => setPagina((p) => p - 1)} disabled={pagina <= 1}>Anterior</button>
          <span className="sub">{pagina} de {paginas}</span>
          <button type="button" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= paginas}>Próxima</button>
        </nav>
      </section>
    </div>
  );
}
