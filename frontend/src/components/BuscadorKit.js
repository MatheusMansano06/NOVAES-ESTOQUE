import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
export default function BuscadorKit({ itemId, onKitDetectado, onSemKit }) {
    const [skuBuscado, setSkuBuscado] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [kitDetectado, setKitDetectado] = useState(null);
    const [componentes, setComponentes] = useState([]);
    const [quantidades, setQuantidades] = useState({});
    const [mensagem, setMensagem] = useState(null);
    const handleBuscar = async (e) => {
        e.preventDefault();
        if (!skuBuscado.trim()) {
            setMensagem({ tipo: 'erro', texto: 'Digite um SKU para buscar' });
            return;
        }
        setBuscando(true);
        setMensagem(null);
        setKitDetectado(null);
        setComponentes([]);
        setQuantidades({});
        try {
            // Verificar se é kit
            const resKit = await fetch(`http://127.0.0.1:8000/api/olist/kits/verificar?sku=${encodeURIComponent(skuBuscado.toUpperCase())}`);
            const dataKit = await resKit.json();
            if (!dataKit.eh_kit) {
                setMensagem({ tipo: 'info', texto: `${skuBuscado} não é um kit configurado` });
                if (onSemKit)
                    onSemKit();
                return;
            }
            // É um kit! Buscar informações dos componentes
            setKitDetectado(dataKit);
            setMensagem({ tipo: 'sucesso', texto: `Kit detectado: ${dataKit.nome_kit}` });
            // Buscar dados de cada componente na Olist
            const compsData = [];
            for (const sku of dataKit.skus_componentes) {
                try {
                    const resProd = await fetch(`http://127.0.0.1:8000/api/olist/produtos?q=${encodeURIComponent(sku)}`);
                    const dataProd = await resProd.json();
                    const prod = dataProd.produtos?.[0];
                    if (prod) {
                        compsData.push({
                            sku: sku,
                            olist_produto_id: prod.id,
                            olist_nome: prod.nome || sku,
                            olist_preco: prod.preco || 0
                        });
                        setQuantidades(prev => ({ ...prev, [sku]: 0 }));
                    }
                }
                catch (err) {
                    console.error(`Erro ao buscar componente ${sku}:`, err);
                }
            }
            setComponentes(compsData);
            if (onKitDetectado && compsData.length > 0) {
                onKitDetectado(dataKit, compsData);
            }
        }
        catch (err) {
            setMensagem({ tipo: 'erro', texto: `Erro ao buscar kit: ${err}` });
        }
        finally {
            setBuscando(false);
        }
    };
    return (_jsxs("div", { style: { padding: '1.5rem', background: '#fff3cd', border: '3px solid #ffc107', borderRadius: '8px', marginBottom: '2rem' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }, children: [_jsx("span", { style: { fontSize: '1.5rem' }, children: "\uD83C\uDF81" }), _jsx("h3", { style: { margin: 0, color: '#856404', fontSize: '1.1rem', fontWeight: '700' }, children: "Buscar Kit (Produto Composto)" })] }), _jsx("p", { style: { margin: '0 0 1rem', color: '#856404', fontSize: '0.9rem' }, children: "Se este produto \u00E9 um KIT (como Viseira + Reparo), busque pelo SKU do kit aqui primeiro!" }), _jsxs("form", { onSubmit: handleBuscar, style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' }, children: [_jsx("input", { type: "text", placeholder: "Digite o SKU do kit (ex: V+RL3)", value: skuBuscado, onChange: (e) => setSkuBuscado(e.target.value), disabled: buscando, style: {
                            flex: 1,
                            padding: '0.6rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '0.9rem'
                        } }), _jsx("button", { type: "submit", disabled: buscando, style: {
                            padding: '0.6rem 1.2rem',
                            background: '#007acc',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            whiteSpace: 'nowrap'
                        }, children: buscando ? '...' : 'Buscar' })] }), mensagem && (_jsx("div", { style: {
                    padding: '0.75rem',
                    marginBottom: '1rem',
                    borderRadius: '4px',
                    background: mensagem.tipo === 'erro' ? '#ffebee' : mensagem.tipo === 'sucesso' ? '#e8f5e9' : '#e3f2fd',
                    color: mensagem.tipo === 'erro' ? '#c62828' : mensagem.tipo === 'sucesso' ? '#2e7d32' : '#0d47a1',
                    fontSize: '0.9rem'
                }, children: mensagem.texto })), kitDetectado && componentes.length > 0 && (_jsxs("div", { style: { background: '#fff', border: '2px solid #4caf50', borderRadius: '6px', padding: '1rem' }, children: [_jsxs("h4", { style: { margin: '0 0 0.75rem', color: '#2e7d32' }, children: ["\uD83C\uDF81 ", kitDetectado.nome_kit] }), _jsxs("p", { style: { margin: '0 0 1rem', color: '#666', fontSize: '0.85rem' }, children: ["Composto por ", kitDetectado.quantidade_componentes, " componentes:"] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: componentes.map((comp) => (_jsxs("div", { style: {
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 1fr',
                                gap: '0.5rem',
                                alignItems: 'center',
                                padding: '0.75rem',
                                background: '#f5f5f5',
                                borderRadius: '4px'
                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: '600', color: '#1a1a1a', fontSize: '0.9rem' }, children: comp.olist_nome }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#999' }, children: ["SKU: ", comp.sku] })] }), _jsxs("div", { style: { fontSize: '0.85rem', color: '#666' }, children: ["R$ ", comp.olist_preco.toFixed(2)] }), _jsx("input", { type: "number", min: "0", step: "1", placeholder: "Qtd", disabled: true, style: {
                                        padding: '0.4rem',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        fontSize: '0.9rem',
                                        textAlign: 'center',
                                        background: '#e8f5e9',
                                        cursor: 'not-allowed'
                                    }, title: "Ser\u00E1 atualizado automaticamente com a quantidade da nota fiscal" })] }, comp.sku))) }), _jsx("div", { style: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' }, children: "\u2139\uFE0F A quantidade ser\u00E1 automaticamente atualizada para cada componente baseada na quantidade confirmada da nota fiscal." })] }))] }));
}
