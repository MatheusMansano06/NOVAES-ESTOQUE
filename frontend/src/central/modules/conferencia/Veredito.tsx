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
          {c.estoque_lancado_em && <p className="aviso ok">Estoque lançado em {quando(c.estoque_lancado_em)}.</p>}
          <NotaDevolucao tela={tela} />
          <DevolverProduto tela={tela} onFeito={onAtualizar} />
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

/** A NF de devolução ainda precisa ser criada ou emitida? Mesmas regras do backend (devolver_produto). */
function notaPendente(tela: Tela): boolean {
  const pedido = tela.olist.pedidos.find((p) => p.nota);
  const c = tela.conferencia!;
  if (!pedido?.nota || pedido.nota.situacao === "Cancelada" || (c.classe === "C" && !c.erro_nosso)) return false;
  return !pedido.nota_devolucao || pedido.nota_devolucao.situacao === "Pendente";
}

/** Um clique, como o "Devolver" da Olist: lança o estoque no depósito certo e cria + emite a NF de devolução. */
function DevolverProduto({ tela, onFeito }: { tela: Tela; onFeito: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const c = tela.conferencia!;
  const falta_estoque = c.lancamentos.length > 0 && !c.estoque_lancado_em;
  const falta_nota = notaPendente(tela);
  if (!falta_estoque && !falta_nota) return null;

  async function devolver() {
    const passos = [falta_estoque && "lança o estoque na Olist", falta_nota && "cria e emite a NF de devolução na SEFAZ"]
      .filter(Boolean).join(" e ");
    if (!window.confirm(`Devolver o produto agora? Isso ${passos}. Nota autorizada só se desfaz com cancelamento fiscal.`)) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/conferencia/${tela.devolucao.id}/devolver`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
      onFeito();
    }
  }

  const parcial = (c.estoque_resultado ?? []).length > 0 || (!falta_estoque && falta_nota);
  return (
    <>
      <button type="button" className="botao principal" onClick={devolver} disabled={enviando}>
        {enviando ? "Devolvendo…" : parcial ? "Terminar devolução" : "Devolver produto"}
      </button>
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
    </>
  );
}

function NotaDevolucao({ tela }: { tela: Tela }) {
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
    conteudo = <p className="sub">Será criada e emitida junto com a devolução do produto.</p>;
  } else if (pedido.nota_devolucao.situacao === "Pendente") {
    conteudo = <p className="sub">NF de devolução {pedido.nota_devolucao.numero} criada, falta emitir.</p>;
  } else {
    conteudo = <p className="aviso ok">NF de devolução {pedido.nota_devolucao.numero}: {pedido.nota_devolucao.situacao.toLowerCase()}.</p>;
  }

  return (
    <div className="bloco-nota">
      <h4>NF de devolução</h4>
      {conteudo}
      <div className="linha-botoes">
        {/* A NF de devolução é documento próprio: não aparece dentro do pedido de venda, só em Notas Fiscais. */}
        {pedido?.nota_devolucao && (
          <a className="botao" href={`https://erp.olist.com/notas_fiscais#edit/${pedido.nota_devolucao.id}`}
             target="_blank" rel="noopener noreferrer">Ver NF de devolução na Olist ↗</a>
        )}
        {pedido && (
          <a className="botao" href={`https://erp.olist.com/vendas#edit/${pedido.id}`} target="_blank" rel="noopener noreferrer">
            Ver pedido na Olist ↗</a>
        )}
      </div>
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
