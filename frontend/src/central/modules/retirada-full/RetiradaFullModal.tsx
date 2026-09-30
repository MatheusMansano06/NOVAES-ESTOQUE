import { useEffect, useRef, useState, type FormEvent } from "react";

import { api } from "../../shared/api";
import { reais } from "../../shared/formato";
import { Icone } from "../../shared/Icone";

/** Etiqueta do Full = inventory_id do anúncio no ML (ex.: DPPZ10673). */
export const ehEtiquetaFull = (codigo: string) => /^[A-Z]{4}\d{5}$/i.test(codigo.trim());

interface Produto {
  codigo: string;
  item_id: string;
  titulo: string;
  thumbnail: string | null;
  sku: string;
  custo: number | null;
}

interface Entrada extends Produto {
  quantidade: number;
  lancados: { sku: string; quantidade: number }[];
}

interface Props {
  codigo: string;
  onFechar: () => void;
}

/** Produto que voltou do Full: bipou a etiqueta, confere o produto, digita a quantidade e dá entrada no orgânico. */
export function RetiradaFullModal({ codigo, onFechar }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [erro, setErro] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);
  const [feito, setFeito] = useState<Entrada | null>(null);

  useEffect(() => {
    api.get<Produto>(`/retirada-full/${encodeURIComponent(codigo.trim())}`)
      .then((p) => { setProduto(p); setTimeout(() => campo.current?.select(), 0); })
      .catch((e) => setErro((e as Error).message));
  }, [codigo]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    const qtd = Number(quantidade);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) {
      setErro("Digite uma quantidade inteira entre 1 e 999.");
      return;
    }
    setErro(null);
    setLancando(true);
    try {
      setFeito(await api.post<Entrada>(`/retirada-full/${encodeURIComponent(codigo.trim())}/entrada`, { quantidade: qtd }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLancando(false);
    }
  }

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal pequeno" role="dialog" aria-modal="true" aria-labelledby="full-titulo">
        <header className="modal-topo">
          <div>
            <h2 id="full-titulo">Retirada do Full</h2>
            <p className="sub">Etiqueta bipada: {codigo.trim().toUpperCase()}</p>
          </div>
          <button type="button" className="icone-botao" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" />
          </button>
        </header>

        <div className="passo">
          {!produto && !erro && <div className="carregando">Buscando o anúncio e o produto na Olist…</div>}
          {produto && (
            <div className="full-produto">
              {produto.thumbnail && <img src={produto.thumbnail} alt="" width={72} height={72} />}
              <div>
                <strong>{produto.sku}</strong>
                <p>{produto.titulo}</p>
                <p className="sub">Anúncio {produto.item_id}{produto.custo != null && `, custo ${reais(produto.custo)}`}</p>
              </div>
            </div>
          )}

          {produto && !feito && (
            <form onSubmit={lancar}>
              <label className="campo">
                <span>Quantas unidades voltaram do Full?</span>
                <input ref={campo} type="number" inputMode="numeric" min={1} max={999} step={1} required
                       value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              </label>
              <div className="passo-rodape">
                <button type="button" className="botao" onClick={onFechar}>Cancelar</button>
                <button type="submit" className="botao principal" disabled={lancando}>
                  {lancando ? "Lançando…" : "Dar entrada no orgânico"}
                </button>
              </div>
            </form>
          )}

          {feito && (
            <>
              <p className="aviso ok" role="status">
                Entrada de {feito.quantidade} un. no estoque vendável da Olist
                {feito.lancados.length > 1 && ` (kit: ${feito.lancados.map((l) => `${l.quantidade}x ${l.sku}`).join(", ")})`}.
              </p>
              <div className="passo-rodape">
                <button type="button" className="botao principal" onClick={onFechar} autoFocus>Fechar e bipar o próximo</button>
              </div>
            </>
          )}

          {erro && <p className="aviso erro" role="alert">{erro}</p>}
        </div>
      </div>
    </div>
  );
}
