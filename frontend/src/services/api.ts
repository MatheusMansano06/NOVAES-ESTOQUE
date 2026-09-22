import axios, { AxiosInstance } from 'axios'

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const API_BASE_URL = `${API_ORIGIN}/api`
export const OPERADOR_SESSION_KEY = 'nvs_operador_sessao'

export interface OperadorSessao {
  operadorId?: number | null
  operadorNome: string
  role: 'operador' | 'master'
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function getOperadorSessao(): OperadorSessao | null {
  try {
    const raw = localStorage.getItem(OPERADOR_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.operadorNome || !parsed.role) return null
    return {
      operadorId: parsed.operadorId ?? null,
      operadorNome: String(parsed.operadorNome),
      role: parsed.role === 'master' ? 'master' : 'operador',
    }
  } catch {
    return null
  }
}

export function setOperadorSessao(sessao: OperadorSessao) {
  localStorage.setItem(OPERADOR_SESSION_KEY, JSON.stringify(sessao))
}

export function clearOperadorSessao() {
  localStorage.removeItem(OPERADOR_SESSION_KEY)
}

export function buildOperadorHeaders() {
  const sessao = getOperadorSessao()
  if (!sessao) return {}

  return {
    'x-operator-id': sessao.operadorId == null ? '' : String(sessao.operadorId),
    'x-operator-name': sessao.operadorNome,
    'x-operator-role': sessao.role,
  }
}

api.interceptors.request.use((config) => {
  const headers = buildOperadorHeaders()
  config.headers = {
    ...(config.headers ?? {}),
    ...headers,
  }
  return config
})

export interface VinculoSugestao {
  olist_produto_id: string
  olist_sku: string
  olist_nome: string
  olist_preco: number
  vezes_usado: number
}

export interface UploadResponse {
  id: number
  numero_nf: string
  status: string
  itens_encontrados: number
  sugestoes_vinculacao?: {
    item_id: number
    descricao: string
    confianca: number
    sugestao: VinculoSugestao
  }[]
  erros?: string
}

export interface NotaFiscalItem {
  id: number
  codigo_produto: string
  descricao: string
  quantidade_nf: number
  quantidade_confirmada?: number
  preco_unitario: number
  status: string
  divergencia?: string
  data_criacao: string
}

export interface NotaFiscal {
  id: number
  numero_nf: string
  serie: string
  fornecedor: string
  data_emissao: string
  data_upload: string
  arquivo_original: string
  status: string
  erros?: string
  itens: NotaFiscalItem[]
}

export interface NotaFiscalList {
  total: number
  skip: number
  limit: number
  items: NotaFiscal[]
}

export const uploadNFe = (file: File): Promise<UploadResponse> => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/upload-nfe', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }).then(res => res.data)
}

export const aceitarSugestaoVinculo = (itemId: number, sugestao: VinculoSugestao): Promise<any> => {
  return api.post('/olist/aceitar-sugestao', {
    item_id: itemId,
    olist_produto_id: sugestao.olist_produto_id,
    olist_sku: sugestao.olist_sku,
    olist_nome: sugestao.olist_nome,
    olist_preco: sugestao.olist_preco,
  }).then(res => res.data)
}

export const getNotaFiscal = (id: number): Promise<NotaFiscal> => {
  return api.get(`/notas-fiscais/${id}`).then(res => res.data)
}

export const listNotasFiscais = (skip: number = 0, limit: number = 10): Promise<NotaFiscalList> => {
  return api.get('/notas-fiscais', {
    params: { skip, limit }
  }).then(res => res.data)
}

export const excluirNotaFiscal = (nfId: number): Promise<any> => {
  return api.post('/notas-fiscais/deletar', { nf_id: nfId }).then(res => res.data)
}

export const excluirMultiplasNotas = (nfIds: number[]): Promise<any> => {
  return api.post('/notas-fiscais/deletar-multiplas', { nf_ids: nfIds }).then(res => res.data)
}

export const baixarNotaFiscal = (nfId: number): void => {
  window.location.href = `${API_BASE_URL}/notas-fiscais/${nfId}/baixar`
}

export const baixarPdfNotaFiscal = (nfId: number): void => {
  window.location.href = `${API_BASE_URL}/notas-fiscais/${nfId}/pdf`
}

export const baixarMultiplosOuPdfs = async (nfIds: number[], formato: 'original' | 'pdf'): Promise<void> => {
  if (nfIds.length === 0) return

  if (nfIds.length === 1) {
    if (formato === 'pdf') {
      baixarPdfNotaFiscal(nfIds[0])
    } else {
      baixarNotaFiscal(nfIds[0])
    }
    return
  }

  // Para múltiplos arquivos, baixa cada um individualmente
  for (const nfId of nfIds) {
    if (formato === 'pdf') {
      window.open(`${API_BASE_URL}/notas-fiscais/${nfId}/pdf`, '_blank')
    } else {
      window.open(`${API_BASE_URL}/notas-fiscais/${nfId}/baixar`, '_blank')
    }
    // Aguarda um pouco entre downloads para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

export interface DevolucaoResumo {
  id: number
  marketplace: string
  order_id: string
  claim_id: string
  status_marketplace: string
  motivo: string
  prazo_resolucao: string | null
}

export interface DevolucaoItem {
  sku_esperado: string
  produto_nome: string
  quantidade: number
  cmv_unitario: number | null
}

export interface DevolucaoEvento {
  status: string
  descricao: string
  origem: string
  data_hora: string
}

export interface DevolucaoOlistLink {
  produto_id_olist: string
  sku: string
  produto_nome_olist: string
  cmv: number
  estoque_disponivel: number | null
}

export interface DevolucaoDetalhe extends DevolucaoResumo {
  itens: DevolucaoItem[]
  eventos: DevolucaoEvento[]
  olist: DevolucaoOlistLink | null
}

export async function listarDevolucoes(): Promise<DevolucaoResumo[]> {
  const resp = await api.get<DevolucaoResumo[]>('/devolucoes')
  return resp.data
}

export async function buscarDevolucao(id: number): Promise<DevolucaoDetalhe> {
  const resp = await api.get<DevolucaoDetalhe>(`/devolucoes/${id}`)
  return resp.data
}

export async function sincronizarDevolucoes(): Promise<{ novos: number; atualizados: number }> {
  const resp = await api.post('/devolucoes/sincronizar')
  return resp.data
}

export default api
