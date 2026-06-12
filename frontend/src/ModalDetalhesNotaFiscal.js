import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import './ModalDetalhes.css';
export function ModalDetalhesNotaFiscal({ isOpen, onClose, nota, }) {
    if (!isOpen)
        return null;
    const totalValor = nota.itens?.reduce((sum, item) => sum + (item.quantidade_nf * item.preco_unitario), 0) || 0;
    return (_jsx("div", { style: {
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
        }, onClick: onClose, children: _jsxs("div", { style: {
                background: '#ffffff',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                width: '95vw',
                maxWidth: '1200px',
                height: '90vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { style: {
                        background: '#ffffff',
                        borderBottom: '1px solid #e0e0e0',
                        padding: '1.5rem 2rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        position: 'sticky',
                        top: 0,
                        zIndex: 1001
                    }, children: [_jsxs("div", { children: [_jsx("h2", { style: { margin: 0, color: '#1a1a1a', fontSize: '1.5rem', fontWeight: '600' }, children: "NOTA FISCAL ELETR\u00D4NICA" }), _jsxs("p", { style: { margin: '0.5rem 0 0 0', color: '#666', fontSize: '0.95rem' }, children: ["NF #", nota.numero_nf, " - S\u00E9rie ", nota.serie] })] }), _jsx("button", { onClick: onClose, style: {
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
                            }, children: "\u00D7" })] }), _jsxs("div", { style: {
                        flex: 1,
                        overflowY: 'auto',
                        padding: '2rem'
                    }, children: [_jsx("div", { style: {
                                background: '#f9f9f9',
                                border: '2px solid #007acc',
                                padding: '2rem',
                                borderRadius: '8px',
                                marginBottom: '2rem'
                            }, children: _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#007acc', fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }, children: "Fornecedor" }), _jsx("h3", { style: { color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '700', margin: '0 0 1rem 0' }, children: nota.fornecedor }), _jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }, children: "CNPJ" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.95rem' }, children: "N/A (Dados n\u00E3o dispon\u00EDveis)" })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }, children: "ENDERE\u00C7O" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.95rem' }, children: "N/A (Dados n\u00E3o dispon\u00EDveis)" })] })] }), _jsxs("div", { children: [_jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }, children: "DATA DE EMISS\u00C3O" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '600' }, children: nota.data_emissao
                                                            ? new Date(nota.data_emissao).toLocaleDateString('pt-BR', {
                                                                year: 'numeric',
                                                                month: 'long',
                                                                day: 'numeric'
                                                            })
                                                            : 'N/A' })] }), _jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }, children: "STATUS" }), _jsx("p", { style: {
                                                            color: '#155724',
                                                            fontSize: '0.95rem',
                                                            fontWeight: '600',
                                                            display: 'inline-block',
                                                            background: '#f0f9f6',
                                                            padding: '0.5rem 1rem',
                                                            borderRadius: '4px',
                                                            border: '1px solid #c8e6c9'
                                                        }, children: nota.status?.toUpperCase() || 'PROCESSADO' })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.25rem' }, children: "QUANTIDADE DE ITENS" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1.3rem', fontWeight: '700' }, children: nota.itens?.length || 0 })] })] })] }) }), _jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsx("h3", { style: { color: '#1a1a1a', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: '600' }, children: "Produtos" }), nota.itens && nota.itens.length > 0 ? (_jsxs("div", { style: {
                                        borderCollapse: 'collapse',
                                        width: '100%',
                                        border: '1px solid #e0e0e0',
                                        borderRadius: '6px',
                                        overflow: 'hidden'
                                    }, children: [_jsxs("div", { style: {
                                                background: '#007acc',
                                                color: 'white',
                                                display: 'grid',
                                                gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                                                gap: '1rem',
                                                padding: '1rem',
                                                fontWeight: '600',
                                                fontSize: '0.9rem'
                                            }, children: [_jsx("div", { children: "PRODUTO" }), _jsx("div", { style: { textAlign: 'center' }, children: "QTD" }), _jsx("div", { style: { textAlign: 'center' }, children: "VALOR UN." }), _jsx("div", { style: { textAlign: 'center' }, children: "SUBTOTAL" }), _jsx("div", { style: { textAlign: 'right' }, children: "C\u00D3DIGO" })] }), nota.itens.map((item, idx) => (_jsxs("div", { style: {
                                                display: 'grid',
                                                gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr',
                                                gap: '1rem',
                                                padding: '1rem',
                                                borderTop: idx > 0 ? '1px solid #e0e0e0' : 'none',
                                                background: idx % 2 === 0 ? '#ffffff' : '#f9f9f9'
                                            }, children: [_jsx("div", { style: { color: '#1a1a1a', fontWeight: '500' }, children: item.descricao }), _jsx("div", { style: { textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }, children: item.quantidade_nf.toFixed(0) }), _jsxs("div", { style: { textAlign: 'center', color: '#1a1a1a' }, children: ["R$ ", item.preco_unitario.toFixed(2)] }), _jsxs("div", { style: { textAlign: 'center', color: '#007acc', fontWeight: '600' }, children: ["R$ ", (item.quantidade_nf * item.preco_unitario).toFixed(2)] }), _jsx("div", { style: { textAlign: 'right', color: '#666', fontSize: '0.9rem' }, children: item.codigo_produto })] }, item.id)))] })) : (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Nenhum produto" }))] }), _jsxs("div", { style: {
                                background: '#f5f5f5',
                                border: '2px solid #007acc',
                                padding: '1.5rem 2rem',
                                borderRadius: '6px',
                                textAlign: 'right'
                            }, children: [_jsx("p", { style: { color: '#999', fontSize: '0.9rem', marginBottom: '0.5rem' }, children: "VALOR TOTAL DA NOTA" }), _jsxs("p", { style: { color: '#007acc', fontSize: '2rem', fontWeight: '700', margin: 0 }, children: ["R$ ", totalValor.toFixed(2)] })] })] }), _jsx("div", { style: {
                        background: '#f5f5f5',
                        borderTop: '1px solid #e0e0e0',
                        padding: '1rem 2rem',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '1rem'
                    }, children: _jsx("button", { onClick: onClose, style: {
                            padding: '0.75rem 1.5rem',
                            background: '#007acc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s'
                        }, onMouseEnter: (e) => (e.currentTarget.style.background = '#005a96'), onMouseLeave: (e) => (e.currentTarget.style.background = '#007acc'), children: "Fechar" }) })] }) }));
}
