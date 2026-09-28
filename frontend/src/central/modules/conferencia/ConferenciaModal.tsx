import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../shared/api";
import { MOTIVO, PLATAFORMA } from "../../shared/devolucao";
import { prazoRestante, quando, reais } from "../../shared/formato";
import { Icone } from "../../shared/Icone";
import { LogoPlataforma } from "../../shared/LogoPlataforma";
import { Checklist, type Constatacao } from "./Checklist";
import { Evidencias } from "./Evidencias";
import { CULPA, type Midia, type Tela } from "./tipos";
import { Veredito } from "./Veredito";

const PASSOS = ["Conferir", "Fotos e vídeo", "Resultado e ações"] as const;

/** QR da etiqueta amarela do Full: id da triagem (13 dígitos), que a API do ML não expõe. */
const ETIQUETA_TRIAGEM = /^\d{13}$/;

interface Triagem {
  id: number; pedido: string; pacote: string | null; condicao: string | null; triada_em: string | null; imagem: string | null;
  itens: { nome: string | null; sku: string | null; quantidade: number | null }[];
}
const CONDICAO_TRIAGEM: Record<string, string> = { unsaleable: "não vendável", no_testable: "não testável" };

/** Devoluções do Full que o CD mandou de volta e ainda não foram conferidas, filtradas pelos últimos dígitos do
 * pedido impresso na etiqueta. O clique vincula a etiqueta: o próximo bipe abre direto. */
