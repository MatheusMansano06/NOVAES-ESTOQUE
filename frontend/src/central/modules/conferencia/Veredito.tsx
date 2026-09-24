import { useEffect, useState } from "react";

import { api } from "../../shared/api";
import { PLATAFORMA } from "../../shared/devolucao";
import { prazoRestante, quando, reais } from "../../shared/formato";
import { CLASSE, DEPOSITO, type Contestacao, type Tela } from "./tipos";

interface Props {
  tela: Tela;
  onAtualizar: () => void;
  onIrParaProvas: () => void;
}

export function Veredito({ tela, onAtualizar, onIrParaProvas }: Props) {
  const { devolucao: d, conferencia: c, evidencias } = tela;
  if (!c) return null;
  const classe = CLASSE[c.classe];
  const resultado = c.estoque_resultado ?? [];
  const temFoto = evidencias.some((e) => e.tipo === "foto");
  const prejuizo = (c.frete_reverso ?? 0) + (c.perda_produto ?? 0);

  return (
    <div className={`veredito classe-${c.classe}`}>
      <div className="veredito-cabeca">
        <div className="etiqueta" aria-hidden="true"><span className="furo" /><span className="letra">{c.classe}</span></div>
        <div>
          <h3>Classe {c.classe}: {classe.nome}</h3>
          <p className="sub">{classe.explica}. Conferido em {quando(c.conferida_em)}.</p>
          <p className="prejuizo">
            Prejuízo registrado <strong>{reais(prejuizo)}</strong>
            <small>
              Frete reverso {reais(c.frete_reverso ?? 0)}, produto {c.perda_produto == null ? "sem custo cadastrado" : reais(c.perda_produto)}
            </small>
          </p>
        </div>
      </div>

      <div className="veredito-colunas">
        <section aria-labelledby="t-estoque">
          <h4 id="t-estoque">Estoque na Olist</h4>
          {c.lancamentos.length === 0 ? (
            <p className="aviso">Nada a lançar: o item que chegou não é um produto nosso. Fica registrado só aqui.</p>
          ) : (
            <ul className="lancamentos">
              {c.lancamentos.map((l, i) => {
                const feito = resultado[i];
                return (
                  <li key={`${l.sku}-${l.deposito}-${l.tipo}`} className={feito ? (feito.ok ? "ok" : "falhou") : ""}>
                    <strong>{l.tipo === "E" ? "Entrada" : "Saída"}</strong> do {l.sku === "vendido" ? "produto vendido" : "produto que chegou"}
                    {" "}em {DEPOSITO[l.deposito]}{l.deposito === "avaria" ? ` ${PLATAFORMA[d.plataforma]}` : ""}
                    {feito && <small>{feito.ok ? `Feito (${feito.sku_olist})` : `Falhou: ${feito.erro}`}</small>}
                  </li>
                );
              })}
            </ul>
          )}
          {c.lancamentos.length > 0 && (
            <LancarEstoque devolucaoId={d.id} lancadoEm={c.estoque_lancado_em} parcial={resultado.length > 0} onFeito={onAtualizar} />
          )}
          <NotaDevolucao tela={tela} onFeito={onAtualizar} />
        </section>

        <section aria-labelledby="t-contestar">
          <h4 id="t-contestar">{c.chamado_manual ? "Chamado manual" : `Contestação na ${PLATAFORMA[d.plataforma]}`}</h4>
          <p className={c.contestar || c.chamado_manual ? "aviso forte" : "aviso"}>{c.motivo}</p>
          {(c.contestar || c.chamado_manual) && d.prazo_vendedor && (
            <p className="sub">Prazo da plataforma: {quando(d.prazo_vendedor)} ({prazoRestante(d.prazo_vendedor)}).</p>
          )}
          {(c.contestar || c.chamado_manual) && !temFoto && (
            <button type="button" className="botao" onClick={onIrParaProvas}>Anexar fotos antes</button>
          )}
          {c.chamado_manual
            ? <ChamadoManual devolucaoId={d.id} abertoEm={c.chamado_aberto_em} protocolo={c.chamado_protocolo} onFeito={onAtualizar} />
            : c.contestar && <Contestar devolucaoId={d.id} textoInicial={c.observacao ?? ""} temFoto={temFoto} onMudou={onAtualizar} />}
        </section>
      </div>
    </div>
  );
}

