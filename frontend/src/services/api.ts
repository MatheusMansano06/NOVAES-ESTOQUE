import axios, { AxiosInstance } from 'axios'

const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const API_BASE_URL = `${API_ORIGIN}/api`

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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

export default api
