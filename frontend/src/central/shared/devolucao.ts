/** Formato único de devolução que o backend devolve (trilha Devoluções). Usado por várias telas. */
export type Plataforma = "mercado_livre" | "shopee";

export interface Devolucao {
  id: number;
  plataforma: Plataforma;
  id_externo: string;
  pedido: string;
  pacote: string | null;
  rastreio: string | null;
  etapa: string;
  status_plataforma: string;
  em_mediacao: boolean;
  pode_contestar: boolean;
  motivo: string;
  motivo_plataforma: string;
  responsavel: "comprador" | "vendedor" | "a_definir";
  destino: string;
  valor_reembolso: number | null;
  custo_plataforma: number | null;
  afeta_reputacao: boolean | null;
  prazo_vendedor: string | null;
  itens: { sku?: string | null; quantidade?: number | null }[];
  aberta_em: string;
}

export const PLATAFORMA: Record<Plataforma, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee" };

export const MOTIVO: Record<string, string> = {
  arrependimento: "Se arrependeu da compra",
  nao_serviu: "Não serviu",
  diferente: "Diferente do anunciado",
  defeito: "Com defeito",
  incompleto: "Incompleto",
  danificado: "Chegou danificado",
  nao_recebido: "Não recebeu",
  outro: "Outro motivo",
};
