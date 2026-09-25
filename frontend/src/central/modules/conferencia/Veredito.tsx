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
                    {feito && <small>{feito.ok ? `Feito${feito.pela_olist ? " pela Olist" : ""} (${feito.sku_olist})` : `Falhou: ${feito.erro}`}</small>}
                  </li>
                );
              })}
            </ul>
          )}
          <Devolucao tela={tela} onFeito={onAtualizar} />
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
            : c.contestar
              ? <Contestar devolucaoId={d.id} textoInicial={c.observacao ?? ""} temFoto={temFoto} podeAceitar={d.plataforma === "shopee"} onMudou={onAtualizar} />
              : d.plataforma === "shopee" && <AceitarSozinho devolucaoId={d.id} onMudou={onAtualizar} />}
        </section>
      </div>
    </div>
  );
}

/** Com NF de venda autorizada, a devolução é pelo "devolver produtos" da Olist (devolve ao Geral e gera a NF);
 *  a Central só completa o que falta (avaria: tira do Geral e põe na avaria). Sem NF, a Central lança tudo. */
function Devolucao({ tela, onFeito }: { tela: Tela; onFeito: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const c = tela.conferencia!;
  const pedido = tela.olist.pedidos.find((p) => p.nota);
  const nota = pedido?.nota;
  const devolucaoNota = pedido?.nota_devolucao;
  const pelaOlist = !!nota && nota.situacao !== "Cancelada" && !(c.classe === "C" && !c.erro_nosso);
  const avaria = c.lancamentos.some((l) => l.deposito === "avaria");

  async function lancar(viaOlist: boolean) {
    const pergunta = viaOlist
      ? avaria
        ? `Confirma que já fez o "devolver produtos" na Olist? Agora a Central tira do Geral e põe na Avaria ${PLATAFORMA[tela.devolucao.plataforma]}.`
        : `Confirma que já fez o "devolver produtos" na Olist? O estoque já voltou ao Geral por lá; a Central só registra.`
      : "Lançar estes movimentos no estoque da Olist agora? Isso altera o saldo real.";
    if (!window.confirm(pergunta)) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${tela.devolucao.id}/lancar-estoque`, { via_olist: viaOlist });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
      onFeito();
    }
  }

  let acao;
  if (c.estoque_lancado_em) {
    acao = <p className="aviso ok">Estoque lançado em {quando(c.estoque_lancado_em)}.</p>;
  } else if (pelaOlist) {
    acao = (
      <ol className="passos-olist">
        <li>
          Na Olist, abra a NF de venda {nota!.numero}, vá em <strong>mais ações → devolver produtos</strong> e confirme.
          Ela devolve o estoque ao Geral e gera a NF de devolução.
          <a className="botao" href={`https://erp.olist.com/notas_fiscais#edit/${nota!.id}`} target="_blank" rel="noopener noreferrer">
            Abrir NF de venda na Olist ↗</a>
        </li>
        <li>
          Volte aqui e confirme.{avaria && " Como é avaria, a Central move o produto do Geral para a avaria."}
          <button type="button" className="botao principal" onClick={() => lancar(true)} disabled={enviando}>
            {enviando ? "Conferindo…" : "Já devolvi na Olist"}</button>
        </li>
      </ol>
    );
  } else if (c.lancamentos.length > 0) {
    acao = (
      <button type="button" className="botao principal" onClick={() => lancar(false)} disabled={enviando}>
        {enviando ? "Lançando…" : (c.estoque_resultado ?? []).length > 0 ? "Terminar lançamento na Olist" : "Lançar estoque na Olist"}
      </button>
    );
  }

  return (
    <>
      {acao}
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
      <div className="bloco-nota">
        <h4>NF de devolução</h4>
        {!nota ? (
          <p className="aviso">{tela.olist.erro ? "Olist indisponível agora." : "Sem NF de venda na Olist para este pedido."}</p>
        ) : nota.situacao === "Cancelada" ? (
          <p className="aviso">A NF de venda foi cancelada: não precisa de nota de devolução.</p>
        ) : !pelaOlist ? (
          <p className="aviso">O produto vendido não voltou: não há nota de devolução a fazer.</p>
        ) : devolucaoNota ? (
          <p className={devolucaoNota.situacao === "Pendente" ? "aviso" : "aviso ok"}>
            NF de devolução {devolucaoNota.numero} (série {devolucaoNota.serie}): {devolucaoNota.situacao.toLowerCase()}.
            {devolucaoNota.situacao === "Pendente" && " Emita pela Olist (Notas Fiscais, filtro Entrada)."}
          </p>
        ) : (
          <p className="sub">Sai junto com o "devolver produtos" da Olist.</p>
        )}
      </div>
    </>
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

function resultadoEnviado(r: Contestacao) {
  return r.caminho === "aceite"
    ? <p className="aviso ok">Devolução aceita em {quando(r.enviada_em)}. A plataforma reembolsa o comprador.</p>
    : <p className="aviso ok">Disputa aberta em {quando(r.enviada_em)}.{r.aviso ? ` ${r.aviso}` : ""}</p>;
}

// Aceitar = reembolsar o comprador na plataforma. Irreversível: confirma antes.
function BotaoAceitar({ devolucaoId, onResultado }: { devolucaoId: number; onResultado: (r: Contestacao) => void }) {
  const [enviando, setEnviando] = useState(false);
  async function aceitar() {
    if (!window.confirm("Aceitar a devolução? A plataforma reembolsa o comprador e não dá para abrir disputa depois.")) return;
    setEnviando(true);
    try {
      onResultado(await api.post<Contestacao>(`/mediacoes/${devolucaoId}/aceitar`));
    } catch (e) {
      onResultado({ ok: false, caminho: null, aviso: null, erro: (e as Error).message, enviada_em: "" });
    } finally {
      setEnviando(false);
    }
  }
  return (
    <button type="button" className="botao" onClick={aceitar} disabled={enviando}>
      {enviando ? "Aceitando…" : "Aceitar devolução"}
    </button>
  );
}

function AceitarSozinho({ devolucaoId, onMudou }: { devolucaoId: number; onMudou: () => void }) {
  const [historico, setHistorico] = useState<Contestacao[]>([]);
  useEffect(() => {
    let ativo = true;
    api.get<Contestacao[]>(`/mediacoes/${devolucaoId}`).then((h) => ativo && setHistorico(h)).catch(() => {});
    return () => { ativo = false; };
  }, [devolucaoId]);
  const feito = historico.find((h) => h.ok);
  if (feito) return resultadoEnviado(feito);
  const ultimo = historico[historico.length - 1];
  return (
    <div className="linha-botoes">
      <BotaoAceitar devolucaoId={devolucaoId} onResultado={(r) => { setHistorico((h) => [...h, r]); onMudou(); }} />
      {ultimo?.erro && <p className="aviso erro" role="alert">{ultimo.erro}</p>}
    </div>
  );
}

function Contestar({ devolucaoId, textoInicial, temFoto, podeAceitar, onMudou }:
  { devolucaoId: number; textoInicial: string; temFoto: boolean; podeAceitar: boolean; onMudou: () => void }) {
  const [motivos, setMotivos] = useState<{ id: string; texto: string; exigencia?: string }[] | null>(null);
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
  if (enviada) return resultadoEnviado(enviada);
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
            {motivos?.map((m) => <option key={m.id} value={m.id}>{m.texto}{m.exigencia ? " (pede provas)" : ""}</option>)}
          </select>
        </label>
      )}
      {!semMotivo && motivos?.find((m) => String(m.id) === motivo)?.exigencia && (
        <p className="sub">{motivos.find((m) => String(m.id) === motivo)!.exigencia}</p>
      )}
      <label className="campo">
        <span>O que aconteceu (vai para a plataforma)</span>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <div className="linha-botoes">
        <button type="button" className="botao alerta" onClick={enviar} disabled={!pronto || enviando}>
          {enviando ? "Enviando…" : "Abrir disputa"}
        </button>
        {podeAceitar && (
          <BotaoAceitar devolucaoId={devolucaoId} onResultado={(r) => {
            if (!r.ok) setErro(r.erro);
            setHistorico((h) => [...h, r]);
            onMudou();
          }} />
        )}
        {falhou && <button type="button" className="botao" onClick={guardarParaDepois}>Guardar para chamado manual</button>}
      </div>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </div>
  );
}
