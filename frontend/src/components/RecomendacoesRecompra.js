import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import ModalRecomendacaoDetalhes from './ModalRecomendacaoDetalhes';
const RecomendacoesRecompra = ({ onVoltar }) => {
    const [recomendacoes, setRecomendacoes] = useState([]);
    const [filtroUrgencia, setFiltroUrgencia] = useState('todos');
    const [carregando, setCarregando] = useState(true);
    const [atualizando, setAtualizando] = useState(false);
    const [erro, setErro] = useState(null);
    const [selecionada, setSelecionada] = useState(null);
    const [modalAberto, setModalAberto] = useState(false);
    // Carregar recomendações ao montar
    useEffect(() => {
        loadRecomendacoes();
    }, [filtroUrgencia]);
    const loadRecomendacoes = async () => {
        try {
            setCarregando(true);
            setErro(null);
            const params = new URLSearchParams();
            if (filtroUrgencia !== 'todos') {
                params.append('filtro', filtroUrgencia);
            }
            const response = await fetch(`http://127.0.0.1:8000/api/recomendacoes?${params}`);
            if (!response.ok) {
                throw new Error('Erro ao carregar recomendações');
            }
            const data = await response.json();
            setRecomendacoes(data.recomendacoes || []);
        }
        catch (err) {
            setErro(err instanceof Error ? err.message : 'Erro desconhecido');
        }
        finally {
            setCarregando(false);
        }
    };
    const atualizarRecomendacoes = async () => {
        try {
            setAtualizando(true);
            const response = await fetch('http://127.0.0.1:8000/api/recomendacoes/gerar', {
                method: 'POST'
            });
            if (!response.ok) {
                throw new Error('Erro ao atualizar recomendações');
            }
            await loadRecomendacoes();
            alert('✅ Recomendações atualizadas com sucesso!');
        }
        catch (err) {
            alert('❌ Erro ao atualizar: ' + (err instanceof Error ? err.message : 'desconhecido'));
        }
        finally {
            setAtualizando(false);
        }
    };
    const abrirDetalhes = (recomendacao) => {
        setSelecionada(recomendacao);
        setModalAberto(true);
    };
    const fecharModal = () => {
        setModalAberto(false);
        setSelecionada(null);
    };
    const handleCompraConfirmada = () => {
        fecharModal();
        loadRecomendacoes();
    };
    // Agrupar por urgência
    const recomendacoesPorUrgencia = {
        critico: recomendacoes.filter(r => r.urgencia === 'critico'),
        moderado: recomendacoes.filter(r => r.urgencia === 'moderado'),
        ok: recomendacoes.filter(r => r.urgencia === 'ok')
    };
    const renderizarCard = (rec) => {
        const borderColor = {
            critico: '#f44336',
            moderado: '#ff9800',
            ok: '#4caf50'
        }[rec.urgencia];
        const backgroundColor = {
            critico: '#ffebee',
            moderado: '#fff3e0',
            ok: '#e8f5e9'
        }[rec.urgencia];
        return (_jsxs("div", { style: {
                borderLeft: `4px solid ${borderColor}`,
                backgroundColor: backgroundColor,
                padding: '1rem',
                marginBottom: '1rem',
                borderRadius: '4px',
                border: `1px solid ${borderColor}20`
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("h4", { style: { margin: '0 0 0.5rem 0', color: '#1a1a1a' }, children: rec.nome_produto }), _jsxs("div", { style: { fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }, children: ["Estoque: ", _jsxs("strong", { children: [rec.estoque_atual, " un"] }), " | Vende:", ' ', _jsxs("strong", { children: [rec.frequencia_venda_diaria.toFixed(1), "/dia"] }), " | Falta em:", ' ', _jsxs("strong", { children: [rec.dias_ate_faltar.toFixed(1), "d"] })] }), _jsxs("div", { style: { fontSize: '0.9rem', color: '#666', marginBottom: '0.8rem' }, children: [_jsx("strong", { children: "Recomenda\u00E7\u00E3o:" }), " Compre ", rec.quantidade_recomendada, " unidades"] }), _jsxs("div", { style: {
                                        backgroundColor: '#fff',
                                        padding: '0.75rem',
                                        borderRadius: '4px',
                                        marginBottom: '0.8rem',
                                        fontSize: '0.85rem'
                                    }, children: [_jsxs("div", { style: { fontWeight: 'bold', color: '#28a745', marginBottom: '0.3rem' }, children: ["\u2705 ", rec.fornecedor_recomendado, " @ R$ ", rec.preco_unitario.toFixed(2), "/un = R$", ' ', rec.custo_total.toFixed(2)] }), _jsx("div", { style: { color: '#999' }, children: rec.motivo })] })] }), _jsx("div", { style: {
                                textAlign: 'center',
                                marginLeft: '1rem',
                                minWidth: '80px'
                            }, children: _jsxs("div", { style: {
                                    backgroundColor: borderColor,
                                    color: '#fff',
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: '999px',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    marginBottom: '0.5rem'
                                }, children: [rec.urgencia === 'critico' && '🔴 CRÍTICO', rec.urgencia === 'moderado' && '🟡 MODERADO', rec.urgencia === 'ok' && '🟢 OK'] }) })] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-start' }, children: [_jsx("button", { onClick: () => abrirDetalhes(rec), style: {
                                padding: '0.4rem 0.8rem',
                                backgroundColor: '#007acc',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem'
                            }, children: "Ver Detalhes" }), _jsx("button", { onClick: () => abrirDetalhes(rec), style: {
                                padding: '0.4rem 0.8rem',
                                backgroundColor: '#28a745',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem'
                            }, children: "Comprar Agora \u25B6" })] })] }, rec.id));
    };
    return (_jsxs("div", { style: { padding: '2rem', backgroundColor: '#f5f5f5', minHeight: '100vh' }, children: [_jsxs("div", { style: { maxWidth: '1200px', margin: '0 auto' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }, children: [_jsxs("div", { children: [_jsx("button", { onClick: onVoltar, style: {
                                            padding: '0.5rem 1rem',
                                            backgroundColor: '#fff',
                                            color: '#333',
                                            border: '1px solid #ddd',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            marginRight: '1rem'
                                        }, children: "\u2190 Voltar" }), _jsx("h1", { style: { display: 'inline-block', margin: '0' }, children: "\uD83D\uDED2 RECOMENDA\u00C7\u00D5ES DE RECOMPRA" })] }), _jsx("button", { onClick: atualizarRecomendacoes, disabled: atualizando, style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: atualizando ? '#ccc' : '#007acc',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: atualizando ? 'not-allowed' : 'pointer'
                                }, children: atualizando ? '⏳ Atualizando...' : '🔄 Atualizar Agora' })] }), _jsxs("div", { style: { marginBottom: '2rem', display: 'flex', gap: '0.5rem' }, children: [_jsxs("button", { onClick: () => setFiltroUrgencia('todos'), style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: filtroUrgencia === 'todos' ? '#007acc' : '#fff',
                                    color: filtroUrgencia === 'todos' ? '#fff' : '#333',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }, children: ["Todos (", recomendacoes.length, ")"] }), _jsxs("button", { onClick: () => setFiltroUrgencia('critico'), style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: filtroUrgencia === 'critico' ? '#f44336' : '#fff',
                                    color: filtroUrgencia === 'critico' ? '#fff' : '#333',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }, children: ["\uD83D\uDD34 Cr\u00EDtico (", recomendacoesPorUrgencia.critico.length, ")"] }), _jsxs("button", { onClick: () => setFiltroUrgencia('moderado'), style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: filtroUrgencia === 'moderado' ? '#ff9800' : '#fff',
                                    color: filtroUrgencia === 'moderado' ? '#fff' : '#333',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }, children: ["\uD83D\uDFE1 Moderado (", recomendacoesPorUrgencia.moderado.length, ")"] }), _jsxs("button", { onClick: () => setFiltroUrgencia('ok'), style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: filtroUrgencia === 'ok' ? '#4caf50' : '#fff',
                                    color: filtroUrgencia === 'ok' ? '#fff' : '#333',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }, children: ["\uD83D\uDFE2 Ok (", recomendacoesPorUrgencia.ok.length, ")"] })] }), erro && (_jsxs("div", { style: {
                            backgroundColor: '#ffebee',
                            color: '#c62828',
                            padding: '1rem',
                            borderRadius: '4px',
                            marginBottom: '1rem'
                        }, children: ["\u274C Erro: ", erro] })), carregando ? (_jsx("div", { style: { textAlign: 'center', padding: '2rem' }, children: _jsx("p", { children: "\u23F3 Carregando recomenda\u00E7\u00F5es..." }) })) : filtroUrgencia === 'todos' ? (_jsxs(_Fragment, { children: [recomendacoesPorUrgencia.critico.length > 0 && (_jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsxs("h2", { style: { color: '#f44336', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #f44336' }, children: ["\uD83D\uDD34 CR\u00CDTICO (", recomendacoesPorUrgencia.critico.length, ") - Compre HOJE"] }), recomendacoesPorUrgencia.critico.map(renderizarCard)] })), recomendacoesPorUrgencia.moderado.length > 0 && (_jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsxs("h2", { style: { color: '#ff9800', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #ff9800' }, children: ["\uD83D\uDFE1 MODERADO (", recomendacoesPorUrgencia.moderado.length, ") - Pr\u00F3ximos 5-7 dias"] }), recomendacoesPorUrgencia.moderado.map(renderizarCard)] })), recomendacoesPorUrgencia.ok.length > 0 && (_jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsxs("h2", { style: { color: '#4caf50', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #4caf50' }, children: ["\uD83D\uDFE2 OK (", recomendacoesPorUrgencia.ok.length, ") - Estoque para 15+ dias"] }), recomendacoesPorUrgencia.ok.map(renderizarCard)] })), recomendacoes.length === 0 && (_jsx("div", { style: { textAlign: 'center', padding: '2rem', color: '#999' }, children: _jsx("p", { children: "\uD83D\uDE0A \u00D3timo! Nenhuma recomenda\u00E7\u00E3o urgente no momento. Seu estoque est\u00E1 saud\u00E1vel!" }) }))] })) : recomendacoes.length === 0 ? (_jsx("div", { style: { textAlign: 'center', padding: '2rem', color: '#999' }, children: _jsx("p", { children: "Nenhuma recomenda\u00E7\u00E3o nesta categoria." }) })) : (recomendacoes.map(renderizarCard))] }), selecionada && (_jsx(ModalRecomendacaoDetalhes, { isOpen: modalAberto, onClose: fecharModal, recomendacao: selecionada, onConfirmarCompra: handleCompraConfirmada }))] }));
};
export default RecomendacoesRecompra;
