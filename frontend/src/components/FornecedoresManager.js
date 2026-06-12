import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
export function FornecedoresManager({ onVoltar }) {
    const [notas, setNotas] = useState([]);
    const [fornecedores, setFornecedores] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
    const [produtosSelecionados, setProdutosSelecionados] = useState([]);
    const [showModal, setShowModal] = useState(false);
    // Estados para busca de produtos
    const [view, setView] = useState('suppliers');
    const [termoBusca, setTermoBusca] = useState('');
    const [resultadosBusca, setResultadosBusca] = useState([]);
    // Estados para editar nome dos fornecedores
    const [nomesFornecedores, setNomesFornecedores] = useState({});
    const [showModalNome, setShowModalNome] = useState(false);
    const [fornecedorParaEditar, setFornecedorParaEditar] = useState(null);
    const [novoNome, setNovoNome] = useState('');
    // Carrega as notas fiscais na montagem
    useEffect(() => {
        loadNotas();
    }, []);
    const loadNotas = async () => {
        setCarregando(true);
        try {
            const res = await fetch('http://127.0.0.1:8000/api/notas-fiscais');
            if (!res.ok)
                throw new Error('Falha ao carregar notas');
            const response = await res.json();
            // A API retorna um objeto paginado com { total, skip, limit, items }
            const data = response.items || response;
            setNotas(data);
            // Agrupa fornecedores
            groupByFornecedor(data);
        }
        catch (err) {
            console.error('Erro ao carregar notas:', err);
        }
        finally {
            setCarregando(false);
        }
    };
    const groupByFornecedor = (notasData) => {
        const fornecedoresUnicos = new Map();
        notasData.forEach(nota => {
            if (nota.fornecedor) {
                const count = (nota.itens?.length || 0);
                if (count > 0) {
                    const atual = fornecedoresUnicos.get(nota.fornecedor) || 0;
                    fornecedoresUnicos.set(nota.fornecedor, atual + count);
                }
            }
        });
        const fornecedorList = Array.from(fornecedoresUnicos.entries())
            .map(([nome, quantidadeProdutos]) => ({ nome, quantidadeProdutos }))
            .sort((a, b) => a.nome.localeCompare(b.nome));
        setFornecedores(fornecedorList);
    };
    const getProductsByFornecedor = (fornecedorNome) => {
        const produtoMap = new Map();
        notas.forEach(nota => {
            if (nota.fornecedor === fornecedorNome && nota.itens) {
                nota.itens.forEach(item => {
                    const chave = `${item.codigo_produto}|${item.descricao}`;
                    const existente = produtoMap.get(chave);
                    if (existente) {
                        existente.frequencia += 1;
                    }
                    else {
                        produtoMap.set(chave, {
                            codigo_produto: item.codigo_produto,
                            descricao: item.descricao,
                            frequencia: 1,
                            olist_sku: item.olist_sku || undefined,
                            olist_produto_id: item.olist_produto_id || undefined,
                            olist_nome: item.olist_nome || undefined,
                        });
                    }
                });
            }
        });
        const produtos = Array.from(produtoMap.values())
            .sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto));
        return produtos;
    };
    const handleFornecedorClick = (fornecedorNome) => {
        setFornecedorSelecionado(fornecedorNome);
        const produtos = getProductsByFornecedor(fornecedorNome);
        setProdutosSelecionados(produtos);
        setShowModal(true);
    };
    const handleFecharModal = () => {
        setShowModal(false);
        setFornecedorSelecionado(null);
        setProdutosSelecionados([]);
    };
    // Função para agregar todos os produtos com todos os fornecedores
    const aggregateAllProducts = () => {
        const productMap = new Map();
        notas.forEach(nota => {
            if (nota.itens) {
                nota.itens.forEach(item => {
                    const chave = `${item.codigo_produto}|${item.descricao}`;
                    const existing = productMap.get(chave);
                    if (existing) {
                        // Procura fornecedor existente ou adiciona novo
                        const supplierIdx = existing.fornecedores.findIndex(f => f.nome === nota.fornecedor);
                        if (supplierIdx >= 0) {
                            existing.fornecedores[supplierIdx].frequencia += 1;
                        }
                        else {
                            existing.fornecedores.push({
                                nome: nota.fornecedor,
                                preco_unitario: item.preco_unitario,
                                frequencia: 1,
                                olist_sku: item.olist_sku || undefined,
                                olist_nome: item.olist_nome || undefined
                            });
                        }
                    }
                    else {
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
                        });
                    }
                });
            }
        });
        // Ordena fornecedores por preço para cada produto
        productMap.forEach(product => {
            product.fornecedores.sort((a, b) => a.preco_unitario - b.preco_unitario);
        });
        return productMap;
    };
    // Função para buscar produtos por termo
    const handleBusca = (termo) => {
        setTermoBusca(termo);
        if (termo.trim() === '') {
            setResultadosBusca([]);
            return;
        }
        const allProducts = aggregateAllProducts();
        const termoLower = termo.toLowerCase();
        const resultados = Array.from(allProducts.values())
            .filter(p => p.codigo_produto.toLowerCase().includes(termoLower) ||
            p.descricao.toLowerCase().includes(termoLower) ||
            p.fornecedores.some(f => f.olist_sku?.toLowerCase().includes(termoLower) || f.olist_nome?.toLowerCase().includes(termoLower)))
            .sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto));
        setResultadosBusca(resultados);
    };
    const getNomeExibicao = (nomeFornecedor) => {
        return nomesFornecedores[nomeFornecedor] || nomeFornecedor;
    };
    if (carregando) {
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "NVS TECH" }), _jsx("p", { children: "Sistema de Gest\u00E3o Inteligente de Estoque para Opera\u00E7\u00F5es de Log\u00EDstica e Marketplace" })] }) }), _jsx("main", { className: "container main-content", children: _jsx("p", { style: { textAlign: 'center', color: '#999', padding: '2rem' }, children: "Carregando fornecedores..." }) })] }));
    }
    return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "NVS TECH" }), _jsx("p", { children: "Sistema de Gest\u00E3o Inteligente de Estoque para Opera\u00E7\u00F5es de Log\u00EDstica e Marketplace" })] }) }), _jsxs("main", { className: "container main-content", children: [_jsx("button", { onClick: onVoltar, style: {
                            marginBottom: '2rem',
                            padding: '0.75rem 1.5rem',
                            background: '#f0f0f0',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '0.95rem'
                        }, children: "\u2190 Voltar" }), _jsxs("div", { style: { display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '2px solid #e0e0e0', paddingBottom: '0' }, children: [_jsx("button", { onClick: () => { setView('suppliers'); setTermoBusca(''); setResultadosBusca([]); }, style: {
                                    padding: '1rem 1.5rem',
                                    background: view === 'suppliers' ? '#007acc' : 'transparent',
                                    color: view === 'suppliers' ? 'white' : '#333',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.95rem',
                                    borderBottom: view === 'suppliers' ? '3px solid #005a96' : 'none'
                                }, children: "Fornecedores" }), _jsx("button", { onClick: () => setView('search'), style: {
                                    padding: '1rem 1.5rem',
                                    background: view === 'search' ? '#007acc' : 'transparent',
                                    color: view === 'search' ? 'white' : '#333',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.95rem',
                                    borderBottom: view === 'search' ? '3px solid #005a96' : 'none'
                                }, children: "Busca de Produtos" })] }), view === 'suppliers' && (_jsxs("div", { className: "card", children: [_jsx("h2", { style: { marginTop: 0 }, children: "Fornecedores" }), _jsx("p", { style: { color: '#666', marginBottom: '1.5rem' }, children: "Selecione um fornecedor para ver seus produtos" }), fornecedores.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Nenhum fornecedor encontrado. Fa\u00E7a o upload de notas fiscais primeiro." })) : (_jsx("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                                    gap: '1rem'
                                }, children: fornecedores.map((fornecedor) => (_jsx("div", { style: {
                                        padding: '1.5rem',
                                        border: '1px solid #ddd',
                                        borderRadius: '8px',
                                        background: '#fafafa',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                                    }, onMouseEnter: (e) => {
                                        const el = e.currentTarget;
                                        el.style.background = '#f0f8ff';
                                        el.style.borderColor = '#007acc';
                                        el.style.boxShadow = '0 4px 12px rgba(0, 122, 204, 0.15)';
                                    }, onMouseLeave: (e) => {
                                        const el = e.currentTarget;
                                        el.style.background = '#fafafa';
                                        el.style.borderColor = '#ddd';
                                        el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
                                    }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }, children: [_jsxs("div", { style: { flex: 1, cursor: 'pointer' }, onClick: () => handleFornecedorClick(fornecedor.nome), children: [_jsx("div", { style: { fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem', color: '#1a1a1a' }, children: getNomeExibicao(fornecedor.nome) }), _jsxs("div", { style: { fontSize: '0.9rem', color: '#666' }, children: [fornecedor.quantidadeProdutos, " produto", fornecedor.quantidadeProdutos !== 1 ? 's' : ''] })] }), _jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    setFornecedorParaEditar(fornecedor.nome);
                                                    setNovoNome(nomesFornecedores[fornecedor.nome] || '');
                                                    setShowModalNome(true);
                                                }, style: {
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontSize: '1.2rem',
                                                    padding: '0.25rem',
                                                    color: '#999',
                                                    transition: 'color 0.2s'
                                                }, onMouseEnter: (e) => (e.currentTarget.style.color = '#007acc'), onMouseLeave: (e) => (e.currentTarget.style.color = '#999'), title: "Editar nome", children: "\u270F\uFE0F" })] }) }, fornecedor.nome))) }))] })), view === 'search' && (_jsxs("div", { className: "card", children: [_jsx("h2", { style: { marginTop: 0 }, children: "Busca de Produtos" }), _jsx("p", { style: { color: '#666', marginBottom: '1.5rem' }, children: "Busque por c\u00F3digo, descri\u00E7\u00E3o ou SKU Olist para encontrar o produto e comparar pre\u00E7os entre fornecedores" }), _jsx("input", { type: "text", placeholder: "Digite c\u00F3digo, descri\u00E7\u00E3o ou SKU...", value: termoBusca, onChange: (e) => handleBusca(e.target.value), style: {
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    border: '1px solid #cfd8dc',
                                    borderRadius: '6px',
                                    fontSize: '0.95rem',
                                    marginBottom: '1.5rem',
                                    boxSizing: 'border-box'
                                } }), termoBusca.trim() === '' ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Digite um produto para buscar" })) : resultadosBusca.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Nenhum produto encontrado" })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem' }, children: resultadosBusca.map((produto, idx) => (_jsxs("div", { style: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { padding: '1rem', background: '#f7f9fa', borderBottom: '1px solid #e0e0e0' }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '1rem', color: '#1a1a1a', marginBottom: '0.25rem' }, children: produto.codigo_produto }), _jsx("div", { style: { fontSize: '0.9rem', color: '#666' }, children: produto.descricao })] }), _jsx("div", { style: { padding: '1rem' }, children: produto.fornecedores.map((fornecedor, fIdx) => (_jsxs("div", { style: {
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    padding: '0.75rem',
                                                    borderBottom: fIdx < produto.fornecedores.length - 1 ? '1px solid #f0f0f0' : 'none',
                                                    backgroundColor: fIdx % 2 === 0 ? '#ffffff' : '#fafafa'
                                                }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 600, color: '#1a1a1a', marginBottom: '0.25rem' }, children: getNomeExibicao(fornecedor.nome) }), _jsxs("div", { style: { fontSize: '0.85rem', color: '#666' }, children: [fornecedor.frequencia, "x comprado", fornecedor.frequencia !== 1 ? 's' : ''] })] }), _jsxs("div", { style: { textAlign: 'right', minWidth: '150px' }, children: [_jsxs("div", { style: { fontWeight: 700, fontSize: '1.1rem', color: '#28a745', marginBottom: '0.25rem' }, children: ["R$ ", fornecedor.preco_unitario.toFixed(2)] }), fornecedor.olist_sku && (_jsxs("div", { style: { fontSize: '0.8rem', color: '#28a745' }, children: ["SKU: ", fornecedor.olist_sku] }))] })] }, fIdx))) })] }, idx))) }))] }))] }), showModal && (_jsx("div", { style: {
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
                }, onClick: handleFecharModal, children: _jsxs("div", { style: {
                        background: 'white',
                        borderRadius: '8px',
                        maxWidth: '700px',
                        width: '90%',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
                    }, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { style: {
                                padding: '1.5rem',
                                borderBottom: '1px solid #e0e0e0',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                background: '#f7f9fa'
                            }, children: [_jsxs("h3", { style: { margin: 0, color: '#1a1a1a' }, children: [getNomeExibicao(fornecedorSelecionado || ''), " - Produtos"] }), _jsx("button", { onClick: handleFecharModal, style: {
                                        background: 'none',
                                        border: 'none',
                                        fontSize: '1.5rem',
                                        cursor: 'pointer',
                                        color: '#999'
                                    }, children: "\u00D7" })] }), _jsx("div", { style: { padding: '1.5rem' }, children: produtosSelecionados.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center' }, children: "Nenhum produto encontrado" })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: produtosSelecionados.map((produto, idx) => (_jsx("div", { style: {
                                        padding: '1rem',
                                        border: '1px solid #e0e0e0',
                                        borderRadius: '6px',
                                        background: '#f9f9f9'
                                    }, children: _jsx("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }, children: _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 600, color: '#1a1a1a', marginBottom: '0.25rem' }, children: produto.codigo_produto }), _jsx("div", { style: { fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }, children: produto.descricao }), _jsxs("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { style: {
                                                                display: 'inline-block',
                                                                padding: '0.25rem 0.75rem',
                                                                background: '#e0e0e0',
                                                                borderRadius: '4px',
                                                                fontSize: '0.85rem',
                                                            }, children: ["Comprado ", produto.frequencia, "x"] }), produto.olist_sku && (_jsxs("div", { style: { display: 'inline-block', padding: '0.25rem 0.75rem', background: '#c8e6c9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' }, children: ["\u2705 ", produto.olist_sku] }))] })] }) }) }, idx))) })) }), _jsx("div", { style: {
                                padding: '1rem 1.5rem',
                                borderTop: '1px solid #e0e0e0',
                                background: '#f7f9fa',
                                textAlign: 'right'
                            }, children: _jsx("button", { onClick: handleFecharModal, style: {
                                    padding: '0.75rem 1.5rem',
                                    background: '#f0f0f0',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                }, children: "Voltar" }) })] }) })), showModalNome && (_jsx("div", { style: {
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
                }, onClick: () => {
                    setShowModalNome(false);
                    setFornecedorParaEditar(null);
                    setNovoNome('');
                }, children: _jsxs("div", { style: {
                        background: 'white',
                        borderRadius: '8px',
                        maxWidth: '500px',
                        width: '90%',
                        padding: '2rem',
                        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
                    }, onClick: (e) => e.stopPropagation(), children: [_jsx("h3", { style: { margin: '0 0 1rem 0', color: '#1a1a1a' }, children: "Editar Nome do Fornecedor" }), _jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("label", { style: { display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }, children: "Nome Oficial:" }), _jsx("div", { style: { padding: '0.75rem', background: '#f5f5f5', borderRadius: '4px', color: '#999' }, children: fornecedorParaEditar })] }), _jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("label", { style: { display: 'block', marginBottom: '0.5rem', color: '#666', fontWeight: 600 }, children: "Nome Customizado:" }), _jsx("input", { type: "text", value: novoNome, onChange: (e) => setNovoNome(e.target.value), placeholder: "Ex: Augusto, Cordoaria, etc...", style: {
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid #cfd8dc',
                                        borderRadius: '6px',
                                        fontSize: '0.95rem',
                                        boxSizing: 'border-box'
                                    } })] }), _jsxs("div", { style: { display: 'flex', gap: '1rem', justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: () => {
                                        setShowModalNome(false);
                                        setFornecedorParaEditar(null);
                                        setNovoNome('');
                                    }, style: {
                                        padding: '0.75rem 1.5rem',
                                        background: '#f0f0f0',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        fontSize: '0.95rem'
                                    }, children: "Cancelar" }), _jsx("button", { onClick: () => {
                                        if (fornecedorParaEditar && novoNome.trim()) {
                                            setNomesFornecedores(prev => ({
                                                ...prev,
                                                [fornecedorParaEditar]: novoNome.trim()
                                            }));
                                        }
                                        setShowModalNome(false);
                                        setFornecedorParaEditar(null);
                                        setNovoNome('');
                                    }, style: {
                                        padding: '0.75rem 1.5rem',
                                        background: '#007acc',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        fontSize: '0.95rem'
                                    }, children: "Salvar" })] })] }) }))] }));
}
export default FornecedoresManager;
