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
            const resKit = await fetch(`http://localhost:8000/api/olist/kits/verificar?sku=${encodeURIComponent(skuBuscado.toUpperCase())}`);
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
                    const resProd = await fetch(`http://localhost:8000/api/olist/produtos?q=${encodeURIComponent(sku)}`);
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
    return (<div style={{ padding: '1.5rem', background: '#fff3cd', border: '3px solid #ffc107', borderRadius: '8px', marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '1.5rem' }}>🎁</span>
        <h3 style={{ margin: 0, color: '#856404', fontSize: '1.1rem', fontWeight: '700' }}>Buscar Kit (Produto Composto)</h3>
      </div>
      <p style={{ margin: '0 0 1rem', color: '#856404', fontSize: '0.9rem' }}>
        Se este produto é um KIT (como Viseira + Reparo), busque pelo SKU do kit aqui primeiro!
      </p>

      <form onSubmit={handleBuscar} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input type="text" placeholder="Digite o SKU do kit (ex: V+RL3)" value={skuBuscado} onChange={(e) => setSkuBuscado(e.target.value)} disabled={buscando} style={{
            flex: 1,
            padding: '0.6rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '0.9rem'
        }}/>
        <button type="submit" disabled={buscando} style={{
            padding: '0.6rem 1.2rem',
            background: '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '600',
            whiteSpace: 'nowrap'
        }}>
          {buscando ? '...' : 'Buscar'}
        </button>
      </form>

      {mensagem && (<div style={{
                padding: '0.75rem',
                marginBottom: '1rem',
                borderRadius: '4px',
                background: mensagem.tipo === 'erro' ? '#ffebee' : mensagem.tipo === 'sucesso' ? '#e8f5e9' : '#e3f2fd',
                color: mensagem.tipo === 'erro' ? '#c62828' : mensagem.tipo === 'sucesso' ? '#2e7d32' : '#0d47a1',
                fontSize: '0.9rem'
            }}>
          {mensagem.texto}
        </div>)}

      {kitDetectado && componentes.length > 0 && (<div style={{ background: '#fff', border: '2px solid #4caf50', borderRadius: '6px', padding: '1rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', color: '#2e7d32' }}>
            🎁 {kitDetectado.nome_kit}
          </h4>
          <p style={{ margin: '0 0 1rem', color: '#666', fontSize: '0.85rem' }}>
            Composto por {kitDetectado.quantidade_componentes} componentes:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {componentes.map((comp) => (<div key={comp.sku} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '0.5rem',
                    alignItems: 'center',
                    padding: '0.75rem',
                    background: '#f5f5f5',
                    borderRadius: '4px'
                }}>
                <div>
                  <div style={{ fontWeight: '600', color: '#1a1a1a', fontSize: '0.9rem' }}>
                    {comp.olist_nome}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#999' }}>
                    SKU: {comp.sku}
                  </div>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  R$ {comp.olist_preco.toFixed(2)}
                </div>
                <input type="number" min="0" step="1" placeholder="Qtd" disabled style={{
                    padding: '0.4rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                    background: '#e8f5e9',
                    cursor: 'not-allowed'
                }} title="Será atualizado automaticamente com a quantidade da nota fiscal"/>
              </div>))}
          </div>

          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' }}>
            ℹ️ A quantidade será automaticamente atualizada para cada componente baseada na quantidade confirmada da nota fiscal.
          </div>
        </div>)}
    </div>);
}
