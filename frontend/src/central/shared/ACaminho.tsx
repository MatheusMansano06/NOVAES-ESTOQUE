import type { Plataforma } from "./devolucao";
import { LogoPlataforma } from "./LogoPlataforma";
import type { Envio } from "./operacao";

export type ACaminhoDados = Record<Plataforma, Record<Envio, number>>;
const ZERO: Record<Envio, number> = { aguardando_postagem: 0, postado: 0, sem_info: 0 };
const SEM_DADOS: ACaminhoDados = { mercado_livre: ZERO, shopee: ZERO };
const PLATAFORMAS: Plataforma[] = ["mercado_livre", "shopee"];
const ROTULO: Record<Exclude<Envio, "sem_info">, string> = { aguardando_postagem: "Não postou ainda", postado: "Postado, a caminho" };

/** Mercadoria a caminho da Novaes por plataforma: o comprador ainda não postou x já postou e está vindo. */
export function ACaminho({ dados = SEM_DADOS, titulo, ativo, onEscolher }: {
  dados?: ACaminhoDados;
  titulo?: string;
  ativo?: { plataforma: Plataforma | ""; envio: Envio | "" };
  onEscolher: (p: Plataforma, e: Envio) => void;
}) {
  return (
    <section className="cartao a-caminho" aria-label="A caminho por plataforma">
      {titulo && <h2>{titulo}</h2>}
      <div className="a-caminho-grade">
        {PLATAFORMAS.map((p) => {
          const c = dados[p];
          return (
            <div key={p} className="a-caminho-plataforma">
              <LogoPlataforma plataforma={p} tamanho={22} comNome />
              <strong>{c.aguardando_postagem + c.postado + c.sem_info}</strong>
              {(["aguardando_postagem", "postado"] as const).map((e) => (
                <button key={e} type="button" className="a-caminho-numero" aria-pressed={ativo?.plataforma === p && ativo.envio === e}
                        onClick={() => onEscolher(p, e)}>
                  <span className="sub">{ROTULO[e]}</span>
                  {c[e]}
                </button>
              ))}
              {c.sem_info > 0 && <span className="sub" title="A plataforma ainda não informou se o comprador postou">{c.sem_info} sem info</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
