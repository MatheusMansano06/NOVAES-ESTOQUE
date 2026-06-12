import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
const ModalRecomendacaoDetalhes = ({ isOpen, onClose, recomendacao, onConfirmarCompra }) => {
    const [analiseDetalhada, setAnaliseDetalhada] = useState(null);
    const [carregando, setCarregando] = useState(false);
    const [comprando, setComprando] = useState(false);
    useEffect(() => {
        if (isOpen && recomendacao) {
            loadAnaliseDetalhada();
        }
    }, [isOpen, recomendacao]);
    const loadAnaliseDetalhada = async () => {
        try {
            setCarregando(true);
            const response = await fetch(`http://127.0.0.1:8000/api/recomendacoes/${recomendacao.sku_olist}`);
            if (!response.ok) {
                throw new Error('Erro ao carregar análise');
            }
            const data = await response.json();
            setAnaliseDetalhada(data);
        }
        catch (err) {
            console.error('Erro:', err);
            alert('Erro ao carregar análise detalhada');
        }
        finally {
            setCarregando(false);
        }
    };
    const handleComprarAgora = async () => {
        try {
            setComprando(true);
            const response = await fetch(`http://127.0.0.1:8000/api/recomendacoes/${recomendacao.sku_olist}/confirmar-compra`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quantidade: recomendacao.quantidade_recomendada,
                    fornecedor: recomendacao.fornecedor_recomendado,
                    observacoes: ''
                })
            });
            if (!response.ok) {
                throw new Error('Erro ao confirmar compra');
            }
            alert(`✅ Pedido de ${recomendacao.quantidade_recomendada} unidades registrado!`);
            onConfirmarCompra();
            onClose();
        }
        catch (err) {
            alert('❌ Erro: ' + (err instanceof Error ? err.message : 'desconhecido'));
        }
        finally {
            setComprando(false);
        }
    };
    if (!isOpen)
        return null;
    return (_jsx("div", { style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }, children: _jsxs("div", { style: {
                backgroundColor: '#fff',
                borderRadius: '8px',
                maxWidth: '800px',
                maxHeight: '90vh',
                overflow: 'auto',
                padding: '2rem',
                position: 'relative',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }, children: [_jsx("button", { onClick: onClose, style: {
                        position: 'absolute',
                        top: '1rem',
                        right: '1rem',
                        backgroundColor: 'transparent',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        color: '#666'
                    }, children: "\u2715" }), _jsxs("h2", { style: { marginTop: 0, marginBottom: '1.5rem' }, children: [recomendacao.nome_produto, " - An\u00E1lise Detalhada"] }), carregando ? (_jsx("div", { style: { textAlign: 'center', padding: '2rem' }, children: _jsx("p", { children: "\u23F3 Carregando an\u00E1lise..." }) })) : analiseDetalhada ? (_jsxs(_Fragment, { children: [_jsxs("div", { style: {
                                backgroundColor: '#f9f9f9',
                                padding: '1rem',
                                borderRadius: '4px',
                                marginBottom: '1.5rem'
                            }, children: [_jsx("h3", { style: { marginTop: 0, color: '#007acc' }, children: "\uD83D\uDCC8 AN\u00C1LISE DE DEMANDA" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: [_jsxs("div", { children: [_jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "\u00DAltimos 7 dias:" }), " ", analiseDetalhada.analise_demanda.vendas_ultimos_7_dias, " un"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "\u00DAltimos 30 dias:" }), " ", analiseDetalhada.analise_demanda.vendas_ultimos_30_dias, " un"] })] }), _jsxs("div", { children: [_jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "M\u00E9dia di\u00E1ria:" }), " ", analiseDetalhada.analise_demanda.media_diaria.toFixed(2), " un/dia"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Previs\u00E3o pr\u00F3ximos 7 dias:" }), ' ', analiseDetalhada.analise_demanda.previsao_proximos_7_dias, " un"] })] })] }), _jsxs("p", { style: { margin: '0.5rem 0 0 0', color: '#666' }, children: [_jsx("strong", { children: "Tend\u00EAncia:" }), " ", analiseDetalhada.analise_demanda.tendencia, ' ', analiseDetalhada.analise_demanda.crescimento_semana_anterior > 0
                                            ? `(crescimento ${analiseDetalhada.analise_demanda.crescimento_semana_anterior.toFixed(1)}%)`
                                            : ''] })] }), _jsxs("div", { style: {
                                backgroundColor: '#f9f9f9',
                                padding: '1rem',
                                borderRadius: '4px',
                                marginBottom: '1.5rem'
                            }, children: [_jsx("h3", { style: { marginTop: 0, color: '#007acc' }, children: "\uD83D\uDCE6 ESTOQUE ATUAL" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: [_jsxs("div", { children: [_jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Quantidade:" }), " ", analiseDetalhada.estoque_atual.quantidade, " unidades"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Cobertura:" }), " ", analiseDetalhada.estoque_atual.cobertura_dias.toFixed(1), " dias"] })] }), _jsxs("div", { children: [_jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Valor total (custo):" }), " R$", ' ', analiseDetalhada.estoque_atual.valor_total_custo.toFixed(2)] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Status:" }), ' ', _jsxs("span", { style: {
                                                                backgroundColor: analiseDetalhada.estoque_atual.status === 'critico'
                                                                    ? '#ffcdd2'
                                                                    : '#fff9c4',
                                                                padding: '0.2rem 0.5rem',
                                                                borderRadius: '3px'
                                                            }, children: [analiseDetalhada.estoque_atual.status === 'critico' && '🔴 CRÍTICO', analiseDetalhada.estoque_atual.status === 'moderado' && '🟡 MODERADO', analiseDetalhada.estoque_atual.status === 'ok' && '🟢 OK'] })] })] })] })] }), _jsxs("div", { style: {
                                backgroundColor: '#f9f9f9',
                                padding: '1rem',
                                borderRadius: '4px',
                                marginBottom: '1.5rem'
                            }, children: [_jsx("h3", { style: { marginTop: 0, color: '#007acc' }, children: "\uD83C\uDFEA FORNECEDORES DISPON\u00CDVEIS" }), analiseDetalhada.fornecedores.length > 0 && (_jsxs("div", { style: {
                                        backgroundColor: '#e8f5e9',
                                        padding: '1rem',
                                        borderRadius: '4px',
                                        marginBottom: '1rem',
                                        borderLeft: '4px solid #28a745'
                                    }, children: [_jsxs("h4", { style: { margin: '0 0 0.5rem 0', color: '#28a745' }, children: ["\u2705 RECOMENDADO: ", analiseDetalhada.fornecedores[0]?.nome || recomendacao.fornecedor_recomendado] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Pre\u00E7o:" }), " R$ ", recomendacao.preco_unitario.toFixed(2), "/un (melhor!)"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Lead time:" }), " ", analiseDetalhada.fornecedores[0]?.lead_time_dias || 'N/A', " dias"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "Comprado:" }), " ", analiseDetalhada.fornecedores[0]?.frequencia_compra || 0, "x antes (confi\u00E1vel)"] }), analiseDetalhada.fornecedores[0]?.historico_precos && (_jsxs("div", { style: { marginTop: '0.5rem', fontSize: '0.85rem' }, children: [_jsx("strong", { children: "Hist\u00F3rico de pre\u00E7os:" }), analiseDetalhada.fornecedores[0].historico_precos.map((p, idx) => (_jsxs("div", { children: ["\u2022 ", new Date(p.data).toLocaleDateString(), ": R$ ", p.preco.toFixed(2), " (", p.quantidade, " un)"] }, idx))), _jsxs("div", { style: { color: '#666', marginTop: '0.3rem' }, children: ["\u2192 ", analiseDetalhada.fornecedores[0]?.tendencia_preco] })] }))] })), recomendacao.fornecedores_alternativos.map((f, idx) => (_jsxs("div", { style: {
                                        backgroundColor: '#fff3e0',
                                        padding: '0.8rem',
                                        borderRadius: '4px',
                                        marginBottom: '0.8rem',
                                        borderLeft: '4px solid #ff9800'
                                    }, children: [_jsxs("h5", { style: { margin: '0 0 0.3rem 0' }, children: ["ALT ", idx + 1, ": ", f.nome] }), _jsxs("p", { style: { margin: '0.2rem 0' }, children: ["Pre\u00E7o: R$ ", f.preco_unitario.toFixed(2), "/un | Lead time: ", f.lead_time_dias, " dias | Comprado:", ' ', f.frequencia_compra, "x"] }), _jsxs("p", { style: { margin: '0.2rem 0', color: '#d84315', fontSize: '0.85rem' }, children: ["\u274C ", f.motivo_nao_recomendado] })] }, idx)))] }), _jsxs("div", { style: {
                                backgroundColor: '#e3f2fd',
                                padding: '1rem',
                                borderRadius: '4px',
                                borderLeft: '4px solid #007acc'
                            }, children: [_jsx("h3", { style: { marginTop: 0, color: '#007acc' }, children: "\uD83C\uDFAF RECOMENDA\u00C7\u00C3O FINAL" }), analiseDetalhada.recomendacao_final && (_jsx("div", { children: _jsxs("div", { style: {
                                            backgroundColor: '#fff',
                                            padding: '1rem',
                                            borderRadius: '4px',
                                            marginBottom: '1rem'
                                        }, children: [_jsx("p", { style: { margin: '0.3rem 0' }, children: _jsxs("strong", { style: { fontSize: '1.1em' }, children: ["COMPRAR: ", analiseDetalhada.recomendacao_final.comprar_quantidade, " unidades"] }) }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "FORNECEDOR:" }), " ", analiseDetalhada.recomendacao_final.fornecedor] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "PRE\u00C7O:" }), " R$ ", analiseDetalhada.recomendacao_final.preco_unitario.toFixed(2), "/un = R$", ' ', analiseDetalhada.recomendacao_final.custo_total.toFixed(2), " total"] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "PRAZO:" }), " ", analiseDetalhada.recomendacao_final.prazo_entrega_dias, " dias \u2192 Chegar\u00E1 em ", new Date(analiseDetalhada.recomendacao_final.data_chegada_estimada).toLocaleDateString()] }), _jsxs("p", { style: { margin: '0.3rem 0' }, children: [_jsx("strong", { children: "COBERTURA AP\u00D3S COMPRA:" }), " ", analiseDetalhada.recomendacao_final.cobertura_apos_compra, " dias"] })] }) }))] })] })) : (_jsx("div", { style: { textAlign: 'center', color: '#666' }, children: _jsx("p", { children: "N\u00E3o foi poss\u00EDvel carregar a an\u00E1lise detalhada." }) })), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '2rem' }, children: [_jsx("button", { onClick: onClose, style: {
                                padding: '0.5rem 1rem',
                                backgroundColor: '#fff',
                                color: '#333',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }, children: "Voltar" }), _jsx("button", { onClick: handleComprarAgora, disabled: comprando, style: {
                                padding: '0.5rem 1rem',
                                backgroundColor: comprando ? '#ccc' : '#28a745',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: comprando ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold'
                            }, children: comprando ? '⏳ Processando...' : '✅ Comprar Agora' })] })] }) }));
};
export default ModalRecomendacaoDetalhes;
