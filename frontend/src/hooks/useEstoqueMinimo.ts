import { useState } from 'react'
import api from '../services/api'

export interface ConfigEstoqueMinimo {
  id: number
  produto_codigo: string
  estoque_minimo: number
  notificar_fornecedores: number
  criado_em: string
  atualizado_em: string
}

export const useEstoqueMinimo = () => {
  const [configs, setConfigs] = useState<ConfigEstoqueMinimo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listar = async (skip = 0, limit = 100) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/estoque-minimo', {
        params: { skip, limit }
      })
      setConfigs(response.data.configuracoes)
      return response.data
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao listar configurações'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const criar = async (produto_codigo: string, estoque_minimo: number, notificar_fornecedores: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/estoque-minimo', {
        produto_codigo,
        estoque_minimo,
        notificar_fornecedores: notificar_fornecedores ? 1 : 0
      })
      setConfigs(prev => {
        // Se já existe configuração para este produto, atualiza
        const idx = prev.findIndex(c => c.produto_codigo === produto_codigo)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = response.data.config
          return updated
        }
        return [...prev, response.data.config]
      })
      return response.data.config
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao criar configuração'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const editar = async (produto_codigo: string, estoque_minimo: number, notificar_fornecedores: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.put(`/estoque-minimo/${produto_codigo}`, {
        estoque_minimo,
        notificar_fornecedores: notificar_fornecedores ? 1 : 0
      })
      setConfigs(prev =>
        prev.map(c => c.produto_codigo === produto_codigo ? response.data.config : c)
      )
      return response.data.config
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao editar configuração'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    configs,
    loading,
    error,
    listar,
    criar,
    editar
  }
}
