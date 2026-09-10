type Platform = 'ml' | 'shopee' | 'operacao'

interface PlatformTabsProps {
  active: Platform
  onChange: (platform: Platform) => void
}

export function PlatformTabs({ active, onChange }: PlatformTabsProps) {
  const tabs: Array<{ id: Platform; label: string; icon: string; color: string }> = [
    { id: 'ml', label: 'Mercado Livre', icon: '📦', color: '#1e5a96' },
    { id: 'shopee', label: 'Shopee', icon: '🧡', color: '#ff8800' },
    { id: 'operacao', label: 'Operação', icon: '⚙️', color: '#666' },
  ]

  return (
    <div style={{
      display: 'flex',
      gap: '2rem',
      borderBottom: '2px solid #e0e0e0',
      paddingBottom: '1rem',
      alignItems: 'center',
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: active === tab.id ? `3px solid ${tab.color}` : 'none',
            cursor: 'pointer',
            fontWeight: active === tab.id ? '600' : '400',
            fontSize: '14px',
            color: active === tab.id ? tab.color : '#666',
            padding: '0.5rem 0',
            paddingBottom: 'calc(1rem - 3px)',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ marginRight: '0.4rem' }}>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export { type Platform }
