import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { uploadNFe, aceitarSugestaoVinculo } from '../services/api';
import './UploadNFe.css';
export default function UploadNFe({ onUploadSuccess }) {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [acceptingIndex, setAcceptingIndex] = useState(null);
    const [message, setMessage] = useState(null);
    const [result, setResult] = useState(null);
    const handleFileChange = (e) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            const ext = selectedFile.name.split('.').pop()?.toLowerCase();
            if (['xml', 'pdf'].includes(ext || '')) {
                setFile(selectedFile);
                setMessage(null);
            }
            else {
                setMessage({ type: 'error', text: 'Por favor, selecione um arquivo XML ou PDF' });
                setFile(null);
            }
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) {
            setMessage({ type: 'error', text: 'Selecione um arquivo primeiro' });
            return;
        }
        setLoading(true);
        setMessage(null);
        try {
            const response = await uploadNFe(file);
            setResult(response);
            setMessage({
                type: 'success',
                text: `NF #${response.numero_nf} processada com sucesso! ${response.itens_encontrados} itens encontrados`
            });
            setFile(null);
            onUploadSuccess();
        }
        catch (error) {
            setMessage({
                type: 'error',
                text: error.response?.data?.detail || 'Erro ao processar arquivo'
            });
        }
        finally {
            setLoading(false);
        }
    };
    const handleAceitarSugestao = async (index) => {
        if (!result?.sugestoes_vinculacao?.[index])
            return;
        setAcceptingIndex(index);
        try {
            const sugestao = result.sugestoes_vinculacao[index];
            await aceitarSugestaoVinculo(sugestao.item_id, sugestao.sugestao);
            // Remove a sugestão da lista
            const novasSugestoes = result.sugestoes_vinculacao.filter((_, i) => i !== index);
            setResult({ ...result, sugestoes_vinculacao: novasSugestoes });
            setMessage({
                type: 'success',
                text: `✓ Vinculado: ${sugestao.sugestao.olist_nome}`
            });
        }
        catch (error) {
            setMessage({
                type: 'error',
                text: 'Erro ao aceitar sugestão'
            });
        }
        finally {
            setAcceptingIndex(null);
        }
    };
    return (_jsx("div", { className: "upload-container", children: _jsxs("form", { onSubmit: handleSubmit, children: [_jsxs("div", { className: "upload-area", children: [_jsx("input", { type: "file", accept: ".xml,.pdf", onChange: handleFileChange, disabled: loading, id: "file-input" }), _jsxs("label", { htmlFor: "file-input", className: "upload-label", children: [_jsx("div", { className: "upload-icon", children: "\uD83D\uDCC4" }), _jsx("p", { children: file ? `Arquivo: ${file.name}` : 'Clique para selecionar ou arraste um arquivo XML/PDF' }), _jsx("small", { children: "M\u00E1ximo 10MB" })] })] }), message && (_jsxs("div", { className: `message message-${message.type}`, children: [message.type === 'success' ? '✓' : '✕', " ", message.text] })), result && (_jsxs("div", { className: "result-summary", children: [_jsx("h3", { children: "\u2713 Processado com Sucesso" }), _jsxs("dl", { children: [_jsx("dt", { children: "ID:" }), _jsx("dd", { children: result.id }), _jsx("dt", { children: "NF:" }), _jsx("dd", { children: result.numero_nf }), _jsx("dt", { children: "Itens:" }), _jsx("dd", { children: result.itens_encontrados }), _jsx("dt", { children: "Status:" }), _jsx("dd", { children: result.status })] }), result.sugestoes_vinculacao && result.sugestoes_vinculacao.length > 0 && (_jsxs("div", { className: "sugestoes-vinculacao", children: [_jsxs("h4", { children: ["\uD83D\uDCA1 ", result.sugestoes_vinculacao.length, " Vincula\u00E7\u00E3o(\u00F5es) Sugerida(s)"] }), _jsx("div", { className: "sugestoes-list", children: result.sugestoes_vinculacao.map((sugestao, idx) => (_jsxs("div", { className: "sugestao-item", children: [_jsxs("div", { className: "sugestao-info", children: [_jsx("div", { className: "produto-nf", children: _jsx("strong", { children: sugestao.descricao }) }), _jsx("div", { className: "confiance-bar", children: _jsx("div", { className: "confiance-fill", style: { width: `${sugestao.confianca}%` } }) }), _jsxs("div", { className: "confiance-text", children: [sugestao.confianca, "% de confian\u00E7a"] }), _jsx("div", { className: "produto-olist", children: _jsxs("small", { children: ["\u2192 ", sugestao.sugestao.olist_nome] }) })] }), _jsx("button", { type: "button", className: "btn-aceitar", onClick: () => handleAceitarSugestao(idx), disabled: acceptingIndex === idx, children: acceptingIndex === idx ? '...' : '✓' })] }, idx))) })] }))] })), _jsx("button", { type: "submit", disabled: !file || loading, className: "submit-btn", children: loading ? 'Processando...' : 'Enviar NF-e' })] }) }));
}
