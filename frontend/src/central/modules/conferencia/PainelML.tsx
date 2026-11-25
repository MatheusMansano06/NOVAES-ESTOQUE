import { useEffect, useState, type ReactNode } from "react";

import { api } from "../../shared/api";
import { prazoRestante, quando } from "../../shared/formato";
import type { Contestacao } from "./tipos";

/** Um botão do painel do ML, lido na hora. `pede` diz o que o operador precisa informar antes. */
interface AcaoML {
  acao: string;
  nome: string;
  pede: ("confirmar" | "motivo" | "texto" | "fotos")[];
  executavel: boolean;
  obrigatoria: boolean;
  prazo: string | null;
}

interface Situacao {
  situacao: string;
  /** Número que identifica o painel (1 a 5; 0 = situação que a Central ainda não conhece). */
  numero: number;
  titulo: string;
  explica: string;
  em_mediacao: boolean;
  acoes: AcaoML[];
}

type Motivo = { id: string; texto: string };

const CONFIRMA: Record<string, string> = {
  return_review_ok: "Confirmar \"Chegou como esperado\"? O ML encerra e reembolsa o comprador. Não dá para contestar depois.",
  refund: "Devolver o dinheiro ao comprador agora, sem esperar o produto? Não tem volta.",
  return_review_fail: "Enviar o relato de problema ao ML? Depois de enviado não dá para desfazer.",
  open_dispute: "Abrir mediação no ML? O mediador passa a decidir o caso.",
};

const FEITO: Record<string, string> = {
  aceite: "Chegou como esperado", reembolso: "Dinheiro devolvido", revisao_com_falha: "Problema reportado",
  mediacao: "Mediação aberta", disputa: "Disputa aberta", mensagem_mediador: "Mensagem ao mediador",
  mensagem_comprador: "Mensagem ao comprador",
};

/** Espelho do painel do ML: identifica a situação da reclamação e mostra só os botões que o ML libera agora.
 *  `semPainel` aparece quando a reclamação não tem painel no ML (ex.: só o envio, sem reclamação). */
export function PainelML({ devolucaoId, temFoto, onIrParaProvas, onMudou, semPainel }:
  { devolucaoId: number; temFoto: boolean; onIrParaProvas: () => void; onMudou: () => void; semPainel: ReactNode }) {
  const [sit, setSit] = useState<Situacao | null | undefined>(undefined);
  const [historico, setHistorico] = useState<Contestacao[]>([]);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [aberta, setAberta] = useState<AcaoML | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    setErroLeitura(null);
    api.get<Situacao | null>(`/mediacoes/${devolucaoId}/situacao`)
      .then((s) => ativo && setSit(s))
      .catch((e) => ativo && setErroLeitura(`Não consegui ler a reclamação no ML: ${(e as Error).message}`));
    api.get<Contestacao[]>(`/mediacoes/${devolucaoId}`).then((h) => ativo && setHistorico(h)).catch(() => {});
    return () => { ativo = false; };
  }, [devolucaoId, versao]);

  if (sit === null) return <>{semPainel}</>;

  function feito(r: Contestacao) {
    setHistorico((h) => [...h, r]);
    if (r.ok) { setAberta(null); setVersao((v) => v + 1); onMudou(); }
  }

  return (
    <div className="painel-ml">
      {erroLeitura && <p className="aviso erro" role="alert">{erroLeitura}</p>}
      {sit === undefined && !erroLeitura && <p className="sub">Lendo a reclamação no Mercado Livre…</p>}
      {sit && <>
        <p className={`painel-ml-situacao situacao-${sit.situacao}`}>
          <strong>Situação {sit.numero || "?"} · {sit.titulo}</strong>
          {sit.em_mediacao && sit.situacao !== "mediacao" && <span> (com mediação aberta)</span>}
        </p>
        <p className="sub">{sit.explica}</p>
        {sit.acoes.length > 0 && (
          <div className="linha-botoes" role="group" aria-label="Botões que o Mercado Livre libera agora">
            {sit.acoes.map((a) => (
              <button key={a.acao} type="button" title={a.executavel ? undefined : "Faça pelo painel do Mercado Livre"}
                      className={`botao${a.acao === aberta?.acao ? " ativo" : ""}${a.obrigatoria ? " alerta" : ""}`}
                      aria-pressed={a.acao === aberta?.acao} onClick={() => setAberta(a)}>
                {a.nome}{a.obrigatoria ? " (o ML exige)" : ""}
              </button>
            ))}
            <button type="button" className="botao" onClick={() => setVersao((v) => v + 1)}>Atualizar</button>
          </div>
        )}
        {aberta && (aberta.executavel
          ? <FormAcao key={aberta.acao} devolucaoId={devolucaoId} acao={aberta} temFoto={temFoto}
                      onIrParaProvas={onIrParaProvas} onFeito={feito} />
          : <p className="aviso">“{aberta.nome}” só pelo painel do Mercado Livre (use “Abrir a reclamação no Mercado Livre”).</p>)}
      </>}
      <Historico itens={historico} />
    </div>
  );
}

