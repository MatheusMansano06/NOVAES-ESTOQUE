import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Navegacao } from "../../CentralDevolucoes";
import { BASE_API } from "../../shared/api";
import { MOTIVO, type Plataforma } from "../../shared/devolucao";
import { prazoRestante } from "../../shared/formato";
import { Icone } from "../../shared/Icone";
import { ACaminho } from "../../shared/ACaminho";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { codigoDe, ENVIO, type Envio, type LinhaOperacao, type Operacao, type Status } from "../../shared/operacao";
import { usarDados } from "../../shared/usarDados";

/** Abas na língua de quem está na bancada: o que é e o que fazer com cada grupo. */
const ABAS = [
  { id: "aguardando_conferencia", nome: "Chegaram", explica: "Pacotes que já estão aqui. Confira um por um.", status: ["aguardando_conferencia"] },
  { id: "precisa_acao", nome: "Falta terminar", explica: "Já conferidos: falta lançar o estoque, contestar ou abrir chamado.", status: ["precisa_acao"] },
  { id: "a_caminho", nome: "A caminho", explica: "Ainda não chegaram. Nada a fazer por enquanto.", status: ["a_caminho"] },
  { id: "em_mediacao", nome: "Em mediação", explica: "A plataforma está decidindo. Só acompanhar.", status: ["em_mediacao"] },
  // Filtra pelo resultado da mediação, não pelo status: o status de quem terminou já é "Concluídas".
  { id: "mediacoes", nome: "Mediações encerradas", explica: "Ganhas e perdidas. A perdida vale abrir chamado manual.", status: [] },
  { id: "concluidas", nome: "Concluídas", explica: "Tudo feito. Ficam aqui para consulta.", status: ["resolvida", "finalizada"] },
] as const;
type IdAba = (typeof ABAS)[number]["id"];
const POR_PAGINA = 7;

const RESULTADO: Record<string, string> = {
  ganha: "Mediação ganha", perdida: "Mediação perdida", parcial: "Mediação parcial (perdeu parte)",
};
type Resultado = "" | "ganha" | "perdida";
const FILTRO_RESULTADO: Record<Resultado, string> = { "": "ganha,perdida,parcial", ganha: "ganha", perdida: "perdida,parcial" };

const PENDENCIA_TEXTO: Record<string, { situacao: string; botao: string }> = {
  lancar_estoque: { situacao: "Falta lançar o estoque na Olist", botao: "Lançar estoque" },
  contestar: { situacao: "Vale contestar na plataforma", botao: "Contestar" },
  chamado_manual: { situacao: "Abrir chamado manual na plataforma", botao: "Abrir chamado" },
};
const SITUACAO: Record<Status, string> = {
  a_caminho: "Ainda não chegou", aguardando_conferencia: "Chegou, falta conferir", precisa_acao: "Falta terminar",
  em_mediacao: "A plataforma está decidindo", com_a_plataforma: "Ficou no CD da plataforma", resolvida: "Resolvida", finalizada: "Finalizada",
};

