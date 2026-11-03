// Rodar: node frontend/src/central/modules/conferencia/detectorParado.check.mjs
import assert from "node:assert";

import { DetectorParado } from "./detectorParado.ts";

const L = 64, A = 36;
let semente = 1;
const ruido = () => ((semente = (semente * 16807) % 2147483647) % 17) - 8; // webcam: até ±8 em cada ponto

/** Bancada com um produto pequeno (10x10, 4% da imagem) na posição x; sem x, bancada vazia. */
function cena(x, cor = 200) {
  const q = new Uint8Array(L * A);
  for (let i = 0; i < q.length; i++) q[i] = 60 + ruido();
  if (x !== undefined) for (let l = 10; l < 20; l++) for (let c = x; c < x + 10; c++) q[l * L + c] = cor + ruido();
  return q;
}

const d = new DetectorParado();
let t = 0;
function rodar(quadro, ms) {
  let fotos = 0;
  for (const fim = t + ms; t < fim; t += 250) if (d.avaliar(quadro(), t).fotografar) fotos++;
  return fotos;
}
const mexendo = () => rodar.pos = ((rodar.pos ?? 0) + 7) % 50;

assert.equal(rodar(() => new Uint8Array(L * A).fill(t * 2 % 255), 1500), 0, "câmera ajustando a exposição ao abrir não fotografa");
assert.equal(rodar(() => cena(), 10000), 0, "bancada vazia parada, sem ninguém mexer, não fotografa");
assert.equal(rodar(() => cena(mexendo()), 6000), 0, "produto pequeno mexendo não fotografa");
assert.equal(rodar(() => cena(5), 2750), 0, "parou por menos de 3s não fotografa");
assert.equal(rodar(() => cena(5), 750), 1, "mexeu e parou por 3s: fotografa");
assert.equal(rodar(() => cena(5), 9000), 0, "continuar parado não repete a foto");
assert.equal(rodar(() => cena(mexendo()), 3000) + rodar(() => cena(5), 4000), 0, "mexer e voltar para o mesmo lugar não repete a foto");
assert.equal(rodar(() => cena(mexendo()), 3000) + rodar(() => cena(5, 120), 3500), 1, "outra face do produto: fotografa de novo");
assert.equal(rodar(() => cena(mexendo()), 3000) + rodar(() => cena(), 9000), 0, "tirou o produto e a bancada ficou vazia: não fotografa");
console.log("detectorParado ok");