function TriagemFull({ codigo, onEscolher }: { codigo: string; onEscolher: (pedido: string) => void }) {
  const [lista, setLista] = useState<Triagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let ativo = true;
    api.get<Triagem[]>("/triagens-full").then((l) => ativo && setLista(l)).catch((e) => ativo && setErro((e as Error).message));
    return () => { ativo = false; };
  }, []);

  const digitos = filtro.replace(/\D/g, "");
  const achadas = lista && digitos.length >= 3
    ? lista.filter((t) => t.pedido.endsWith(digitos) || (t.pacote ?? "").endsWith(digitos) || t.pedido.includes(digitos))
    : [];

  function pedidoMarcado(pedido: string) {
    const i = pedido.lastIndexOf(digitos);
    return i < 0 ? pedido : <>{pedido.slice(0, i)}<mark>{pedido.slice(i, i + digitos.length)}</mark>{pedido.slice(i + digitos.length)}</>;
  }

  return (
    <div className="vincular">
      <h3>Etiqueta de triagem do Full <strong>{codigo}</strong></h3>
      <p className="sub">
        O Mercado Livre não informa o id da triagem pela API. Digite os <strong>últimos dígitos do nº do pedido</strong> impresso
        embaixo do QR e escolha a devolução: a etiqueta fica vinculada e o próximo bipe abre direto.
      </p>
      <input className="triagem-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} inputMode="numeric"
             placeholder="Ex.: 12148" aria-label="Últimos dígitos do pedido" autoFocus />
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
      {lista === null ? <p className="sub">Carregando as devoluções do Full…</p>
        : digitos.length < 3 ? <p className="sub">{lista.length} devoluções do Full reprovadas na triagem aguardam chegada. Digite ao menos 3 dígitos.</p>
        : achadas.length === 0 ? (
          <p className="sub">
            Nenhuma devolução do Full pendente com esse número.{" "}
            {digitos.length >= 10 && <button type="button" className="link-botao" onClick={() => onEscolher(digitos)}>Buscar a venda {digitos} mesmo assim</button>}
          </p>
        ) : (
          <ul className="triagem-lista">
            {achadas.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onEscolher(t.pedido)}>
                  {t.imagem ? <img src={t.imagem} alt="" /> : <span className="qb-sem-foto" aria-hidden="true" />}
                  <span className="triagem-produto">
                    <strong>{t.itens.map((i) => i.sku).filter(Boolean).join(", ") || "Sem SKU"}</strong>
                    <span className="sub">{t.itens[0]?.nome ?? "—"}</span>
                  </span>
                  <span className="triagem-pedido">
                    <span>Pedido {pedidoMarcado(t.pedido)}</span>
                    <span className="sub">
                      {t.condicao ? CONDICAO_TRIAGEM[t.condicao] ?? t.condicao : "—"}
                      {t.triada_em ? ` · triado em ${new Date(t.triada_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : ""}
                    </span>
                  </span>
                  <span className="triagem-acao">Vincular</span>
                </button>
              </li>
            ))}
            {achadas.length > 8 && <li className="sub">+{achadas.length - 8}: digite mais dígitos</li>}
          </ul>
        )}
    </div>
  );
}

interface Props {
  codigo: string;
  onFechar: () => void;
  onMudou: () => void;
}

/** Bipou: identifica a venda e conduz a conferência em passos, sem sair da tela onde o operador estava. */
export function ConferenciaModal({ codigo, onFechar, onMudou }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const [telas, setTelas] = useState<Tela[] | null>(null);
  const [escolhida, setEscolhida] = useState(0);
  const [passo, setPasso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const carregar = useCallback(async (inicial = false) => {
    try {
      const r = await api.get<Tela[]>(`/conferencia/${encodeURIComponent(codigo)}`);
      setTelas(r);
      if (inicial && r[0]?.conferencia) setPasso(2); // já conferida: abre no resultado
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [codigo]);

  useEffect(() => { void carregar(true); }, [carregar]);

  const [venda, setVenda] = useState("");
  async function vincular(pedido = venda.trim()) {
    setErro(null);
    try {
      const r = await api.get<Tela[]>(`/conferencia/${encodeURIComponent(pedido)}?etiqueta=${encodeURIComponent(codigo)}`);
      if (!r.length) setErro(`Nada encontrado para ${pedido} também. Aguarde a próxima sincronização.`);
      else { setTelas(r); setPasso(r[0].conferencia ? 2 : 0); onMudou(); }
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    caixa.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const atualizar = useCallback(() => { void carregar(); onMudou(); }, [carregar, onMudou]);

  async function registrar(tela: Tela, c: Constatacao) {
    setErro(null);
    setRegistrando(true);
    try {
      await api.post(`/conferencia/${tela.devolucao.id}`, c);
      await carregar();
      onMudou();
      setPasso(1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRegistrando(false);
    }
  }

  const tela = telas?.[escolhida];
  const conferida = !!tela?.conferencia;

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" tabIndex={-1} ref={caixa}>
        <header className="modal-topo">
          <div>
            <h2 id="modal-titulo">{tela ? `Devolução ${PLATAFORMA[tela.devolucao.plataforma]}` : "Identificando a venda"}</h2>
            <p className="sub">Código bipado: {codigo}</p>
          </div>
          {telas && telas.length > 1 && (
            <div className="segmentos" role="tablist" aria-label="Devoluções com este código">
              {telas.map((t, i) => (
                <button key={t.devolucao.id} role="tab" aria-selected={i === escolhida}
                        onClick={() => { setEscolhida(i); setPasso(t.conferencia ? 2 : 0); }}>
                  {PLATAFORMA[t.devolucao.plataforma]} {t.devolucao.id_externo}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="icone-botao" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" />
          </button>
        </header>

        {erro && <p className="aviso erro" role="alert">{erro}</p>}
        {!telas && !erro && <div className="carregando">Buscando a devolução, o pedido na Olist e o custo…</div>}
        {telas?.length === 0 && ETIQUETA_TRIAGEM.test(codigo) && (
          <TriagemFull codigo={codigo} onEscolher={(pedido) => void vincular(pedido)} />
        )}
        {telas?.length === 0 && !ETIQUETA_TRIAGEM.test(codigo) && (
          <form className="vincular" onSubmit={(e) => { e.preventDefault(); void vincular(); }}>
            <h3>Nenhuma devolução com o código <strong>{codigo}</strong></h3>
            <p className="sub">
              Algumas etiquetas não vêm pela API do Mercado Livre: a <strong>amarela da retirada do Full</strong> (QR com
              número de 13 dígitos) e a de retorno de pacote não entregue. Faça uma vez e o sistema aprende:
            </p>
            <ol>
              <li>
                Copie o código e busque no <strong>Pós-venda</strong> do Mercado Livre.
                <button type="button" className="botao" onClick={() => void navigator.clipboard?.writeText(codigo)}>Copiar código</button>
              </li>
              <li>Digite aqui o nº da venda que aparecer (ou bipe a etiqueta de ida).</li>
            </ol>
            <div className="linha-botoes">
              <input value={venda} onChange={(e) => setVenda(e.target.value)} placeholder="Nº da venda, pacote ou envio"
                     aria-label="Número da venda" autoFocus />
              <button type="submit" className="botao principal" disabled={!venda.trim()}>Buscar e vincular</button>
            </div>
            <p className="sub">Depois disso, bipar esta etiqueta abre direto a devolução.</p>
          </form>
        )}

        {tela && (
          <div className="modal-corpo" key={tela.devolucao.id}>
            <Ficha tela={tela} />
            <section className="modal-passos">
              <ol className="stepper">
                {PASSOS.map((p, i) => (
                  <li key={p}>
                    <button type="button" aria-current={passo === i ? "step" : undefined}
                            className={i < passo || (i === 2 && conferida) ? "feito" : ""}
                            disabled={i > 0 && !conferida} onClick={() => setPasso(i)}>
                      <span className="stepper-n">{i + 1}</span>{p}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="passo">
                {passo === 0 && (
                  <Checklist atual={tela.conferencia} travada={!!tela.conferencia?.estoque_resultado?.length}
                             enviando={registrando} onRegistrar={(c) => registrar(tela, c)} />
                )}
                {passo === 1 && (
                  <>
                    <Evidencias devolucaoId={tela.devolucao.id} evidencias={tela.evidencias}
                                exigidas={tela.conferencia?.evidencias_exigidas ?? []} onEnviada={atualizar} />
                    <div className="passo-rodape">
                      <button type="button" className="botao" onClick={() => setPasso(0)}>Voltar</button>
                      <button type="button" className="botao principal" onClick={() => setPasso(2)}>Ver resultado</button>
                    </div>
                  </>
                )}
                {passo === 2 && <Veredito tela={tela} onAtualizar={atualizar} onIrParaProvas={() => setPasso(1)} />}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Midias({ midia, plataforma }: { midia: Midia; plataforma: string }) {
  const { fotos, videos } = midia.comprador;
  return (
    <>
      <h3>Anúncio vendido</h3>
      {midia.anuncio.map((a, i) => (
        <figure key={i} className="midia-anuncio">
          {a.imagem
            ? <a href={a.imagem} target="_blank" rel="noreferrer"><img src={a.imagem} alt={`Foto do anúncio: ${a.nome ?? ""}`} /></a>
            : <p className="aviso">Sem foto do anúncio no cache.</p>}
          {a.nome && <figcaption>{a.nome}</figcaption>}
        </figure>
      ))}
      {(fotos.length > 0 || videos.length > 0) && (
        <>
          <h3>O que o comprador enviou</h3>
          <div className="midia-comprador">
            {fotos.map((f, i) => (
              <a key={f} href={f} target="_blank" rel="noreferrer"><img src={f} alt={`Foto do comprador ${i + 1}`} /></a>
            ))}
            {videos.map((v, i) => (
              <a key={v} href={v} target="_blank" rel="noreferrer" className="botao">Vídeo {i + 1}</a>
            ))}
          </div>
        </>
      )}
      {midia.link && (
        <a className="botao midia-link" href={midia.link} target="_blank" rel="noreferrer">
          Abrir a reclamação no {plataforma}
        </a>
      )}
    </>
  );
}

function Ficha({ tela }: { tela: Tela }) {
  const { devolucao: d, olist } = tela;
  const culpa = CULPA[d.responsavel];
  const prazo = prazoRestante(d.prazo_vendedor);

  return (
    <aside className="ficha" aria-label="Dados da venda">
      <LogoPlataforma plataforma={d.plataforma} tamanho={24} comNome />
      <dl className="dados">
        <div><dt>Motivo do comprador</dt>
          <dd>{d.motivo === "outro" ? d.motivo_plataforma : (MOTIVO[d.motivo] ?? d.motivo)}</dd></div>
        <div className={d.responsavel === "vendedor" ? "alerta-linha" : ""}>
          <dt>Quem a plataforma culpa</dt><dd>{culpa.quem}<small>{culpa.efeito}</small></dd>
        </div>
        <div><dt>Frete reverso cobrado</dt><dd>{reais(d.custo_plataforma)}</dd></div>
        {prazo && (
          <div className={prazo === "prazo vencido" || prazo.endsWith("h restantes") ? "alerta-linha" : ""}>
            <dt>Prazo para agir</dt><dd>{quando(d.prazo_vendedor)}<small>{prazo}</small></dd>
          </div>
        )}
        {d.afeta_reputacao && <div className="alerta-linha"><dt>Reputação</dt><dd>Esta reclamação afeta a reputação</dd></div>}
        {d.em_mediacao && <div><dt>Mediação</dt><dd>Em mediação na plataforma</dd></div>}
        <div><dt>Pedido</dt><dd>{d.pacote ? `${d.pacote} (carrinho)` : d.pedido}</dd></div>
      </dl>

      <Midias midia={tela.midia} plataforma={PLATAFORMA[d.plataforma]} />

      <h3>Na Olist</h3>
      {olist.erro && <p className="aviso erro">{olist.erro}</p>}
      {!olist.erro && olist.pedidos.length === 0 && <p className="aviso">Pedido ainda não encontrado na Olist.</p>}
      {olist.pedidos.map((p) => {
        const cancelada = p.nota?.situacao === "Cancelada";
        return (
          <div key={p.id} className="olist">
            <p className="sub">Pedido {p.numero}, {p.situacao.toLowerCase()}</p>
            {p.itens.map((i) => (
              <div key={i.produto_id} className="item">
                <strong>{i.sku}</strong>
                <span>{i.descricao}</span>
                <small>{i.quantidade} un, custo {i.custo == null ? "sem custo cadastrado" : reais(i.custo)}</small>
              </div>
            ))}
            {p.nota && <p className="sub">NF de venda {p.nota.numero}: {p.nota.situacao.toLowerCase()}</p>}
            {cancelada && p.nota_devolucao && (
              <p className="aviso erro">NF de devolução {p.nota_devolucao.numero} para venda com nota cancelada. Confira com o fiscal.</p>
            )}
            {!cancelada && p.nota && (p.nota_devolucao
              ? <p className="sub">NF de devolução {p.nota_devolucao.numero}: {p.nota_devolucao.situacao.toLowerCase()}</p>
              : <p className="aviso">NF de devolução ainda não criada na Olist.</p>)}
          </div>
        );
      })}
    </aside>
  );
}
