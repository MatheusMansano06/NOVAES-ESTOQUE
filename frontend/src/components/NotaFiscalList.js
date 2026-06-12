import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { listNotasFiscais, excluirMultiplasNotas, baixarNotaFiscal } from '../services/api';
import './NotaFiscalList.css';
export default function NotaFiscalList({ refresh }) {
    const [notas, setNotas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selecionadas, setSelecionadas] = useState(new Set());
    const [deletando, setDeletando] = useState(false);
    const loadNotas = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await listNotasFiscais();
            setNotas(response.items);
            setSelecionadas(new Set());
        }
        catch (err) {
            setError('Erro ao carregar notas fiscais');
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        loadNotas();
    }, [refresh]);
    const toggleSelecao = (notaId) => {
        const novo = new Set(selecionadas);
        if (novo.has(notaId)) {
            novo.delete(notaId);
        }
        else {
            novo.add(notaId);
        }
        setSelecionadas(novo);
    };
    const selecionarTodas = () => {
        if (selecionadas.size === notas.length) {
            setSelecionadas(new Set());
        }
        else {
            setSelecionadas(new Set(notas.map(n => n.id)));
        }
    };
    const handleExcluir = async () => {
        if (!window.confirm(`Tem certeza que deseja excluir ${selecionadas.size} nota(s)? Esta ação não pode ser desfeita.`)) {
            return;
        }
        setDeletando(true);
        try {
            await excluirMultiplasNotas(Array.from(selecionadas));
            await loadNotas();
        }
        catch (err) {
            alert('Erro ao excluir notas: ' + (err.response?.data?.error || err.message));
        }
        finally {
            setDeletando(false);
        }
    };
    const handleBaixar = () => {
        selecionadas.forEach(notaId => {
            baixarNotaFiscal(notaId);
        });
    };
    if (loading) {
        return _jsx("div", { className: "loading", children: "Carregando..." });
    }
    if (error) {
        return _jsx("div", { className: "error", children: error });
    }
    if (notas.length === 0) {
        return _jsx("div", { className: "empty", children: "Nenhuma nota fiscal processada ainda" });
    }
    const todasSelecionadas = selecionadas.size === notas.length && notas.length > 0;
    return (_jsxs("div", { className: "list-container", children: [selecionadas.size > 0 && (_jsxs("div", { className: "action-bar", children: [_jsxs("span", { className: "selection-info", children: [selecionadas.size, " selecionada", selecionadas.size !== 1 ? 's' : ''] }), _jsxs("div", { className: "action-buttons", children: [_jsxs("button", { className: "btn-action btn-download", onClick: handleBaixar, disabled: deletando, title: "Baixar arquivos selecionados", children: ["\uD83D\uDCE5 Baixar (", selecionadas.size, ")"] }), _jsx("button", { className: "btn-action btn-delete", onClick: handleExcluir, disabled: deletando, title: "Excluir notas selecionadas", children: deletando ? '...' : '🗑 Excluir' })] })] })), _jsx("div", { className: "list-header", children: _jsxs("label", { className: "checkbox-all", children: [_jsx("input", { type: "checkbox", checked: todasSelecionadas, onChange: selecionarTodas, title: "Selecionar/Desselecionar todas" }), _jsx("span", { children: "Todas" })] }) }), _jsx("div", { className: "list", children: notas.map(nota => (_jsxs("div", { className: `nota-item ${selecionadas.has(nota.id) ? 'selected' : ''}`, children: [_jsx("div", { className: "nota-checkbox", children: _jsx("input", { type: "checkbox", checked: selecionadas.has(nota.id), onChange: () => toggleSelecao(nota.id) }) }), _jsxs("div", { className: "nota-content", children: [_jsxs("div", { className: "nota-header", children: [_jsxs("h3", { children: ["NF #", nota.numero_nf] }), _jsx("span", { className: `status-badge status-${nota.status}`, children: nota.status })] }), _jsxs("div", { className: "nota-details", children: [_jsxs("p", { children: [_jsx("strong", { children: "Fornecedor:" }), " ", nota.fornecedor] }), _jsxs("p", { children: [_jsx("strong", { children: "S\u00E9rie:" }), " ", nota.serie] }), _jsxs("p", { children: [_jsx("strong", { children: "Itens:" }), " ", nota.itens.length] }), _jsxs("p", { children: [_jsx("strong", { children: "Data Upload:" }), " ", new Date(nota.data_upload).toLocaleDateString('pt-BR')] })] }), _jsxs("div", { className: "items-preview", children: [_jsxs("h4", { children: ["Produtos (", nota.itens.length, ")"] }), _jsxs("div", { className: "items-list", children: [nota.itens.slice(0, 3).map(item => (_jsxs("div", { className: "item-row", children: [_jsx("span", { className: "item-desc", children: item.descricao }), _jsxs("span", { className: "item-qty", children: [item.quantidade_nf, " un"] })] }, item.id))), nota.itens.length > 3 && (_jsxs("div", { className: "item-more", children: ["+ ", nota.itens.length - 3, " mais..."] }))] })] })] })] }, nota.id))) })] }));
}
