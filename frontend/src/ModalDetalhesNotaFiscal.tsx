import './ModalDetalhes.css'

interface NotaFiscal {
  id: number
  numero_nf: string
  serie: string
  fornecedor: string
  status: string
  data_emissao?: string
  itens?: Array<{
    id: number
    codigo_produto: string
    descricao: string
    quantidade_nf: number
    preco_unitario: number
  }>
}

interface ModalDetalhesNotaFiscalProps {
  isOpen: boolean
  onClose: () => void
  nota: NotaFiscal
}

export function ModalDetalhesNotaFiscal({
  isOpen,
  onClose,
  nota,
}: ModalDetalhesNotaFiscalProps) {
  if (!isOpen) return null

  const totalValor = nota.itens?.reduce((sum, item) => sum + (item.quantidade_nf * item.preco_unitario), 0) || 0

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }} onClick={onClose}>
      <div style={{
        background: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        width: '95vw',
        maxWidth: '1200px',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }} onClick={(e) => e.stopPropagation()}>

        {/* HEADER */}
        <div style={{
          background: '#ffffff',
          borderBottom: '1px solid #e0e0e0',
          padding: '1.5rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 1001
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#1a1a1a', fontSize: '1.5rem', fontWeight: '600' }}>
              NOTA FISCAL ELETRÔNICA
            </h2>
            <p style={{ margin: '0.5rem 0 0 0', color: '#666', fontSize: '0.95rem' }}>
              NF #{nota.numero_nf} - Série {nota.serie}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            fontSize: '2rem',
            color: '#999',
            cursor: 'pointer',
            padding: '0',
            width: '50px',
            height: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            ×
          </button>
        </div>

        {/* CONTENT */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '2rem'
        }}>

          {/* CABEÇALHO EMPRESA */}
          <div style={{
            background: '#f9f9f9',
            border: '2px solid #007acc',
            padding: '2rem',
            borderRadius: '8px',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              {/* Dados da Empresa */}
              <div>
                <p style={{ color: '#007acc', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Fornecedor
                </p>
                <h3 style={{ color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '700', margin: '0 0 1rem 0' }}>
                  {nota.fornecedor}
                </h3>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }}>CNPJ</p>
                  <p style={{ color: '#1a1a1a', fontSize: '0.95rem' }}>N/A (Dados não disponíveis)</p>
                </div>

                <div>
                  <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }}>ENDEREÇO</p>
                  <p style={{ color: '#1a1a1a', fontSize: '0.95rem' }}>N/A (Dados não disponíveis)</p>
                </div>
              </div>

              {/* Dados da Nota */}
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }}>DATA DE EMISSÃO</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '600' }}>
                    {nota.data_emissao
                      ? new Date(nota.data_emissao).toLocaleDateString('pt-BR', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })
                      : 'N/A'
                    }
                  </p>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }}>STATUS</p>
                  <p style={{
                    color: '#155724',
                    fontSize: '0.95rem',
                    fontWeight: '600',
                    display: 'inline-block',
                    background: '#f0f9f6',
                    padding: '0.5rem 1rem',
                    borderRadius: '4px',
                    border: '1px solid #c8e6c9'
                  }}>
                    {nota.status?.toUpperCase() || 'PROCESSADO'}
                  </p>
                </div>

                <div>
                  <p style={{ color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }}>QUANTIDADE DE ITENS</p>
                  <p style={{ color: '#1a1a1a', fontSize: '1.3rem', fontWeight: '700' }}>
                    {nota.itens?.length || 0}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* TABELA DE PRODUTOS */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#1a1a1a', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: '600' }}>
              Produtos
            </h3>

            {nota.itens && nota.itens.length > 0 ? (
              <div style={{
                borderCollapse: 'collapse',
                width: '100%',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                {/* HEADER TABELA */}
                <div style={{
                  background: '#007acc',
                  color: 'white',
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                  gap: '1rem',
                  padding: '1rem',
                  fontWeight: '600',
                  fontSize: '0.9rem'
                }}>
                  <div>PRODUTO</div>
                  <div style={{ textAlign: 'center' }}>QTD</div>
                  <div style={{ textAlign: 'center' }}>VALOR UN.</div>
                  <div style={{ textAlign: 'center' }}>SUBTOTAL</div>
                  <div style={{ textAlign: 'right' }}>CÓDIGO</div>
                </div>

                {/* LINHAS */}
                {nota.itens.map((item, idx) => (
                  <div key={item.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                    gap: '1rem',
                    padding: '1rem',
                    borderTop: idx > 0 ? '1px solid #e0e0e0' : 'none',
                    background: idx % 2 === 0 ? '#ffffff' : '#f9f9f9'
                  }}>
                    <div style={{ color: '#1a1a1a', fontWeight: '500' }}>
                      {item.descricao}
                    </div>
                    <div style={{ textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }}>
                      {item.quantidade_nf.toFixed(0)}
                    </div>
                    <div style={{ textAlign: 'center', color: '#1a1a1a' }}>
                      R$ {item.preco_unitario.toFixed(2)}
                    </div>
                    <div style={{ textAlign: 'center', color: '#007acc', fontWeight: '600' }}>
                      R$ {(item.quantidade_nf * item.preco_unitario).toFixed(2)}
                    </div>
                    <div style={{ textAlign: 'right', color: '#666', fontSize: '0.9rem' }}>
                      {item.codigo_produto}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Nenhum produto</p>
            )}
          </div>

          {/* RESUMO FINANCEIRO */}
          <div style={{
            background: '#f5f5f5',
            border: '2px solid #007acc',
            padding: '1.5rem 2rem',
            borderRadius: '6px',
            textAlign: 'right'
          }}>
            <p style={{ color: '#999', fontSize: '0.9rem', marginBottom: '0.5rem' }}>VALOR TOTAL DA NOTA</p>
            <p style={{ color: '#007acc', fontSize: '2rem', fontWeight: '700', margin: 0 }}>
              R$ {totalValor.toFixed(2)}
            </p>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{
          background: '#f5f5f5',
          borderTop: '1px solid #e0e0e0',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '1rem'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#007acc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#005a96')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#007acc')}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
