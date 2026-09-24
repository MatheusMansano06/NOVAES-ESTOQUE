import type { Devolucao } from "./devolucao";

/** Status de operação que o backend (trilha Operação) calcula para cada devolução. */
export type Status =
  | "a_caminho" | "aguardando_conferencia" | "precisa_acao" | "em_mediacao" | "com_a_plataforma" | "resolvida" | "finalizada";

export const STATUS: Record<Status, { nome: string; cor: string }> = {
  a_caminho: { nome: "A caminho", cor: "azul" },
  aguardando_conferencia: { nome: "Aguardando conferência", cor: "amarelo" },
  precisa_acao: { nome: "Precisa de ação", cor: "vermelho" },
  em_mediacao: { nome: "Em mediação", cor: "roxo" },
  com_a_plataforma: { nome: "Com a plataforma", cor: "cinza" },
  resolvida: { nome: "Resolvida", cor: "verde" },
  finalizada: { nome: "Finalizada", cor: "cinza" },
};

export const PENDENCIA: Record<string, string> = {
  lancar_estoque: "Lançar estoque",
  contestar: "Contestar",
  chamado_manual: "Abrir chamado manual",
};

export interface LinhaOperacao extends Devolucao {
  status: Status;
  pendencias: string[];
  produto: string | null;
  imagem: string | null;
  prejuizo: number | null;
  atualizada_em: string;
}

export interface Operacao {
  total: number;
  contagens: Record<Status, number>;
  itens: LinhaOperacao[];
}

/** O código que abre o modal: o rastreio é o que o leitor bipa; sem ele, o id da reclamação. */
export const codigoDe = (d: { rastreio: string | null; id_externo: string }) => d.rastreio ?? d.id_externo;
