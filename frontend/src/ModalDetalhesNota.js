import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import './ModalDetalhes.css';
// ===== NÚMERO DE WHATSAPP DO FORNECEDOR/RESPONSÁVEL =====
// Formato: código do país (55) + DDD + número, somente dígitos.
// Ex: 55 + 19 + 978149245 = 5519978149245
const NUMERO_WHATSAPP = '5519978149245';
export function ModalDetalhesNota({ isOpen, onClose, produto, notaNota, onNaoConfirmado, onDivergenciaConfirmada, }) {
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(Math.round(produto.quantidade_confirmada || produto.quantidade_total).toString());
    const [loading, setLoading] = useState(false);
    const [observacoes, setObservacoes] = useState('');
    if (!isOpen)
        return null;
    const qtdConfirmada = parseFloat(quantidadeConfirmada) || 0;
    const divergencia = produto.quantidade_total - qtdConfirmada;
    const temDivergencia = Math.abs(divergencia) > 0.01;
    const handleConfirmar = async () => {
        // Pré-abre a aba do WhatsApp AINDA no clique do usuário (evita bloqueio de pop-up).
        // Só preenchemos a URL depois que a divergência for registrada.
        let janelaWhatsApp = null;
        if (temDivergencia) {
            janelaWhatsApp = window.open('', '_blank');
        }
        setLoading(true);
        try {
            if (temDivergencia) {
                // === FLUXO COM DIVERGÊNCIA ===
                let tipo = 'a_menos';
                if (qtdConfirmada > produto.quantidade_total) {
                    tipo = 'a_mais';
                }
                else if (qtdConfirmada === 0) {
                    tipo = 'nao_veio';
                }
                let textoMensagem = `⚠️ DIVERGÊNCIA NA NOTA FISCAL\n\n`;
                textoMensagem += `Produto: ${produto.descricao}\n`;
                textoMensagem += `Código: ${produto.codigo_produto}\n`;
                textoMensagem += `Esperado: ${Math.round(produto.quantidade_total)} un\n`;
                textoMensagem += `Recebido: ${Math.round(qtdConfirmada)} un\n`;
                if (tipo === 'a_mais') {
                    textoMensagem += `Situação: Quantidade MAIOR\n`;
                    textoMensagem += `Diferença: +${Math.round(Math.abs(divergencia))} un\n`;
                }
                else if (tipo === 'a_menos') {
                    textoMensagem += `Situação: Quantidade MENOR\n`;
                    textoMensagem += `Diferença: -${Math.round(Math.abs(divergencia))} un\n`;
                }
                else if (tipo === 'nao_veio') {
                    textoMensagem += `Situação: Produto NÃO CHEGOU\n`;
                }
                if (observacoes) {
                    textoMensagem += `\nObservações: ${observacoes}\n`;
                }
                // Registrar divergência
                const resDivergencia = await fetch('http://127.0.0.1:8000/api/registrar-divergencia', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        item_id: produto.id_item,
                        quantidade_confirmada: qtdConfirmada,
                        tipo_divergencia: tipo,
                        observacoes: observacoes,
                        mensagem_whatsapp: textoMensagem,
                    }),
                });
                if (!resDivergencia.ok) {
                    alert('❌ Erro ao registrar divergência');
                    if (janelaWhatsApp)
                        janelaWhatsApp.close();
                    return;
                }
                await resDivergencia.json();
                // Preenche a aba do WhatsApp (já aberta no clique) com a mensagem pronta
                const urlWhatsApp = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(textoMensagem)}`;
                if (janelaWhatsApp) {
                    janelaWhatsApp.location.href = urlWhatsApp;
                }
                else {
                    // fallback caso o navegador tenha bloqueado a pré-abertura
                    window.open(urlWhatsApp, '_blank');
                }
                alert(`✅ Divergência registrada!\n\nAbri o WhatsApp com a mensagem pronta. É só clicar em ENVIAR na conversa.\n\nDepois vamos vincular na Olist e subir ${Math.round(qtdConfirmada)} un.`);
                // Callback para ir direto vincular/subir na Olist com a qtd recebida
                if (onDivergenciaConfirmada) {
                    onDivergenciaConfirmada(qtdConfirmada);
                }
            }
            else {
                // === FLUXO SEM DIVERGÊNCIA (quantidade correta) ===
                // Persistir a confirmação no backend (marca como conferido)
                const resConf = await fetch('http://127.0.0.1:8000/api/confirmar-estoque', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        item_id: produto.id_item,
                        quantidade_confirmada: qtdConfirmada,
                        divergencia: null,
                        observacoes: observacoes,
                    }),
                });
                if (!resConf.ok) {
                    alert('❌ Erro ao confirmar quantidade');
                    return;
                }
                alert('✅ Quantidade confirmada com sucesso!');
                // Callback para ir para próxima etapa
                if (onNaoConfirmado) {
                    onNaoConfirmado(qtdConfirmada);
                }
            }
        }
        catch (err) {
            alert('❌ Erro: ' + err);
        }
        finally {
            setLoading(false);
            onClose();
        }
    };
    return (_jsx("div", { className: "modal-overlay", onClick: onClose, children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "Confer\u00EAncia de Produto" }), _jsx("button", { className: "modal-close", onClick: onClose, children: "\u00D7" })] }), _jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "product-info", children: [_jsx("h3", { children: "Informa\u00E7\u00F5es do Produto" }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Produto:" }), _jsx("span", { className: "info-value", children: produto.descricao })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "C\u00F3digo:" }), _jsx("span", { className: "info-value", children: produto.codigo_produto })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Quantidade Esperada:" }), _jsxs("span", { className: "info-value", children: [Math.round(produto.quantidade_total), " un"] })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { className: "info-label", children: "Pre\u00E7o Unit.:" }), _jsxs("span", { className: "info-value", children: ["R$ ", produto.preco_unitario.toFixed(2)] })] })] }), _jsxs("div", { className: "confirmation-section", children: [_jsx("h3", { children: "Quantidade Recebida" }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Quantos itens foram recebidos?" }), _jsx("input", { type: "text", className: "form-input", value: quantidadeConfirmada, onChange: (e) => {
                                                const val = e.target.value;
                                                // Permitir apenas números e ponto
                                                if (val === '' || !isNaN(parseFloat(val))) {
                                                    setQuantidadeConfirmada(val);
                                                }
                                            }, placeholder: "Digite a quantidade", disabled: loading, style: {
                                                fontFamily: 'monospace',
                                                fontSize: '1rem',
                                                letterSpacing: '0.5px'
                                            } })] })] }), temDivergencia && (_jsxs(_Fragment, { children: [_jsxs("div", { style: {
                                        background: 'rgba(220, 53, 69, 0.1)',
                                        border: '1px solid #dc3545',
                                        padding: '1rem',
                                        borderRadius: '6px',
                                        marginBottom: '1rem',
                                        color: '#721c24',
                                    }, children: [_jsx("strong", { style: { fontSize: '1rem' }, children: "\u26A0\uFE0F DIVERG\u00CANCIA DETECTADA" }), _jsx("p", { style: { margin: '0.5rem 0 0 0', fontSize: '0.95rem' }, children: divergencia > 0
                                                ? `Quantidade ${Math.round(Math.abs(divergencia))} un MENOR que o esperado`
                                                : `Quantidade ${Math.round(Math.abs(divergencia))} un MAIOR que o esperado` }), _jsx("p", { style: { margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.8 }, children: "Uma mensagem ser\u00E1 enviada automaticamente com estes detalhes." })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Observa\u00E7\u00F5es (opcional)" }), _jsx("textarea", { className: "form-input", value: observacoes, onChange: (e) => setObservacoes(e.target.value), placeholder: "Digite aqui qualquer observa\u00E7\u00E3o adicional...", rows: 3, style: { resize: 'vertical' }, disabled: loading })] })] })), _jsxs("div", { className: "button-group", children: [_jsx("button", { className: "btn btn-secondary", onClick: onClose, disabled: loading, children: "Cancelar" }), _jsx("button", { className: "btn btn-primary", onClick: handleConfirmar, disabled: loading, children: loading
                                        ? 'Processando...'
                                        : temDivergencia
                                            ? 'Confirmar e Registrar Divergência'
                                            : 'Confirmar' })] })] })] }) }));
}