/** Vídeo e fotos da conferência. Só carrega ao abrir: arquivo de vídeo na lista inteira gastaria banda à toa. */
function Provas({ evidencias }: { evidencias: LinhaOperacao["evidencias"] }) {
  const [aberto, setAberto] = useState(false);
  if (!evidencias.length) return null;
  const fotos = evidencias.filter((e) => e.tipo === "foto").length;
  const videos = evidencias.length - fotos;
  const resumo = [videos && (videos === 1 ? "1 vídeo" : `${videos} vídeos`), fotos && (fotos === 1 ? "1 foto" : `${fotos} fotos`)].filter(Boolean).join(" e ");
  return (
    <details className="provas" onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>Provas da conferência: {resumo}</summary>
      {aberto && (
        <ul>
          {evidencias.map((ev) => {
            const url = `${BASE_API}/conferencia/evidencias/${ev.id}`;
            return (
              <li key={ev.id}>
                {ev.tipo === "video"
                  ? <video src={url} controls preload="metadata" />
                  : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Foto ${ev.id} da conferência`} loading="lazy" /></a>}
                <a className="botao" href={url} download={ev.arquivo}>Baixar</a>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

function lerBancada() {
  try { return localStorage.getItem("modoBancada") !== "0"; } catch { return true; }
}

function acao(l: LinhaOperacao) {
  if (l.status === "a_caminho" && l.envio) return { situacao: ENVIO[l.envio], botao: "Ver detalhes", principal: false };
  if (l.pendencias.length) return { ...PENDENCIA_TEXTO[l.pendencias[0]], principal: true };
  if (l.mediacao && RESULTADO[l.mediacao]) return { situacao: RESULTADO[l.mediacao], botao: "Ver detalhes", principal: false };
  if (l.status === "aguardando_conferencia") return { situacao: SITUACAO[l.status], botao: "Conferir agora", principal: true };
  if (l.status === "em_mediacao") return { situacao: SITUACAO[l.status], botao: "Acompanhar", principal: false };
  return { situacao: SITUACAO[l.status], botao: "Ver detalhes", principal: false };
}

export function OperacaoPage({ nav }: { nav: Navegacao }) {
  const campo = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState("");
  const [bancada, setBancada] = useState(lerBancada);
  const inicial = ABAS.find((a) => (a.status as readonly string[]).includes(nav.statusInicial ?? ""))?.id ?? "aguardando_conferencia";
  const [aba, setAba] = useState<IdAba>(inicial);
  const [plataforma, setPlataforma] = useState<Plataforma | "">(nav.filtroInicial?.plataforma ?? "");
  const [envio, setEnvio] = useState<Envio | "">(nav.filtroInicial?.envio ?? "");
  const [resultado, setResultado] = useState<Resultado>("");
  const [pagina, setPagina] = useState(1);

  const atual = ABAS.find((a) => a.id === aba)!;
  const filtro = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA), destino: "vendedor", status: atual.status.join(",") });
  if (plataforma) filtro.set("plataforma", plataforma);
  if (aba === "a_caminho" && envio) filtro.set("envio", envio);
  if (aba === "mediacoes") filtro.set("mediacao", FILTRO_RESULTADO[resultado]);
  const { dados, erro } = usarDados<Operacao>(`/operacao?${filtro}`, nav.versao);
  // Contagens de todas as abas, sem filtro de status (a resposta já traz a contagem por status).
  const { dados: todas } = usarDados<Operacao>(`/operacao?por_pagina=1&destino=vendedor${plataforma ? `&plataforma=${plataforma}` : ""}`, nav.versao);
  const contar = (ids: readonly string[]) => (todas ? ids.reduce((s, id) => s + (todas.contagens[id as Status] ?? 0), 0) : null);
  const m = todas?.mediacoes;
  const contarAba = (a: (typeof ABAS)[number]) => (a.id === "mediacoes" ? (m ? m.ganha + m.perdida + m.parcial : null) : contar(a.status));

  useEffect(() => { setPagina(1); }, [aba, plataforma, envio, resultado]);

  // Modo bancada: o foco volta sozinho para o campo, o leitor pode bipar a qualquer momento.
  useEffect(() => {
    try { localStorage.setItem("modoBancada", bancada ? "1" : "0"); } catch { /* sem armazenamento: só não lembra */ }
    if (!bancada) return;
    campo.current?.focus();
    const voltar = () => setTimeout(() => {
      if (!document.querySelector(".modal") && document.activeElement?.tagName !== "SELECT") campo.current?.focus();
    }, 50);
    window.addEventListener("click", voltar);
    return () => window.removeEventListener("click", voltar);
  }, [bancada, nav.versao]);

  function bipar(e: FormEvent) {
    e.preventDefault();
    if (codigo.trim()) nav.abrir(codigo, true);
    setCodigo("");
  }

  const paginas = Math.max(1, Math.ceil((dados?.total ?? 0) / POR_PAGINA));

  return (
    <div className="tela operacao">
      <section className="cartao bipe-cartao">
        <div className="bipe-topo">
          <h1>Bancada de devoluções</h1>
          <label className="interruptor" title="Com o modo bancada ligado, o cursor fica sempre no campo do leitor">
            <input type="checkbox" checked={bancada} onChange={(e) => setBancada(e.target.checked)} />
            <span className="interruptor-trilho" aria-hidden="true" />
            <span>Modo bancada</span>
          </label>
        </div>
        <form className="bipe" onSubmit={bipar} role="search">
          <Icone nome="codigo" tamanho={26} />
          <input ref={campo} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off"
                 aria-label="Bipe a etiqueta do pacote" placeholder="Bipe a etiqueta, o QR code ou a nota do pacote que chegou" />
          <button type="submit" className="botao principal">Abrir</button>
        </form>
        <ol className="passos">
          <li><span>1</span>Bipe a etiqueta, o QR code ou a nota que veio no pacote</li>
          <li><span>2</span>A câmera abre em tela cheia: filme a abertura do pacote, clique em terminar e responda as perguntas</li>
          <li><span>3</span>Siga o que o sistema indicar: estoque, contestação ou chamado</li>
        </ol>
      </section>

      <div className="abas-operador" role="tablist" aria-label="Grupos de devoluções">
        {ABAS.map((a) => (
          <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
            <span className="aba-topo"><strong>{a.nome}</strong><span className="contagem">{contarAba(a) ?? "…"}</span></span>
            <span className="aba-explica">{a.explica}</span>
          </button>
        ))}
      </div>

      {aba === "a_caminho" && (
        <ACaminho dados={todas?.a_caminho} ativo={{ plataforma, envio }} onEscolher={(p, e) => { setPlataforma(p); setEnvio(e); }} />
      )}

      <section className="cartao lista">
        <div className="lista-topo">
          <p className="sub">{atual.explica}</p>
          {aba === "a_caminho" && (
            <div className="segmentos" role="group" aria-label="Situação do envio">
              <button type="button" aria-pressed={!envio} onClick={() => setEnvio("")}>Todos</button>
              <button type="button" aria-pressed={envio === "aguardando_postagem"} onClick={() => setEnvio("aguardando_postagem")}>Não postou</button>
              <button type="button" aria-pressed={envio === "postado"} onClick={() => setEnvio("postado")}>Postado</button>
            </div>
          )}
          {aba === "mediacoes" && (
            <div className="segmentos" role="group" aria-label="Resultado da mediação">
              <button type="button" aria-pressed={!resultado} onClick={() => setResultado("")}>Todas</button>
              <button type="button" aria-pressed={resultado === "ganha"} onClick={() => setResultado("ganha")}>Ganhas {m?.ganha ?? ""}</button>
              <button type="button" aria-pressed={resultado === "perdida"} onClick={() => setResultado("perdida")}>Perdidas {m ? m.perdida + m.parcial : ""}</button>
            </div>
          )}
          <div className="segmentos" role="group" aria-label="Marketplace">
            <button type="button" aria-pressed={!plataforma} onClick={() => setPlataforma("")}>Todos</button>
            {(["mercado_livre", "shopee"] as Plataforma[]).map((p) => (
              <button key={p} type="button" aria-pressed={plataforma === p} onClick={() => setPlataforma(p)}>
                <LogoPlataforma plataforma={p} tamanho={18} comNome />
              </button>
            ))}
          </div>
        </div>
        {erro && <p className="aviso erro">{erro}</p>}
        <ul className="fila-operador">
          {dados?.itens.map((l) => {
            const a = acao(l);
            const prazo = prazoRestante(l.prazo_vendedor);
            const urgente = prazo && (prazo === "prazo vencido" || prazo.endsWith("h restantes"));
            const skus = l.itens.map((i) => i.sku).filter(Boolean).join(", ");
            return (
              <li key={l.id}>
                <button type="button" className="linha-operador" onClick={() => nav.abrir(codigoDe(l), l.status === "aguardando_conferencia")}>
                  {l.imagem ? <img src={l.imagem} alt="" loading="lazy" /> : <span className="foto-vazia" />}
                  <span className="produto-nome">
                    <strong>{l.produto ?? (skus ? `SKU ${skus}` : "Produto sem nome")}</strong>
                    <span className="sub">{l.produto && skus ? `SKU ${skus}, ` : ""}pedido {l.pacote ?? l.pedido}</span>
                  </span>
                  <LogoPlataforma plataforma={l.plataforma} tamanho={24} />
                  <span className="motivo"><span className="sub">Por que voltou</span>{MOTIVO[l.motivo] ?? l.motivo}</span>
                  <span className="situacao">
                    <span className="sub">Situação</span>{a.situacao}
                    {urgente && <span className="urgente">Prazo: {prazo}</span>}
                  </span>
                  <span className={a.principal ? "botao principal" : "botao"}>{a.botao}</span>
                </button>
                <Provas evidencias={l.evidencias} />
              </li>
            );
          })}
        </ul>
        {dados && dados.itens.length === 0 && <p className="vazio">Nada aqui agora. {aba === "aguardando_conferencia" ? "Quando um pacote chegar, bipe a etiqueta no campo acima." : ""}</p>}
        {!dados && !erro && <p className="vazio">Carregando…</p>}
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
