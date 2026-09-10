type Marketplace = 'olist' | 'shopee' | null

interface MarketplaceSwitchProps {
  active: Marketplace
  onChange: (mp: Marketplace) => void
}

export function MarketplaceSwitch({ active, onChange }: MarketplaceSwitchProps) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <button
        onClick={() => onChange(null)}
        style={{
          border: active === null ? '2px solid #333' : '1px solid #ccc',
          background: active === null ? '#f5f5f5' : '#fff',
          padding: '0.4rem 0.8rem',
          borderRadius: '4px',
          cursor: 'pointer',
          fontWeight: active === null ? 'bold' : 'normal',
          fontSize: '12px',
        }}
      >
        Todos
      </button>
      <button
        onClick={() => onChange('olist')}
        style={{
          border: active === 'olist' ? '2px solid #1e5a96' : '1px solid #ccc',
          background: active === 'olist' ? '#e8f1f8' : '#fff',
          padding: '0.4rem 0.8rem',
          borderRadius: '4px',
          cursor: 'pointer',
          fontWeight: active === 'olist' ? 'bold' : 'normal',
          fontSize: '12px',
          color: active === 'olist' ? '#1e5a96' : '#333',
        }}
      >
        📦 Olist
      </button>
      <button
        onClick={() => onChange('shopee')}
        style={{
          border: active === 'shopee' ? '2px solid #ff8800' : '1px solid #ccc',
          background: active === 'shopee' ? '#fff3e0' : '#fff',
          padding: '0.4rem 0.8rem',
          borderRadius: '4px',
          cursor: 'pointer',
          fontWeight: active === 'shopee' ? 'bold' : 'normal',
          fontSize: '12px',
          color: active === 'shopee' ? '#ff8800' : '#333',
        }}
      >
        🧡 Shopee
      </button>
    </div>
  )
}

export { type Marketplace }
