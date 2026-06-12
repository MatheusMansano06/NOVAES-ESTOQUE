import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import api from '../services/api';
export const NotificacoesFornecedores = () => {
    const [notificacoes, setNotificacoes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    useEffect(() => {
        carregarNotificacoes();
    }, []);
    const carregarNotificacoes = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.get('/historico-notificacoes', {
                params: { skip: 0, limit: 100 }
            });
            setNotificacoes(response.data.notificacoes);
        }
        catch (err) {
            setError('Erro ao carregar notificações: ' + (err.response?.data?.error || 'Desconhecido'));
        }
        finally {
            setLoading(false);
        }
    };
    const handleNotificarAgora = async () => {
        setEnviando(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const response = await api.post('/notificar-fornecedores', {});
            if (response.data.notificacoes_enviadas > 0) {
                setSuccessMessage(`✓ ${response.data.notificacoes_enviadas} notificação(ões) registrada(s) e pronta(s) para enviar!`);
            }
            else {
                setSuccessMessage('✓ Verificação concluída. Nenhum produto com estoque baixo no momento.');
            }
            // Recarregar histórico
            await carregarNotificacoes();
        }
        catch (err) {
            setError('Erro ao notificar fornecedores: ' + (err.response?.data?.error || 'Desconhecido'));
        }
        finally {
            setEnviando(false);
        }
    };
    return (_jsxs("div", { style: { padding: '20px' }, children: [_jsxs("div", { style: { marginBottom: '20px' }, children: [_jsx("h2", { children: "\uD83D\uDCF2 Notifica\u00E7\u00F5es de Fornecedores" }), _jsx("p", { style: { color: '#666', marginBottom: '15px' }, children: "Gest\u00E3o de notifica\u00E7\u00F5es autom\u00E1ticas de estoque baixo via WhatsApp. Notifica\u00E7\u00F5es s\u00E3o enviadas automaticamente todos os dias \u00E0s 08:00." }), _jsx("button", { onClick: handleNotificarAgora, disabled: enviando || loading, style: {
                            padding: '12px 24px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: enviando ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            opacity: enviando || loading ? 0.6 : 1
                        }, children: enviando ? '⏳ Notificando...' : '🔔 Notificar Fornecedores Agora' })] }), error && (_jsx("div", { style: {
                    padding: '12px',
                    backgroundColor: '#ffebee',
                    color: '#c62828',
                    borderRadius: '4px',
                    marginBottom: '20px'
                }, children: error })), successMessage && (_jsx("div", { style: {
                    padding: '12px',
                    backgroundColor: '#e8f5e9',
                    color: '#2e7d32',
                    borderRadius: '4px',
                    marginBottom: '20px'
                }, children: successMessage })), _jsx("h3", { style: { marginTop: '30px', marginBottom: '15px' }, children: "Hist\u00F3rico de Notifica\u00E7\u00F5es" }), loading ? (_jsx("div", { style: { textAlign: 'center', padding: '40px', color: '#666' }, children: "Carregando hist\u00F3rico..." })) : notificacoes.length === 0 ? (_jsx("div", { style: { textAlign: 'center', padding: '40px', color: '#999' }, children: "Nenhuma notifica\u00E7\u00E3o registrada ainda." })) : (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: {
                        width: '100%',
                        borderCollapse: 'collapse',
                        backgroundColor: 'white',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }, children: [_jsx("thead", { children: _jsxs("tr", { style: { backgroundColor: '#f0f0f0', borderBottom: '2px solid #ddd' }, children: [_jsx("th", { style: { padding: '12px', textAlign: 'left' }, children: "Data/Hora" }), _jsx("th", { style: { padding: '12px', textAlign: 'left' }, children: "Fornecedor" }), _jsx("th", { style: { padding: '12px', textAlign: 'left' }, children: "Produto" }), _jsx("th", { style: { padding: '12px', textAlign: 'center' }, children: "Estoque" }), _jsx("th", { style: { padding: '12px', textAlign: 'left' }, children: "WhatsApp" }), _jsx("th", { style: { padding: '12px', textAlign: 'center' }, children: "Status" })] }) }), _jsx("tbody", { children: notificacoes.map(n => (_jsxs("tr", { style: {
                                    borderBottom: '1px solid #eee',
                                }, children: [_jsx("td", { style: { padding: '12px' }, children: new Date(n.enviado_em).toLocaleString('pt-BR') }), _jsx("td", { style: { padding: '12px' }, children: _jsx("strong", { children: n.fornecedor_nome }) }), _jsxs("td", { style: { padding: '12px' }, children: [_jsx("div", { children: n.produto_descricao }), _jsxs("div", { style: { fontSize: '12px', color: '#999' }, children: ["C\u00F3digo: ", n.produto_codigo] })] }), _jsx("td", { style: { padding: '12px', textAlign: 'center' }, children: _jsx("div", { children: _jsxs("span", { style: {
                                                    padding: '4px 8px',
                                                    backgroundColor: '#ffebee',
                                                    color: '#c62828',
                                                    borderRadius: '4px',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold'
                                                }, children: [n.quantidade_atual, " / ", n.estoque_minimo] }) }) }), _jsx("td", { style: { padding: '12px' }, children: _jsxs("a", { href: `https://wa.me/${n.telefone_usado}`, target: "_blank", rel: "noreferrer", style: {
                                                color: '#25D366',
                                                textDecoration: 'none',
                                                fontWeight: 'bold'
                                            }, children: ["\uD83D\uDCAC ", n.telefone_usado] }) }), _jsx("td", { style: { padding: '12px', textAlign: 'center' }, children: _jsx("span", { style: {
                                                padding: '4px 8px',
                                                backgroundColor: n.status === 'enviado' ? '#c8e6c9' : '#ffe0b2',
                                                color: n.status === 'enviado' ? '#2e7d32' : '#e65100',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                fontWeight: 'bold'
                                            }, children: n.status === 'enviado' ? '✓ Enviada' : '⚠ ' + n.status }) })] }, n.id))) })] }) }))] }));
};