function LancarEstoque({ devolucaoId, lancadoEm, parcial, onFeito }:
  { devolucaoId: number; lancadoEm: string | null; parcial: boolean; onFeito: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (lancadoEm) return <p className="aviso ok">Estoque lançado em {quando(lancadoEm)}.</p>;

  async function lancar() {
    if (!window.confirm("Lançar estes movimentos no estoque da Olist agora? Isso altera o saldo real.")) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${devolucaoId}/lancar-estoque`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
      onFeito();
    }
  }

  return (
    <>
      <button type="button" className="botao principal" onClick={lancar} disabled={enviando}>
        {enviando ? "Lançando…" : parcial ? "Terminar lançamento na Olist" : "Lançar estoque na Olist"}
      </button>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </>
  );
}

function NotaDevolucao({ tela, onFeito }: { tela: Tela; onFeito: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = tela.olist.pedidos.find((p) => p.nota);
  const c = tela.conferencia!;

  let conteudo;
  if (!pedido?.nota) {
    conteudo = <p className="aviso">{tela.olist.erro ? "Olist indisponível agora." : "Sem NF de venda na Olist para este pedido."}</p>;
  } else if (pedido.nota.situacao === "Cancelada") {
    conteudo = <p className="aviso">A NF de venda foi cancelada: não precisa de nota de devolução.</p>;
  } else if (c.classe === "C" && !c.erro_nosso) {
    conteudo = <p className="aviso">O produto vendido não voltou: não há nota de devolução a fazer.</p>;
  } else if (!pedido.nota_devolucao) {
    conteudo = <button type="button" className="botao" disabled={enviando}
                       onClick={() => agir("", "Criar na Olist a NF de devolução da venda? Ela fica pendente até você emitir.")}>
      {enviando ? "Gerando…" : "Gerar NF de devolução"}</button>;
  } else if (pedido.nota_devolucao.situacao === "Pendente") {
    conteudo = (
      <>
        <p className="sub">NF de devolução {pedido.nota_devolucao.numero} criada, ainda pendente.</p>
        <button type="button" className="botao principal" disabled={enviando}
                onClick={() => agir("/emitir", "Emitir a NF de devolução na SEFAZ agora? Nota autorizada só se desfaz com cancelamento fiscal.")}>
          {enviando ? "Emitindo…" : "Emitir NF de devolução"}</button>
      </>
    );
  } else {
    conteudo = <p className="aviso ok">NF de devolução {pedido.nota_devolucao.numero}: {pedido.nota_devolucao.situacao.toLowerCase()}.</p>;
  }

  async function agir(sufixo: string, pergunta: string) {
    if (!window.confirm(pergunta)) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${tela.devolucao.id}/nota-devolucao${sufixo}`);
      onFeito();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bloco-nota">
      <h4>NF de devolução</h4>
      {conteudo}
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </div>
  );
}

function ChamadoManual({ devolucaoId, abertoEm, protocolo, onFeito }:
  { devolucaoId: number; abertoEm: string | null; protocolo: string | null; onFeito: () => void }) {
  const [numero, setNumero] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (abertoEm) return <p className="aviso ok">Chamado aberto em {quando(abertoEm)}{protocolo ? `, protocolo ${protocolo}` : ""}.</p>;

  async function marcar() {
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${devolucaoId}/chamado-manual/aberto`, { protocolo: numero.trim() || null });
      onFeito();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="contestar">
      <p className="sub">Abra o chamado no painel da plataforma com as fotos daqui e anote o protocolo.</p>
      <label className="campo">
        <span>Protocolo do chamado (opcional)</span>
        <input value={numero} onChange={(e) => setNumero(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="botao principal" onClick={marcar} disabled={enviando}>
        {enviando ? "Salvando…" : "Marcar chamado como aberto"}
      </button>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </div>
  );
}

function Contestar({ devolucaoId, textoInicial, temFoto, onMudou }:
  { devolucaoId: number; textoInicial: string; temFoto: boolean; onMudou: () => void }) {
  const [motivos, setMotivos] = useState<{ id: string; texto: string }[] | null>(null);
  const [historico, setHistorico] = useState<Contestacao[]>([]);
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState(textoInicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    api.get<Contestacao[]>(`/mediacoes/${devolucaoId}`).then((h) => ativo && setHistorico(h)).catch(() => {});
    api.get<{ id: string; texto: string }[]>(`/mediacoes/${devolucaoId}/motivos`)
      .then((m) => ativo && setMotivos(m))
      .catch((e) => ativo && setErro(`Não consegui buscar os motivos da plataforma: ${(e as Error).message}`));
    return () => { ativo = false; };
  }, [devolucaoId]);

  const enviada = historico.find((h) => h.ok);
  if (enviada) {
    return <p className="aviso ok">Contestação enviada em {quando(enviada.enviada_em)}.{enviada.aviso ? ` ${enviada.aviso}` : ""}</p>;
  }
  const falhou = historico.length > 0;

  async function enviar() {
    if (!window.confirm("Enviar a contestação para a plataforma agora? Depois de enviada não dá para desfazer.")) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post<Contestacao>(`/mediacoes/${devolucaoId}/contestar`, { motivo, texto });
      if (!r.ok) setErro(r.erro);
      setHistorico((h) => [...h, r]);
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function guardarParaDepois() {
    await api.post(`/conferencia/${devolucaoId}/chamado-manual`);
    onMudou();
  }

  // Lista vazia = a plataforma não pede motivo aqui (ML com produto perfeito: vai direto à mediação).
  const semMotivo = motivos?.length === 0;
  const pronto = motivos && (semMotivo || motivo) && texto.trim().length >= 10 && temFoto;
  return (
    <div className="contestar">
      {semMotivo ? (
        <p className="sub">Vai para a mediação: explique que o produto voltou exatamente como foi enviado.</p>
      ) : (
        <label className="campo">
          <span>Motivo oficial</span>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={!motivos}>
            <option value="">{motivos ? "Escolha o motivo" : "Carregando motivos…"}</option>
            {motivos?.map((m) => <option key={m.id} value={m.id}>{m.texto}</option>)}
          </select>
        </label>
      )}
      <label className="campo">
        <span>O que aconteceu (vai para a plataforma)</span>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <div className="linha-botoes">
        <button type="button" className="botao alerta" onClick={enviar} disabled={!pronto || enviando}>
          {enviando ? "Enviando…" : "Enviar contestação"}
        </button>
        {falhou && <button type="button" className="botao" onClick={guardarParaDepois}>Guardar para chamado manual</button>}
      </div>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </div>
  );
}
