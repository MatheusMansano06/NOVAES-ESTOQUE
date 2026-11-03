/** Regulagem da foto automática. Quadros em cinza (0-255); os limiares são a diferença média por ponto.
 *  Se na bancada disparar demais ou de menos, é aqui que se ajusta. */
export const PARADO_MS = 3000;
const LIMIAR_MOVIMENTO = 4; // até aqui é ruído da webcam ou mão firme: conta como parado
const LIMIAR_CENA = 10; // acima disso é uma cena nova, que ainda não foi fotografada

export function diferenca(a: Uint8Array, b: Uint8Array): number {
  let soma = 0;
  for (let i = 0; i < a.length; i++) soma += Math.abs(a[i] - b[i]);
  return soma / a.length;
}

/** Diz quando a imagem ficou parada por PARADO_MS numa cena que ainda não foi fotografada.
 *  ponytail: compara imagens, não reconhece produto; a bancada vazia pode render uma foto, que o operador apaga. */
export class DetectorParado {
  private ancora: Uint8Array | null = null;
  private desde = 0;
  private cenas: Uint8Array[] = [];

  avaliar(quadro: Uint8Array, agora: number): { fotografar: boolean; progresso: number } {
    if (!this.ancora || diferenca(quadro, this.ancora) > LIMIAR_MOVIMENTO) {
      this.ancora = quadro;
      this.desde = agora;
      return { fotografar: false, progresso: 0 };
    }
    if (this.cenas.some((c) => diferenca(quadro, c) <= LIMIAR_CENA)) return { fotografar: false, progresso: 0 };
    const progresso = Math.min(1, (agora - this.desde) / PARADO_MS);
    if (progresso < 1) return { fotografar: false, progresso };
    this.cenas.push(quadro);
    return { fotografar: true, progresso: 1 };
  }
}
