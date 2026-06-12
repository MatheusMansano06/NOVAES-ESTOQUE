import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import api from '../services/api';
export function EmbaldesManager() {
    const [inbounds, setInbounds] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [nomeInbound, setNomeInbound] = useState('');
    const [dataLimite, setDataLimite] = useState('');
    const [semData, setSemData] = useState(true);
    const [arquivo, setArquivo] = useState(null);
    const [inboundSelecionado, setInboundSelecionado] = useState(null);
    const [aba, setAba] = useState('processando');
    const [visao, setVisao] = useState('upload');
    const [editandoData, setEditandoData] = useState(null);
    const [novaData, setNovaData] = useState('');
    const [revisao, setRevisao] = useState(null);
    const [revisandoId, setRevisandoId] = useState(null);
    const [carregandoRevisao, setCarregandoRevisao] = useState(false);
    const [declaracoes, setDeclaracoes] = useState({});
    const [confirmandoBaixa, setConfirmandoBaixa] = useState(false);
    const [baixandoItemId, setBaixandoItemId] = useState(null);
    const [itensBaixados, setItensBaixados] = useState({});
    const [filtroRevisao, setFiltroRevisao] = useState('todos');
    // Vínculo manual de item "não achado"
    const [vinculandoItem, setVinculandoItem] = useState(null);
    const [buscaTermo, setBuscaTermo] = useState('');
    const [buscaResultados, setBuscaResultados] = useState([]);
    const [buscandoOlist, setBuscandoOlist] = useState(false);
    const [vinculandoProduto, setVinculandoProduto] = useState(false);
    useEffect(() => {
        carregarInbounds();
    }, []);
    const carregarInbounds = async () => {
        try {
            setLoading(true);
            const resposta = await api.get('/embaldes?limit=200');
            setInbounds(resposta.data.items);
        }
        catch (erro) {
            setMessage('Erro ao carregar inbounds: ' + String(erro));
        }
        finally {
            setLoading(false);
        }
    };
    const handleUpload = async (e) => {
        e.preventDefault();
        if (!arquivo) {
            setMessage('Selecione um arquivo PDF');
            return;
        }
        if (!nomeInbound.trim()) {
            setMessage('Digite um nome para o inbound');
            return;
        }
        try {
            setLoading(true);
            setMessage('');
            const formData = new FormData();
            formData.append('arquivo', arquivo);
            formData.append('nome_embale', nomeInbound);
            if (dataLimite)
                formData.append('data_limite', dataLimite);
            const resposta = await api.post('/embaldes/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const d = resposta.data;
            setMessage(`Inbound ${d.numero_inbound || ''} processado: ${d.itens_validados}/${d.itens_processados} items vinculados`);
            setNomeInbound('');
            setDataLimite('');
            setSemData(true);
            setArquivo(null);
            await carregarInbounds();
        }
        catch (erro) {
            const msgErro = erro.response?.data?.erro || String(erro);
            setMessage('Erro: ' + msgErro);
        }
        finally {
            setLoading(false);
        }
    };
    const irParaLista = async () => {
        setVisao('lista');
        await carregarInbounds();
    };
    const voltarParaUpload = () => {
        setVisao('upload');
        setInboundSelecionado(null);
        setRevisandoId(null);
        setRevisao(null);
        setDeclaracoes({});
        setItensBaixados({});
    };
    const carregarDetalhes = async (inb) => {
        if (inboundSelecionado?.id === inb.id) {
            setInboundSelecionado(null);
            return;
        }
        // Visões mutuamente exclusivas: abrir os itens fecha a revisão Olist.
        setRevisandoId(null);
        setRevisao(null);
        try {
            const resposta = await api.get(`/embaldes/${inb.id}`);
            setInboundSelecionado(resposta.data);
        }
        catch (erro) {
            setMessage('Erro ao carregar detalhes: ' + String(erro));
        }
    };
    const encerrarInbound = async (id) => {
        if (!confirm('Encerrar este inbound? Ele vai parar de descontar do estoque nas próximas notas.'))
            return;
        try {
            await api.post(`/embaldes/${id}/encerrar`);
            await carregarInbounds();
            setMessage('Inbound encerrado');
        }
        catch (erro) {
            setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)));
        }
    };
    const salvarData = async (id) => {
        try {
            await api.post(`/embaldes/${id}/data-limite`, { data_limite: novaData || null });
            setEditandoData(null);
            setNovaData('');
            await carregarInbounds();
            setMessage('Data limite atualizada');
        }
        catch (erro) {
            setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)));
        }
    };
    const carregarRevisao = async (id) => {
        if (revisandoId === id) {
            // Toggle: fecha
            setRevisandoId(null);
            setRevisao(null);
            setDeclaracoes({});
            return;
        }
        try {
            setCarregandoRevisao(true);
            // Visões mutuamente exclusivas: abrir a revisão fecha a lista de itens.
            setInboundSelecionado(null);
            setRevisandoId(id);
            setRevisao(null);
            setDeclaracoes({});
            setItensBaixados({});
            setFiltroRevisao('todos');
            const resposta = await api.get(`/embaldes/${id}/revisao`);
            setRevisao(resposta.data);
            // Marca os que já foram baixados antes
            const jaBaixados = {};
            for (const it of resposta.data.itens || []) {
                if (it.baixa_aplicada === 1)
                    jaBaixados[it.item_id] = 1;
            }
            setItensBaixados(jaBaixados);
        }
        catch (erro) {
            setMessage('Erro ao revisar: ' + (erro.response?.data?.erro || String(erro)));
            setRevisandoId(null);
        }
        finally {
            setCarregandoRevisao(false);
        }
    };
    const confirmarBaixa = async () => {
        if (!revisao)
            return;
        if (!confirm('Confirmar a baixa EM MASSA na Olist? Isso escreve no estoque real e não há volta.'))
            return;
        try {
            setConfirmandoBaixa(true);
            const resposta = await api.post(`/embaldes/${revisao.embale_id}/confirmar-baixa`, {
                itens: declaracoes
            });
            setMessage(`Sucesso! ${resposta.data.mensagem}`);
            // Marca os itens baixados localmente
            const novos = { ...itensBaixados };
            for (const r of resposta.data.resultados || []) {
                if (r.status === 'ok' || r.status === 'ja_baixado')
                    novos[r.item_id] = r.quantidade_baixada || 0;
            }
            setItensBaixados(novos);
        }
        catch (erro) {
            setMessage('Erro ao confirmar: ' + (erro.response?.data?.erro || String(erro)));
        }
        finally {
            setConfirmandoBaixa(false);
        }
    };
    const baixarItem = async (it) => {
        if (!revisao)
            return;
        const qtd = it.tem_falta
            ? (declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0))
            : Math.round(it.quantidade_full);
        if (!confirm(`Baixar ${qtd} un. de "${it.titulo_anuncio}" na Olist? Não há volta.`))
            return;
        try {
            setBaixandoItemId(it.item_id);
            const resposta = await api.post(`/embaldes/${revisao.embale_id}/itens/${it.item_id}/baixa`, {
                quantidade: qtd
            });
            const r = resposta.data;
            if (r.status === 'ok' || r.status === 'ja_baixado') {
                setItensBaixados({ ...itensBaixados, [it.item_id]: r.quantidade_baixada || qtd });
                setMessage(r.mensagem || 'Baixa aplicada');
            }
            else {
                setMessage(r.mensagem || r.erro || 'Não foi possível baixar');
            }
        }
        catch (erro) {
            setMessage('Erro: ' + (erro.response?.data?.erro || String(erro)));
        }
        finally {
            setBaixandoItemId(null);
        }
    };
    const abrirVinculo = (it) => {
        setVinculandoItem(it);
        const termo = it.sku_inbound || it.titulo_anuncio || '';
        setBuscaTermo(termo);
        setBuscaResultados([]);
        if (termo)
            buscarOlist(termo);
    };
    const buscarOlist = async (termo) => {
        if (!termo || termo.trim().length < 1)
            return;
        try {
            setBuscandoOlist(true);
            const resposta = await api.get('/olist/produtos', { params: { q: termo.trim() } });
            setBuscaResultados(resposta.data.produtos || []);
        }
        catch (erro) {
            setMessage('Erro na busca: ' + (erro.response?.data?.erro || String(erro)));
        }
        finally {
            setBuscandoOlist(false);
        }
    };
    const vincularAnuncio = async (produto) => {
        if (!vinculandoItem || !revisao)
            return;
        try {
            setVinculandoProduto(true);
            await api.post(`/embaldes/${revisao.embale_id}/itens/${vinculandoItem.item_id}/vincular`, {
                olist_produto_id: produto.id,
                olist_sku: produto.sku || produto.codigo_produto || '',
                olist_nome: produto.nome || produto.descricao || '',
                olist_preco: produto.preco || 0,
            });
            setMessage(`Vinculado: ${produto.nome || produto.descricao}`);
            setVinculandoItem(null);
            setBuscaResultados([]);
            // Recarrega a revisão (agora o item será achado e terá estoque)
            const id = revisao.embale_id;
            setRevisandoId(null);
            await carregarRevisao(id);
        }
        catch (erro) {
            setMessage('Erro ao vincular: ' + (erro.response?.data?.erro || String(erro)));
        }
        finally {
            setVinculandoProduto(false);
        }
    };
    const formatarData = (iso) => {
        if (!iso)
            return null;
        return new Date(iso).toLocaleDateString('pt-BR');
    };
    // "valendo" e "processando" são ambos ativos (não encerrados)
    const ehAtivo = (status) => status !== 'encerrado';
    const inboundsFiltrados = inbounds.filter((i) => aba === 'encerrado' ? i.status === 'encerrado' : ehAtivo(i.status));
    const countProcessando = inbounds.filter((i) => ehAtivo(i.status)).length;
    const countEncerrado = inbounds.filter((i) => i.status === 'encerrado').length;
    const sucessoUpload = message && !message.toLowerCase().includes('erro');
    return (_jsxs("div", { style: { padding: '2rem' }, children: [_jsxs("div", { style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    marginBottom: '1.25rem',
                    flexWrap: 'wrap'
                }, children: [_jsx("h2", { style: { margin: 0, color: '#061a35' }, children: "Inbound (Lista de Separa\u00E7\u00E3o ML FULL)" }), visao === 'upload' ? (_jsx("button", { type: "button", onClick: irParaLista, style: {
                            padding: '0.75rem 1.2rem',
                            background: '#0878ff',
                            color: '#fff',
                            border: '1px solid #0878ff',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            boxShadow: '0 8px 18px rgba(8, 120, 255, 0.22)'
                        }, children: "Ver Inbounds" })) : (_jsx("button", { type: "button", onClick: voltarParaUpload, style: {
                            padding: '0.75rem 1.2rem',
                            background: '#ffffff',
                            color: '#0878ff',
                            border: '1px solid #0878ff',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }, children: "Voltar para subir lista" }))] }), visao === 'upload' && (_jsxs("div", { style: {
                    backgroundColor: '#ffffff',
                    padding: '1.5rem',
                    borderRadius: '8px',
                    marginBottom: '2rem',
                    border: '1px solid rgba(8, 120, 255, 0.18)',
                    boxShadow: '0 18px 45px rgba(6, 26, 53, 0.14)'
                }, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Subir Inbound" }), _jsx("p", { style: { color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }, children: "Envie o PDF de instru\u00E7\u00F5es de prepara\u00E7\u00E3o do Mercado Livre FULL. O sistema l\u00EA o SKU de cada produto e verifica se j\u00E1 existe um an\u00FAncio vinculado na Olist." }), _jsxs("form", { onSubmit: handleUpload, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }, children: [_jsxs("div", { children: [_jsx("label", { style: { fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }, children: "Nome do Inbound:" }), _jsx("input", { type: "text", placeholder: "Ex: Inbound Semana 1", value: nomeInbound, onChange: (e) => setNomeInbound(e.target.value), disabled: loading, style: { width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem' } })] }), _jsxs("div", { children: [_jsx("label", { style: { fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }, children: "Data de envio do FULL:" }), _jsx("input", { type: "date", value: dataLimite, onChange: (e) => setDataLimite(e.target.value), disabled: loading || semData, style: { width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem', backgroundColor: semData ? '#f0f0f0' : '#fff', color: semData ? '#999' : '#000' } }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', cursor: 'pointer', fontSize: '0.88rem', color: '#555' }, children: [_jsx("input", { type: "checkbox", checked: semData, onChange: (e) => { setSemData(e.target.checked); if (e.target.checked)
                                                            setDataLimite(''); }, disabled: loading }), "Sem data ainda (fica como ", _jsx("strong", { style: { color: '#1565c0' }, children: "\u00A0valendo" }), ")"] })] })] }), _jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("label", { style: { fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }, children: "Arquivo PDF:" }), _jsxs("div", { style: { border: '2px dashed #ccc', borderRadius: '4px', padding: '1.5rem', textAlign: 'center', backgroundColor: '#fff' }, children: [_jsx("input", { type: "file", accept: ".pdf", onChange: (e) => setArquivo(e.target.files?.[0] || null), disabled: loading, style: { display: 'none' }, id: "pdf-input" }), _jsx("label", { htmlFor: "pdf-input", style: { cursor: 'pointer', display: 'block' }, children: arquivo ? (_jsx("div", { style: { color: '#2e7d32', fontWeight: 'bold' }, children: arquivo.name })) : (_jsx("div", { style: { color: '#666' }, children: "Clique para selecionar um PDF" })) })] })] }), _jsx("button", { type: "submit", disabled: loading || !arquivo || !nomeInbound, style: {
                                    padding: '0.9rem 2rem',
                                    backgroundColor: (loading || !arquivo || !nomeInbound) ? '#ccc' : '#1976D2',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: (loading || !arquivo || !nomeInbound) ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '1rem'
                                }, children: loading ? 'Processando...' : 'Subir Inbound' })] }), message && (_jsxs("div", { style: {
                            marginTop: '1rem',
                            padding: '1rem',
                            backgroundColor: message.toLowerCase().includes('erro') ? '#ffebee' : '#e8f5e9',
                            color: message.toLowerCase().includes('erro') ? '#c62828' : '#2e7d32',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            flexWrap: 'wrap'
                        }, children: [_jsx("span", { children: message }), sucessoUpload && (_jsx("button", { type: "button", onClick: irParaLista, style: {
                                    padding: '0.55rem 1rem',
                                    background: '#0878ff',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }, children: "Ver Inbounds" }))] }))] })), visao === 'lista' && (_jsxs("div", { style: {
                    backgroundColor: '#ffffff',
                    padding: '1.5rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(8, 120, 255, 0.18)',
                    boxShadow: '0 18px 45px rgba(6, 26, 53, 0.14)'
                }, children: [_jsx("h3", { style: { marginTop: 0, marginBottom: '1rem', color: '#061a35' }, children: "Gest\u00E3o de Inbounds" }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #eef3f8', flexWrap: 'wrap' }, children: [_jsxs("button", { onClick: () => setAba('processando'), style: {
                                    padding: '0.75rem 1.5rem',
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '1rem',
                                    color: aba === 'processando' ? '#1976D2' : '#6d7b8f',
                                    borderBottom: aba === 'processando' ? '3px solid #1976D2' : '3px solid transparent',
                                    marginBottom: '-2px'
                                }, children: ["Ativos (", countProcessando, ")"] }), _jsxs("button", { onClick: () => setAba('encerrado'), style: {
                                    padding: '0.75rem 1.5rem',
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '1rem',
                                    color: aba === 'encerrado' ? '#1976D2' : '#6d7b8f',
                                    borderBottom: aba === 'encerrado' ? '3px solid #1976D2' : '3px solid transparent',
                                    marginBottom: '-2px'
                                }, children: ["Encerrados (", countEncerrado, ")"] })] }), inboundsFiltrados.length === 0 ? (_jsx("p", { style: { color: '#6d7b8f', textAlign: 'center', padding: '2rem' }, children: aba === 'processando' ? 'Nenhum inbound processando.' : 'Nenhum inbound encerrado.' })) : (_jsx("div", { style: { display: 'grid', gap: '1rem' }, children: inboundsFiltrados.map((inb) => (_jsxs("div", { style: {
                                border: '1px solid rgba(8, 120, 255, 0.16)',
                                borderRadius: '8px',
                                padding: '1.5rem',
                                backgroundColor: inb.status === 'encerrado' ? '#f8fbff' : '#fff',
                                boxShadow: '0 8px 22px rgba(6, 26, 53, 0.08)'
                            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1.5rem', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }, onClick: () => carregarDetalhes(inb), children: [_jsxs("div", { style: { flex: '1 1 220px', minWidth: 0 }, children: [_jsx("div", { style: { fontWeight: 'bold', fontSize: '1.1rem' }, children: inb.nome_embalde }), _jsxs("div", { style: { color: '#666', fontSize: '0.85rem', marginTop: '0.4rem' }, children: [inb.numero_inbound ? `Frete #${inb.numero_inbound}` : 'Sem número', inb.total_unidades ? ` · ${Math.round(inb.total_unidades)} un` : ''] })] }), _jsx("div", { style: { flex: '1 1 180px', minWidth: 0, fontSize: '0.85rem' }, onClick: (e) => e.stopPropagation(), children: editandoData === inb.id ? (_jsxs("div", { style: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("input", { type: "date", value: novaData, onChange: (e) => setNovaData(e.target.value), style: { padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' } }), _jsx("button", { onClick: () => salvarData(inb.id), style: { padding: '0.4rem 0.7rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }, children: "OK" }), _jsx("button", { onClick: () => { setNovaData(''); salvarData(inb.id); }, title: "Volta para VALENDO (sem data)", style: { padding: '0.4rem 0.7rem', background: '#fff', color: '#1565c0', border: '1px solid #1565c0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }, children: "Sem data" }), _jsx("button", { onClick: () => { setEditandoData(null); setNovaData(''); }, style: { padding: '0.4rem 0.7rem', background: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }, children: "x" })] })) : (_jsxs("div", { children: [_jsx("span", { style: { color: '#666' }, children: "Envio FULL: " }), inb.status === 'valendo' ? (_jsx("span", { style: { padding: '0.15rem 0.5rem', background: '#e3f2fd', color: '#1565c0', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.8rem' }, children: "VALENDO (sem data)" })) : (_jsx("strong", { children: formatarData(inb.data_limite) || 'sem data' })), ehAtivo(inb.status) && (_jsx("button", { onClick: () => { setEditandoData(inb.id); setNovaData(inb.data_limite?.slice(0, 10) || ''); }, style: { marginLeft: '0.5rem', padding: '0.2rem 0.5rem', background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }, children: "editar" })), inb.status === 'encerrado' && inb.data_encerramento && (_jsxs("div", { style: { color: '#999', marginTop: '0.2rem' }, children: ["Encerrado em ", formatarData(inb.data_encerramento)] }))] })) }), _jsxs("div", { style: { flex: '0 1 110px', textAlign: 'center' }, children: [_jsxs("div", { style: { fontSize: '1.1rem', fontWeight: 'bold', color: inb.qtd_validados === inb.qtd_items ? '#2e7d32' : '#ef6c00' }, children: [inb.qtd_validados, "/", inb.qtd_items] }), _jsx("div", { style: { fontSize: '0.78rem', color: '#666' }, children: "vinculados" })] }), _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { display: 'flex', gap: '0.5rem', flexDirection: 'column', flex: '0 1 130px' }, children: [_jsx("button", { onClick: () => carregarRevisao(inb.id), style: { padding: '0.5rem 1rem', background: revisandoId === inb.id ? '#1976D2' : '#fff', color: revisandoId === inb.id ? '#fff' : '#1976D2', border: '1px solid #1976D2', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }, children: revisandoId === inb.id ? 'Fechar revisão' : 'Revisar Olist' }), ehAtivo(inb.status) ? (_jsx("button", { onClick: () => encerrarInbound(inb.id), style: { padding: '0.5rem 1rem', background: '#fff', color: '#c62828', border: '1px solid #c62828', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }, children: "Encerrar" })) : (_jsx("span", { style: { padding: '0.4rem 0.9rem', background: '#9e9e9e', color: '#fff', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 'bold', textAlign: 'center' }, children: "Encerrado" }))] })] }), revisandoId === inb.id && (_jsx("div", { style: { marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '2px solid #1976D2', overflowX: 'auto' }, children: carregandoRevisao ? (_jsx("div", { style: { textAlign: 'center', padding: '2rem', color: '#1976D2', fontWeight: 'bold' }, children: "Consultando estoque na Olist, produto por produto... aguarde." })) : revisao ? (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { padding: '0.6rem 1rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.85rem' }, children: ["Total: ", _jsx("strong", { children: revisao.resumo.total })] }), _jsxs("div", { style: { padding: '0.6rem 1rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' }, children: ["Achados na Olist: ", _jsx("strong", { children: revisao.resumo.encontrados })] }), _jsxs("div", { style: { padding: '0.6rem 1rem', background: '#fff3e0', borderRadius: '4px', fontSize: '0.85rem' }, children: ["N\u00E3o achados: ", _jsx("strong", { children: revisao.resumo.nao_encontrados })] }), _jsxs("div", { style: { padding: '0.6rem 1rem', background: '#ffebee', borderRadius: '4px', fontSize: '0.85rem' }, children: ["Com falta: ", _jsx("strong", { children: revisao.resumo.com_falta })] })] }), _jsx("div", { style: { fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem', fontStyle: 'italic' }, children: "Revis\u00E3o (somente leitura) \u2014 selecione quantas unidades baixar em cada item." }), (() => {
                                                const itBaixado = (it) => it.baixa_aplicada === 1 || !!itensBaixados[it.item_id];
                                                const itVinc = (it) => it.vinculado === 1 || !!it.olist_produto_id;
                                                const chips = [
                                                    { id: 'todos', label: 'Todos', n: revisao.itens.length },
                                                    { id: 'vinculados', label: 'Vinculados', n: revisao.itens.filter(itVinc).length },
                                                    { id: 'nao_vinculados', label: 'Não vinculados', n: revisao.itens.filter((i) => !itVinc(i)).length },
                                                    { id: 'baixados', label: 'Estoque retirado', n: revisao.itens.filter(itBaixado).length },
                                                    { id: 'nao_baixados', label: 'Ainda não retirado', n: revisao.itens.filter((i) => !itBaixado(i)).length },
                                                ];
                                                return (_jsx("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }, children: chips.map((c) => {
                                                        const ativo = filtroRevisao === c.id;
                                                        return (_jsxs("button", { onClick: () => setFiltroRevisao(c.id), style: {
                                                                padding: '0.4rem 0.9rem', borderRadius: '999px', cursor: 'pointer',
                                                                fontSize: '0.85rem', fontWeight: 600,
                                                                border: ativo ? '1px solid #1976D2' : '1px solid #ddd',
                                                                background: ativo ? '#1976D2' : '#fff',
                                                                color: ativo ? '#fff' : '#555',
                                                            }, children: [c.label, " ", _jsxs("span", { style: { opacity: 0.8 }, children: ["(", c.n, ")"] })] }, c.id));
                                                    }) }));
                                            })(), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2.4fr 0.9fr 0.9fr 0.9fr 1.1fr 0.8fr 1fr', gap: '0.5rem', padding: '0.7rem 0.9rem', background: '#f5f5f5', borderRadius: '4px 4px 0 0', fontSize: '0.8rem', fontWeight: 'bold', color: '#555', textTransform: 'uppercase' }, children: [_jsx("div", { children: "Produto / SKU" }), _jsx("div", { style: { textAlign: 'center' }, children: "Estoque Olist" }), _jsx("div", { style: { textAlign: 'center' }, children: "Vai pro FULL" }), _jsx("div", { style: { textAlign: 'center' }, children: "Resultado" }), _jsx("div", { style: { textAlign: 'center' }, children: "Situa\u00E7\u00E3o" }), _jsx("div", { style: { textAlign: 'center' }, children: "Declarar" }), _jsx("div", { style: { textAlign: 'center' }, children: "A\u00E7\u00E3o" })] }), _jsx("div", { style: { maxHeight: '560px', overflowY: 'auto', border: '1px solid #eee', borderTop: 'none' }, children: revisao.itens.filter((it) => {
                                                    const baixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id];
                                                    const vinc = it.vinculado === 1 || !!it.olist_produto_id;
                                                    if (filtroRevisao === 'vinculados')
                                                        return vinc;
                                                    if (filtroRevisao === 'nao_vinculados')
                                                        return !vinc;
                                                    if (filtroRevisao === 'baixados')
                                                        return baixado;
                                                    if (filtroRevisao === 'nao_baixados')
                                                        return !baixado;
                                                    return true;
                                                }).map((it) => {
                                                    const naoAchado = !it.olist_encontrado;
                                                    const semEstoque = it.olist_encontrado && it.estoque_indisponivel;
                                                    const bg = naoAchado ? '#fff8f0' : it.tem_falta ? '#ffebee' : '#fff';
                                                    const jaBaixado = it.baixa_aplicada === 1 || !!itensBaixados[it.item_id];
                                                    const vinculado = it.vinculado === 1 || !!it.olist_produto_id;
                                                    const podeBaixar = it.olist_encontrado && !semEstoque && !jaBaixado;
                                                    return (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2.4fr 0.9fr 0.9fr 0.9fr 1.1fr 0.8fr 1fr', gap: '0.5rem', padding: '0.8rem 0.9rem', background: jaBaixado ? '#eef7ee' : bg, borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem', alignItems: 'center', opacity: jaBaixado ? 0.8 : 1 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, lineHeight: 1.3 }, children: it.titulo_anuncio }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#666', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }, children: [_jsxs("span", { children: ["SKU: ", it.sku_inbound || '—'] }), _jsx("span", { style: {
                                                                                    padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
                                                                                    background: vinculado ? '#e8f5e9' : '#fff3e0',
                                                                                    color: vinculado ? '#2e7d32' : '#ef6c00',
                                                                                    border: `1px solid ${vinculado ? '#a5d6a7' : '#ffcc80'}`
                                                                                }, children: vinculado ? '✓ vinculado' : 'sem vínculo' }), jaBaixado && (_jsx("span", { style: { padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' }, children: "\u2193 estoque retirado" }))] })] }), _jsx("div", { style: { textAlign: 'center', fontWeight: 'bold' }, children: naoAchado ? '—' : semEstoque ? '?' : it.estoque_atual }), _jsx("div", { style: { textAlign: 'center' }, children: Math.round(it.quantidade_full) }), _jsx("div", { style: { textAlign: 'center', fontWeight: 'bold', color: '#2e7d32' }, children: naoAchado || semEstoque ? '—' : it.tem_falta ? '—' : it.resultado }), _jsx("div", { style: { textAlign: 'center' }, children: naoAchado ? (_jsx("span", { style: { color: '#ef6c00', fontWeight: 'bold', fontSize: '0.8rem' }, children: "N\u00E3o achado na Olist" })) : semEstoque ? (_jsx("span", { style: { color: '#999', fontSize: '0.8rem' }, children: "Estoque indispon\u00EDvel" })) : it.tem_falta ? (_jsxs("span", { style: { color: '#c62828', fontWeight: 'bold', fontSize: '0.8rem' }, children: ["Falta ", Math.round(it.falta || 0)] })) : (_jsx("span", { style: { color: '#2e7d32', fontWeight: 'bold', fontSize: '0.8rem' }, children: "OK" })) }), _jsx("div", { style: { textAlign: 'center' }, children: it.tem_falta && !jaBaixado ? (_jsx("input", { type: "number", min: "0", max: it.estoque_atual || 0, value: declaracoes[it.item_id] ?? Math.round(it.estoque_atual || 0), onChange: (e) => setDeclaracoes({ ...declaracoes, [it.item_id]: parseFloat(e.target.value) || 0 }), style: { width: '60px', padding: '0.3rem', borderRadius: '3px', border: '1px solid #ddd', textAlign: 'center', fontSize: '0.85rem' } })) : (_jsx("span", { style: { color: '#999', fontSize: '0.8rem' }, children: "\u2014" })) }), _jsx("div", { style: { textAlign: 'center' }, children: jaBaixado ? (_jsx("span", { style: { color: '#2e7d32', fontWeight: 'bold', fontSize: '0.8rem' }, children: "\u2713 Baixado" })) : naoAchado ? (_jsx("button", { onClick: () => abrirVinculo(it), style: { padding: '0.3rem 0.7rem', background: '#fff', color: '#ef6c00', border: '1px solid #ef6c00', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }, children: "Vincular" })) : podeBaixar ? (_jsx("button", { onClick: () => baixarItem(it), disabled: baixandoItemId === it.item_id, style: { padding: '0.3rem 0.7rem', background: '#fff', color: '#1976D2', border: '1px solid #1976D2', borderRadius: '4px', cursor: baixandoItemId === it.item_id ? 'wait' : 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }, children: baixandoItemId === it.item_id ? '...' : 'Baixar' })) : (_jsx("span", { style: { color: '#ccc', fontSize: '0.8rem' }, children: "\u2014" })) })] }, it.item_id));
                                                }) }), _jsxs("div", { style: { marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }, children: [_jsx("button", { onClick: confirmarBaixa, disabled: confirmandoBaixa, style: { padding: '0.6rem 1.2rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: confirmandoBaixa ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: confirmandoBaixa ? 0.7 : 1 }, children: confirmandoBaixa ? 'Processando...' : 'Baixar TODOS pendentes na Olist' }), _jsx("span", { style: { fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }, children: "Baixa em massa. Ou use \"Baixar\" linha por linha. N\u00E3o h\u00E1 volta!" })] })] })) : null })), inboundSelecionado?.id === inb.id && (_jsx("div", { style: { marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #eee' }, children: _jsx("div", { style: { display: 'grid', gap: '0.75rem' }, children: inboundSelecionado.itens?.map((item) => (_jsx("div", { style: {
                                                padding: '1rem',
                                                backgroundColor: item.validado ? '#f1f8f4' : '#fff8f0',
                                                borderRadius: '4px',
                                                borderLeft: `4px solid ${item.validado ? '#2e7d32' : '#ef6c00'}`
                                            }, children: _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '1rem', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'bold', fontSize: '0.95rem' }, children: item.titulo_anuncio }), _jsxs("div", { style: { fontSize: '0.82rem', color: '#666', marginTop: '0.3rem' }, children: ["SKU: ", _jsx("strong", { children: item.sku_inbound || '—' }), item.codigo_ml ? ` · ML: ${item.codigo_ml}` : ''] }), !item.validado && item.validacao_mensagem && (_jsx("div", { style: { fontSize: '0.8rem', color: '#ef6c00', marginTop: '0.3rem' }, children: item.validacao_mensagem }))] }), _jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("div", { style: { fontWeight: 'bold', fontSize: '1.1rem' }, children: Math.round(item.quantidade_separada) }), _jsx("div", { style: { fontSize: '0.78rem', color: '#666' }, children: "unidades" })] }), _jsx("div", { style: {
                                                            padding: '0.4rem 0.9rem',
                                                            backgroundColor: item.validado ? '#2e7d32' : '#ef6c00',
                                                            color: 'white',
                                                            borderRadius: '4px',
                                                            fontSize: '0.82rem',
                                                            fontWeight: 'bold',
                                                            whiteSpace: 'nowrap'
                                                        }, children: item.validado ? 'Vinculado' : 'Sem vínculo' })] }) }, item.id))) }) }))] }, inb.id))) }))] })), vinculandoItem && (_jsx("div", { onClick: () => { setVinculandoItem(null); setBuscaResultados([]); }, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { background: '#fff', borderRadius: '8px', padding: '1.5rem', width: '640px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }, children: [_jsx("h3", { style: { margin: 0 }, children: "Vincular a um an\u00FAncio da Olist" }), _jsx("button", { onClick: () => { setVinculandoItem(null); setBuscaResultados([]); }, style: { background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#999', lineHeight: 1 }, children: "\u00D7" })] }), _jsxs("div", { style: { fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }, children: ["Produto do inbound: ", _jsx("strong", { children: vinculandoItem.titulo_anuncio }), _jsx("br", {}), "SKU do inbound: ", _jsx("strong", { children: vinculandoItem.sku_inbound || '—' })] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' }, children: [_jsx("input", { type: "text", value: buscaTermo, onChange: (e) => setBuscaTermo(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                        buscarOlist(buscaTermo); }, placeholder: "Buscar por SKU ou nome do an\u00FAncio...", autoFocus: true, style: { flex: 1, padding: '0.6rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.95rem' } }), _jsx("button", { onClick: () => buscarOlist(buscaTermo), disabled: buscandoOlist, style: { padding: '0.6rem 1.2rem', background: '#1976D2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }, children: buscandoOlist ? 'Buscando...' : 'Buscar' })] }), buscandoOlist ? (_jsx("div", { style: { textAlign: 'center', padding: '1.5rem', color: '#666' }, children: "Buscando na Olist..." })) : buscaResultados.length === 0 ? (_jsx("div", { style: { textAlign: 'center', padding: '1.5rem', color: '#999' }, children: buscaTermo ? 'Nenhum anúncio encontrado. Tente outro termo.' : 'Digite um termo e busque.' })) : (_jsx("div", { style: { display: 'grid', gap: '0.5rem' }, children: buscaResultados.map((p) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.9rem', border: '1px solid #eee', borderRadius: '4px', gap: '1rem' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: '0.9rem' }, children: p.nome || p.descricao }), _jsxs("div", { style: { fontSize: '0.78rem', color: '#666' }, children: ["SKU: ", p.sku || p.codigo_produto || '—', p.preco ? ` · R$ ${Number(p.preco).toFixed(2)}` : ''] })] }), _jsx("button", { onClick: () => vincularAnuncio(p), disabled: vinculandoProduto, style: { padding: '0.4rem 1rem', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '4px', cursor: vinculandoProduto ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' }, children: vinculandoProduto ? '...' : 'Vincular' })] }, p.id))) }))] }) }))] }));
}
