import { useState } from 'react'
import api from '../services/api'

export interface Fornecedor {
  id: number
  nome: string
  cnpj?: string
  contato_whatsapp?: string
  email?: string
  endereco?: string
  ativo: number
  criado_em: string
}

export interface FornecedorForm {
  nome: string
  cnpj?: string
  contato_whatsapp?: string
  email?: string
  endereco?: string
}

export const useFornecedores = () => {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listar = async (skip = 0, limit = 100, ativo = true) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/fornecedores', {
        params: { skip, limit, ativo: ativo ? 1 : 0 }
      })
      setFornecedores(response.data.fornecedores)
      return response.data
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao listar fornecedores'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const criar = async (dados: FornecedorForm) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/fornecedores', dados)
      setFornecedores(prev => [...prev, response.data.fornecedor])
      return response.data.fornecedor
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao criar fornecedor'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const editar = async (id: number, dados: Partial<FornecedorForm>) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.put(`/fornecedores/${id}`, dados)
      setFornecedores(prev =>
        prev.map(f => f.id === id ? response.data.fornecedor : f)
      )
      return response.data.fornecedor
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao editar fornecedor'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const deletar = async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/fornecedores/${id}`)
      setFornecedores(prev => prev.filter(f => f.id !== id))
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao deletar fornecedor'
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    fornecedores,
    loading,
    error,
    listar,
    criar,
    editar,
    deletar
  }
}
