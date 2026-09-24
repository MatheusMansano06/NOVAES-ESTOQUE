/** Ícones de traço simples (poucos: não vale uma biblioteca). */
const CAMINHOS = {
  caixa: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8",
  alerta: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.5",
  caminhao: "M3 6h11v9H3zM14 9h4l3 3v3h-7M7.5 18.5a1.5 1.5 0 1 0 0-.01M17.5 18.5a1.5 1.5 0 1 0 0-.01",
  balao: "M4 5h16v10H9l-5 4V5Z",
  ok: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6",
  lupa: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5",
  codigo: "M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14",
  relogio: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  moeda: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm2.5-12H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5M12 7v2m0 8v-2",
  fechar: "M6 6l12 12M18 6 6 18",
  telefone: "M8 4h8v16H8zM11 17h2",
  mao: "M7 11V6a1.5 1.5 0 0 1 3 0v4m0-5a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v6c0 4-2 6-6 6-3 0-4-2-6-5l-1.5-2.5a1.5 1.5 0 0 1 2.5-1.5L7 13",
} as const;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CAMINHOS[nome]} />
    </svg>
  );
}
