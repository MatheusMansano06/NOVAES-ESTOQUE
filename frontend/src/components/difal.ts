// Cálculo estimado de DIFAL (Diferencial de Alíquota do ICMS) em vendas
// interestaduais a consumidor final. Estimativa gerencial — NÃO substitui o
// cálculo oficial do contador (não considera base dupla da LC 190/2022, FECP,
// benefícios fiscais nem regras específicas de cada estado).

export type UF = 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN'
  | 'RO' | 'RR' | 'RS' | 'SC' | 'SP' | 'SE' | 'TO'

export const UFS: UF[] = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RO', 'RR', 'RS', 'SC', 'SP', 'SE', 'TO']

export const NOME_UF: Record<UF, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
  RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}

// Grupo Sul/Sudeste EXCETO ES (regra da alíquota interestadual de 7% vs 12%)
const SUL_SUDESTE_EXCETO_ES = new Set<UF>(['PR', 'RS', 'SC', 'MG', 'RJ', 'SP'])

// Alíquotas internas padrão (%) — valores gerais aproximados 2024/2025.
// EDITÁVEIS na ferramenta (cada estado muda por conta própria).
export const INTERNAS_PADRAO: Record<UF, number> = {
  AC: 19, AL: 20, AP: 18, AM: 20, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23,
  MT: 17, MS: 17, MG: 18, PA: 19, PB: 20, PR: 19.5, PE: 20.5, PI: 22.5, RJ: 22, RN: 20,
  RO: 19.5, RR: 20, RS: 17, SC: 17, SP: 18, SE: 20, TO: 20,
}

export interface DifalConfig {
  origem: UF
  importado: boolean            // trata como importado (interestadual 4%)
  internas: Record<UF, number>  // alíquota interna de cada estado destino
}

const STORAGE_KEY = 'difal_config_v1'

export function configPadrao(origem: UF = 'SP'): DifalConfig {
  return { origem, importado: false, internas: { ...INTERNAS_PADRAO } }
}

export function carregarConfig(): DifalConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      return { origem: c.origem || 'SP', importado: !!c.importado, internas: { ...INTERNAS_PADRAO, ...(c.internas || {}) } }
    }
  } catch { /* ignore */ }
  return configPadrao()
}

export function salvarConfig(c: DifalConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

// Alíquota interestadual (%) da origem para o destino.
export function aliquotaInterestadual(origem: UF, destino: UF, importado: boolean): number {
  if (importado) return 4
  const destinoBaixa = !SUL_SUDESTE_EXCETO_ES.has(destino) // N/NE/CO ou ES
  if (SUL_SUDESTE_EXCETO_ES.has(origem) && destinoBaixa) return 7
  return 12
}

export interface EntradaVenda { uf: UF; base: number }
export interface LinhaDifal {
  uf: UF
  vendas: number
  base: number
  interestadual: number
  interna: number
  aliquotaDifal: number
  difal: number
}
export interface ResultadoDifal {
  linhas: LinhaDifal[]
  totalDifal: number
  totalBase: number
  baseInterestadual: number   // base só das operações interestaduais (com DIFAL)
}

export function calcularDifal(entradas: EntradaVenda[], config: DifalConfig): ResultadoDifal {
  const mapa = new Map<UF, { base: number; vendas: number }>()
  for (const e of entradas) {
    if (!e.uf) continue
    const cur = mapa.get(e.uf) || { base: 0, vendas: 0 }
    cur.base += e.base; cur.vendas += 1
    mapa.set(e.uf, cur)
  }
  const linhas: LinhaDifal[] = []
  let totalDifal = 0, totalBase = 0, baseInterestadual = 0
  for (const [uf, { base, vendas }] of mapa) {
    totalBase += base
    const interna = config.internas[uf] ?? INTERNAS_PADRAO[uf]
    if (uf === config.origem) {
      // Operação interna — sem DIFAL
      linhas.push({ uf, vendas, base, interestadual: 0, interna, aliquotaDifal: 0, difal: 0 })
      continue
    }
    const inter = aliquotaInterestadual(config.origem, uf, config.importado)
    const aliq = Math.max(0, interna - inter)
    const difal = base * aliq / 100
    totalDifal += difal
    baseInterestadual += base
    linhas.push({ uf, vendas, base, interestadual: inter, interna, aliquotaDifal: aliq, difal })
  }
  linhas.sort((a, b) => b.difal - a.difal || b.base - a.base)
  return { linhas, totalDifal, totalBase, baseInterestadual }
}
