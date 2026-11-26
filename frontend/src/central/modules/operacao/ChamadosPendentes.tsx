import { useEffect, useRef, useState, type FormEvent } from "react";

import { api } from "../../shared/api";
import { PLATAFORMA } from "../../shared/devolucao";
import { reais } from "../../shared/formato";
import { Icone } from "../../shared/Icone";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import type { LinhaOperacao } from "../../shared/operacao";
import { usarDados } from "../../shared/usarDados";

/** Mediação perdida de produto que voltou quebrado ou diferente: o valor só volta com chamado manual no suporte. */
export interface ChamadoPendente extends LinhaOperacao {
  perdida_em: string;
  conferencia: { classe: "A" | "B" | "C"; chamado_protocolo: string | null; chamado_aberto_em: string | null };
}
interface Chamados { abrir: ChamadoPendente[]; aguardando: ChamadoPendente[] }

const PROBLEMA = { A: "Voltou perfeito, comprador culpou a Novaes", B: "Chegou quebrado / avariado", C: "Diferente do que enviamos" } as const;

/** Igual ao backend (operacao/servico.PRAZO_CHAMADO_DIAS): passou disso, sai da lista e fica como perda. */
const PRAZO_DIAS = 30;

const FAIXAS = [
  { id: "todas", nome: "Todas", cabe: () => true },
  { id: "vencendo", nome: "Vencendo (até 7 dias)", cabe: (d: number) => PRAZO_DIAS - d <= 7 },
  { id: "8a20", nome: "8 a 20 dias", cabe: (d: number) => PRAZO_DIAS - d > 7 && PRAZO_DIAS - d <= 20 },
  { id: "folga", nome: "Mais de 20 dias", cabe: (d: number) => PRAZO_DIAS - d > 20 },
] as const;

const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(`${iso}Z`).getTime()) / 864e5));
const ha = (d: number) => (d === 0 ? "hoje" : d === 1 ? "há 1 dia" : `há ${d} dias`);
const faltam = (d: number) => { const f = Math.max(0, PRAZO_DIAS - d); return f <= 1 ? "último dia" : `faltam ${f} dias`; };

/** Faixa vermelha no topo da Central enquanto houver chamado a abrir. Some sozinha quando a lista zera. */
export function AlertaChamados({ versao, onAbrir }: { versao: number; onAbrir: () => void }) {
  const { dados: todos } = usarDados<Chamados>("/operacao/chamados-pendentes", versao);
  const dados = todos?.abrir;
  if (!dados?.length) return null;
  const n = dados.length;
  const valor = dados.reduce((s, c) => s + (c.prejuizo ?? 0), 0);
  return (
    <button type="button" className="alerta-chamados" onClick={onAbrir}>
      <span className="alerta-chamados-sino" aria-hidden="true">!</span>
      <span>
        <strong>{n === 1 ? "1 mediação perdida precisa de chamado" : `${n} mediações perdidas precisam de chamado`}</strong>
        <span className="alerta-chamados-sub">
          A bancada contradiz o comprador (voltou quebrado, diferente ou perfeito). Abra o chamado no suporte para receber
          {valor > 0 ? ` ${reais(valor)}` : " o valor"}.
        </span>
      </span>
      <span className="alerta-chamados-acao">Abrir chamados</span>
    </button>
  );
}

function Linha({ c, onFeito, onVer }: { c: ChamadoPendente; onFeito: () => void; onVer: () => void }) {
  if (c.conferencia.chamado_aberto_em) return <LinhaAguardando c={c} onFeito={onFeito} onVer={onVer} />;
  return <LinhaAbrir c={c} onFeito={onFeito} onVer={onVer} />;
}

function Produto({ c }: { c: ChamadoPendente }) {
  const skus = c.itens.map((i) => i.sku).filter(Boolean).join(", ");
  return (
    <>
      {c.imagem ? <img src={c.imagem} alt="" loading="lazy" /> : <span className="foto-vazia" />}
      <span className="produto-nome">
        <strong>{c.produto ?? (skus ? `SKU ${skus}` : "Produto sem nome")}</strong>
        <span className="sub">{c.produto && skus ? `SKU ${skus}, ` : ""}pedido {c.pacote ?? c.pedido}</span>
      </span>
      <LogoPlataforma plataforma={c.plataforma} tamanho={24} />
    </>
  );
}

