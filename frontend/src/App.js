import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import './App.css';
import { ModalDetalhes } from './ModalDetalhes';
import { ModalDetalhesNota } from './ModalDetalhesNota';
import { ModalDetalhesNotaFiscal } from './ModalDetalhesNotaFiscal';
import { FornecedoresManager } from './components/FornecedoresManager';
import { EmbaldesManager } from './components/EmbaldesManager';
import { baixarMultiplosOuPdfs } from './services/api';
function App() {
    // Estados de navegação
    const [pagina, setPagina] = useState('inicial');
    const [notaSelecionada, setNotaSelecionada] = useState(null);
    const [produtosNota, setProdutosNota] = useState([]);
    // Estados da página inicial
    const [file, setFile] = useState(null);
    const [notas, setNotas] = useState([]);
    const [estoque, setEstoque] = useState([]);
    const [divergencias, setDivergencias] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [produtoSelecionado, setProdutoSelecionado] = useState(null);
    const [itensSelecionadosMultiplos, setItensSelecionadosMultiplos] = useState(new Set());
    // Grupos de produto expandidos manualmente (setinha). Grupos multi-registro
    // comecam colapsados; o usuario expande para ver todos os registros.
    const [gruposExpandidos, setGruposExpandidos] = useState(new Set());
    const [mostrarTodosEstoque, setMostrarTodosEstoque] = useState(false);
    const [modalDetalhesNFAberto, setModalDetalhesNFAberto] = useState(false);
    const [modalAdicionarProdutoAberto, setModalAdicionarProdutoAberto] = useState(false);
    const [novoProduto, setNovoProduto] = useState({
        codigo: '',
        descricao: '',
        quantidade: 1,
        preco: 0
    });
    const [produtoOlistSKU, setProdutoOlistSKU] = useState('');
    const [sugestoesSKU, setSugestoesSKU] = useState([]);
    const [produtoOlistSelecionado, setProdutoOlistSelecionado] = useState({
        id: '',
        sku: '',
        nome: '',
        preco: 0,
        estoque: 0,
        estoque_saldo: 0,
        estoque_reservado: 0
    });
    const [produtoConferindoAtualmente, setProdutoConferindoAtualmente] = useState(null);
    // Controla se o formulário de preenchimento manual está aberto (botão)
    const [mostrarManual, setMostrarManual] = useState(false);
    // Reserva de inbound ativo para o produto selecionado (regra do FULL)
    const [reservaInbound, setReservaInbound] = useState(0);
    const [reservaInboundInbs, setReservaInboundInbs] = useState('');
    // Candidatos do inbound que podem ser este mesmo produto (p/ confirmar)
    const [inboundCandidatos, setInboundCandidatos] = useState([]);
    const [candidatoVinculado, setCandidatoVinculado] = useState(null);
    const [vinculandoCandidato, setVinculandoCandidato] = useState(false);
    // Memória de vínculos (de-para fornecedor -> Olist)
    const [sugestaoVinculo, setSugestaoVinculo] = useState(null);
    const [sugestaoDispensada, setSugestaoDispensada] = useState(false);
    const [modalVinculosAberto, setModalVinculosAberto] = useState(false);
    const [listaVinculos, setListaVinculos] = useState([]);
    // Kit detectado
    const [kitDetectado, setKitDetectado] = useState(null);
    const [componentesKit, setComponentesKit] = useState([]);
    // Tela única: filtro + modal de detalhe com abas
    const [filtroBusca, setFiltroBusca] = useState('');
    const [filtroData, setFiltroData] = useState('');
    const [notaDetalheAberta, setNotaDetalheAberta] = useState(null);
    const [abaDetalhe, setAbaDetalhe] = useState('detalhes');
    const [notasSelecionadas, setNotasSelecionadas] = useState(new Set());
    const [deletando, setDeletando] = useState(false);
    const [downloadandoPdf, setDownloadandoPdf] = useState(false);
    const fileInputRef = useRef(null);
    // Debounce da busca de produtos Olist (evita 1 request por tecla)
    const buscaTimeoutRef = useRef(null);
    const [buscandoSKU, setBuscandoSKU] = useState(false);
    // Carregar notas ao iniciar
    useEffect(() => {
        loadNotas();
        loadEstoque();
        loadDivergencias();
    }, []);
    // Ao entrar na tela de vínculo, busca se esse produto já foi vinculado antes
    useEffect(() => {
        if (pagina === 'relacionamento_produto' && produtoSelecionado) {
            setSugestaoVinculo(null);
            setSugestaoDispensada(false);
            const codigo = produtoSelecionado.codigo_produto || '';
            const descricao = produtoSelecionado.descricao || '';
            fetch(`http://127.0.0.1:8000/api/olist/sugestao-vinculo?codigo=${encodeURIComponent(codigo)}&descricao=${encodeURIComponent(descricao)}`)
                .then((r) => r.json())
                .then((d) => { if (d.encontrado)
                setSugestaoVinculo(d.vinculo); })
                .catch(() => { });
        }
    }, [pagina, produtoSelecionado]);
    // Quando um anúncio Olist é selecionado, verifica se esse produto está
    // separado em algum inbound ATIVO (regra do FULL) para mostrar no preview.
    useEffect(() => {
        setCandidatoVinculado(null);
        setInboundCandidatos([]);
        if (!produtoOlistSelecionado.sku && !produtoOlistSelecionado.id) {
            setReservaInbound(0);
            setReservaInboundInbs('');
            return;
        }
        const params = new URLSearchParams({
            olist_produto_id: produtoOlistSelecionado.id || '',
            olist_sku: produtoOlistSelecionado.sku || ''
        });
        fetch(`http://127.0.0.1:8000/api/embaldes/reserva-produto?${params}`)
            .then((r) => r.json())
            .then((d) => {
            const reserva = Math.round(d.reservado_full || 0);
            setReservaInbound(reserva);
            setReservaInboundInbs((d.detalhes || []).map((x) => `#${x.numero_inbound}`).join(', '));
            // Se já casou direto (vínculo/SKU), não precisa pedir confirmação.
            if (reserva > 0)
                return;
            // Senão, busca CANDIDATOS no inbound (por título/SKU) p/ o usuário confirmar.
            const p2 = new URLSearchParams({
                olist_produto_id: produtoOlistSelecionado.id || '',
                olist_sku: produtoOlistSelecionado.sku || '',
                olist_nome: produtoOlistSelecionado.nome || ''
            });
            fetch(`http://127.0.0.1:8000/api/embaldes/buscar-no-inbound?${p2}`)
                .then((r) => r.json())
                .then((dc) => setInboundCandidatos(dc.candidatos || []))
                .catch(() => setInboundCandidatos([]));
        })
            .catch(() => { setReservaInbound(0); setReservaInboundInbs(''); });
    }, [produtoOlistSelecionado.id, produtoOlistSelecionado.sku]);
    // Confirma que um candidato do inbound é este produto: vincula o item do
    // inbound a este anúncio (de-para) e recalcula a reserva pro FULL.
    const confirmarCandidatoInbound = async (cand) => {
        if (!produtoOlistSelecionado.id) {
            alert('❌ Anúncio Olist sem ID — selecione o anúncio novamente.');
            return;
        }
        setVinculandoCandidato(true);
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/embaldes/${cand.inbound_id}/itens/${cand.item_id}/vincular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    olist_produto_id: produtoOlistSelecionado.id,
                    olist_sku: produtoOlistSelecionado.sku,
                    olist_nome: produtoOlistSelecionado.nome,
                    olist_preco: produtoOlistSelecionado.preco
                })
            });
            if (!res.ok) {
                const e = await res.json();
                alert('❌ Erro ao vincular ao inbound: ' + (e.erro || 'desconhecido'));
                return;
            }
            // Recalcula a reserva (agora casa por produto_id)
            const params = new URLSearchParams({
                olist_produto_id: produtoOlistSelecionado.id || '',
                olist_sku: produtoOlistSelecionado.sku || ''
            });
            const r = await fetch(`http://127.0.0.1:8000/api/embaldes/reserva-produto?${params}`);
            const d = await r.json();
            setReservaInbound(Math.round(d.reservado_full || 0));
            setReservaInboundInbs((d.detalhes || []).map((x) => `#${x.numero_inbound}`).join(', '));
            setCandidatoVinculado(cand);
            setInboundCandidatos([]);
        }
        catch (err) {
            alert('❌ Erro: ' + err);
        }
        finally {
            setVinculandoCandidato(false);
        }
    };
    // Usa a sugestão: busca dados frescos (estoque) do anúncio e seleciona
    const usarSugestao = async () => {
        if (!sugestaoVinculo)
            return;
        const termo = sugestaoVinculo.olist_sku || sugestaoVinculo.nf_codigo || '';
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/olist/produtos?q=${encodeURIComponent(termo)}`);
            const data = await res.json();
            const lista = data.produtos || [];
            const prod = lista.find((p) => String(p.id) === String(sugestaoVinculo.olist_produto_id)) || lista[0];
            if (prod) {
                handleSelecionarSKU(prod);
            }
            else {
                // fallback: usa os dados salvos (sem estoque ao vivo)
                handleSelecionarSKU({
                    id: sugestaoVinculo.olist_produto_id,
                    sku: sugestaoVinculo.olist_sku,
                    nome: sugestaoVinculo.olist_nome,
                    preco: sugestaoVinculo.olist_preco,
                    estoque_atual: 0,
                    estoque_saldo: 0,
                });
            }
        }
        catch {
            // fallback silencioso
        }
        finally {
            setSugestaoVinculo(null);
        }
    };
    const loadVinculos = async () => {
        try {
            const res = await fetch('http://127.0.0.1:8000/api/olist/vinculos');
            const data = await res.json();
            setListaVinculos(data.vinculos || []);
        }
        catch (err) {
            console.error('Erro ao carregar vínculos:', err);
        }
    };
    const abrirModalVinculos = () => {
        loadVinculos();
        setModalVinculosAberto(true);
    };
    const deletarVinculo = async (id) => {
        if (!window.confirm('Remover este vínculo salvo? Ele não será mais sugerido automaticamente.'))
            return;
        try {
            await fetch('http://127.0.0.1:8000/api/olist/vinculos/deletar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            loadVinculos();
        }
        catch (err) {
            alert('Erro ao remover vínculo');
        }
    };
    const toggleSelecaoNota = (notaId) => {
        const novo = new Set(notasSelecionadas);
        if (novo.has(notaId)) {
            novo.delete(notaId);
        }
        else {
            novo.add(notaId);
        }
        setNotasSelecionadas(novo);
    };
    const selecionarTodasNotas = () => {
        if (notasSelecionadas.size === notasFiltradas.length) {
            setNotasSelecionadas(new Set());
        }
        else {
            setNotasSelecionadas(new Set(notasFiltradas.map(n => n.id)));
        }
    };
    const excluirNotasSelecionadas = async () => {
        if (!window.confirm(`Tem certeza que deseja excluir ${notasSelecionadas.size} nota(s)? Esta ação não pode ser desfeita.`)) {
            return;
        }
        setDeletando(true);
        try {
            await fetch('http://127.0.0.1:8000/api/notas-fiscais/deletar-multiplas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nf_ids: Array.from(notasSelecionadas) }),
            });
            await loadNotas();
            setNotasSelecionadas(new Set());
        }
        catch (err) {
            alert('Erro ao excluir notas');
        }
        finally {
            setDeletando(false);
        }
    };
    const baixarNotasSelecionadas = async (formato = 'pdf') => {
        try {
            setDownloadandoPdf(true);
            await baixarMultiplosOuPdfs(Array.from(notasSelecionadas), formato);
        }
        finally {
            setDownloadandoPdf(false);
        }
    };
    const loadNotas = async () => {
        try {
            const res = await fetch('http://127.0.0.1:8000/api/notas-fiscais');
            const data = await res.json();
            setNotas(data.items || []);
            setNotasSelecionadas(new Set());
        }
        catch (err) {
            console.error('Erro ao carregar notas:', err);
        }
    };
    const loadEstoque = async () => {
        try {
            const res = await fetch('http://127.0.0.1:8000/api/estoque-virtual');
            const data = await res.json();
            setEstoque(data.produtos || []);
        }
        catch (err) {
            console.error('Erro ao carregar estoque:', err);
        }
    };
    const loadDivergencias = async () => {
        try {
            const res = await fetch('http://127.0.0.1:8000/api/divergencias');
            const data = await res.json();
            setDivergencias(data.divergencias || []);
        }
        catch (err) {
            console.error('Erro ao carregar divergências:', err);
        }
    };
    const irParaProximaEtapa = (novaPagina) => {
        setPagina(novaPagina);
        setModalOpen(false);
        loadNotas();
        loadDivergencias();
    };
    // Vai para a página de vínculo Olist usando a quantidade que REALMENTE chegou
    const irParaOlistSubirEstoque = (qtdConfirmada) => {
        setProdutoSelecionado((prev) => prev ? { ...prev, quantidade_nf: qtdConfirmada } : prev);
        // Limpa seleção anterior da Olist
        setProdutoOlistSelecionado({
            id: '', sku: '', nome: '', preco: 0,
            estoque: 0, estoque_saldo: 0, estoque_reservado: 0
        });
        setProdutoOlistSKU('');
        setSugestoesSKU([]);
        setMostrarManual(false);
        setModalOpen(false);
        setNotaDetalheAberta(null);
        setPagina('relacionamento_produto');
        loadNotas();
        loadDivergencias();
    };
    // Calcula progresso de estoque subido na Olist (0-100%)
    const calcularProgresso = (itens) => {
        const lista = itens || [];
        const total = lista.length;
        if (total === 0)
            return { conferidos: 0, total: 0, percentual: 0 };
        const conferidos = lista.filter((i) => !!i.estoque_olist_atualizado_em).length;
        return { conferidos, total, percentual: Math.round((conferidos / total) * 100) };
    };
    // Status automático da nota (pelo % subido na Olist)
    const statusNota = (nota) => {
        const { percentual } = calcularProgresso(nota.itens);
        if (percentual >= 100)
            return { label: 'CONCLUÍDA', cor: '#2e7d32', bg: '#e8f5e9', icone: '✅' };
        if (percentual > 0)
            return { label: 'EM ANDAMENTO', cor: '#1565c0', bg: '#e3f2fd', icone: '🔄' };
        return { label: 'A CONFERIR', cor: '#e65100', bg: '#fff3e0', icone: '🆕' };
    };
    // Abre o modal de detalhe da nota (busca dados frescos)
    const abrirDetalheNota = async (notaId) => {
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${notaId}`);
            const data = await res.json();
            setNotaDetalheAberta(data);
            setNotaSelecionada(data);
            setProdutosNota(data.itens || []);
            setAbaDetalhe('detalhes');
        }
        catch (err) {
            console.error('Erro ao abrir nota:', err);
        }
    };
    // Notas filtradas pela busca (nº, nome, CNPJ) e data
    const notasFiltradas = notas.filter((nota) => {
        const termo = filtroBusca.trim().toLowerCase();
        const casaTermo = !termo ||
            (nota.numero_nf || '').toLowerCase().includes(termo) ||
            (nota.fornecedor || '').toLowerCase().includes(termo) ||
            (nota.cnpj || '').toLowerCase().includes(termo);
        const casaData = !filtroData ||
            (nota.data_emissao || '').slice(0, 10) === filtroData;
        return casaTermo && casaData;
    });
    // Divergências apenas da nota aberta no detalhe
    const divergenciasDaNota = (nota) => !nota ? [] : divergencias.filter((d) => String(d.numero_nf) === String(nota.numero_nf));
    const resolverDivergenciaItem = async (itemId) => {
        const res = await fetch('http://127.0.0.1:8000/api/resolver-divergencia', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
        });
        if (res.ok) {
            alert('✅ Divergência marcada como resolvida');
            await loadDivergencias();
            await loadNotas();
        }
        else
            alert('❌ Erro ao resolver');
    };
    const deletarDivergenciaItem = async (itemId) => {
        if (!window.confirm('Tem certeza que deseja deletar esta divergência?'))
            return;
        const res = await fetch('http://127.0.0.1:8000/api/deletar-divergencia', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
        });
        if (res.ok) {
            alert('✅ Divergência deletada');
            await loadDivergencias();
            await loadNotas();
        }
        else
            alert('❌ Erro ao deletar');
    };
    // Da divergência -> tela de vincular Olist (sobe a quantidade recebida)
    const vincularDivergenciaOlist = (div) => {
        setProdutoSelecionado({
            id: div.item_id,
            descricao: div.produto,
            codigo_produto: div.codigo,
            quantidade_nf: div.quantidade_confirmada,
            preco_unitario: 0,
        });
        setProdutoOlistSelecionado({ id: '', sku: '', nome: '', preco: 0, estoque: 0, estoque_saldo: 0, estoque_reservado: 0 });
        setProdutoOlistSKU('');
        setSugestoesSKU([]);
        setMostrarManual(false);
        setNotaDetalheAberta(null);
        setPagina('relacionamento_produto');
    };
    // Abre conferência de um produto (a partir da aba Conferência)
    const conferirProduto = (item) => {
        if (!notaDetalheAberta)
            return;
        const produtoEstoque = {
            id_item: item.id,
            descricao: item.descricao,
            codigo_produto: item.codigo_produto,
            quantidade_total: item.quantidade_nf,
            quantidade_nf: item.quantidade_nf,
            quantidade_confirmada: item.quantidade_confirmada ?? item.quantidade_nf,
            preco_unitario: item.preco_unitario,
            notas_fiscais: [{
                    numero_nf: notaDetalheAberta.numero_nf || '', serie: notaDetalheAberta.serie || '',
                    fornecedor: notaDetalheAberta.fornecedor || '', quantidade: item.quantidade_nf
                }]
        };
        setProdutoSelecionado(produtoEstoque);
        setModalOpen(true);
    };
    const toggleSelecaoMultipla = (itemId) => {
        const novo = new Set(itensSelecionadosMultiplos);
        if (novo.has(itemId)) {
            novo.delete(itemId);
        }
        else {
            novo.add(itemId);
        }
        setItensSelecionadosMultiplos(novo);
    };
    // Agrupa itens pela descrição
    const agruparItensPorDescricao = (itens) => {
        const grupos = {};
        itens.forEach((item) => {
            if (!grupos[item.descricao]) {
                grupos[item.descricao] = [];
            }
            grupos[item.descricao].push(item);
        });
        return Object.entries(grupos).map(([descricao, items]) => ({
            descricao,
            items,
            totalQtd: items.reduce((s, i) => s + i.quantidade_nf, 0),
            selecionados: items.filter(i => itensSelecionadosMultiplos.has(i.id))
        }));
    };
    const enviarMultiplosEmMassa = async () => {
        if (!notaDetalheAberta || itensSelecionadosMultiplos.size === 0)
            return;
        const notaSelecionada = notaDetalheAberta;
        const itensArray = (notaSelecionada.itens || []).filter(i => itensSelecionadosMultiplos.has(i.id));
        if (itensArray.length === 0)
            return;
        const primeiroItem = itensArray[0];
        const descricaoComum = primeiroItem.descricao;
        const qtdTotal = itensArray.reduce((s, i) => s + i.quantidade_nf, 0);
        const msg = `Confirmar envio em massa?\n\n` +
            `Produto: ${descricaoComum}\n` +
            `Quantidade de registros: ${itensArray.length}\n` +
            `Quantidade total: ${Math.round(qtdTotal)} unidades\n\n` +
            `Os registros serão agrupados e enviados como uma única entrada para a Olist.`;
        if (!window.confirm(msg))
            return;
        setProdutoSelecionado({
            id_item: itensArray[0].id,
            descricao: descricaoComum,
            codigo_produto: itensArray[0].codigo_produto,
            quantidade_total: qtdTotal,
            quantidade_nf: qtdTotal,
            quantidade_confirmada: qtdTotal,
            preco_unitario: itensArray[0].preco_unitario,
            notas_fiscais: itensArray.map(i => ({
                numero_nf: notaSelecionada.numero_nf || '',
                serie: notaSelecionada.serie || '',
                fornecedor: notaSelecionada.fornecedor || '',
                quantidade: i.quantidade_nf
            }))
        });
        setItensSelecionadosMultiplos(new Set());
        setModalOpen(true);
    };
    // Componente de barra de progresso reutilizável
    const BarraProgresso = ({ itens, compacto = false }) => {
        const { conferidos, total, percentual } = calcularProgresso(itens);
        const cor = percentual === 100 ? '#4caf50' : percentual > 0 ? '#007acc' : '#bdbdbd';
        return (_jsxs("div", { style: { marginTop: compacto ? '0.5rem' : '0' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }, children: [_jsxs("span", { style: { fontSize: compacto ? '0.75rem' : '0.85rem', color: '#666', fontWeight: 600 }, children: ["Subidos na Olist: ", conferidos, "/", total] }), _jsxs("span", { style: { fontSize: compacto ? '0.75rem' : '0.85rem', color: cor, fontWeight: 700 }, children: [percentual, "%"] })] }), _jsx("div", { style: { background: '#e0e0e0', borderRadius: '999px', height: compacto ? '6px' : '10px', overflow: 'hidden' }, children: _jsx("div", { style: {
                            width: `${percentual}%`,
                            height: '100%',
                            background: cor,
                            borderRadius: '999px',
                            transition: 'width 0.4s ease'
                        } }) })] }));
    };
    // Dados mock de produtos Olist (futuramente virá de uma API real)
    const produtosOlistMock = [
        { sku: '001', nome: 'Produto XYZ - Azul', preco: 49.90, estoque: 15 },
        { sku: '002', nome: 'Produto XYZ - Vermelho', preco: 49.90, estoque: 8 },
        { sku: '003', nome: 'Produto ABC - P', preco: 35.00, estoque: 12 },
        { sku: '004', nome: 'Produto ABC - M', preco: 35.00, estoque: 20 },
        { sku: '005', nome: 'Produto ABC - G', preco: 35.00, estoque: 5 },
        { sku: '006', nome: 'Camiseta Premium - Branco', preco: 79.90, estoque: 30 },
        { sku: '007', nome: 'Camiseta Premium - Preto', preco: 79.90, estoque: 25 },
        { sku: '008', nome: 'Bermuda Casual - Azul', preco: 89.90, estoque: 10 },
    ];
    const handleBuscarSKU = (busca) => {
        // Atualiza o input imediatamente (resposta instantanea ao digitar)
        setProdutoOlistSKU(busca);
        // Cancela a busca anterior agendada
        if (buscaTimeoutRef.current) {
            clearTimeout(buscaTimeoutRef.current);
        }
        if (busca.length < 2) {
            setSugestoesSKU([]);
            setBuscandoSKU(false);
            return;
        }
        // Debounce: so dispara a busca 300ms apos parar de digitar
        setBuscandoSKU(true);
        buscaTimeoutRef.current = setTimeout(() => {
            executarBuscaSKU(busca);
        }, 300);
    };
    const executarBuscaSKU = async (busca) => {
        try {
            const response = await fetch(`http://127.0.0.1:8000/api/olist/produtos?q=${encodeURIComponent(busca)}`);
            if (!response.ok && response.status === 503) {
                setSugestoesSKU([]);
                setMessage({
                    type: 'warning',
                    text: '⚠️ Configure sua chave de API da Olist no arquivo .env para usar a busca em tempo real.'
                });
                return;
            }
            const data = await response.json();
            setSugestoesSKU(data.produtos && Array.isArray(data.produtos) ? data.produtos : []);
        }
        catch (err) {
            console.error('Erro ao buscar produtos Olist:', err);
            setSugestoesSKU([]);
            setMessage({
                type: 'error',
                text: '❌ Erro ao buscar produtos da Olist. Verifique se a API está disponível.'
            });
        }
        finally {
            setBuscandoSKU(false);
        }
    };
    const handleSelecionarSKU = async (produto) => {
        // Tentar detectar kit automaticamente
        try {
            const resDeteccao = await fetch(`http://127.0.0.1:8000/api/olist/detectar-kit?sku=${encodeURIComponent(produto.sku.toUpperCase())}`);
            const dataDeteccao = await resDeteccao.json();
            if (dataDeteccao.eh_kit) {
                // É um kit! Extrair componentes
                console.log('[KIT-DETECTADO]', dataDeteccao);
                setKitDetectado({
                    eh_kit: true,
                    sku_kit: dataDeteccao.sku_principal,
                    nome_kit: dataDeteccao.nome_kit,
                    skus_componentes: dataDeteccao.componentes.map((c) => c.sku),
                    quantidade_componentes: dataDeteccao.componentes.length,
                    id_kit: 0
                });
                setComponentesKit(dataDeteccao.componentes.map((c) => ({
                    sku: c.sku,
                    olist_produto_id: c.id,
                    olist_nome: c.nome || c.descricao,
                    olist_preco: c.preco
                })));
                setProdutoOlistSKU('');
                setSugestoesSKU([]);
                return;
            }
        }
        catch (err) {
            console.log('[KIT-AUTO] Detecção falhou, usando fluxo normal:', err);
        }
        // Não é kit ou detecção falhou - usar fluxo normal
        // Seleciona imediatamente (sem estoque ainda) para a UI responder rápido
        setProdutoOlistSelecionado({
            id: produto.id || '',
            sku: produto.sku || '',
            nome: produto.nome || '',
            preco: parseFloat(produto.preco) || 0,
            estoque: parseInt(produto.estoque_atual ?? produto.estoque) || 0,
            estoque_saldo: parseInt(produto.estoque_saldo ?? produto.estoque_atual) || 0,
            estoque_reservado: parseInt(produto.estoque_reservado) || 0
        });
        setProdutoOlistSKU('');
        setSugestoesSKU([]);
        // Busca o estoque atual sob demanda (1 requisição rápida)
        if (produto.id && (produto.estoque_atual === undefined || produto.estoque_atual === null)) {
            try {
                const resEstoque = await fetch(`http://127.0.0.1:8000/api/olist/estoque-produto?id=${encodeURIComponent(produto.id)}`);
                const estoque = await resEstoque.json();
                setProdutoOlistSelecionado((prev) => ({
                    ...prev,
                    estoque: parseInt(estoque.estoque_atual) || 0,
                    estoque_saldo: parseInt(estoque.estoque_saldo) || 0,
                    estoque_reservado: parseInt(estoque.estoque_reservado) || 0
                }));
            }
            catch (err) {
                console.error('Erro ao buscar estoque do produto:', err);
            }
        }
    };
    const handleVincularKit = async (kit, componentes) => {
        if (!produtoSelecionado) {
            alert('❌ Erro: nenhum produto selecionado');
            return;
        }
        const itemId = produtoSelecionado.id ?? produtoSelecionado.id_item;
        if (!itemId) {
            alert('❌ Erro: item sem identificador');
            return;
        }
        const qtdNF = Math.round(produtoSelecionado.quantidade_nf);
        const mensagem = `Confirmar vinculação do KIT?\n\n` +
            `Kit: ${kit.nome_kit}\n` +
            `SKU: ${kit.sku_kit}\n` +
            `Componentes: ${componentes.length}\n\n` +
            `Cada componente será atualizado com: +${qtdNF} unidades\n\n` +
            `Deseja continuar?`;
        if (!window.confirm(mensagem))
            return;
        try {
            // Vincular kit + atualizar estoque de cada componente
            const res = await fetch('http://127.0.0.1:8000/api/olist/kits/vincular-com-componentes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: itemId,
                    sku_kit: kit.sku_kit,
                    componentes: componentes
                })
            });
            const data = await res.json();
            if (res.ok && data.sucesso) {
                const sucessos = data.resultados_componentes.filter((r) => r.sucesso).length;
                const falhas = data.resultados_componentes.filter((r) => !r.sucesso).length;
                let detalhesMsg = `✅ Kit vinculado com sucesso!\n\n`;
                detalhesMsg += `Kit: ${kit.nome_kit}\n`;
                detalhesMsg += `Componentes atualizados: ${sucessos}/${componentes.length}\n\n`;
                // Mostrar detalhes de cada componente
                data.resultados_componentes.forEach((comp) => {
                    if (comp.sucesso) {
                        detalhesMsg += `✅ ${comp.sku}\n`;
                        detalhesMsg += `   ${comp.estoque_anterior} + ${comp.quantidade_adicionada} = ${comp.novo_estoque} un\n`;
                    }
                    else {
                        detalhesMsg += `❌ ${comp.sku} - Erro: ${comp.erro}\n`;
                    }
                });
                alert(detalhesMsg);
                // Recarregar nota para atualizar status do item
                const nfId = notaDetalheAberta?.id ?? notaSelecionada?.id;
                if (nfId) {
                    try {
                        const resNota = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${nfId}`);
                        const dataNota = await resNota.json();
                        setProdutosNota(dataNota.itens || []);
                        setNotaDetalheAberta(dataNota);
                    }
                    catch (err) {
                        console.error('Erro ao recarregar nota:', err);
                    }
                }
                await loadNotas();
                await loadDivergencias();
                setKitDetectado(null);
                setComponentesKit([]);
                voltarParaInicial();
            }
            else {
                alert('❌ Erro ao vincular kit: ' + (data.erro || 'desconhecido'));
            }
        }
        catch (err) {
            alert('❌ Erro: ' + err);
        }
    };
    const handleVincular = async () => {
        if (!produtoOlistSelecionado.sku || !produtoSelecionado) {
            alert('❌ Selecione um anúncio da Olist primeiro!');
            return;
        }
        // O item pode vir com 'id' (divergência) ou 'id_item' (conferência)
        const itemId = produtoSelecionado.id ?? produtoSelecionado.id_item;
        if (!itemId) {
            alert('❌ Erro: item sem identificador. Volte e selecione o produto novamente.');
            return;
        }
        const qtdNF = Math.round(produtoSelecionado.quantidade_nf);
        const saldoAtual = produtoOlistSelecionado.estoque_saldo;
        // REGRA DO INBOUND: verifica se este produto está separado para FULL
        // em algum inbound ativo (que ainda não deu baixa). Se estiver, segura
        // essa quantidade — sobe na Olist só o restante.
        let reservaFull = 0;
        let reservaInfo = '';
        try {
            const params = new URLSearchParams({
                olist_produto_id: produtoOlistSelecionado.id || '',
                olist_sku: produtoOlistSelecionado.sku || ''
            });
            const resR = await fetch(`http://127.0.0.1:8000/api/embaldes/reserva-produto?${params}`);
            const dataR = await resR.json();
            reservaFull = Math.round(dataR.reservado_full || 0);
            if (reservaFull > 0) {
                const inbs = (dataR.detalhes || []).map((d) => `#${d.numero_inbound}`).join(', ');
                reservaInfo = `\n⚠️ ${reservaFull} un estão num inbound ativo (${inbs}) e serão SEGURADAS pro FULL.\n`;
            }
        }
        catch { /* se falhar, segue sem reserva */ }
        const qtdSubir = Math.max(0, qtdNF - reservaFull);
        const novoSaldo = saldoAtual + qtdSubir;
        const confirmar = window.confirm(`Confirmar atualização de estoque na Olist?\n\n` +
            `Produto: ${produtoOlistSelecionado.nome}\n` +
            `SKU: ${produtoOlistSelecionado.sku}\n\n` +
            `Estoque atual na Olist: ${saldoAtual} un\n` +
            `Quantidade da NF: ${qtdNF} un\n` +
            reservaInfo +
            `→ Vai subir na Olist: ${qtdSubir} un\n` +
            `= Novo estoque total: ${novoSaldo} un\n\n` +
            `Deseja continuar?`);
        if (!confirmar)
            return;
        try {
            // 1. Vincular produto NF -> anúncio Olist
            const resVinc = await fetch('http://127.0.0.1:8000/api/olist/vincular-produto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: itemId,
                    olist_produto_id: produtoOlistSelecionado.id,
                    olist_sku: produtoOlistSelecionado.sku,
                    olist_nome: produtoOlistSelecionado.nome,
                    olist_preco: produtoOlistSelecionado.preco
                })
            });
            if (!resVinc.ok) {
                const err = await resVinc.json();
                alert('❌ Erro ao vincular: ' + (err.error || 'desconhecido'));
                return;
            }
            // 2. Atualizar estoque na Olist (ENTRADA da quantidade da NF)
            // Em subida em massa, envia todos os IDs do grupo para marcar todos como subidos
            const idsMassa = produtoSelecionado.ids_massa;
            const resEst = await fetch('http://127.0.0.1:8000/api/olist/atualizar-estoque', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: itemId,
                    item_ids: idsMassa && idsMassa.length > 1 ? idsMassa : undefined,
                    quantidade: qtdNF,
                    tipo: 'E'
                })
            });
            const dataEst = await resEst.json();
            if (resEst.ok && dataEst.sucesso) {
                alert(`✅ Sucesso!\n\n${dataEst.mensagem || 'Produto vinculado e estoque atualizado na Olist.'}`);
                // Recarregar dados
                await loadNotas();
                await loadDivergencias();
                // Voltar para HOME com o modal da nota aberto na aba de conferência
                setPagina('inicial');
                setModalDetalhesNFAberto(false);
                setAbaDetalhe('conferencia');
                // Reabrir o modal com a nota ATUALIZADA da API (nao a versao antiga em
                // memoria) - senao os itens recem-subidos continuam aparecendo "A conferir"
                const nfIdReabrir = notaDetalheAberta?.id ?? notaSelecionada?.id;
                if (nfIdReabrir) {
                    try {
                        const resNota = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${nfIdReabrir}`);
                        const notaAtualizada = await resNota.json();
                        setNotaSelecionada(notaAtualizada);
                        setNotaDetalheAberta(notaAtualizada);
                    }
                    catch {
                        if (notaSelecionada)
                            setNotaDetalheAberta(notaSelecionada);
                    }
                }
                return;
            }
            else {
                alert('⚠️ Produto vinculado, mas falha ao atualizar estoque: ' + (dataEst.error || 'desconhecido'));
            }
        }
        catch (err) {
            alert('❌ Erro: ' + err);
        }
    };
    const handleAdicionarProduto = async () => {
        if (!novoProduto.codigo || !novoProduto.descricao) {
            alert('❌ Preencha código e descrição!');
            return;
        }
        try {
            const res = await fetch('http://127.0.0.1:8000/api/produtos-manuais', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nf_id: notaSelecionada?.id,
                    codigo_recebido: novoProduto.codigo,
                    descricao_recebida: novoProduto.descricao,
                    quantidade: novoProduto.quantidade,
                    preco: novoProduto.preco
                })
            });
            if (res.ok) {
                alert('✅ Produto adicionado ao estoque!');
                setModalAdicionarProdutoAberto(false);
                setNovoProduto({ codigo: '', descricao: '', quantidade: 1, preco: 0 });
                // Recarregar a nota para atualizar a lista/abas
                const nfId = notaDetalheAberta?.id ?? notaSelecionada?.id;
                if (nfId) {
                    const resNota = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${nfId}`);
                    const dataNota = await resNota.json();
                    setProdutosNota(dataNota.itens || []);
                    setNotaDetalheAberta(dataNota);
                }
                loadNotas();
            }
            else {
                alert('❌ Erro ao adicionar produto');
            }
        }
        catch (err) {
            alert('❌ Erro: ' + err);
        }
    };
    const abrirNotaSelecionada = async (notaId) => {
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${notaId}`);
            const data = await res.json();
            setNotaSelecionada(data);
            setPagina('inicial'); // Mantém na inicial mas mostra a nota selecionada
        }
        catch (err) {
            console.error('Erro ao buscar nota:', err);
        }
    };
    const irParaConferenciaProdutos = async () => {
        if (!notaSelecionada)
            return;
        try {
            // Buscar dados frescos da nota para refletir conferências já feitas
            const res = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${notaSelecionada.id}`);
            const data = await res.json();
            setNotaSelecionada(data);
            setProdutosNota(data.itens || []);
        }
        catch (err) {
            setProdutosNota(notaSelecionada.itens || []);
        }
        setPagina('produtos_nota');
    };
    const abrirConferencia = async (notaId) => {
        try {
            const res = await fetch(`http://127.0.0.1:8000/api/notas-fiscais/${notaId}`);
            const data = await res.json();
            setNotaSelecionada(data);
            setPagina('conferencia');
            setMostrarTodosEstoque(false);
        }
        catch (err) {
            console.error('Erro ao buscar nota:', err);
        }
    };
    const voltarParaInicial = () => {
        setPagina('inicial');
        setNotaSelecionada(null);
    };
    const enviarWhatsApp = (produto, quantidadeEsperada, quantidadeRecebida, tipo) => {
        let mensagem = '';
        const telefone = '5519978149245'; // WhatsApp sem formatação
        if (tipo === 'a_mais') {
            mensagem = `Produto ${produto}: Chegou com quantidade MAIOR. Esperado: ${quantidadeEsperada} | Recebido: ${quantidadeRecebida}`;
        }
        else if (tipo === 'a_menos') {
            mensagem = `Produto ${produto}: Chegou com quantidade MENOR. Esperado: ${quantidadeEsperada} | Recebido: ${quantidadeRecebida}`;
        }
        else {
            mensagem = `Produto ${produto}: NÃO CHEGOU. Esperado: ${quantidadeEsperada} | Recebido: 0`;
        }
        const urlWhatsApp = `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
        window.open(urlWhatsApp, '_blank');
    };
    const abrirDetalhes = (produto) => {
        setProdutoSelecionado(produto);
        setModalOpen(true);
    };
    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file) {
            setMessage('Selecione um arquivo!');
            return;
        }
        setLoading(true);
        setMessage('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('http://127.0.0.1:8000/api/upload-nfe', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                setMessage(`NF #${data.numero_nf} - ${data.itens_encontrados} itens importados com sucesso`);
                setFile(null);
                loadNotas();
                loadEstoque();
            }
            else {
                setMessage(`Erro: ${data.error || 'Erro desconhecido'}`);
            }
        }
        catch (err) {
            setMessage(`Erro: ${err}`);
        }
        finally {
            setLoading(false);
        }
    };
    // ===== PÁGINA INICIAL =====
    if (pagina === 'inicial') {
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "NVS TECH" }), _jsx("p", { children: "Sistema de Gest\u00E3o Inteligente de Estoque para Opera\u00E7\u00F5es de Log\u00EDstica e Marketplace" })] }) }), _jsxs("main", { className: "container main-content", children: [message && (_jsx("div", { className: `message ${message.includes('sucesso') ? 'success' : 'error'}`, children: message })), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: '1.5rem', alignItems: 'start' }, children: [_jsxs("div", { className: "card", children: [_jsx("h2", { children: "Upload de Nota Fiscal" }), _jsxs("div", { className: "card-body", children: [_jsxs("form", { onSubmit: handleUpload, style: { display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("div", { onClick: () => fileInputRef.current?.click(), style: { flex: 1, minWidth: '260px', border: '2px dashed #cfd8dc', borderRadius: '8px', padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }, children: [_jsx("span", { style: { fontSize: '1.5rem' }, children: "\u2B06\uFE0F" }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, color: '#1a1a1a' }, children: file ? file.name : 'Selecione um arquivo XML ou PDF' }), _jsx("div", { style: { fontSize: '0.8rem', color: '#90a4ae' }, children: "Clique para escolher" })] })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".xml,.pdf", onChange: (e) => setFile(e.target.files?.[0] || null), disabled: loading, style: { display: 'none' } }), _jsx("button", { type: "submit", disabled: !file || loading, className: "upload-button", style: { whiteSpace: 'nowrap' }, children: loading ? 'Processando...' : 'Enviar NF-e' })] }), _jsxs("div", { style: { marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }, children: [_jsx("button", { onClick: () => setPagina('fornecedores'), style: {
                                                                padding: '0.75rem 1rem',
                                                                background: '#fff',
                                                                color: '#333',
                                                                border: '1px solid #ddd',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontWeight: 600,
                                                                fontSize: '0.95rem',
                                                                transition: 'all 0.2s ease'
                                                            }, onMouseEnter: (e) => {
                                                                const el = e.currentTarget;
                                                                el.style.background = '#f5f5f5';
                                                                el.style.borderColor = '#999';
                                                            }, onMouseLeave: (e) => {
                                                                const el = e.currentTarget;
                                                                el.style.background = '#fff';
                                                                el.style.borderColor = '#ddd';
                                                            }, children: "\uD83D\uDC65 Fornecedores" }), _jsx("button", { onClick: () => setPagina('embaldes'), style: {
                                                                padding: '0.75rem 1rem',
                                                                background: '#fff',
                                                                color: '#333',
                                                                border: '1px solid #ddd',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontWeight: 600,
                                                                fontSize: '0.95rem',
                                                                transition: 'all 0.2s ease'
                                                            }, onMouseEnter: (e) => {
                                                                const el = e.currentTarget;
                                                                el.style.background = '#f5f5f5';
                                                                el.style.borderColor = '#999';
                                                            }, onMouseLeave: (e) => {
                                                                const el = e.currentTarget;
                                                                el.style.background = '#fff';
                                                                el.style.borderColor = '#ddd';
                                                            }, children: "Inbound" })] })] })] }), _jsxs("div", { className: "card", children: [_jsxs("h2", { style: { marginTop: 0 }, children: ["Notas Fiscais (", notasFiltradas.length, ")"] }), _jsxs("div", { className: "card-body", children: [_jsxs("div", { style: { display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }, children: [_jsx("input", { type: "text", value: filtroBusca, onChange: (e) => setFiltroBusca(e.target.value), placeholder: "Buscar por n\u00BA da nota, fornecedor ou CNPJ...", style: { flex: 1, minWidth: '240px', padding: '0.7rem 0.9rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.9rem' } }), _jsx("input", { type: "date", value: filtroData, onChange: (e) => setFiltroData(e.target.value), title: "Filtrar por data de emiss\u00E3o", style: { padding: '0.7rem 0.9rem', border: '1px solid #cfd8dc', borderRadius: '6px', fontSize: '0.9rem' } }), (filtroBusca || filtroData) && (_jsx("button", { onClick: () => { setFiltroBusca(''); setFiltroData(''); }, style: { padding: '0.7rem 1rem', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }, children: "Limpar" }))] }), notasSelecionadas.size > 0 && (_jsxs("div", { style: { background: 'linear-gradient(90deg, #2196F3 0%, #1976D2 100%)', color: 'white', padding: '1rem 1.5rem', borderRadius: '4px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)' }, children: [_jsxs("span", { style: { fontWeight: 600 }, children: [notasSelecionadas.size, " selecionada", notasSelecionadas.size !== 1 ? 's' : ''] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem' }, children: [_jsx("button", { onClick: () => baixarNotasSelecionadas('pdf'), disabled: deletando || downloadandoPdf, style: { padding: '0.6rem 1.2rem', background: '#FF9800', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', opacity: downloadandoPdf ? 0.6 : 1 }, children: downloadandoPdf ? '...' : '📄 PDF' }), _jsx("button", { onClick: () => baixarNotasSelecionadas('original'), disabled: deletando || downloadandoPdf, style: { padding: '0.6rem 1.2rem', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }, children: "\uD83D\uDCE5 Original" }), _jsx("button", { onClick: excluirNotasSelecionadas, disabled: deletando || downloadandoPdf, style: { padding: '0.6rem 1.2rem', background: '#f44336', color: 'white', border: 'none', borderRadius: '3px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', opacity: deletando ? 0.6 : 1 }, children: deletando ? '...' : '🗑 Excluir' })] })] })), notasFiltradas.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: notas.length === 0 ? 'Nenhuma nota processada ainda. Faça o upload de uma NF-e acima.' : 'Nenhuma nota encontrada com esse filtro.' })) : (_jsxs("div", { style: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.6rem 1.1rem', background: '#f7f9fa', borderBottom: '1px solid #e0e0e0', fontSize: '0.72rem', fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' }, children: [_jsx("div", { style: { width: '30px' }, children: _jsx("input", { type: "checkbox", checked: notasSelecionadas.size === notasFiltradas.length && notasFiltradas.length > 0, onChange: selecionarTodasNotas, title: "Selecionar/Desselecionar todas", style: { cursor: 'pointer', width: '18px', height: '18px' } }) }), _jsx("div", { style: { width: 130 }, children: "Status" }), _jsx("div", { style: { flex: 1 }, children: "Nota / Fornecedor" }), _jsx("div", { style: { width: 150, textAlign: 'right' }, children: "Emiss\u00E3o" }), _jsx("div", { style: { width: 200 }, children: "Progresso (Olist)" })] }), notasFiltradas.map((nota, idx) => {
                                                            const st = statusNota(nota);
                                                            const isSelected = notasSelecionadas.has(nota.id);
                                                            return (_jsxs("div", { onClick: () => !isSelected && abrirDetalheNota(nota.id), style: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1.1rem', cursor: 'pointer', background: isSelected ? '#e3f2fd' : '#fff', borderTop: idx > 0 ? '1px solid #eef2f4' : 'none', transition: 'background .15s', borderLeft: isSelected ? '4px solid #2196F3' : 'none' }, onMouseEnter: (e) => { if (!isSelected)
                                                                    e.currentTarget.style.background = '#f5f9ff'; }, onMouseLeave: (e) => { if (!isSelected)
                                                                    e.currentTarget.style.background = '#fff'; }, children: [_jsx("div", { style: { width: '30px', display: 'flex', justifyContent: 'center' }, children: _jsx("input", { type: "checkbox", checked: isSelected, onChange: () => toggleSelecaoNota(nota.id), onClick: (e) => e.stopPropagation(), style: { cursor: 'pointer', width: '18px', height: '18px' } }) }), _jsx("div", { style: { width: 130 }, children: _jsxs("span", { style: { background: st.bg, color: st.cor, fontWeight: 700, fontSize: '0.68rem', padding: '0.25rem 0.55rem', borderRadius: '999px', whiteSpace: 'nowrap' }, children: [st.icone, " ", st.label] }) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: { fontWeight: 700, color: '#1a1a1a', fontSize: '0.92rem' }, children: ["NF #", nota.numero_nf] }), _jsxs("div", { style: { color: '#607d8b', fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: [nota.fornecedor, nota.cnpj ? ` · CNPJ ${nota.cnpj}` : '', " \u00B7 ", nota.itens?.length || 0, " itens"] })] }), _jsx("div", { style: { width: 150, textAlign: 'right', color: '#90a4ae', fontSize: '0.82rem', whiteSpace: 'nowrap' }, children: nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR') : 's/ data' }), _jsx("div", { style: { width: 200 }, children: _jsx(BarraProgresso, { itens: nota.itens, compacto: true }) })] }, nota.id));
                                                        })] }))] })] })] }), _jsxs("div", { style: { display: 'none' }, children: [_jsxs("div", { className: "card", children: [_jsx("h2", { children: "Upload de Nota Fiscal" }), _jsx("div", { className: "card-body", children: _jsxs("form", { onSubmit: handleUpload, children: [_jsxs("div", { className: "upload-section", onClick: () => fileInputRef.current?.click(), children: [_jsx("div", { className: "upload-icon", children: "\u2191" }), _jsx("h3", { children: "Selecione um arquivo" }), _jsx("p", { children: "XML ou PDF de NF-e" }), _jsx("p", { style: { fontSize: '0.85rem', color: '#6b7280' }, children: file ? file.name : 'Clique ou arraste um arquivo' })] }), _jsx("div", { className: "file-input-wrapper", children: _jsx("input", { ref: fileInputRef, type: "file", accept: ".xml,.pdf", onChange: (e) => setFile(e.target.files?.[0] || null), disabled: loading, className: "file-input" }) }), _jsx("button", { type: "submit", disabled: !file || loading, className: "upload-button", children: loading ? 'Processando...' : 'Enviar NF-e' })] }) })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { children: "Notas Fiscais Processadas" }), _jsx("div", { className: "card-body", children: notas.length === 0 ? (_jsx("p", { style: { color: '#666', textAlign: 'center', padding: '2rem' }, children: "Nenhuma nota processada" })) : (_jsx("div", { className: "notas-list", children: notas.map((nota) => (_jsxs("div", { className: "nota-item", onClick: () => abrirNotaSelecionada(nota.id), style: {
                                                        cursor: 'pointer',
                                                        backgroundColor: notaSelecionada?.id === nota.id ? '#e3f2fd' : '#f9f9f9',
                                                        borderLeftColor: notaSelecionada?.id === nota.id ? '#0d47a1' : '#007acc',
                                                    }, children: [_jsxs("div", { className: "nota-number", children: ["NF #", nota.numero_nf] }), _jsxs("div", { className: "nota-info", children: ["Fornecedor: ", _jsx("strong", { children: nota.fornecedor })] }), _jsxs("div", { className: "nota-info", children: ["S\u00E9rie: ", _jsx("strong", { children: nota.serie })] }), _jsx("div", { className: "nota-status", children: nota.status.toUpperCase() }), _jsx(BarraProgresso, { itens: nota.itens, compacto: true })] }, nota.id))) })) })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { children: "Estoque Virtual - Pr\u00E9via" }), _jsx("div", { className: "card-body", children: !notaSelecionada ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem', fontSize: '0.95rem' }, children: "Selecione uma nota fiscal para ver a pr\u00E9via" })) : (_jsxs("div", { children: [_jsxs("div", { style: { background: '#f9f9f9', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' }, children: [_jsx("h3", { style: { color: '#1a1a1a', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: '600' }, children: notaSelecionada.fornecedor }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }, children: [_jsx("span", { style: { color: '#666', fontSize: '0.9rem' }, children: "NF:" }), _jsx("span", { style: { color: '#1a1a1a', fontWeight: '600' }, children: notaSelecionada.numero_nf })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }, children: [_jsx("span", { style: { color: '#666', fontSize: '0.9rem' }, children: "S\u00E9rie:" }), _jsx("span", { style: { color: '#1a1a1a', fontWeight: '600' }, children: notaSelecionada.serie })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }, children: [_jsx("span", { style: { color: '#666', fontSize: '0.9rem' }, children: "Itens:" }), _jsx("span", { style: { color: '#1a1a1a', fontWeight: '600' }, children: notaSelecionada.itens?.length || 0 })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid #e0e0e0' }, children: [_jsx("span", { style: { color: '#666', fontSize: '0.9rem', fontWeight: '600' }, children: "Valor Total:" }), _jsxs("span", { style: { color: '#007acc', fontWeight: '700', fontSize: '1rem' }, children: ["R$ ", (notaSelecionada.itens?.reduce((sum, item) => sum + (item.quantidade_nf * item.preco_unitario), 0) || 0).toFixed(2)] })] })] }), _jsxs("div", { style: { background: '#f5f5f5', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', maxHeight: '200px', overflowY: 'auto' }, children: [_jsxs("p", { style: { color: '#999', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.75rem', textTransform: 'uppercase' }, children: ["Produtos (", notaSelecionada.itens?.length || 0, ")"] }), notaSelecionada.itens && notaSelecionada.itens.length > 0 ? (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' }, children: notaSelecionada.itens.map((item, idx) => (_jsxs("div", { style: { background: '#ffffff', padding: '0.75rem', borderRadius: '4px', fontSize: '0.85rem' }, children: [_jsx("div", { style: { color: '#1a1a1a', fontWeight: '600', marginBottom: '0.25rem' }, children: item.descricao }), _jsxs("div", { style: { color: '#666', fontSize: '0.8rem' }, children: [item.quantidade_nf.toFixed(0), " un \u00D7 R$ ", item.preco_unitario.toFixed(2)] })] }, idx))) })) : (_jsx("p", { style: { color: '#999', fontSize: '0.85rem' }, children: "Nenhum produto" }))] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsx("button", { onClick: irParaConferenciaProdutos, style: {
                                                                    padding: '0.85rem',
                                                                    background: '#007acc',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.9rem',
                                                                    transition: 'all 0.3s'
                                                                }, onMouseEnter: (e) => (e.currentTarget.style.background = '#005a96'), onMouseLeave: (e) => (e.currentTarget.style.background = '#007acc'), children: "Ir para Confer\u00EAncia" }), _jsx("button", { onClick: () => setModalDetalhesNFAberto(true), style: {
                                                                    padding: '0.85rem',
                                                                    background: '#f0f0f0',
                                                                    color: '#1a1a1a',
                                                                    border: '1px solid #e0e0e0',
                                                                    borderRadius: '4px',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.9rem',
                                                                    transition: 'all 0.3s'
                                                                }, onMouseEnter: (e) => (e.currentTarget.style.background = '#e8e8e8'), onMouseLeave: (e) => (e.currentTarget.style.background = '#f0f0f0'), children: "Ver Detalhes" })] })] })) })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { children: "Diverg\u00EAncias Registradas" }), _jsx("div", { className: "card-body", children: divergencias.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem', fontSize: '0.95rem' }, children: "Nenhuma diverg\u00EAncia registrada" })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: divergencias.map((div) => {
                                                    let bgColor = '#e3f2fd';
                                                    let borderColor = '#2196F3';
                                                    let textColor = '#1565c0';
                                                    if (div.tipo_divergencia === 'a_menos') {
                                                        bgColor = '#ffebee';
                                                        borderColor = '#f44336';
                                                        textColor = '#c62828';
                                                    }
                                                    else if (div.tipo_divergencia === 'a_mais') {
                                                        bgColor = '#fff3e0';
                                                        borderColor = '#ff9800';
                                                        textColor = '#e65100';
                                                    }
                                                    else if (div.tipo_divergencia === 'nao_veio') {
                                                        bgColor = '#f3e5f5';
                                                        borderColor = '#9c27b0';
                                                        textColor = '#6a1b9a';
                                                    }
                                                    else if (div.tipo_divergencia === 'produto_substituido') {
                                                        bgColor = '#f0f4c3';
                                                        borderColor = '#cddc39';
                                                        textColor = '#827717';
                                                    }
                                                    const handleResolver = async () => {
                                                        const res = await fetch('http://127.0.0.1:8000/api/resolver-divergencia', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ item_id: div.item_id })
                                                        });
                                                        if (res.ok) {
                                                            alert('✅ Divergência marcada como resolvida');
                                                            loadDivergencias();
                                                        }
                                                        else {
                                                            alert('❌ Erro ao resolver');
                                                        }
                                                    };
                                                    const handleDeletar = async () => {
                                                        if (!window.confirm('Tem certeza que deseja deletar esta divergência?'))
                                                            return;
                                                        const res = await fetch('http://127.0.0.1:8000/api/deletar-divergencia', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ item_id: div.item_id })
                                                        });
                                                        if (res.ok) {
                                                            alert('✅ Divergência deletada');
                                                            loadDivergencias();
                                                        }
                                                        else {
                                                            alert('❌ Erro ao deletar');
                                                        }
                                                    };
                                                    return (_jsxs("div", { style: {
                                                            background: bgColor,
                                                            border: `2px solid ${borderColor}`,
                                                            padding: '1rem',
                                                            borderRadius: '4px',
                                                            fontSize: '0.85rem'
                                                        }, children: [_jsxs("div", { style: { color: textColor, fontWeight: '700', marginBottom: '0.5rem' }, children: ["NF #", div.numero_nf, " - ", div.tipo_divergencia.toUpperCase().replace('_', ' ')] }), _jsx("div", { style: { color: '#1a1a1a', fontWeight: '600', marginBottom: '0.25rem' }, children: div.produto }), _jsxs("div", { style: { color: '#666', fontSize: '0.8rem', marginBottom: '0.5rem' }, children: ["C\u00F3digo: ", div.codigo] }), _jsxs("div", { style: { color: '#666', fontSize: '0.8rem', marginBottom: '0.75rem' }, children: ["NF: ", Math.round(div.quantidade_nf), " | Recebido: ", Math.round(div.quantidade_confirmada)] }), _jsx("div", { style: { color: '#999', fontSize: '0.75rem', marginBottom: '0.75rem' }, children: new Date(div.data_registro).toLocaleDateString('pt-BR', {
                                                                    day: '2-digit',
                                                                    month: '2-digit',
                                                                    hour: '2-digit',
                                                                    minute: '2-digit'
                                                                }) }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("button", { onClick: handleResolver, style: {
                                                                            flex: 1,
                                                                            padding: '0.4rem 0.5rem',
                                                                            background: '#4caf50',
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '3px',
                                                                            fontSize: '0.75rem',
                                                                            fontWeight: '600',
                                                                            cursor: 'pointer'
                                                                        }, children: "\u2713 Resolvida" }), _jsx("button", { onClick: handleDeletar, style: {
                                                                            flex: 1,
                                                                            padding: '0.4rem 0.5rem',
                                                                            background: '#f44336',
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '3px',
                                                                            fontSize: '0.75rem',
                                                                            fontWeight: '600',
                                                                            cursor: 'pointer'
                                                                        }, children: "\u2717 Deletar" })] }), div.tipo_divergencia !== 'nao_veio' && Math.round(div.quantidade_confirmada) > 0 && (_jsxs("button", { onClick: () => {
                                                                    setProdutoSelecionado({
                                                                        id: div.item_id,
                                                                        descricao: div.produto,
                                                                        codigo_produto: div.codigo,
                                                                        quantidade_nf: div.quantidade_confirmada,
                                                                        preco_unitario: 0
                                                                    });
                                                                    setProdutoOlistSelecionado({
                                                                        id: '', sku: '', nome: '', preco: 0,
                                                                        estoque: 0, estoque_saldo: 0, estoque_reservado: 0
                                                                    });
                                                                    setProdutoOlistSKU('');
                                                                    setSugestoesSKU([]);
                                                                    setMostrarManual(false);
                                                                    setPagina('relacionamento_produto');
                                                                }, style: {
                                                                    width: '100%',
                                                                    marginTop: '0.5rem',
                                                                    padding: '0.5rem',
                                                                    background: '#007acc',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '3px',
                                                                    fontSize: '0.78rem',
                                                                    fontWeight: '700',
                                                                    cursor: 'pointer'
                                                                }, children: ["\uD83D\uDD17 Vincular na Olist e Subir ", Math.round(div.quantidade_confirmada), " un"] }))] }, div.item_id));
                                                }) })) })] })] }), mostrarTodosEstoque && (_jsxs("section", { className: "estoque-hero", children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }, children: [_jsxs("h2", { children: ["Todos os Produtos (", estoque.length, ")"] }), _jsx("button", { onClick: () => setMostrarTodosEstoque(false), style: {
                                                padding: '0.5rem 1rem',
                                                background: '#f0f0f0',
                                                border: '1px solid #e0e0e0',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontWeight: '600'
                                            }, children: "Voltar" })] }), _jsx("div", { className: "estoque-grid", children: estoque.map((produto) => (_jsxs("div", { className: "product-card", children: [_jsxs("div", { className: "product-header", children: [_jsxs("div", { className: "product-name", children: [_jsx("h3", { children: produto.descricao }), _jsxs("span", { className: "product-code", children: ["SKU: ", produto.codigo_produto] })] }), _jsxs("div", { className: "product-code-badge", children: [produto.notas_fiscais.length, " NF"] })] }), _jsxs("div", { className: "product-stats", children: [_jsxs("div", { className: "stat-box", children: [_jsx("div", { className: "stat-value", children: produto.quantidade_total.toFixed(0) }), _jsx("div", { className: "stat-label", children: "Qtd Total" })] }), _jsxs("div", { className: "stat-box", children: [_jsx("div", { className: "stat-value", children: produto.quantidade_confirmada.toFixed(0) }), _jsx("div", { className: "stat-label", children: "Confirmada" })] })] }), _jsxs("div", { className: "price-section", children: [_jsx("div", { className: "price-label", children: "Valor Total" }), _jsxs("div", { className: "price-value", children: ["R$ ", (produto.quantidade_total * produto.preco_unitario).toFixed(2)] })] }), _jsx("button", { className: "product-action", onClick: () => abrirDetalhes(produto), children: "Detalhes" })] }, produto.id_item))) }), _jsxs("div", { className: "valor-total", children: ["Total: ", estoque.length, " produto", estoque.length !== 1 ? 's' : '', " | R$ ", estoque.reduce((sum, p) => sum + (p.quantidade_total * p.preco_unitario), 0).toFixed(2)] })] })), _jsx("div", { style: { textAlign: 'center', marginTop: '2rem' }, children: _jsx("button", { onClick: abrirModalVinculos, style: {
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#9e9e9e',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    padding: '0.5rem'
                                }, onMouseEnter: (e) => (e.currentTarget.style.color = '#007acc'), onMouseLeave: (e) => (e.currentTarget.style.color = '#9e9e9e'), children: "\u2699 V\u00EDnculos salvos (de-para fornecedor \u2192 Olist)" }) })] }), modalVinculosAberto && (_jsx("div", { className: "modal-overlay", onClick: () => setModalVinculosAberto(false), children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), style: { maxWidth: '900px', width: '90%' }, children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "V\u00EDnculos Salvos (de-para fornecedor \u2192 Olist)" }), _jsx("button", { className: "modal-close", onClick: () => setModalVinculosAberto(false), children: "\u00D7" })] }), _jsxs("div", { className: "modal-body", children: [_jsx("p", { style: { color: '#666', marginBottom: '1.5rem', fontSize: '0.9rem' }, children: "Cada linha \u00E9 um \"apelido\" de fornecedor que aponta para um an\u00FAncio da Olist. O mesmo an\u00FAncio pode ter v\u00E1rios apelidos (descri\u00E7\u00F5es/c\u00F3digos diferentes). Esses v\u00EDnculos s\u00E3o sugeridos automaticamente em notas futuras." }), listaVinculos.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Nenhum v\u00EDnculo salvo ainda. Eles s\u00E3o criados quando voc\u00EA vincula um produto \u00E0 Olist." })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55vh', overflowY: 'auto' }, children: listaVinculos.map((v) => (_jsxs("div", { style: {
                                                display: 'grid',
                                                gridTemplateColumns: '1fr 1fr auto',
                                                gap: '1rem',
                                                alignItems: 'center',
                                                background: '#f9f9f9',
                                                border: '1px solid #e0e0e0',
                                                borderRadius: '6px',
                                                padding: '1rem'
                                            }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.7rem', fontWeight: 700, margin: 0 }, children: "FORNECEDOR (NF)" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.9rem', fontWeight: 600, margin: '0.15rem 0 0 0' }, children: v.nf_descricao }), _jsxs("p", { style: { color: '#666', fontSize: '0.75rem', margin: 0 }, children: ["C\u00F3d: ", v.nf_codigo || '-'] })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.7rem', fontWeight: 700, margin: 0 }, children: "AN\u00DANCIO OLIST" }), _jsx("p", { style: { color: '#007acc', fontSize: '0.9rem', fontWeight: 600, margin: '0.15rem 0 0 0' }, children: v.olist_nome }), _jsxs("p", { style: { color: '#666', fontSize: '0.75rem', margin: 0 }, children: ["SKU: ", v.olist_sku, " \u00B7 usado ", v.vezes_usado, "x"] })] }), _jsx("button", { onClick: () => deletarVinculo(v.id), style: {
                                                        padding: '0.5rem 0.75rem', background: '#f44336', color: 'white',
                                                        border: 'none', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                                                    }, children: "Remover" })] }, v.id))) }))] })] }) })), produtoSelecionado && (_jsx(ModalDetalhes, { isOpen: modalOpen, onClose: () => setModalOpen(false), produto: produtoSelecionado, onConfirm: () => {
                        setModalOpen(false);
                        loadEstoque();
                    } })), notaSelecionada && (_jsx(ModalDetalhesNotaFiscal, { isOpen: modalDetalhesNFAberto, onClose: () => setModalDetalhesNFAberto(false), nota: notaSelecionada })), notaDetalheAberta && (() => {
                    const nota = notaDetalheAberta;
                    const st = statusNota(nota);
                    const divs = divergenciasDaNota(nota);
                    const totalValor = (nota.itens || []).reduce((s, i) => s + i.quantidade_nf * i.preco_unitario, 0);
                    const TabBtn = ({ id, label, badge }) => (_jsxs("button", { onClick: () => setAbaDetalhe(id), style: {
                            padding: '0.8rem 1.4rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
                            background: abaDetalhe === id ? '#fff' : 'transparent',
                            color: abaDetalhe === id ? '#007acc' : '#607d8b',
                            borderBottom: abaDetalhe === id ? '3px solid #007acc' : '3px solid transparent'
                        }, children: [label, badge ? _jsx("span", { style: { marginLeft: 6, background: '#f44336', color: '#fff', borderRadius: 999, padding: '0 7px', fontSize: '0.7rem' }, children: badge }) : null] }));
                    return (_jsx("div", { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }, onClick: () => setNotaDetalheAberta(null), children: _jsxs("div", { style: { background: '#fff', borderRadius: 8, width: '95vw', maxWidth: 1200, height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { style: { borderBottom: '1px solid #e0e0e0', padding: '1.25rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("h2", { style: { margin: 0, fontSize: '1.4rem' }, children: "NOTA FISCAL ELETR\u00D4NICA" }), _jsxs("p", { style: { margin: '0.3rem 0 0', color: '#666', fontSize: '0.9rem' }, children: ["NF #", nota.numero_nf, " \u00B7 S\u00E9rie ", nota.serie] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '1rem' }, children: [_jsxs("span", { style: { background: st.bg, color: st.cor, fontWeight: 700, fontSize: '0.8rem', padding: '0.35rem 0.8rem', borderRadius: 999 }, children: [st.icone, " ", st.label] }), _jsx("button", { onClick: () => setNotaDetalheAberta(null), style: { background: 'none', border: 'none', fontSize: '2rem', color: '#999', cursor: 'pointer', lineHeight: 1 }, children: "\u00D7" })] })] }), _jsxs("div", { style: { display: 'flex', borderBottom: '1px solid #e0e0e0', background: '#f7f9fa', paddingLeft: '1rem' }, children: [_jsx(TabBtn, { id: "detalhes", label: "\uD83D\uDCC4 Detalhes" }), _jsx(TabBtn, { id: "conferencia", label: "\u2705 Confer\u00EAncia" }), _jsx(TabBtn, { id: "divergencias", label: "\u26A0\uFE0F Diverg\u00EAncias", badge: divs.length })] }), _jsxs("div", { style: { flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }, children: [abaDetalhe === 'detalhes' && (_jsxs("div", { children: [_jsxs("div", { style: { background: '#f9f9f9', border: '2px solid #007acc', padding: '1.5rem', borderRadius: 8, marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#007acc', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', margin: 0 }, children: "Fornecedor" }), _jsx("h3", { style: { margin: '0.25rem 0 0.75rem', color: '#1a1a1a' }, children: nota.fornecedor }), _jsx("p", { style: { color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }, children: "CNPJ" }), _jsx("p", { style: { color: '#1a1a1a', margin: '0 0 0.5rem' }, children: nota.cnpj || 'N/A' }), _jsx("p", { style: { color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }, children: "ENDERE\u00C7O" }), _jsx("p", { style: { color: '#1a1a1a', margin: 0 }, children: nota.endereco || 'N/A' })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }, children: "DATA DE EMISS\u00C3O" }), _jsx("p", { style: { color: '#1a1a1a', fontWeight: 600, margin: '0.25rem 0 0.75rem' }, children: nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A' }), _jsx("p", { style: { color: '#999', fontSize: '0.75rem', fontWeight: 700, margin: 0 }, children: "QUANTIDADE DE ITENS" }), _jsx("p", { style: { color: '#1a1a1a', fontWeight: 700, fontSize: '1.2rem', margin: '0.25rem 0' }, children: nota.itens?.length || 0 })] })] }), _jsx("h3", { style: { marginBottom: '0.75rem' }, children: "Produtos" }), _jsxs("div", { style: { border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }, children: [_jsxs("div", { style: { background: '#007acc', color: '#fff', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '1rem', padding: '0.8rem 1rem', fontWeight: 600, fontSize: '0.85rem' }, children: [_jsx("div", { children: "PRODUTO" }), _jsx("div", { style: { textAlign: 'center' }, children: "QTD" }), _jsx("div", { style: { textAlign: 'center' }, children: "VALOR UN." }), _jsx("div", { style: { textAlign: 'center' }, children: "SUBTOTAL" }), _jsx("div", { style: { textAlign: 'right' }, children: "C\u00D3DIGO" })] }), (nota.itens || []).map((item, idx) => (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '1rem', padding: '0.8rem 1rem', borderTop: idx > 0 ? '1px solid #eee' : 'none', background: idx % 2 ? '#f9f9f9' : '#fff', fontSize: '0.85rem' }, children: [_jsx("div", { style: { color: '#1a1a1a' }, children: item.descricao }), _jsx("div", { style: { textAlign: 'center', fontWeight: 600 }, children: Math.round(item.quantidade_nf) }), _jsxs("div", { style: { textAlign: 'center' }, children: ["R$ ", item.preco_unitario.toFixed(2)] }), _jsxs("div", { style: { textAlign: 'center', color: '#007acc', fontWeight: 600 }, children: ["R$ ", (item.quantidade_nf * item.preco_unitario).toFixed(2)] }), _jsx("div", { style: { textAlign: 'right', color: '#666' }, children: item.codigo_produto })] }, item.id)))] }), _jsxs("div", { style: { background: '#f5f5f5', border: '2px solid #007acc', padding: '1rem 1.5rem', borderRadius: 6, textAlign: 'right', marginTop: '1.5rem' }, children: [_jsx("span", { style: { color: '#999', fontSize: '0.85rem' }, children: "VALOR TOTAL DA NOTA " }), _jsxs("span", { style: { color: '#007acc', fontSize: '1.6rem', fontWeight: 700 }, children: ["R$ ", totalValor.toFixed(2)] })] })] })), abaDetalhe === 'conferencia' && (_jsxs("div", { children: [_jsx("div", { style: { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1.25rem' }, children: _jsx(BarraProgresso, { itens: nota.itens }) }), _jsx("div", { style: { marginBottom: '1rem' }, children: _jsx("button", { onClick: () => setModalAdicionarProdutoAberto(true), style: { padding: '0.6rem 1.1rem', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }, children: "+ Adicionar Produto Manual" }) }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' }, children: agruparItensPorDescricao(nota.itens || []).map((grupo) => {
                                                        const temSelecionados = grupo.selecionados.length > 0;
                                                        const multi = grupo.items.length > 1;
                                                        // Grupo de 1 registro sempre aberto; multi-registro só se expandido
                                                        const expandido = !multi || gruposExpandidos.has(grupo.descricao);
                                                        // Resumo de status para mostrar no cabeçalho (sem precisar abrir)
                                                        const qSubidos = grupo.items.filter(i => i.estoque_olist_atualizado_em).length;
                                                        const qConf = grupo.items.filter(i => (i.quantidade_confirmada !== null && i.quantidade_confirmada !== undefined) && !i.estoque_olist_atualizado_em).length;
                                                        const qFalta = grupo.items.length - qSubidos - qConf;
                                                        const toggleExpandir = () => {
                                                            const novo = new Set(gruposExpandidos);
                                                            if (novo.has(grupo.descricao))
                                                                novo.delete(grupo.descricao);
                                                            else
                                                                novo.add(grupo.descricao);
                                                            setGruposExpandidos(novo);
                                                        };
                                                        return (_jsxs("div", { style: { border: temSelecionados ? '2px solid #2196F3' : '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', background: temSelecionados ? '#e3f2fd' : '#fff' }, children: [_jsxs("div", { style: { background: temSelecionados ? '#bbdefb' : '#f5f5f5', padding: '1rem 1.25rem', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 1, minWidth: '250px', display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: multi ? 'pointer' : 'default' }, onClick: multi ? toggleExpandir : undefined, children: [multi && (_jsx("span", { style: { fontSize: '0.9rem', color: '#555', transition: 'transform 0.15s', transform: expandido ? 'rotate(90deg)' : 'rotate(0deg)', userSelect: 'none' }, "aria-label": expandido ? 'Recolher' : 'Expandir', children: "\u25B6" })), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, color: '#1a1a1a', fontSize: '1rem' }, children: grupo.descricao }), _jsxs("div", { style: { color: '#666', fontSize: '0.85rem' }, children: [grupo.items.length, " registro", grupo.items.length !== 1 ? 's' : '', " \u00B7 Total: ", Math.round(grupo.totalQtd), " un", grupo.selecionados.length > 0 && _jsxs("span", { style: { color: '#2196F3', fontWeight: 700, marginLeft: '0.5rem' }, children: ["\u00B7 ", grupo.selecionados.length, " selecionado", grupo.selecionados.length !== 1 ? 's' : ''] })] }), multi && (_jsxs("div", { style: { display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }, children: [qSubidos > 0 && _jsxs("span", { style: { background: '#e8f5e9', color: '#2e7d32', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }, children: ["\u2705 ", qSubidos, " subido", qSubidos !== 1 ? 's' : ''] }), qConf > 0 && _jsxs("span", { style: { background: '#e3f2fd', color: '#1565c0', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }, children: ["\uD83D\uDD04 ", qConf, " conferido", qConf !== 1 ? 's' : ''] }), qFalta > 0 && _jsxs("span", { style: { background: '#fff3e0', color: '#e65100', fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999 }, children: ["\uD83C\uDD95 ", qFalta, " a conferir"] }), _jsx("span", { style: { color: '#2196F3', fontSize: '0.68rem', fontWeight: 700 }, children: expandido ? '· clique para recolher' : '· clique para ver todos' })] }))] })] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }, children: [grupo.items.length > 1 && grupo.selecionados.length > 0 && (_jsxs("button", { onClick: () => {
                                                                                        if (!notaDetalheAberta)
                                                                                            return;
                                                                                        const primeiroItem = grupo.selecionados[0];
                                                                                        const qtdTotal = grupo.selecionados.reduce((s, i) => s + i.quantidade_nf, 0);
                                                                                        const msg = `Confirmar envio em massa?\n\nProduto: ${grupo.descricao}\nQuantidade de registros: ${grupo.selecionados.length}\nQuantidade total: ${Math.round(qtdTotal)} unidades\n\nOs registros serão agrupados e enviados como uma única entrada para a Olist.`;
                                                                                        if (!window.confirm(msg))
                                                                                            return;
                                                                                        setProdutoSelecionado({
                                                                                            id_item: primeiroItem.id,
                                                                                            // IDs de TODOS os registros do grupo (subida em massa)
                                                                                            // para marcar todos como subidos, nao so o primeiro
                                                                                            ids_massa: grupo.selecionados.map(i => i.id),
                                                                                            descricao: grupo.descricao,
                                                                                            codigo_produto: primeiroItem.codigo_produto,
                                                                                            quantidade_total: qtdTotal,
                                                                                            quantidade_nf: qtdTotal,
                                                                                            quantidade_confirmada: qtdTotal,
                                                                                            preco_unitario: primeiroItem.preco_unitario,
                                                                                            notas_fiscais: grupo.selecionados.map(i => ({
                                                                                                numero_nf: notaDetalheAberta.numero_nf || '',
                                                                                                serie: notaDetalheAberta.serie || '',
                                                                                                fornecedor: notaDetalheAberta.fornecedor || '',
                                                                                                quantidade: i.quantidade_nf
                                                                                            }))
                                                                                        });
                                                                                        setItensSelecionadosMultiplos(new Set());
                                                                                        setModalOpen(true);
                                                                                    }, style: { padding: '0.4rem 0.8rem', background: '#2196F3', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }, children: ["\uD83D\uDCE6 ", grupo.selecionados.length, " em Massa"] })), grupo.items.length > 1 && (_jsx("button", { onClick: () => {
                                                                                        const novo = new Set(itensSelecionadosMultiplos);
                                                                                        const todosSelecionados = grupo.items.every(i => novo.has(i.id));
                                                                                        grupo.items.forEach(i => {
                                                                                            if (todosSelecionados)
                                                                                                novo.delete(i.id);
                                                                                            else
                                                                                                novo.add(i.id);
                                                                                        });
                                                                                        setItensSelecionadosMultiplos(novo);
                                                                                    }, style: { padding: '0.4rem 0.8rem', background: temSelecionados ? '#1976D2' : '#e0e0e0', color: temSelecionados ? '#fff' : '#666', border: 'none', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }, children: grupo.items.every(i => itensSelecionadosMultiplos.has(i.id)) ? '✓ Desselecionar' : '☐ Selecionar' }))] })] }), expandido && (_jsx("div", { children: grupo.items.map((item, idx) => {
                                                                        const subido = !!item.estoque_olist_atualizado_em;
                                                                        const conferido = item.quantidade_confirmada !== null && item.quantidade_confirmada !== undefined;
                                                                        const selecionado = itensSelecionadosMultiplos.has(item.id);
                                                                        return (_jsxs("div", { style: {
                                                                                display: 'grid',
                                                                                gridTemplateColumns: grupo.items.length > 1 ? '30px 1fr auto' : '1fr auto',
                                                                                gap: '1rem',
                                                                                alignItems: 'center',
                                                                                padding: '1rem 1.25rem',
                                                                                borderTop: idx > 0 ? '1px solid #eee' : 'none',
                                                                                background: selecionado ? '#e3f2fd' : idx % 2 === 0 ? '#fff' : '#fafafa'
                                                                            }, children: [grupo.items.length > 1 && (_jsx("input", { type: "checkbox", checked: selecionado, onChange: () => toggleSelecaoMultipla(item.id), style: { width: '18px', height: '18px', cursor: 'pointer' } })), _jsxs("div", { children: [_jsxs("div", { style: { fontWeight: 600, color: '#1a1a1a' }, children: [grupo.items.length > 1 && _jsxs("span", { style: { color: '#999', marginRight: '0.5rem' }, children: ["(", grupo.items.indexOf(item) + 1, ")"] }), Math.round(item.quantidade_nf), " un"] }), _jsxs("div", { style: { color: '#90a4ae', fontSize: '0.8rem' }, children: ["C\u00F3d: ", item.codigo_produto, conferido ? ` · Recebido: ${Math.round(item.quantidade_confirmada)}` : ''] }), _jsx("div", { style: { marginTop: 4 }, children: subido
                                                                                                ? _jsx("span", { style: { background: '#e8f5e9', color: '#2e7d32', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }, children: "\u2705 Subido na Olist" })
                                                                                                : conferido
                                                                                                    ? _jsx("span", { style: { background: '#e3f2fd', color: '#1565c0', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }, children: "\uD83D\uDD04 Conferido" })
                                                                                                    : _jsx("span", { style: { background: '#fff3e0', color: '#e65100', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999 }, children: "\uD83C\uDD95 A conferir" }) })] }), _jsx("button", { onClick: () => conferirProduto(item), style: { padding: '0.6rem 1rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.85rem' }, children: "Conferir" })] }, item.id));
                                                                    }) }))] }, grupo.descricao));
                                                    }) })] })), abaDetalhe === 'divergencias' && (_jsx("div", { children: divs.length === 0 ? (_jsx("p", { style: { color: '#999', textAlign: 'center', padding: '2rem' }, children: "Nenhuma diverg\u00EAncia registrada nesta nota." })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: divs.map((div) => (_jsxs("div", { style: { border: '2px solid #f44336', background: '#ffebee', borderRadius: 8, padding: '1rem 1.25rem' }, children: [_jsx("div", { style: { color: '#c62828', fontWeight: 700, marginBottom: 4 }, children: div.tipo_divergencia.toUpperCase().replace('_', ' ') }), _jsx("div", { style: { fontWeight: 600, color: '#1a1a1a' }, children: div.produto }), _jsxs("div", { style: { color: '#666', fontSize: '0.8rem', marginBottom: '0.75rem' }, children: ["C\u00F3d: ", div.codigo, " \u00B7 NF: ", Math.round(div.quantidade_nf), " \u00B7 Recebido: ", Math.round(div.quantidade_confirmada)] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => resolverDivergenciaItem(div.item_id), style: { padding: '0.4rem 0.8rem', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }, children: "\u2713 Resolvida" }), _jsx("button", { onClick: () => deletarDivergenciaItem(div.item_id), style: { padding: '0.4rem 0.8rem', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }, children: "\u2717 Deletar" }), div.tipo_divergencia !== 'nao_veio' && Math.round(div.quantidade_confirmada) > 0 && (_jsxs("button", { onClick: () => vincularDivergenciaOlist(div), style: { padding: '0.4rem 0.8rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }, children: ["\uD83D\uDD17 Vincular na Olist e Subir ", Math.round(div.quantidade_confirmada), " un"] }))] })] }, div.item_id))) })) }))] }), _jsx("div", { style: { borderTop: '1px solid #e0e0e0', padding: '1rem 2rem', display: 'flex', justifyContent: 'flex-end' }, children: _jsx("button", { onClick: () => setNotaDetalheAberta(null), style: { padding: '0.7rem 1.5rem', background: '#007acc', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }, children: "Fechar" }) })] }) }));
                })(), produtoSelecionado && notaDetalheAberta && (_jsx(ModalDetalhesNota, { isOpen: modalOpen, onClose: () => setModalOpen(false), produto: produtoSelecionado, notaNota: notaDetalheAberta, onNaoConfirmado: (qtd) => irParaOlistSubirEstoque(qtd), onDivergenciaConfirmada: (qtd) => irParaOlistSubirEstoque(qtd) })), modalAdicionarProdutoAberto && notaDetalheAberta && (_jsx("div", { className: "modal-overlay", onClick: () => setModalAdicionarProdutoAberto(false), children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "Adicionar Produto Manual" }), _jsx("button", { className: "modal-close", onClick: () => setModalAdicionarProdutoAberto(false), children: "\u00D7" })] }), _jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "C\u00F3digo do Produto" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.codigo, onChange: (e) => setNovoProduto({ ...novoProduto, codigo: e.target.value }), placeholder: "Ex: 001234" })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Descri\u00E7\u00E3o do Produto" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.descricao, onChange: (e) => setNovoProduto({ ...novoProduto, descricao: e.target.value }), placeholder: "Ex: Produto XYZ" })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Quantidade" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.quantidade, onChange: (e) => { const v = e.target.value; if (v === '' || !isNaN(parseFloat(v)))
                                                            setNovoProduto({ ...novoProduto, quantidade: parseFloat(v) || 0 }); }, placeholder: "0" })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Pre\u00E7o Unit\u00E1rio (R$)" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.preco, onChange: (e) => { const v = e.target.value; if (v === '' || !isNaN(parseFloat(v)))
                                                            setNovoProduto({ ...novoProduto, preco: parseFloat(v) || 0 }); }, placeholder: "0.00" })] })] }), _jsxs("div", { className: "button-group", children: [_jsx("button", { className: "btn btn-secondary", onClick: () => setModalAdicionarProdutoAberto(false), children: "Cancelar" }), _jsx("button", { className: "btn btn-primary", onClick: handleAdicionarProduto, children: "Adicionar Produto" })] })] })] }) }))] }));
    }
    // ===== PÁGINA DE PRODUTOS DA NOTA =====
    if (pagina === 'produtos_nota' && notaSelecionada && produtosNota.length > 0) {
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "CONFER\u00CANCIA DE PRODUTOS" }), _jsxs("p", { children: ["NF #", notaSelecionada.numero_nf, " - ", notaSelecionada.fornecedor] })] }) }), _jsxs("main", { className: "container main-content", children: [_jsxs("div", { style: { display: 'flex', gap: '1rem', marginBottom: '2rem' }, children: [_jsx("button", { onClick: () => setPagina('inicial'), style: {
                                        padding: '0.75rem 1.5rem',
                                        background: '#f0f0f0',
                                        border: '1px solid #e0e0e0',
                                        color: '#1a1a1a',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: '600',
                                        transition: 'all 0.3s'
                                    }, onMouseEnter: (e) => (e.currentTarget.style.background = '#e8e8e8'), onMouseLeave: (e) => (e.currentTarget.style.background = '#f0f0f0'), children: "\u2190 Voltar para Nota" }), _jsx("button", { onClick: () => setModalAdicionarProdutoAberto(true), style: {
                                        padding: '0.75rem 1.5rem',
                                        background: '#4caf50',
                                        border: 'none',
                                        color: 'white',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: '600',
                                        transition: 'all 0.3s'
                                    }, onMouseEnter: (e) => (e.currentTarget.style.background = '#45a049'), onMouseLeave: (e) => (e.currentTarget.style.background = '#4caf50'), children: "+ Adicionar Produto Manual" })] }), _jsxs("div", { style: {
                                background: 'white',
                                border: '1px solid #e0e0e0',
                                borderRadius: '8px',
                                padding: '1.25rem 1.5rem',
                                marginBottom: '1.5rem',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                            }, children: [_jsx("h3", { style: { margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#1a1a1a' }, children: "Progresso - Estoque Subido na Olist" }), _jsx(BarraProgresso, { itens: produtosNota })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: produtosNota.map((item) => (_jsxs("div", { style: {
                                    background: '#ffffff',
                                    border: '1px solid #e0e0e0',
                                    borderRadius: '8px',
                                    padding: '1.5rem',
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 180px',
                                    gap: '2rem',
                                    alignItems: 'flex-start',
                                    transition: 'all 0.3s'
                                }, onMouseEnter: (e) => {
                                    e.currentTarget.style.borderColor = '#d0d0d0';
                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                                }, onMouseLeave: (e) => {
                                    e.currentTarget.style.borderColor = '#e0e0e0';
                                    e.currentTarget.style.boxShadow = 'none';
                                }, children: [_jsxs("div", { children: [_jsx("h3", { style: { color: '#1a1a1a', marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: '600' }, children: item.descricao }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "C\u00D3DIGO DO PRODUTO" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '500' }, children: item.codigo_produto })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "QUANTIDADE ESPERADA" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700' }, children: [Math.round(item.quantidade_nf), " un"] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "VALOR UNIT\u00C1RIO" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: ["R$ ", item.preco_unitario.toFixed(2)] })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#999', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "VALOR TOTAL" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: ["R$ ", (item.quantidade_nf * item.preco_unitario).toFixed(2)] })] })] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsx("button", { onClick: () => {
                                                    const produtoEstoque = {
                                                        id_item: item.id,
                                                        descricao: item.descricao,
                                                        codigo_produto: item.codigo_produto,
                                                        quantidade_total: item.quantidade_nf,
                                                        quantidade_nf: item.quantidade_nf,
                                                        quantidade_confirmada: item.quantidade_confirmada || item.quantidade_nf,
                                                        preco_unitario: item.preco_unitario,
                                                        notas_fiscais: [{
                                                                numero_nf: notaSelecionada.numero_nf || '',
                                                                serie: notaSelecionada.serie || '',
                                                                fornecedor: notaSelecionada.fornecedor || '',
                                                                quantidade: item.quantidade_nf
                                                            }]
                                                    };
                                                    setProdutoSelecionado(produtoEstoque);
                                                    setModalOpen(true);
                                                }, style: {
                                                    padding: '0.75rem 1rem',
                                                    background: '#007acc',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    fontWeight: '600',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.3s',
                                                    fontSize: '0.9rem'
                                                }, onMouseEnter: (e) => (e.currentTarget.style.background = '#005a96'), onMouseLeave: (e) => (e.currentTarget.style.background = '#007acc'), children: "Confer\u00EAncia" }), _jsxs("div", { style: {
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.75rem',
                                                    background: '#f9f9f9',
                                                    borderRadius: '6px',
                                                    border: '1px solid #e0e0e0'
                                                }, children: [_jsx("input", { type: "checkbox", id: `produto-nao-veio-${item.id}`, onChange: (e) => {
                                                            if (e.target.checked) {
                                                                const produtoEstoque = {
                                                                    id_item: item.id,
                                                                    descricao: item.descricao,
                                                                    codigo_produto: item.codigo_produto,
                                                                    quantidade_total: item.quantidade_nf,
                                                                    quantidade_confirmada: 0,
                                                                    preco_unitario: item.preco_unitario,
                                                                    notas_fiscais: [{
                                                                            numero_nf: notaSelecionada.numero_nf || '',
                                                                            serie: notaSelecionada.serie || '',
                                                                            fornecedor: notaSelecionada.fornecedor || '',
                                                                            quantidade: item.quantidade_nf
                                                                        }]
                                                                };
                                                                setProdutoSelecionado(produtoEstoque);
                                                                setModalOpen(true);
                                                            }
                                                        }, style: {
                                                            width: '16px',
                                                            height: '16px',
                                                            cursor: 'pointer'
                                                        } }), _jsx("label", { htmlFor: `produto-nao-veio-${item.id}`, style: {
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem',
                                                            color: '#666',
                                                            fontWeight: '500',
                                                            margin: 0
                                                        }, children: "N\u00E3o veio" })] })] })] }, item.id))) })] }), produtoSelecionado && (_jsx(ModalDetalhesNota, { isOpen: modalOpen, onClose: () => setModalOpen(false), produto: produtoSelecionado, notaNota: notaSelecionada, onNaoConfirmado: (qtd) => irParaOlistSubirEstoque(qtd), onDivergenciaConfirmada: (qtd) => irParaOlistSubirEstoque(qtd) })), modalAdicionarProdutoAberto && (_jsx("div", { className: "modal-overlay", onClick: () => setModalAdicionarProdutoAberto(false), children: _jsxs("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { children: "Adicionar Produto Manual" }), _jsx("button", { className: "modal-close", onClick: () => setModalAdicionarProdutoAberto(false), children: "\u00D7" })] }), _jsxs("div", { className: "modal-body", children: [_jsx("p", { style: { color: '#666', marginBottom: '1.5rem', fontSize: '0.95rem' }, children: "Use este formul\u00E1rio para adicionar produtos que chegaram mas n\u00E3o foram informados na nota fiscal." }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "C\u00F3digo do Produto" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.codigo, onChange: (e) => setNovoProduto({ ...novoProduto, codigo: e.target.value }), placeholder: "Ex: 001234" })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Descri\u00E7\u00E3o do Produto" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.descricao, onChange: (e) => setNovoProduto({ ...novoProduto, descricao: e.target.value }), placeholder: "Ex: Produto XYZ" })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Quantidade" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.quantidade, onChange: (e) => {
                                                            const val = e.target.value;
                                                            if (val === '' || !isNaN(parseFloat(val))) {
                                                                setNovoProduto({ ...novoProduto, quantidade: parseFloat(val) || 0 });
                                                            }
                                                        }, placeholder: "0" })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Pre\u00E7o Unit\u00E1rio (R$)" }), _jsx("input", { type: "text", className: "form-input", value: novoProduto.preco, onChange: (e) => {
                                                            const val = e.target.value;
                                                            if (val === '' || !isNaN(parseFloat(val))) {
                                                                setNovoProduto({ ...novoProduto, preco: parseFloat(val) || 0 });
                                                            }
                                                        }, placeholder: "0.00" })] })] }), _jsxs("div", { className: "button-group", children: [_jsx("button", { className: "btn btn-secondary", onClick: () => setModalAdicionarProdutoAberto(false), children: "Cancelar" }), _jsx("button", { className: "btn btn-primary", onClick: handleAdicionarProduto, children: "Adicionar Produto" })] })] })] }) }))] }));
    }
    // ===== PÁGINA DE FORNECEDORES =====
    if (pagina === 'fornecedores') {
        return (_jsx(FornecedoresManager, { onVoltar: voltarParaInicial }));
    }
    // ===== PÁGINA DE CONFERÊNCIA =====
    if (pagina === 'conferencia' && notaSelecionada) {
        const totalNota = notaSelecionada.itens?.reduce((sum, item) => sum + item.quantidade_nf * item.preco_unitario, 0) || 0;
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "CONFER\u00CANCIA DE NOTA FISCAL" }), _jsx("p", { children: "Verifique e confirme os itens recebidos" })] }) }), _jsxs("main", { className: "container main-content", children: [_jsx("button", { onClick: voltarParaInicial, style: {
                                marginBottom: '2rem',
                                padding: '0.75rem 1.5rem',
                                background: '#f0f0f0',
                                border: '1px solid #e0e0e0',
                                color: '#1a1a1a',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.3s'
                            }, onMouseEnter: (e) => (e.currentTarget.style.background = '#e8e8e8'), onMouseLeave: (e) => (e.currentTarget.style.background = '#f0f0f0'), children: "\u2190 Voltar para notas" }), _jsxs("div", { className: "card", style: { marginBottom: '2rem' }, children: [_jsx("h2", { children: "Informa\u00E7\u00F5es da Nota Fiscal" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }, children: [_jsxs("div", { children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "FORNECEDOR" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: notaSelecionada.fornecedor })] }), _jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "N\u00DAMERO DA NF" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: ["NF #", notaSelecionada.numero_nf] })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "S\u00C9RIE" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: notaSelecionada.serie })] })] }), _jsxs("div", { children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "DATA DE EMISS\u00C3O" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: notaSelecionada.data_emissao
                                                                ? new Date(notaSelecionada.data_emissao).toLocaleDateString('pt-BR')
                                                                : '-' })] }), _jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "TOTAL DA NOTA" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '700' }, children: ["R$ ", totalNota.toFixed(2)] })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.25rem' }, children: "QUANTIDADE DE ITENS" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '1rem', fontWeight: '600' }, children: [notaSelecionada.itens?.length || 0, " item", notaSelecionada.itens?.length !== 1 ? 'ns' : ''] })] })] })] })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { children: "Itens da Nota Fiscal" }), notaSelecionada.itens && notaSelecionada.itens.length > 0 ? (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { backgroundColor: '#f9f9f9', borderBottom: '2px solid #e0e0e0' }, children: [_jsx("th", { style: { padding: '1rem', textAlign: 'left', color: '#1a1a1a', fontWeight: '600' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }, children: "C\u00F3digo" }), _jsx("th", { style: { padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }, children: "Quantidade" }), _jsx("th", { style: { padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }, children: "Pre\u00E7o Unit." }), _jsx("th", { style: { padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }, children: "Subtotal" }), _jsx("th", { style: { padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }, children: "A\u00E7\u00E3o" })] }) }), _jsx("tbody", { children: notaSelecionada.itens.map((item, idx) => (_jsxs("tr", { style: {
                                                        borderBottom: '1px solid #e0e0e0',
                                                        backgroundColor: idx % 2 === 0 ? '#f9f9f9' : '#fff'
                                                    }, children: [_jsx("td", { style: { padding: '1rem', color: '#1a1a1a' }, children: item.descricao }), _jsx("td", { style: { padding: '1rem', textAlign: 'center', color: '#666' }, children: item.codigo_produto }), _jsx("td", { style: { padding: '1rem', textAlign: 'center', color: '#1a1a1a', fontWeight: '600' }, children: Math.round(item.quantidade_nf) }), _jsxs("td", { style: { padding: '1rem', textAlign: 'right', color: '#666' }, children: ["R$ ", item.preco_unitario.toFixed(2)] }), _jsxs("td", { style: { padding: '1rem', textAlign: 'right', color: '#1a1a1a', fontWeight: '600' }, children: ["R$ ", (item.quantidade_nf * item.preco_unitario).toFixed(2)] }), _jsx("td", { style: { padding: '1rem', textAlign: 'center' }, children: _jsx("button", { style: {
                                                                    padding: '0.5rem 1rem',
                                                                    background: '#007acc',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: '600'
                                                                }, children: "Confirmar" }) })] }, item.id))) })] }) })) : (_jsx("p", { style: { color: '#666', textAlign: 'center', padding: '2rem' }, children: "Nenhum item nesta nota" }))] })] })] }));
    }
    // ===== PÁGINA DE RELACIONAMENTO DE PRODUTO =====
    if (pagina === 'relacionamento_produto') {
        // Usar o produto que foi clicado para conferência (produtoSelecionado)
        const produtoAtual = produtoSelecionado;
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsxs("div", { className: "container", children: [_jsx("h1", { children: "INTEGRA\u00C7\u00C3O OLIST" }), _jsx("p", { children: "Vincular produto do estoque ao an\u00FAncio da Olist" })] }) }), _jsx("main", { className: "container main-content", children: _jsxs("div", { className: "card", style: { maxWidth: '800px', margin: '0 auto' }, children: [_jsx("h2", { children: "Vincular ao An\u00FAncio Olist" }), produtoAtual && (_jsxs("div", { style: { background: '#f0f9ff', border: '2px solid #007acc', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }, children: [_jsx("h3", { style: { color: '#007acc', marginTop: 0 }, children: "Produto da Nota Fiscal" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '2rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "PRODUTO" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1.1rem', fontWeight: '700', margin: 0 }, children: produtoAtual.descricao })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "C\u00D3DIGO" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '600', margin: 0 }, children: produtoAtual.codigo_produto })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "QUANTIDADE" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '600', margin: 0 }, children: [Math.round(produtoAtual.quantidade_nf), " un"] })] })] })] })), sugestaoVinculo && !sugestaoDispensada && !produtoOlistSelecionado.sku && !kitDetectado && (_jsxs("div", { style: {
                                    background: '#fff8e1',
                                    border: '2px solid #ffb300',
                                    padding: '1.25rem 1.5rem',
                                    borderRadius: '8px',
                                    marginBottom: '1.5rem'
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }, children: [_jsx("span", { style: { fontSize: '1.2rem' }, children: "\uD83D\uDCA1" }), _jsx("strong", { style: { color: '#e65100' }, children: "Esse produto j\u00E1 foi vinculado antes!" })] }), _jsxs("p", { style: { color: '#5d4037', fontSize: '0.9rem', margin: '0 0 0.25rem 0' }, children: ["An\u00FAncio Olist: ", _jsx("strong", { children: sugestaoVinculo.olist_nome })] }), _jsxs("p", { style: { color: '#8d6e63', fontSize: '0.8rem', margin: '0 0 1rem 0' }, children: ["SKU ", sugestaoVinculo.olist_sku, " \u00B7 usado ", sugestaoVinculo.vezes_usado, "x \u00B7 confirme se \u00E9 o mesmo produto"] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem' }, children: [_jsx("button", { onClick: usarSugestao, style: {
                                                    padding: '0.6rem 1.25rem', background: '#2e7d32', color: 'white',
                                                    border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem'
                                                }, children: "\u2713 Sim, \u00E9 esse an\u00FAncio" }), _jsx("button", { onClick: () => setSugestaoDispensada(true), style: {
                                                    padding: '0.6rem 1.25rem', background: '#f0f0f0', color: '#1a1a1a',
                                                    border: '1px solid #ddd', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem'
                                                }, children: "N\u00E3o, buscar outro" })] })] })), kitDetectado && componentesKit.length > 0 && (_jsxs("div", { style: {
                                    background: '#e8f5e9',
                                    border: '3px solid #4caf50',
                                    padding: '1.5rem',
                                    borderRadius: '8px',
                                    marginBottom: '1.5rem'
                                }, children: [_jsx("h3", { style: { color: '#2e7d32', marginTop: 0 }, children: "\uD83C\uDF81 Kit Detectado!" }), _jsxs("p", { style: { color: '#1b5e20', fontSize: '0.95rem', margin: '0 0 1rem' }, children: [_jsx("strong", { children: kitDetectado.nome_kit }), " (", componentesKit.length, " componentes)"] }), _jsxs("div", { style: {
                                            background: '#f1f8e9',
                                            padding: '1rem',
                                            borderRadius: '6px',
                                            marginBottom: '1rem',
                                            fontSize: '0.85rem',
                                            color: '#558b2f'
                                        }, children: [_jsx("p", { style: { margin: '0 0 0.5rem' }, children: "Componentes que ser\u00E3o atualizados:" }), _jsx("ul", { style: { margin: '0', paddingLeft: '1.25rem' }, children: componentesKit.map((comp) => (_jsxs("li", { style: { margin: '0.25rem 0' }, children: [_jsx("strong", { children: comp.sku }), " - ", comp.olist_nome] }, comp.sku))) })] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem' }, children: [_jsx("button", { onClick: () => handleVincularKit(kitDetectado, componentesKit), style: {
                                                    padding: '0.7rem 1.5rem',
                                                    background: '#4caf50',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    fontSize: '0.9rem'
                                                }, children: "\u2713 Vincular Kit e Atualizar Estoque" }), _jsx("button", { onClick: () => {
                                                    setKitDetectado(null);
                                                    setComponentesKit([]);
                                                    setProdutoOlistSKU('');
                                                }, style: {
                                                    padding: '0.7rem 1.5rem',
                                                    background: '#f0f0f0',
                                                    color: '#1a1a1a',
                                                    border: '1px solid #ddd',
                                                    borderRadius: '6px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    fontSize: '0.9rem'
                                                }, children: "\u2190 Buscar outro" })] })] })), _jsxs("div", { className: "form-group", style: { position: 'relative' }, children: [_jsxs("label", { className: "form-label", children: ["Buscar An\u00FAncio Olist (por SKU ou Nome) - ", _jsx("span", { style: { color: '#999', fontSize: '0.85rem' }, children: "opcional" })] }), _jsx("input", { type: "text", className: "form-input", value: produtoOlistSKU, onChange: (e) => handleBuscarSKU(e.target.value), placeholder: "Digite SKU ou nome do produto (m\u00EDnimo 2 caracteres)... ou pule para preencher manualmente", style: {
                                            padding: '0.75rem',
                                            border: produtoOlistSKU.length > 0 ? '2px solid #007acc' : '1px solid #ddd',
                                            borderRadius: '4px',
                                            fontSize: '0.95rem',
                                            transition: 'all 0.2s',
                                            opacity: 0.7
                                        } }), produtoOlistSKU.length > 0 && sugestoesSKU.length > 0 && (_jsx("div", { style: {
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            right: 0,
                                            background: 'white',
                                            border: '1px solid #ddd',
                                            borderTop: 'none',
                                            borderRadius: '0 0 4px 4px',
                                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                                            zIndex: 10,
                                            maxHeight: '300px',
                                            overflowY: 'auto'
                                        }, children: sugestoesSKU.map((sugestao) => (_jsxs("div", { onClick: () => handleSelecionarSKU(sugestao), style: {
                                                padding: '0.75rem 1rem',
                                                borderBottom: '1px solid #f0f0f0',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                background: 'white'
                                            }, onMouseEnter: (e) => (e.currentTarget.style.background = '#f9f9f9'), onMouseLeave: (e) => (e.currentTarget.style.background = 'white'), children: [_jsxs("div", { style: { color: '#666', fontSize: '0.8rem', fontWeight: '600' }, children: ["SKU: ", sugestao.sku] }), _jsx("div", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '500' }, children: sugestao.nome }), _jsxs("div", { style: { color: '#007acc', fontSize: '0.9rem', fontWeight: '600' }, children: ["R$ ", sugestao.preco.toFixed(2)] })] }, sugestao.sku))) })), produtoOlistSKU.length >= 2 && sugestoesSKU.length === 0 && (_jsxs("div", { style: {
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            right: 0,
                                            background: '#fff3cd',
                                            border: '1px solid #ffc107',
                                            borderTop: 'none',
                                            borderRadius: '0 0 4px 4px',
                                            padding: '1rem',
                                            color: '#856404',
                                            fontSize: '0.9rem',
                                            zIndex: 10
                                        }, children: [_jsxs("strong", { children: ["Nenhum produto encontrado com \"", produtoOlistSKU, "\""] }), _jsx("br", {}), _jsx("br", {}), _jsx("strong", { children: "\uD83D\uDCA1 Dicas:" }), _jsx("br", {}), "1. Verifique se o SKU/nome est\u00E1 correto na sua conta Olist", _jsx("br", {}), "2. Tente buscar pelo SKU exato do produto", _jsx("br", {}), "3. Tente buscar com parte do nome (ex: \"SPIKE\" ao inv\u00E9s de \"VISEIRA SPIKE II\")", _jsx("br", {}), "4. Se a busca continuar n\u00E3o funcionando, voc\u00EA pode preencher manualmente os dados abaixo"] }))] }), !produtoOlistSelecionado.sku && !mostrarManual && (_jsx("button", { type: "button", onClick: () => setMostrarManual(true), style: {
                                    background: '#fff',
                                    border: '2px solid #007acc',
                                    color: '#007acc',
                                    padding: '0.75rem 1.25rem',
                                    borderRadius: '8px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    marginTop: '1rem',
                                    marginBottom: '1.5rem',
                                    fontSize: '0.95rem'
                                }, children: "\uD83D\uDCDD Preencher dados manualmente" })), !produtoOlistSelecionado.sku && mostrarManual && (_jsxs("div", { style: {
                                    background: '#f0f9ff',
                                    border: '2px solid #007acc',
                                    padding: '1.5rem',
                                    borderRadius: '8px',
                                    marginTop: '1.5rem',
                                    marginBottom: '1.5rem'
                                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("h3", { style: { color: '#007acc', marginTop: 0, marginBottom: 0 }, children: "\uD83D\uDCDD Preencher Dados do An\u00FAncio Manualmente" }), _jsx("button", { type: "button", onClick: () => setMostrarManual(false), style: { background: 'none', border: 'none', color: '#999', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }, title: "Fechar preenchimento manual", children: "\u00D7" })] }), _jsx("p", { style: { color: '#666', fontSize: '0.9rem', margin: '0.5rem 0 1.5rem 0' }, children: "Copie os dados do an\u00FAncio da sua Olist e preencha abaixo (funciona melhor que a busca autom\u00E1tica no momento):" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Nome do Produto" }), _jsx("input", { type: "text", className: "form-input", placeholder: "Ex: Suporte Ba\u00FA Bagageiro Yamaha", value: produtoOlistSelecionado.nome, onChange: (e) => setProdutoOlistSelecionado({
                                                            ...produtoOlistSelecionado,
                                                            nome: e.target.value
                                                        }), style: { padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' } })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Pre\u00E7o" }), _jsx("input", { type: "number", className: "form-input", placeholder: "Ex: 299.90", value: produtoOlistSelecionado.preco, onChange: (e) => setProdutoOlistSelecionado({
                                                            ...produtoOlistSelecionado,
                                                            preco: parseFloat(e.target.value) || 0
                                                        }), style: { padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' } })] })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Estoque Dispon\u00EDvel" }), _jsx("input", { type: "number", className: "form-input", placeholder: "Ex: 47", value: produtoOlistSelecionado.estoque, onChange: (e) => setProdutoOlistSelecionado({
                                                        ...produtoOlistSelecionado,
                                                        estoque: parseInt(e.target.value) || 0
                                                    }), style: { padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px' } })] }) })] })), produtoOlistSelecionado.sku && (_jsxs("div", { style: {
                                    background: '#f0f4c3',
                                    border: '2px solid #cddc39',
                                    padding: '1.5rem',
                                    borderRadius: '8px',
                                    marginTop: '1.5rem',
                                    marginBottom: '1.5rem'
                                }, children: [_jsx("h3", { style: { color: '#827717', marginTop: 0 }, children: "An\u00FAncio Selecionado" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.5rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "SKU" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }, children: produtoOlistSelecionado.sku })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "NOME DO AN\u00DANCIO" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '0.9rem', fontWeight: '600', margin: 0 }, children: produtoOlistSelecionado.nome })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "PRE\u00C7O" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }, children: ["R$ ", produtoOlistSelecionado.preco.toFixed(2)] })] }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.25rem' }, children: "ESTOQUE OLIST" }), _jsxs("p", { style: { color: '#1a1a1a', fontSize: '0.95rem', fontWeight: '700', margin: 0 }, children: [produtoOlistSelecionado.estoque, " un disp."] }), _jsxs("p", { style: { color: '#999', fontSize: '0.75rem', margin: '0.15rem 0 0 0' }, children: ["Saldo: ", produtoOlistSelecionado.estoque_saldo, " | Reserv.: ", produtoOlistSelecionado.estoque_reservado] })] })] })] })), produtoOlistSelecionado.sku && produtoSelecionado && reservaInbound === 0 &&
                                !candidatoVinculado && inboundCandidatos.length > 0 && (_jsxs("div", { style: {
                                    background: '#fff8e1',
                                    border: '2px solid #ffb300',
                                    padding: '1.25rem',
                                    borderRadius: '8px',
                                    marginBottom: '1.5rem'
                                }, children: [_jsx("h3", { style: { color: '#e65100', marginTop: 0, marginBottom: '0.5rem' }, children: "\uD83D\uDD0E Esse produto est\u00E1 num inbound em processo?" }), _jsxs("p", { style: { color: '#7a5b00', fontSize: '0.85rem', margin: '0 0 1rem 0' }, children: ["Encontrei ", inboundCandidatos.length, " ", inboundCandidatos.length === 1 ? 'item parecido' : 'itens parecidos', " no seu inbound (SKU do inbound \u00E9 do Mercado Livre, por isso confirme pelo t\u00EDtulo). Se for o mesmo, eu ", _jsx("strong", { children: "seguro a quantidade do FULL" }), " e subo s\u00F3 o resto na Olist."] }), inboundCandidatos.map((c) => (_jsxs("div", { style: {
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            gap: '1rem', padding: '0.75rem 1rem', marginBottom: '0.5rem',
                                            background: 'white', border: '1px solid #ffe082', borderRadius: '6px'
                                        }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { fontWeight: 600, color: '#1a1a1a', fontSize: '0.9rem' }, children: c.titulo }), _jsxs("div", { style: { color: '#888', fontSize: '0.78rem', marginTop: '0.15rem' }, children: ["SKU inbound: ", c.sku_inbound || '—', " \u00B7 Inbound #", c.numero_inbound, " (", c.status_inbound, ")"] }), _jsx("div", { style: { fontSize: '0.82rem', marginTop: '0.25rem' }, children: c.baixa_aplicada === 1 ? (_jsxs("span", { style: { color: '#2e7d32', fontWeight: 600 }, children: ["\u2713 ", c.qtd_full, " un \u2014 j\u00E1 foi baixado deste inbound (n\u00E3o segura de novo)"] })) : (_jsxs("span", { style: { color: '#e65100', fontWeight: 600 }, children: ["\uD83D\uDCE6 ", c.restante_full, " un destinadas ao FULL \u2014 ainda N\u00C3O baixadas"] })) })] }), _jsx("button", { onClick: () => confirmarCandidatoInbound(c), disabled: vinculandoCandidato, style: {
                                                    padding: '0.6rem 1rem', whiteSpace: 'nowrap',
                                                    background: vinculandoCandidato ? '#ccc' : '#ef6c00',
                                                    color: 'white', border: 'none', borderRadius: '5px',
                                                    fontWeight: 600, fontSize: '0.85rem',
                                                    cursor: vinculandoCandidato ? 'wait' : 'pointer'
                                                }, children: vinculandoCandidato ? 'Vinculando…'
                                                    : c.baixa_aplicada === 1 ? 'É esse (já baixado)'
                                                        : `É esse — segurar ${c.restante_full}` })] }, c.item_id))), _jsx("p", { style: { color: '#999', fontSize: '0.75rem', margin: '0.5rem 0 0 0' }, children: "N\u00E3o \u00E9 nenhum desses? Pode ignorar \u2014 vai subir a quantidade cheia normalmente." })] })), produtoOlistSelecionado.sku && produtoSelecionado && (_jsxs("div", { style: {
                                    background: '#e8f5e9',
                                    border: '2px solid #4caf50',
                                    padding: '1.5rem',
                                    borderRadius: '8px',
                                    marginBottom: '1.5rem'
                                }, children: [_jsx("h3", { style: { color: '#2e7d32', marginTop: 0 }, children: "Atualiza\u00E7\u00E3o de Estoque" }), (() => {
                                        const qtdNF = Math.round(produtoSelecionado.quantidade_nf);
                                        const reserva = Math.min(reservaInbound, qtdNF);
                                        const qtdSubir = Math.max(0, qtdNF - reserva);
                                        const novoTotal = produtoOlistSelecionado.estoque_saldo + qtdSubir;
                                        return (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-around', textAlign: 'center', flexWrap: 'wrap', gap: '1rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }, children: "ESTOQUE ATUAL OLIST" }), _jsx("p", { style: { color: '#1a1a1a', fontSize: '1.5rem', fontWeight: '700', margin: 0 }, children: produtoOlistSelecionado.estoque_saldo })] }), _jsx("div", { style: { fontSize: '1.5rem', color: '#4caf50', fontWeight: '700' }, children: "+" }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }, children: "QTD A SUBIR" }), _jsx("p", { style: { color: '#007acc', fontSize: '1.5rem', fontWeight: '700', margin: 0 }, children: qtdSubir }), reserva > 0 && (_jsxs("p", { style: { color: '#999', fontSize: '0.7rem', margin: '0.15rem 0 0 0' }, children: ["(de ", qtdNF, " recebidas)"] }))] }), _jsx("div", { style: { fontSize: '1.5rem', color: '#4caf50', fontWeight: '700' }, children: "=" }), _jsxs("div", { children: [_jsx("p", { style: { color: '#666', fontSize: '0.8rem', fontWeight: '600', margin: 0 }, children: "NOVO ESTOQUE TOTAL" }), _jsx("p", { style: { color: '#2e7d32', fontSize: '1.8rem', fontWeight: '800', margin: 0 }, children: novoTotal })] })] }), reserva > 0 && (_jsxs("div", { style: { marginTop: '1rem', padding: '0.75rem 1rem', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: '6px', color: '#e65100', fontSize: '0.88rem' }, children: ["\u26A0\uFE0F ", _jsxs("strong", { children: [reserva, " un"] }), " deste produto est\u00E3o separadas para o FULL no inbound ", reservaInboundInbs, " e ser\u00E3o ", _jsx("strong", { children: "seguradas" }), " (baixa autom\u00E1tica no inbound). Por isso sobe s\u00F3 ", qtdSubir, " na Olist."] }))] }));
                                    })()] })), _jsxs("div", { style: { display: 'flex', gap: '1rem', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e0e0e0' }, children: [_jsx("button", { onClick: voltarParaInicial, style: {
                                            padding: '0.75rem 1.5rem',
                                            background: '#f0f0f0',
                                            color: '#1a1a1a',
                                            border: '1px solid #e0e0e0',
                                            borderRadius: '4px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            fontSize: '0.95rem',
                                            transition: 'all 0.3s'
                                        }, onMouseEnter: (e) => (e.currentTarget.style.background = '#e8e8e8'), onMouseLeave: (e) => (e.currentTarget.style.background = '#f0f0f0'), children: "\u2190 Voltar para Inicial" }), _jsx("button", { onClick: handleVincular, disabled: !produtoOlistSelecionado.sku, style: {
                                            padding: '0.75rem 1.5rem',
                                            background: produtoOlistSelecionado.sku ? '#007acc' : '#ccc',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            fontWeight: '600',
                                            cursor: produtoOlistSelecionado.sku ? 'pointer' : 'not-allowed',
                                            fontSize: '0.95rem',
                                            transition: 'all 0.3s'
                                        }, onMouseEnter: (e) => {
                                            if (produtoOlistSelecionado.sku) {
                                                e.currentTarget.style.background = '#005a96';
                                            }
                                        }, onMouseLeave: (e) => {
                                            if (produtoOlistSelecionado.sku) {
                                                e.currentTarget.style.background = '#007acc';
                                            }
                                        }, children: "Vincular e Atualizar Estoque \u2192" })] })] }) })] }));
    }
    // ===== PÁGINA FORNECEDORES =====
    if (pagina === 'fornecedores') {
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsx("div", { className: "container", children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("h1", { children: "GEST\u00C3O DE FORNECEDORES" }), _jsx("p", { children: "Cadastre e gerencie fornecedores para notifica\u00E7\u00F5es autom\u00E1ticas" })] }), _jsx("button", { onClick: () => setPagina('inicial'), style: {
                                        padding: '0.6rem 1.2rem',
                                        backgroundColor: '#f0f0f0',
                                        color: '#1a1a1a',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '0.9rem'
                                    }, children: "\u2190 Voltar" })] }) }) }), _jsx("main", { className: "container main-content", children: _jsx(FornecedoresManager, { onVoltar: voltarParaInicial }) })] }));
    }
    // ===== PÁGINA EMBALDES =====
    if (pagina === 'embaldes') {
        return (_jsxs("div", { className: "app", children: [_jsx("header", { className: "header", children: _jsx("div", { className: "container", children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("h1", { children: "INBOUND (LISTA DE SEPARA\u00C7\u00C3O)" }), _jsx("p", { children: "Suba os inbounds do Mercado Livre FULL antes da nota fiscal" })] }), _jsx("button", { onClick: () => setPagina('inicial'), style: {
                                        padding: '0.6rem 1.2rem',
                                        backgroundColor: '#f0f0f0',
                                        color: '#1a1a1a',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '0.9rem'
                                    }, children: "\u2190 Voltar" })] }) }) }), _jsx("main", { className: "container main-content", children: _jsx(EmbaldesManager, {}) })] }));
    }
    return null;
}
export default App;
