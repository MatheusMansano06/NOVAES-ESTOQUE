// Rodar: node frontend/src/central/modules/conferencia/detectorParado.check.mjs
import assert from "node:assert";

import { DetectorParado } from "./detectorParado.ts";

const cena = (valor) => new Uint8Array(100).fill(valor);
const d = new DetectorParado();

function segurar(quadro, inicio, ms = 3000) {
  let fotos = 0;
  for (let t = inicio; t <= inicio + ms; t += 250) if (d.avaliar(quadro, t).fotografar) fotos++;
  return fotos;
}

assert.equal(segurar(cena(50), 0, 2500), 0, "parado por menos de 3s não fotografa");
assert.equal(segurar(cena(51), 2750, 1000), 1, "completou 3s com ruído de webcam: fotografa");
assert.equal(segurar(cena(50), 3750, 9000), 0, "a mesma cena não repete a foto");
assert.equal(segurar(cena(120), 12750), 1, "produto novo parado por 3s: fotografa");
for (let t = 16000, v = 0; t < 22000; t += 250, v = (v + 40) % 240) {
  assert.equal(d.avaliar(cena(v), t).fotografar, false, "imagem mexendo não fotografa");
}
assert.equal(segurar(cena(50), 22000), 0, "voltar a uma cena já fotografada não repete a foto");
console.log("detectorParado ok");
