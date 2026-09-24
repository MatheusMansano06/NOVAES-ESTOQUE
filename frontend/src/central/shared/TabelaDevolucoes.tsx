import { prazoRestante, quando, reais } from "./formato";
import { MOTIVO } from "./devolucao";
import { LogoPlataforma } from "./LogoPlataforma";
import { codigoDe, PENDENCIA, STATUS, type LinhaOperacao } from "./operacao";

interface Props {
  linhas: LinhaOperacao[];
  onAbrir: (codigo: string) => void;
  compacta?: boolean;
}

function acao(l: LinhaOperacao): string {
  if (l.pendencias.length) return PENDENCIA[l.pendencias[0]];
  if (l.status === "aguardando_conferencia") return "Conferir";
  return "Ver detalhes";
}

export function TabelaDevolucoes({ linhas, onAbrir, compacta }: Props) {
  return (
    <table className={compacta ? "tabela compacta" : "tabela"}>
      <thead>
        <tr>
          <th scope="col"><span className="sr">Canal</span></th>
          <th scope="col">Pedido</th>
          <th scope="col">Produto</th>
          {!compacta && <th scope="col">Motivo</th>}
          <th scope="col">Status</th>
          {!compacta && <th scope="col">Prazo</th>}
          {!compacta && <th scope="col" className="num">Prejuízo</th>}
          <th scope="col"><span className="sr">Ação</span></th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => {
          const sku = l.itens.map((i) => i.sku).filter(Boolean).join(", ");
          const prazo = prazoRestante(l.prazo_vendedor);
          const urgente = prazo !== null && prazo !== "prazo vencido" && prazo.endsWith("h restantes");
          return (
            <tr key={l.id} onClick={() => onAbrir(codigoDe(l))}>
              <td className="col-logo"><LogoPlataforma plataforma={l.plataforma} tamanho={24} /></td>
              <td>
                <span className="forte">#{l.pacote ?? l.pedido}</span>
                {!compacta && <span className="sub">{l.rastreio ?? l.id_externo}</span>}
              </td>
              <td className="produto">
                <span className="forte">{sku || "—"}</span>
                {l.produto && <span className="sub">{l.produto}</span>}
              </td>
              {!compacta && <td>{MOTIVO[l.motivo] ?? l.motivo}</td>}
              <td><span className="status"><span className="ponto-etapa" data-cor={STATUS[l.status].cor} />{STATUS[l.status].nome}</span></td>
              {!compacta && (
                <td>
                  <span className={urgente ? "forte urgente" : ""}>{l.prazo_vendedor ? quando(l.prazo_vendedor) : "—"}</span>
                  {prazo && <span className={urgente ? "sub urgente" : "sub"}>{prazo}</span>}
                </td>
              )}
              {!compacta && <td className="num">{reais(l.prejuizo)}</td>}
              <td>
                <button type="button" className={l.pendencias.length ? "botao-linha destaque" : "botao-linha"}
                        onClick={(e) => { e.stopPropagation(); onAbrir(codigoDe(l)); }}>
                  {acao(l)}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