/** Protocolo aberto: falta dizer se o suporte devolveu o valor. Recebido vira recuperado no B.I.; não, continua perda. */
function LinhaAguardando({ c, onFeito, onVer }: { c: ChamadoPendente; onFeito: () => void; onVer: () => void }) {
  const [recebendo, setRecebendo] = useState(false);
  const [valor, setValor] = useState(c.prejuizo != null ? String(c.prejuizo) : "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function responder(recuperado: boolean) {
    if (!recuperado && !window.confirm("Confirmar que o suporte NÃO devolveu o valor? Fica como perda no B.I.")) return;
    setErro(null);
    setEnviando(true);
    try {
      const v = valor.replace(",", ".").trim();
      await api.post(`/conferencia/${c.id}/chamado-manual/resultado`, { recuperado, valor: recuperado && v ? Number(v) : null });
      onFeito();
    } catch (er) {
      setErro((er as Error).message);
      setEnviando(false);
    }
  }

  return (
    <li className="chamado aguardando">
      <div className="chamado-linha">
        <Produto c={c} />
        <span>
          <span className="sub">Protocolo</span>
          <strong>{c.conferencia.chamado_protocolo ?? "—"}</strong>
        </span>
        <span>
          <span className="sub">Chamado aberto</span>
          <strong>{ha(diasDesde(c.conferencia.chamado_aberto_em!))}</strong>
          <span className={PRAZO_DIAS - diasDesde(c.conferencia.chamado_aberto_em!) <= 7 ? "ruim" : "sub"}>
            {faltam(diasDesde(c.conferencia.chamado_aberto_em!))}
          </span>
        </span>
        <span>
          <span className="sub">Em jogo</span>
          <strong>{reais(c.prejuizo)}</strong>
        </span>
        <span className="chamado-botoes">
          <button type="button" className="botao" onClick={onVer}>Ver devolução</button>
          {!recebendo && <button type="button" className="botao principal" onClick={() => setRecebendo(true)} disabled={enviando}>Recebemos</button>}
          {!recebendo && <button type="button" className="botao" onClick={() => void responder(false)} disabled={enviando}>Não recebemos</button>}
        </span>
      </div>
      {recebendo && (
        <form className="chamado-protocolo" onSubmit={(e) => { e.preventDefault(); void responder(true); }}>
          <label>
            <span>Quanto o suporte devolveu (R$)</span>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Ex.: 149,90" autoFocus />
          </label>
          <button type="button" className="botao" onClick={() => setRecebendo(false)}>Cancelar</button>
          <button type="submit" className="botao principal" disabled={enviando}>{enviando ? "Salvando…" : "Confirmar valor recuperado"}</button>
        </form>
      )}
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </li>
  );
}

