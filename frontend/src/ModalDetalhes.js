import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import './ModalDetalhes.css';
export function ModalDetalhes({ isOpen, onClose, produto, onConfirm, }) {
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(produto.quantidade_total);
    const [temDivergencia, setTemDivergencia] = useState(false);
    const [divergencia, setDivergencia] = useState('');
    const [observacoes, setObservacoes] = useState('');
    const [historico, setHistorico] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('success');
    useEffect(() => {
        if (isOpen) {
            loadHistorico();
        }
    }, [isOpen, produto.id_item]);
    const loadHistorico = async () => {
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/historico-confirmacao/${produto.id_item}`);
            const data = await res.json();
            setHistorico(data.historico || []);
        }
        catch (err) {
            console.error('Erro ao carregar histórico:', err);
        }
    };
    const handleConfirmar = async () => {
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('http://127.0.0.1:8000/api/confirmar-estoque', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    item_id: produto.id_item,
                    quantidade_confirmada: parseFloat(quantidadeConfirmada.toString()),
                    divergencia: temDivergencia ? divergencia : null,
                    observacoes: observacoes,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessageType('success');
                setMessage('Confirmação registrada com sucesso!');
                setQuantidadeConfirmada(produto.quantidade_total);
                setDivergencia('');
                setObservacoes('');
                setTemDivergencia(false);
                setTimeout(() => {
                    loadHistorico();
                    if (onConfirm)
                        onConfirm();
                }, 1000);
            }
            else {
                setMessageType('error');
                setMessage(`Erro: ${data.error}`);
            }
        }
        catch (err) {
            setMessageType('error');
            setMessage(`Erro: ${err}`);
        }
        finally {
            setLoading(false);
        }
    };
    if (!isOpen)
        return null;
    const divergenciaValor = produto.quantidade_total - quantidadeConfirmada;
    return (_jsx("div", { className: "modal-overlay", onClick: onClose, children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "Detalhes do Produto" }), _jsx("button", { className: "modal-close", onClick: onClose, children: "\u00D7" })] }), _jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "product-info", children: [_jsx("h3", { children: "Informa\u00E7\u00F5es do Produto" }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Produto:" }), _jsx("span", { className: "info-value", children: produto.descricao })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "C\u00F3digo:" }), _jsx("span", { className: "info-value", children: produto.codigo_produto })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Quantidade:" }), _jsxs("span", { className: "info-value", children: [produto.quantidade_total.toFixed(2), " unidades"] })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Pre\u00E7o Unit.:" }), _jsxs("span", { className: "info-value", children: ["R$ ", produto.preco_unitario.toFixed(2)] })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Valor Total:" }), _jsxs("span", { className: "info-value", children: ["R$ ", (produto.quantidade_total * produto.preco_unitario).toFixed(2)] })] }), _jsxs("div", { style: { marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #1e40af' }, children: [_jsx("h4", { style: { color: '#93c5fd', margin: '0 0 0.75rem 0', fontSize: '0.9rem' }, children: "Notas Fiscais" }), _jsx("div", { className: "nf-list", children: produto.notas_fiscais.map((nf, idx) => (_jsxs("div", { className: "nf-badge", children: [_jsxs("strong", { children: ["NF ", nf.numero_nf] }), " - ", nf.fornecedor, " (", nf.quantidade.toFixed(2), " un)"] }, idx))) })] })] }), message && (_jsx("div", { className: messageType === 'success' ? 'success-message' : 'error-message', children: message })), _jsxs("div", { className: "confirmation-section", children: [_jsx("h3", { children: "Confirmar Recebimento" }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Quantidade Recebida (un)" }), _jsx("input", { type: "number", className: "form-input", value: quantidadeConfirmada, onChange: (e) => setQuantidadeConfirmada(parseFloat(e.target.value) || 0), step: "0.01" })] }), divergenciaValor !== 0 && (_jsxs("div", { style: {
                                        background: 'rgba(239, 68, 68, 0.2)',
                                        border: '1px solid #ef4444',
                                        padding: '0.75rem',
                                        borderRadius: '6px',
                                        marginBottom: '1rem',
                                        color: '#fecaca',
                                    }, children: ["\u26A0\uFE0F ", _jsx("strong", { children: "Diverg\u00EAncia:" }), " ", Math.abs(divergenciaValor).toFixed(2), " unidades"] })), _jsx("div", { className: "form-group", children: _jsx("div", { className: "checkbox-group", children: _jsxs("div", { className: "checkbox-item", children: [_jsx("input", { type: "checkbox", id: "temDivergencia", checked: temDivergencia, onChange: (e) => setTemDivergencia(e.target.checked) }), _jsx("label", { htmlFor: "temDivergencia", children: "Registrar diverg\u00EAncia" })] }) }) }), temDivergencia && (_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Tipo de Diverg\u00EAncia" }), _jsxs("select", { className: "form-select", value: divergencia, onChange: (e) => setDivergencia(e.target.value), children: [_jsx("option", { value: "", children: "Selecione..." }), _jsx("option", { value: "Quantidade Inferior", children: "Quantidade Inferior (Recebido menos)" }), _jsx("option", { value: "Quantidade Superior", children: "Quantidade Superior (Recebido mais)" }), _jsx("option", { value: "Produto Defeituoso", children: "Produto Defeituoso" }), _jsx("option", { value: "Produto Errado", children: "Produto Errado" }), _jsx("option", { value: "Dano no Transporte", children: "Dano no Transporte" }), _jsx("option", { value: "Outro", children: "Outro" })] })] })), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Observa\u00E7\u00F5es (opcional)" }), _jsx("textarea", { className: "form-input", value: observacoes, onChange: (e) => setObservacoes(e.target.value), placeholder: "Digite aqui qualquer observa\u00E7\u00E3o adicional...", rows: 3, style: { resize: 'vertical' } })] })] }), _jsxs("div", { className: "olist-section", children: [_jsx("h3", { children: "Vincular a An\u00FAncio Olist" }), _jsx("div", { className: "olist-info", children: "Ap\u00F3s confirmar o recebimento, voc\u00EA poder\u00E1 vincular este produto a um an\u00FAncio na Olist." }), _jsx("button", { className: "btn btn-secondary", style: { width: '100%' }, children: "+ Criar/Vincular An\u00FAncio Olist" })] }), historico.length > 0 && (_jsxs("div", { className: "historico-section", children: [_jsx("h3", { children: "Hist\u00F3rico de Confirma\u00E7\u00F5es" }), historico.map((item) => (_jsxs("div", { className: "historico-item", children: [_jsx("p", { className: "historico-date", children: new Date(item.data_confirmacao).toLocaleString('pt-BR') }), _jsxs("p", { className: "historico-qty", children: ["Confirmado: ", _jsxs("strong", { children: [item.quantidade_confirmada.toFixed(2), " un"] })] }), item.divergencia && (_jsxs("p", { className: "historico-divergencia", children: ["Diverg\u00EAncia: ", item.divergencia] })), item.observacoes && (_jsx("p", { style: { color: '#999', fontSize: '0.8rem' }, children: item.observacoes }))] }, item.id)))] })), _jsxs("div", { className: "button-group", children: [_jsx("button", { className: "btn btn-secondary", onClick: onClose, children: "Cancelar" }), _jsx("button", { className: "btn btn-primary", onClick: handleConfirmar, disabled: loading, children: loading ? 'Processando...' : 'Confirmar' })] })] })] }) }));
}
