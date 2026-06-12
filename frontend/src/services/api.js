import axios from 'axios';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';
const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});
export const uploadNFe = (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload-nfe', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    }).then(res => res.data);
};
export const aceitarSugestaoVinculo = (itemId, sugestao) => {
    return api.post('/olist/aceitar-sugestao', {
        item_id: itemId,
        olist_produto_id: sugestao.olist_produto_id,
        olist_sku: sugestao.olist_sku,
        olist_nome: sugestao.olist_nome,
        olist_preco: sugestao.olist_preco,
    }).then(res => res.data);
};
export const getNotaFiscal = (id) => {
    return api.get(`/notas-fiscais/${id}`).then(res => res.data);
};
export const listNotasFiscais = (skip = 0, limit = 10) => {
    return api.get('/notas-fiscais', {
        params: { skip, limit }
    }).then(res => res.data);
};
export const excluirNotaFiscal = (nfId) => {
    return api.post('/notas-fiscais/deletar', { nf_id: nfId }).then(res => res.data);
};
export const excluirMultiplasNotas = (nfIds) => {
    return api.post('/notas-fiscais/deletar-multiplas', { nf_ids: nfIds }).then(res => res.data);
};
export const baixarNotaFiscal = (nfId) => {
    window.location.href = `${API_BASE_URL}/notas-fiscais/${nfId}/baixar`;
};
export const baixarPdfNotaFiscal = (nfId) => {
    window.location.href = `${API_BASE_URL}/notas-fiscais/${nfId}/pdf`;
};
export const baixarMultiplosOuPdfs = async (nfIds, formato) => {
    if (nfIds.length === 0)
        return;
    if (nfIds.length === 1) {
        if (formato === 'pdf') {
            baixarPdfNotaFiscal(nfIds[0]);
        }
        else {
            baixarNotaFiscal(nfIds[0]);
        }
        return;
    }
    // Para múltiplos arquivos, baixa cada um individualmente
    for (const nfId of nfIds) {
        if (formato === 'pdf') {
            window.open(`${API_BASE_URL}/notas-fiscais/${nfId}/pdf`, '_blank');
        }
        else {
            window.open(`${API_BASE_URL}/notas-fiscais/${nfId}/baixar`, '_blank');
        }
        // Aguarda um pouco entre downloads para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 200));
    }
};
// Fornecedores
export const listarFornecedores = (skip = 0, limit = 100) => {
    return api.get('/fornecedores', {
        params: { skip, limit }
    }).then(res => res.data);
};
export const criarFornecedor = (dados) => {
    return api.post('/fornecedores', dados).then(res => res.data);
};
export const editarFornecedor = (id, dados) => {
    return api.put(`/fornecedores/${id}`, dados).then(res => res.data);
};
export const deletarFornecedor = (id) => {
    return api.delete(`/fornecedores/${id}`).then(res => res.data);
};
// Estoque Mínimo
export const listarEstoqueMinimo = (skip = 0, limit = 100) => {
    return api.get('/estoque-minimo', {
        params: { skip, limit }
    }).then(res => res.data);
};
export const criarEstoqueMinimo = (produto_codigo, estoque_minimo, notificar_fornecedores) => {
    return api.post('/estoque-minimo', {
        produto_codigo,
        estoque_minimo,
        notificar_fornecedores: notificar_fornecedores ? 1 : 0
    }).then(res => res.data);
};
export const editarEstoqueMinimo = (produto_codigo, estoque_minimo, notificar_fornecedores) => {
    return api.put(`/estoque-minimo/${produto_codigo}`, {
        estoque_minimo,
        notificar_fornecedores: notificar_fornecedores ? 1 : 0
    }).then(res => res.data);
};
// Histórico e Notificações
export const historicoComprasProduto = (produto_codigo) => {
    return api.get(`/historico-compras/${produto_codigo}`).then(res => res.data);
};
export const notificarFornecedores = () => {
    return api.post('/notificar-fornecedores', {}).then(res => res.data);
};
export const historicoNotificacoes = (skip = 0, limit = 100) => {
    return api.get('/historico-notificacoes', {
        params: { skip, limit }
    }).then(res => res.data);
};
export default api;
