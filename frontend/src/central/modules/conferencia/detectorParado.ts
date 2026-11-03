/** Regulagem da foto automática. Quadros em cinza (0-255); os limiares são a fração da imagem que mudou.
 *  Se na bancada disparar demais ou de menos, é aqui que se ajusta. */
export const PARADO_MS = 3000;
const AQUECER_MS = 1500; // a webcam recém-aberta ainda ajusta a exposição: a imagem muda sem ninguém mexer
const DIF_PONTO = 20; // até aqui é ruído da webcam: o ponto conta como igual
const LIMIAR_MOVIMENTO = 0.02; // até aqui é mão firme: conta como parado
const LIMIAR_CENA = 0.015; // acima disso é outra cena (ou outra face do produto), que ainda não foi fotografada

export function diferenca(a: Uint8Array, b: Uint8Array): number {
  let mudaram = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > DIF_PONTO) mudaram++;
  return mudaram / a.length;
}

const NADA = { fotografar: false, progresso: 0 };

/** Fotografa quando alguém mexeu e depois parou por PARADO_MS. A imagem de quando a câmera abriu é o fundo:
 *  bancada vazia nunca vira foto. ponytail: compara imagens, não reconhece produto; caixa ou plástico que
 *  ficou parado na bancada também rende foto, que o operador apaga. */
export class DetectorParado {
  private inicio: number | null = null;
  private ancora: Uint8Array | null = null;
  private desde = 0;
  private mexeu = false;
  private cenas: Uint8Array[] = [];

  avaliar(quadro: Uint8Array, agora: number): { fotografar: boolean; progresso: number } {
    this.inicio ??= agora;
    if (agora - this.inicio < AQUECER_MS) return NADA;
    if (!this.ancora) {
      this.cenas.push(quadro);
      this.ancora = quadro;
      return NADA;
    }
    if (diferenca(quadro, this.ancora) > LIMIAR_MOVIMENTO) {
      this.ancora = quadro;
      this.desde = agora;
      this.mexeu = true;
      return NADA;
    }
    if (!this.mexeu || this.cenas.some((c) => diferenca(quadro, c) <= LIMIAR_CENA)) return NADA;
    const progresso = Math.min(1, (agora - this.desde) / PARADO_MS);
    if (progresso < 1) return { fotografar: false, progresso };
    this.cenas.push(quadro);
    this.mexeu = false;
    return { fotografar: true, progresso: 1 };
  }
}
