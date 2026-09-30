import { useState } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { quando, reais } from "../../shared/formato";
import { usarDados } from "../../shared/usarDados";
import { diaMes, faturaDoDia, NOME_MES, ultimasFaturas } from "../bi/BiPage";

interface Produto {
  sku: string; titulo: string | null; thumbnail: string | null; item_id: string | null;
  quantidade: number; bipes: number; valor: number; sem_custo: number; ultimo: string;
}
interface Bipe {
  codigo: string; sku: string; titulo: string | null; thumbnail: string | null; quantidade: number;
  custo_unitario: number | null; operador: string | null; criado_em: string;
}
interface Resposta {
  inicio: string; fim: string; produtos: Produto[]; bipes: Bipe[];
  total: { quantidade: number; bipes: number; valor: number; skus: number };
}

const foto = (url: string | null) => url?.replace("-I.jpg", "-O.jpg") ?? null;

export function RetornoFullPage({ nav }: { nav: Navegacao }) {
  const [periodo, setPeriodo] = useState(faturaDoDia(new Date()));
  const { dados: r, erro } = usarDados<Resposta>(
    `/retiradas-full?${periodo.includes("-") ? `fatura=${periodo}` : `dias=${periodo}`}`, nav.versao);
  const t = r?.total;

  return (
    <div className="tela full-pg">
      <header className="cabecalho">
        <div>
          <h1>Retorno do Full</h1>
          <p className="sub">{r ? `Voltou do Full do Mercado Livre e entrou no orgânico, de ${diaMes(r.inicio)} a ${diaMes(r.fim)}` : "Carregando…"}</p>
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

      <section className="op-cartoes" aria-label="Resumo do período">
        <article className="cartao op-cartao op-total">
          <span className="op-rotulo">Unidades que voltaram</span>
          <strong className="op-numero">{t?.quantidade ?? "…"}</strong>
          <span className="op-plataformas">em {t?.bipes ?? 0} bipes</span>
        </article>
        <article className="cartao op-cartao">
          <span className="op-rotulo">Produtos diferentes</span>
          <strong className="op-numero">{t?.skus ?? "…"}</strong>
          <span className="sub">SKUs com retorno no período</span>
        </article>
        <article className="cartao op-cartao">
          <span className="op-rotulo">Valor que voltou (custo)</span>
          <strong className="op-numero">{reais(t?.valor)}</strong>
          <span className="sub">pelo custo do dia do retorno</span>
        </article>
      </section>

      <section className="cartao op-lista" aria-label="Por produto">
        <header><h2>Por produto</h2><span className="sub">o que mais volta primeiro</span></header>
        {r && r.produtos.length === 0 ? (
          <div className="op-vazio">
            <strong>Nada voltou do Full no período</strong>
            <span className="sub">Cada etiqueta do Full bipada na bancada aparece aqui (registro a partir de 28/09/2026).</span>
          </div>
        ) : (
          <div className="tabela-area">
            <table className="tabela qb-tabela">
              <thead><tr><th>Produto</th><th className="num">Unidades</th><th className="num">Bipes</th><th className="num">Valor</th><th className="num">Último retorno</th></tr></thead>
              <tbody>
                {r?.produtos.map((p) => (
                  <tr key={p.sku}>
                    <td>
                      <div className="qb-produto">
                        {p.thumbnail ? <img src={foto(p.thumbnail)!} alt="" loading="lazy" /> : <span className="qb-sem-foto" aria-hidden="true" />}
                        <div>
                          <strong>{p.sku}</strong>
                          <span className="sub qb-nome" title={p.titulo ?? undefined}>{p.titulo ?? p.item_id ?? "—"}</span>
                        </div>
                      </div>
                    </td>
                    <td className="num"><strong className="full-qtd">{p.quantidade}</strong></td>
                    <td className="num">{p.bipes}</td>
                    <td className="num">{p.sem_custo === p.quantidade ? <span className="qb-falta">sem custo</span> : reais(p.valor)}</td>
                    <td className="num sub">{quando(p.ultimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cartao op-lista" aria-label="Últimos bipes">
        <header><h2>Bipe a bipe</h2>{r && r.bipes.length >= 200 && <span className="sub">últimos 200</span>}</header>
        {r && r.bipes.length === 0 ? <div className="op-vazio"><span className="sub">Nenhum bipe no período.</span></div> : (
          <div className="tabela-area">
            <table className="tabela qb-tabela">
              <thead><tr><th>Quando</th><th>Quem</th><th>Etiqueta</th><th>SKU</th><th className="num">Qtd</th></tr></thead>
              <tbody>
                {r?.bipes.map((b, i) => (
                  <tr key={`${b.codigo}-${b.criado_em}-${i}`}>
                    <td className="op-hora">{quando(b.criado_em)}</td>
                    <td>{b.operador
                      ? <span className="op-pessoa"><span className="op-avatar pequeno" aria-hidden="true">{b.operador.charAt(0).toUpperCase()}</span>{b.operador}</span>
                      : <span className="sub">—</span>}</td>
                    <td className="op-pedido">{b.codigo}</td>
                    <td title={b.titulo ?? undefined}>{b.sku}</td>
                    <td className="num"><strong>{b.quantidade}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
