import { useState, useEffect } from 'react'

interface NotaFiscal {
  id: number
  numero_nf: string
  fornecedor: string
  itens?: ItemEstoque[]
}

interface ItemEstoque {
  id: number
  codigo_produto: string
  descricao: string
  quantidade_nf: number
  preco_unitario: number
  olist_produto_id?: string | null
  olist_sku?: string | null
  olist_nome?: string | null
}

interface Fornecedor {
  nome: string
  quantidadeProdutos: number
}

interface ProdutoFornecedor {
  codigo_produto: string
  descricao: string
  frequencia: number
  olist_sku?: string
  olist_produto_id?: string
  olist_nome?: string
}

interface FornecedorComPreco {
  nome: string
  preco_unitario: number
  frequencia: number
  olist_sku?: string
  olist_nome?: string
}

interface ProdutoComFornecedores {
  codigo_produto: string
  descricao: string
  fornecedores: FornecedorComPreco[]
}

interface FornecedoresManagerProps {
  onVoltar: () => void
}

export function FornecedoresManager({ onVoltar }: FornecedoresManagerProps) {
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<string | null>(null)
  const [produtosSelecionados, setProdutosSelecionados] = useState<ProdutoFornecedor[]>([])
  const [showModal, setShowModal] = useState(false)

  // Estados para busca de produtos
  const [view, setView] = useState<'suppliers' | 'search'>('suppliers')
  const [termoBusca, setTermoBusca] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<ProdutoComFornecedores[]>([])

  // Estados para editar nome dos fornecedores
  const [nomesFornecedores, setNomesFornecedores] = useState<{ [key: string]: string }>({})
  const [showModalNome, setShowModalNome] = useState(false)
  const [fornecedorParaEditar, setFornecedorParaEditar] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState('')

  // Carrega as notas fiscais na montagem
  useEffect(() => {
    loadNotas()
  }, [])

  const loadNotas = async () => {
    setCarregando(true)
    try {
      const res = await fetch('http://127.0.0.1:8000/api/notas-fiscais')
      if (!res.ok) throw new Error('Falha ao carregar notas')

      const response = await res.json()
      // A API retorna um objeto paginado com { total, skip, limit, items }
      const data: NotaFiscal[] = response.items || response
      setNotas(data)

      // Agrupa fornecedores
      groupByFornecedor(data)
    } catch (err) {
      console.error('Erro ao carregar notas:', err)
    } finally {
      setCarregando(false)
    }
  }

  const groupByFornecedor = (notasData: NotaFiscal[]) => {
    const fornecedoresUnicos = new Map<string, number>()

    notasData.forEach(nota => {
      if (nota.fornecedor) {
        const count = (nota.itens?.length || 0)
        if (count > 0) {
          const atual = fornecedoresUnicos.get(nota.fornecedor) || 0
          fornecedoresUnicos.set(nota.fornecedor, atual + count)
        }
      }
    })

    const fornecedorList: Fornecedor[] = Array.from(fornecedoresUnicos.entries())
      .map(([nome, quantidadeProdutos]) => ({ nome, quantidadeProdutos }))
      .sort((a, b) => a.nome.localeCompare(b.nome))

    setFornecedores(fornecedorList)
  }

  const getProductsByFornecedor = (fornecedorNome: string) => {
    const produtoMap = new Map<string, ProdutoFornecedor>()

    notas.forEach(nota => {
      if (nota.fornecedor === fornecedorNome && nota.itens) {
        nota.itens.forEach(item => {
          const chave = `${item.codigo_produto}|${item.descricao}`
          const existente = produtoMap.get(chave)

          if (existente) {
            existente.frequencia += 1
          } else {
            produtoMap.set(chave, {
              codigo_produto: item.codigo_produto,
              descricao: item.descricao,
              frequencia: 1,
              olist_sku: item.olist_sku || undefined,
              olist_produto_id: item.olist_produto_id || undefined,
              olist_nome: item.olist_nome || undefined,
            })
          }
        })
      }
    })

    const produtos = Array.from(produtoMap.values())
      .sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto))

    return produtos
  }

  const handleFornecedorClick = (fornecedorNome: string) => {
    setFornecedorSelecionado(fornecedorNome)
    const produtos = getProductsByFornecedor(fornecedorNome)
    setProdutosSelecionados(produtos)
    setShowModal(true)
  }

  const handleFecharModal = () => {
    setShowModal(false)
    setFornecedorSelecionado(null)
    setProdutosSelecionados([])
  }

  // Função para agregar todos os produtos com todos os fornecedores
  const aggregateAllProducts = (): Map<string, ProdutoComFornecedores> => {
    const productMap = new Map<string, ProdutoComFornecedores>()

    notas.forEach(nota => {
      if (nota.itens) {
        nota.itens.forEach(item => {
          const chave = `${item.codigo_produto}|${item.descricao}`
          const existing = productMap.get(chave)

          if (existing) {
            // Procura fornecedor existente ou adiciona novo
            const supplierIdx = existing.fornecedores.findIndex(
              f => f.nome === nota.fornecedor
            )
            if (supplierIdx >= 0) {
              existing.fornecedores[supplierIdx].frequencia += 1
            } else {
              existing.fornecedores.push({
                nome: nota.fornecedor,
                preco_unitario: item.preco_unitario,
                frequencia: 1,
                olist_sku: item.olist_sku || undefined,
                olist_nome: item.olist_nome || undefined
              })
            }
          } else {
            productMap.set(chave, {
              codigo_produto: item.codigo_produto,
              descricao: item.descricao,
              fornecedores: [{
                nome: nota.fornecedor,
                preco_unitario: item.preco_unitario,
                frequencia: 1,
                olist_sku: item.olist_sku || undefined,
                olist_nome: item.olist_nome || undefined
              }]
            })
          }
        })
      }
    })

    // Ordena fornecedores por preço para cada produto
    productMap.forEach(product => {
      product.fornecedores.sort((a, b) => a.preco_unitario - b.preco_unitario)
    })

    return productMap
  }

  // Função para buscar produtos por termo
  const handleBusca = (termo: string) => {
    setTermoBusca(termo)

    if (termo.trim() === '') {
      setResultadosBusca([])
      return
    }

    const allProducts = aggregateAllProducts()
    const termoLower = termo.toLowerCase()

    const resultados = Array.from(allProducts.values())
      .filter(p =>
        p.codigo_produto.toLowerCase().includes(termoLower) ||
        p.descricao.toLowerCase().includes(termoLower) ||
        p.fornecedores.some(f => f.olist_sku?.toLowerCase().includes(termoLower) || f.olist_nome?.toLowerCase().includes(termoLower))
      )
      .sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto))

    setResultadosBusca(resultados)
  }

  const getNomeExibicao = (nomeFornecedor: string) => {
    return nomesFornecedores[nomeFornecedor] || nomeFornecedor
  }

  if (carregando) {
    return (
      <div className="app">
        <header className="header">
          <div className="container">
            <h1>NVS TECH</h1>
            <p>Sistema de Gestão Inteligente de Estoque para Operações de Logística e Marketplace</p>
          </div>
        </header>
        <main className="container main-content">
          <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Carregando fornecedores...</p>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <h1>NVS TECH</h1>
          <p>Sistema de Gestão Inteligente de Estoque para Operações de Logística e Marketplace</p>
        </div>
      </header>

      <main className="container main-content">
        <button
          onClick={onVoltar}
          style={{
            marginBottom: '2rem',
            padding: '0.75rem 1.5rem',
            background: '#f0f0f0',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.95rem'
          }}
        >
          ← Voltar
        </button>

        {/* Tabs de navegação */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '2px solid #e0e0e0', paddingBottom: '0' }}>
          <button
            onClick={() => { setView('suppliers'); setTermoBusca(''); setResultadosBusca([]) }}
            style={{
              padding: '1rem 1.5rem',
              background: view === 'suppliers' ? '#007acc' : 'transparent',
              color: view === 'suppliers' ? 'white' : '#333',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.95rem',
              borderBottom: view === 'suppliers' ? '3px solid #005a96' : 'none'
            }}
          >
            Fornecedores
          </button>
          <button
            onClick={() => setView('search')}
            style={{
              padding: '1rem 1.5rem',
              background: view === 'search' ? '#007acc' : 'transparent',
              color: view === 'search' ? 'white' : '#333',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.95rem',
              borderBottom: view === 'search' ? '3px solid #005a96' : 'none'
            }}
          >
            Busca de Produtos
          </button>
        </div>

        {/* View: Fornecedores */}
        {view === 'suppliers' && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Fornecedores</h2>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>Selecione um fornecedor para ver seus produtos</p>

          {fornecedores.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>
              Nenhum fornecedor encontrado. Faça o upload de notas fiscais primeiro.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '1rem'
              }}
            >
              {fornecedores.map((fornecedor) => (
                <div
                  key={fornecedor.nome}
                  style={{
                    padding: '1.5rem',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    background: '#fafafa',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = '#f0f8ff'
                    el.style.borderColor = '#007acc'
                    el.style.boxShadow = '0 4px 12px rgba(0, 122, 204, 0.15)'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = '#fafafa'
                    el.style.borderColor = '#ddd'
                    el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleFornecedorClick(fornecedor.nome)}>
                      <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem', color: '#1a1a1a' }}>
                        {getNomeExibicao(fornecedor.nome)}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#666' }}>
                        {fornecedor.quantidadeProdutos} produto{fornecedor.quantidadeProdutos !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setFornecedorParaEditar(fornecedor.nome)
                        setNovoNome(nomesFornecedores[fornecedor.nome] || '')
                        setShowModalNome(true)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1.2rem',
                        padding: '0.25rem',
                        color: '#999',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#007acc')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#999')}
                      title="Editar nome"
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* View: Busca de Produtos */}
        {view === 'search' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Busca de Produtos</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>Busque por código, descrição ou SKU Olist para encontrar o produto e comparar preços entre fornecedores</p>

          {/* Input de busca */}
          <input
            type="text"
            placeholder="Digite código, descrição ou SKU..."
            value={termoBusca}
            onChange={(e) => handleBusca(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              border: '1px solid #cfd8dc',
              borderRadius: '6px',
              fontSize: '0.95rem',
              marginBottom: '1.5rem',
              boxSizing: 'border-box'
            }}
          />

          {/* Resultados */}
          {termoBusca.trim() === '' ? (
            <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Digite um produto para buscar</p>
          ) : resultadosBusca.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Nenhum produto encontrado</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {resultadosBusca.map((produto, idx) => (
                <div key={idx} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                  {/* Header do produto */}
                  <div style={{ padding: '1rem', background: '#f7f9fa', borderBottom: '1px solid #e0e0e0' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1a1a1a', marginBottom: '0.25rem' }}>
                      {produto.codigo_produto}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#666' }}>
                      {produto.descricao}
                    </div>
                  </div>

                  {/* Tabela de fornecedores */}
                  <div style={{ padding: '1rem' }}>
                    {produto.fornecedores.map((fornecedor, fIdx) => (
                      <div
                        key={fIdx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.75rem',
                          borderBottom: fIdx < produto.fornecedores.length - 1 ? '1px solid #f0f0f0' : 'none',
                          backgroundColor: fIdx % 2 === 0 ? '#ffffff' : '#fafafa'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: '#1a1a1a', marginBottom: '0.25rem' }}>
                            {getNomeExibicao(fornecedor.nome)}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: '#666' }}>
                            {fornecedor.frequencia}x comprado{fornecedor.frequencia !== 1 ? 's' : ''}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', minWidth: '150px' }}>
                          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#28a745', marginBottom: '0.25rem' }}>
                            R$ {fornecedor.preco_unitario.toFixed(2)}
                          </div>
                          {fornecedor.olist_sku && (
                            <div style={{ fontSize: '0.8rem', color: '#28a745' }}>
                              SKU: {fornecedor.olist_sku}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </main>

      {/* MODAL DE PRODUTOS */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={handleFecharModal}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              maxWidth: '700px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.5rem',
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f7f9fa'
              }}
            >
              <h3 style={{ margin: 0, color: '#1a1a1a' }}>
                {getNomeExibicao(fornecedorSelecionado || '')} - Produtos
              </h3>
              <button
                onClick={handleFecharModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#999'
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem' }}>
              {produtosSelecionados.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center' }}>Nenhum produto encontrado</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {produtosSelecionados.map((produto, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '1rem',
                        border: '1px solid #e0e0e0',
                        borderRadius: '6px',
                        background: '#f9f9f9'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: '#1a1a1a', marginBottom: '0.25rem' }}>
                            {produto.codigo_produto}
                          </div>
                          <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
                            {produto.descricao}
                          </div>
                          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <div
                              style={{
                                display: 'inline-block',
                                padding: '0.25rem 0.75rem',
                                background: '#e0e0e0',
                                borderRadius: '4px',
                                fontSize: '0.85rem',
                              }}
                            >
                              Comprado {produto.frequencia}x
                            </div>
                            {produto.olist_sku && (
                              <div style={{ display: 'inline-block', padding: '0.25rem 0.75rem', background: '#c8e6c9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' }}>
                                ✅ {produto.olist_sku}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid #e0e0e0',
                background: '#f7f9fa',
                textAlign: 'right'
              }}
            >
              <button
                onClick={handleFecharModal}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#f0f0f0',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDITAR NOME */}
      {showModalNome && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001
          }}
          onClick={() => {
            setShowModalNome(false)
            setFornecedorParaEditar(null)
            setNovoNome('')
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%',
              padding: '2rem',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem 0', color: '#1a1a1a' }}>
              Editar Nome do Fornecedor
            </h3>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }}>
                Nome Oficial:
              </label>
              <div style={{ padding: '0.75rem', background: '#f5f5f5', borderRadius: '4px', color: '#999' }}>
                {fornecedorParaEditar}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }}>
                Nome Customizado:
              </label>
              <input
                type="text"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex: Augusto, Cordoaria, etc..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #cfd8dc',
                  borderRadius: '6px',
                  fontSize: '0.95rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowModalNome(false)
                  setFornecedorParaEditar(null)
                  setNovoNome('')
                }}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#f0f0f0',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.95rem'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (fornecedorParaEditar && novoNome.trim()) {
                    setNomesFornecedores(prev => ({
                      ...prev,
                      [fornecedorParaEditar]: novoNome.trim()
                    }))
                  }
                  setShowModalNome(false)
                  setFornecedorParaEditar(null)
                  setNovoNome('')
                }}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#007acc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.95rem'
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FornecedoresManager
