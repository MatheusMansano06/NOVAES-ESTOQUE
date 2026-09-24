import { useState, type FormEvent } from "react";

import type { Conferencia } from "./tipos";

export interface Constatacao {
  produto_correto: boolean;
  completo: boolean;
  sem_uso: boolean;
  revendavel: boolean;
  erro_nosso: boolean;
  sku_recebido: string | null;
  observacao: string | null;
}

type Pergunta = keyof Omit<Constatacao, "sku_recebido" | "observacao">;

const PERGUNTAS: { campo: Pergunta; texto: string; ajuda?: string }[] = [
  { campo: "produto_correto", texto: "É o produto que foi vendido?", ajuda: "Confira SKU, modelo e cor com o pedido." },
  { campo: "completo", texto: "Está completo?", ajuda: "Peças, acessórios e manual." },
  { campo: "sem_uso", texto: "Está sem sinais de uso?" },
  { campo: "revendavel", texto: "Pode voltar para a venda?" },
];

interface Props {
  atual: Conferencia | null;
  travada: boolean;
  enviando: boolean;
  onRegistrar: (c: Constatacao) => void;
}

export function Checklist({ atual, travada, enviando, onRegistrar }: Props) {
  const [respostas, setRespostas] = useState<Partial<Record<Pergunta, boolean>>>(() =>
    atual
      ? { produto_correto: atual.produto_correto, completo: atual.completo, sem_uso: atual.sem_uso,
          revendavel: atual.revendavel, erro_nosso: atual.erro_nosso }
      : { erro_nosso: false },
  );
  const [sku, setSku] = useState(atual?.sku_recebido ?? "");
  const [obs, setObs] = useState(atual?.observacao ?? "");

  const errado = respostas.produto_correto === false;
  const faltando = PERGUNTAS.filter((p) => respostas[p.campo] === undefined).length;

  function responder(campo: Pergunta, valor: boolean) {
    setRespostas((r) => ({ ...r, [campo]: valor, ...(campo === "produto_correto" && valor ? { erro_nosso: false } : {}) }));
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (faltando) return;
    onRegistrar({
      produto_correto: respostas.produto_correto!, completo: respostas.completo!, sem_uso: respostas.sem_uso!,
      revendavel: respostas.revendavel!, erro_nosso: errado ? !!respostas.erro_nosso : false,
      sku_recebido: sku.trim() || null, observacao: obs.trim() || null,
    });
  }

  return (
    <form className="checklist" onSubmit={enviar} aria-describedby={travada ? "aviso-travada" : undefined}>
      <fieldset disabled={travada || enviando}>
        <legend>O que chegou na bancada</legend>
        {PERGUNTAS.map((p) => (
          <SimNao key={p.campo} nome={p.campo} texto={p.texto} ajuda={p.ajuda}
                  valor={respostas[p.campo]} onEscolher={(v) => responder(p.campo, v)} />
        ))}
        {errado && (
          <SimNao nome="erro_nosso" texto="Fomos nós que enviamos esse produto por engano?"
                  ajuda="Se sim, a Novaes assume e não contesta."
                  valor={respostas.erro_nosso} onEscolher={(v) => responder("erro_nosso", v)} />
        )}
        <label className="campo">
          <span>SKU do produto que chegou {errado ? "" : "(opcional)"}</span>
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Bipe o código do produto"
                 autoComplete="off" />
        </label>
        <label className="campo">
          <span>O que você viu</span>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3}
                    placeholder="Ex.: risco na lateral, caixa aberta, veio outra peça" />
        </label>
        <button type="submit" className="botao principal" disabled={faltando > 0}>
          {enviando ? "Registrando…" : faltando ? `Responda mais ${faltando}` : atual ? "Atualizar conferência" : "Registrar conferência"}
        </button>
      </fieldset>
      {travada && <p id="aviso-travada" className="sub">Estoque já lançado na Olist: esta conferência não pode mais mudar.</p>}
    </form>
  );
}

interface SimNaoProps {
  nome: string;
  texto: string;
  ajuda?: string;
  valor: boolean | undefined;
  onEscolher: (v: boolean) => void;
}

function SimNao({ nome, texto, ajuda, valor, onEscolher }: SimNaoProps) {
  return (
    <div className="pergunta" role="radiogroup" aria-labelledby={`p-${nome}`}>
      <div>
        <span id={`p-${nome}`} className="pergunta-texto">{texto}</span>
        {ajuda && <span className="pergunta-ajuda">{ajuda}</span>}
      </div>
      <div className="sim-nao">
        {([true, false] as const).map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={valor === v}
                  className={valor === v ? (v ? "marcado sim" : "marcado nao") : ""} onClick={() => onEscolher(v)}>
            {v ? "Sim" : "Não"}
          </button>
        ))}
      </div>
    </div>
  );
}
