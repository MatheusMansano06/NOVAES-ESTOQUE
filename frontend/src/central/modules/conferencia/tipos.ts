import type { Devolucao } from "../../shared/devolucao";

export type Classe = "A" | "B" | "C";

export interface NotaResumo {
  id: number;
  numero: string;
  serie: string | null;
  situacao: string;
}

export interface ItemOlist {
  produto_id: number;
  sku: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  custo: number | null;
}

export interface PedidoOlist {
  id: number;
  numero: number;
  situacao: string;
  canal: string;
  nota: NotaResumo | null;
  nota_devolucao: NotaResumo | null;
  itens: ItemOlist[];
}

export interface Lancamento {
  sku: "vendido" | "recebido";
  deposito: "vendavel" | "avaria";
  tipo: "E" | "S";
  ok?: boolean;
  erro?: string;
  sku_olist?: string;
  pela_olist?: boolean; // entrada feita pelo "devolver produtos" da Olist
}

export interface Conferencia {
  classe: Classe;
  lancamentos: Lancamento[];
  contestar: boolean;
  motivo: string;
  evidencias_exigidas: string[];
  conferida_em: string;
  estoque_lancado_em: string | null;
  estoque_resultado: Lancamento[] | null;
  sku_recebido: string | null;
  produto_correto: boolean;
  completo: boolean;
  sem_uso: boolean;
  revendavel: boolean;
  erro_nosso: boolean;
  observacao: string | null;
  perda_produto: number | null;
  frete_reverso: number | null;
  chamado_manual: boolean;
  chamado_aberto_em: string | null;
  chamado_protocolo: string | null;
}

export interface Evidencia {
  id: number;
  tipo: "foto" | "video";
  enviada_em: string;
}

/** Conferência visual: foto do anúncio vendido, link para a reclamação e o que o comprador anexou. */
export interface Midia {
  anuncio: { nome: string | null; imagem: string | null }[];
  comprador: { fotos: string[]; videos: string[] };
  link: string | null;
}

export interface Tela {
  devolucao: Devolucao;
  olist: { erro: string | null; pedidos: PedidoOlist[] };
  midia: Midia;
  conferencia: Conferencia | null;
  evidencias: Evidencia[];
}

export interface Contestacao {
  ok: boolean;
  caminho: string | null;
  aviso: string | null;
  erro: string | null;
  enviada_em: string;
}

export const CULPA: Record<Devolucao["responsavel"], { quem: string; efeito: string }> = {
  comprador: { quem: "Comprador", efeito: "Sem custo de frete para a Novaes" },
  vendedor: { quem: "Novaes", efeito: "A plataforma cobra o frete reverso de nós" },
  a_definir: { quem: "Em análise", efeito: "A plataforma ainda vai decidir quem paga" },
};

export const CLASSE: Record<Classe, { nome: string; explica: string }> = {
  A: { nome: "Recuperado", explica: "Volta para o estoque vendável" },
  B: { nome: "Avaria", explica: "Produto nosso sem condição de venda" },
  C: { nome: "Divergente", explica: "Não é o que enviamos" },
};

export const DEPOSITO = { vendavel: "Geral (vendável)", avaria: "Avaria" } as const;