function LinhaAbrir({ c, onFeito, onVer }: { c: ChamadoPendente; onFeito: () => void; onVer: () => void }) {
  const [abrindo, setAbrindo] = useState(false);
  const [protocolo, setProtocolo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { if (abrindo) campo.current?.focus(); }, [abrindo]);

  const dias = diasDesde(c.perdida_em);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!protocolo.trim()) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${c.id}/chamado-manual/aberto`, { protocolo: protocolo.trim() });
      onFeito();
    } catch (er) {
      setErro((er as Error).message);
      setEnviando(false);
    }
  }

  return (
    <li className="chamado">
      <div className="chamado-linha">
        <Produto c={c} />
        <span>
          <span className="sub">Problema na conferência</span>
          <span className={`chamado-problema classe-${c.conferencia.classe.toLowerCase()}`}>{PROBLEMA[c.conferencia.classe]}</span>
        </span>
        <span>
          <span className="sub">Perdeu a mediação</span>
          <strong>{ha(dias)}</strong>
          <span className={PRAZO_DIAS - dias <= 7 ? "ruim" : "sub"}>{faltam(dias)}</span>
        </span>
        <span>
          <span className="sub">A receber</span>
          <strong>{reais(c.prejuizo)}</strong>
        </span>
        <span className="chamado-botoes">
          <button type="button" className="botao" onClick={onVer}>Ver devolução</button>
          {!abrindo && <button type="button" className="botao alerta" onClick={() => setAbrindo(true)}>Chamado realizado</button>}
        </span>
      </div>
      {abrindo && (
        <form className="chamado-protocolo" onSubmit={confirmar}>
          <label>
            <span>Número do protocolo no suporte do {PLATAFORMA[c.plataforma]}</span>
            <input ref={campo} value={protocolo} onChange={(e) => setProtocolo(e.target.value)} required maxLength={60}
                   placeholder="Ex.: 123456789" autoComplete="off" />
          </label>
          <button type="button" className="botao" onClick={() => { setAbrindo(false); setProtocolo(""); }}>Cancelar</button>
          <button type="submit" className="botao principal" disabled={!protocolo.trim() || enviando}>
            {enviando ? "Salvando…" : "Confirmar protocolo"}
          </button>
          {erro && <p className="aviso erro" role="alert">{erro}</p>}
        </form>
      )}
    </li>
  );
}

/** Lista das mediações perdidas que pedem chamado manual. Cada uma só sai daqui com o número do protocolo. */
export function ChamadosPendentesModal({ versao, onFechar, onMudou, onVer }:
  { versao: number; onFechar: () => void; onMudou: () => void; onVer: (codigo: string) => void }) {
  const [recarga, setRecarga] = useState(0);
  const { dados: todos, erro } = usarDados<Chamados>("/operacao/chamados-pendentes", versao + recarga);
  const dados = todos?.abrir;
  const aguardando = todos?.aguardando ?? [];
  const [faixa, setFaixa] = useState<(typeof FAIXAS)[number]["id"]>("todas");
  const [aba, setAba] = useState<"abrir" | "aguardando">("abrir");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const contar = (f: (typeof FAIXAS)[number]) => dados?.filter((c) => f.cabe(diasDesde(c.perdida_em))).length ?? 0;
  const atual = FAIXAS.find((f) => f.id === faixa)!;
  const lista = dados?.filter((c) => atual.cabe(diasDesde(c.perdida_em))) ?? [];

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal chamados-modal" role="dialog" aria-modal="true" aria-labelledby="chamados-titulo">
        <header className="modal-topo">
          <div>
            <h2 id="chamados-titulo">Chamados a abrir: mediações perdidas</h2>
            <p className="sub">
              A conferência contradiz o comprador (voltou quebrado, diferente do enviado, ou perfeito quando ele alegou
              defeito), mas a plataforma deu ganho a ele.
              Abra o chamado no suporte e registre o protocolo: só assim sai da lista (e o vídeo é apagado). Depois,
              em "Aguardando resposta", diga se o valor voltou: recebido entra no B.I. como recuperado.
              Prazo de {PRAZO_DIAS} dias em cada etapa: passou, sai daqui, o vídeo é apagado e fica como perda.
            </p>
          </div>
          <button type="button" className="icone-botao" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" />
          </button>
        </header>
        <div className="chamados-filtros">
          <div className="segmentos" role="tablist" aria-label="Etapa do chamado">
            <button type="button" role="tab" aria-selected={aba === "abrir"} aria-pressed={aba === "abrir"} onClick={() => setAba("abrir")}>
              Abrir chamado <span className="contagem">{dados?.length ?? "…"}</span>
            </button>
            <button type="button" role="tab" aria-selected={aba === "aguardando"} aria-pressed={aba === "aguardando"} onClick={() => setAba("aguardando")}>
              Aguardando resposta <span className="contagem">{todos ? aguardando.length : "…"}</span>
            </button>
          </div>
          {aba === "abrir" && (
            <div className="segmentos" role="group" aria-label="Tempo desde que a mediação foi perdida">
              {FAIXAS.map((f) => (
                <button key={f.id} type="button" aria-pressed={faixa === f.id} onClick={() => setFaixa(f.id)}>
                  {f.nome} <span className="contagem">{contar(f)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chamados-corpo">
          {erro && <p className="aviso erro" role="alert">{erro}</p>}
          {!todos && !erro && <p className="vazio">Carregando…</p>}
          {aba === "abrir" && dados && dados.length === 0 && <p className="vazio">Nenhum chamado para abrir. Tudo em dia.</p>}
          {aba === "abrir" && dados && dados.length > 0 && lista.length === 0 && <p className="vazio">Nada nesta faixa de tempo.</p>}
          {aba === "aguardando" && todos && aguardando.length === 0 && <p className="vazio">Nenhum chamado esperando resposta do suporte.</p>}
          <ul className="chamados-lista">
            {(aba === "abrir" ? lista : aguardando).map((c) => (
              <Linha key={c.id} c={c} onVer={() => onVer(c.rastreio ?? c.id_externo)}
                     onFeito={() => { setRecarga((r) => r + 1); onMudou(); }} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
