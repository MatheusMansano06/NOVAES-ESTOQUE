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
        {telas?.length === 0 && (
          <div className="carregando">
            Nenhuma devolução com o código <strong>{codigo}</strong>. Confira a etiqueta ou aguarde a próxima sincronização.
          </div>
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
        <div><dt>Motivo do comprador</dt><dd>{MOTIVO[d.motivo] ?? d.motivo}</dd></div>
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