function FormAcao({ devolucaoId, acao, temFoto, onIrParaProvas, onFeito }:
  { devolucaoId: number; acao: AcaoML; temFoto: boolean; onIrParaProvas: () => void; onFeito: (r: Contestacao) => void }) {
  const [motivos, setMotivos] = useState<Motivo[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pede = (p: AcaoML["pede"][number]) => acao.pede.includes(p);

  useEffect(() => {
    if (!acao.pede.includes("motivo")) return;
    let ativo = true;
    api.get<Motivo[]>(`/mediacoes/${devolucaoId}/motivos`)
      .then((m) => ativo && setMotivos(m))
      .catch((e) => ativo && setErro(`Não consegui buscar os motivos do ML: ${(e as Error).message}`));
    return () => { ativo = false; };
  }, [devolucaoId, acao]);

  async function enviar() {
    if (!window.confirm(CONFIRMA[acao.acao] ?? `Enviar "${acao.nome}" ao Mercado Livre agora?`)) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post<Contestacao>(`/mediacoes/${devolucaoId}/acao`, { acao: acao.acao, motivo, texto });
      if (!r.ok) setErro(r.erro);
      onFeito(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const faltaFoto = pede("fotos") && !temFoto;
  const pronto = (!pede("motivo") || motivo) && (!pede("texto") || texto.trim().length >= 10) && !faltaFoto;
  return (
    <div className="contestar">
      {acao.prazo && <p className="sub">Prazo do ML: {quando(acao.prazo)} ({prazoRestante(acao.prazo)}).</p>}
      {pede("motivo") && (
        <label className="campo">
          <span>Motivo oficial do ML (obrigatório)</span>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={!motivos}>
            <option value="">{motivos ? "Escolha o motivo" : "Carregando motivos…"}</option>
            {motivos?.map((m) => <option key={m.id} value={m.id}>{m.texto}</option>)}
          </select>
        </label>
      )}
      {pede("texto") && (
        <label className="campo">
          <span>{acao.acao === "send_message_to_complainant" ? "Mensagem ao comprador" : "O que aconteceu"} (mín. 10 letras; vai para o ML)</span>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} />
        </label>
      )}
      {faltaFoto && (
        <p className="aviso">Este botão manda as fotos da conferência ao ML. <button type="button" className="botao" onClick={onIrParaProvas}>Anexar fotos</button></p>
      )}
      <div className="linha-botoes">
        <button type="button" className={pede("confirmar") ? "botao" : "botao alerta"} onClick={enviar} disabled={!pronto || enviando}>
          {enviando ? "Enviando…" : `Enviar: ${acao.nome}`}
        </button>
      </div>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </div>
  );
}

function Historico({ itens }: { itens: Contestacao[] }) {
  if (!itens.length) return null;
  return (
    <details className="painel-ml-historico" open={itens.some((i) => !i.ok)}>
      <summary>O que já foi feito por aqui ({itens.length})</summary>
      <ul>
        {itens.map((r, i) => (
          <li key={i} className={r.ok ? "ok" : "falhou"}>
            {r.ok ? FEITO[r.caminho ?? ""] ?? r.caminho : "Não passou"}{r.enviada_em ? ` · ${quando(r.enviada_em)}` : ""}
            {r.aviso && <small> {r.aviso}</small>}
            {r.erro && <small> {r.erro}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}
