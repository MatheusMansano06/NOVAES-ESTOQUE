import { type ReactNode, useState } from 'react'

type IconName =
  | 'dashboard'
  | 'receipt'
  | 'box'
  | 'users'
  | 'megaphone'
  | 'truck'
  | 'warning'
  | 'menu'
  | 'bell'
  | 'sync'
  | 'user'
  | 'search'
  | 'radar'

export interface ShellNavItem {
  key: string
  label: string
  icon: IconName
  active?: boolean
  badge?: string | number | null
  onClick: () => void
}

export interface ShellNavGroup {
  label: string
  items: ShellNavItem[]
}

export interface ShellStatusItem {
  label: string
  value: string
  tone?: 'positive' | 'warning' | 'danger' | 'neutral'
  // Quando definido, o chip vira um botão clicável (ex.: conectar integração pendente).
  // Sem onClick, é apenas um indicador estático (não clicável).
  onClick?: () => void
}

interface AppShellProps {
  title: string
  subtitle: string
  navGroups: ShellNavGroup[]
  statuses: ShellStatusItem[]
  profileName?: string
  profileSubtitle?: string
  onProfileClick?: () => void
  syncTimeLabel?: string
  primaryAction?: {
    label: string
    onClick: () => void
  }
  children: ReactNode
}

function ShellIcon({ name }: { name: IconName }) {
  const shared = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'dashboard':
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        </svg>
      )
    case 'receipt':
      return (
        <svg {...shared}>
          <path d="M7 3h10a2 2 0 0 1 2 2v16l-2.5-1.8L14 21l-2.5-1.8L9 21l-2.5-1.8L4 21V5a2 2 0 0 1 2-2Z" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      )
    case 'box':
      return (
        <svg {...shared}>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="M12 12 4 7.5" />
          <path d="M12 12l8-4.5" />
          <path d="M12 12v9" />
        </svg>
      )
    case 'users':
      return (
        <svg {...shared}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="3.5" />
          <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M15.5 3.13a3.5 3.5 0 0 1 0 6.75" />
        </svg>
      )
    case 'megaphone':
      return (
        <svg {...shared}>
          <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
          <path d="M16 8a5 5 0 0 1 0 8" />
          <path d="M18.5 5.5a8.5 8.5 0 0 1 0 13" />
        </svg>
      )
    case 'search':
      return (
        <svg {...shared}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      )
    case 'truck':
      return (
        <svg {...shared}>
          <path d="M10 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8v12Z" />
          <path d="M10 9h5l3 3v3a2 2 0 0 1-2 2h-1" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="16.5" cy="17.5" r="1.5" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...shared}>
          <path d="M12 4 3.7 18.2A1.4 1.4 0 0 0 4.9 20h14.2a1.4 1.4 0 0 0 1.2-1.8L12 4Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      )
    case 'radar':
      return (
        <svg {...shared}>
          <path d="M12 12 8 6.5" />
          <path d="M4 12a8 8 0 1 0 4-6.9" />
          <path d="M7.5 12A4.5 4.5 0 1 0 12 7.5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...shared}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...shared}>
          <path d="M15 17H5.5c-.8 0-1.3-.8-.9-1.5L6 13.4V10a6 6 0 1 1 12 0v3.4l1.4 2.1c.4.7-.1 1.5-.9 1.5H15" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...shared}>
          <path d="M20 7h-5V2" />
          <path d="M4 17h5v5" />
          <path d="M5.5 9A7 7 0 0 1 17 5l3 2" />
          <path d="M18.5 15A7 7 0 0 1 7 19l-3-2" />
        </svg>
      )
    case 'user':
      return (
        <svg {...shared}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      )
  }
}

function toneClass(tone: ShellStatusItem['tone']) {
  switch (tone) {
    case 'positive':
      return 'is-positive'
    case 'warning':
      return 'is-warning'
    case 'danger':
      return 'is-danger'
    default:
      return 'is-neutral'
  }
}

export function AppShell({
  title,
  subtitle,
  navGroups,
  statuses,
  profileName,
  profileSubtitle,
  onProfileClick,
  syncTimeLabel,
  primaryAction,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className={`nvs-shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="nvs-sidebar">
        <div className="nvs-sidebar__brand">
          <div className="nvs-sidebar__brand-card">
            <img src="/assets/nvs-tech-full.jpeg" alt="NVS Tech" />
          </div>
        </div>

        <div className="nvs-sidebar__groups">
          {navGroups.map((group) => (
            <div className="nvs-sidebar__group" key={group.label}>
              <div className="nvs-sidebar__group-label">{group.label}</div>
              <div className="nvs-sidebar__items">
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`nvs-sidebar__item${item.active ? ' is-active' : ''}`}
                    onClick={item.onClick}
                    title={item.label}
                  >
                    <span className="nvs-sidebar__item-icon">
                      <ShellIcon name={item.icon} />
                    </span>
                    <span className="nvs-sidebar__item-label">{item.label}</span>
                    {item.badge != null && item.badge !== '' && (
                      <span className="nvs-sidebar__item-badge">{item.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="nvs-shell__stage">
        <header className="nvs-topbar">
          <button type="button" className="nvs-icon-button" onClick={() => setCollapsed((value) => !value)}>
            <ShellIcon name="menu" />
          </button>

          <div className="nvs-topbar__status-strip">
            {statuses.map((status) =>
              status.onClick ? (
                <button
                  key={status.label}
                  type="button"
                  className={`nvs-status-chip is-clickable ${toneClass(status.tone)}`}
                  onClick={status.onClick}
                  title={`Clique para conectar ${status.label}`}
                >
                  <span className="nvs-status-chip__dot" />
                  <span className="nvs-status-chip__label">{status.label}</span>
                  <strong>{status.value}</strong>
                </button>
              ) : (
                <div key={status.label} className={`nvs-status-chip ${toneClass(status.tone)}`}>
                  <span className="nvs-status-chip__dot" />
                  <span className="nvs-status-chip__label">{status.label}</span>
                  <strong>{status.value}</strong>
                </div>
              )
            )}
          </div>

          <div className="nvs-topbar__sync">
            <span>Ultima sincronizacao</span>
            <strong>{syncTimeLabel ?? '--:--'}</strong>
          </div>

          {primaryAction && (
            <button type="button" className="nvs-topbar__cta" onClick={primaryAction.onClick}>
              <ShellIcon name="sync" />
              <span>{primaryAction.label}</span>
            </button>
          )}

          <button type="button" className="nvs-icon-button">
            <ShellIcon name="bell" />
          </button>

          <div
            className="nvs-topbar__profile"
            onClick={onProfileClick}
            style={onProfileClick ? { cursor: 'pointer' } : undefined}
            title={onProfileClick ? 'Trocar operador' : undefined}
          >
            <div className="nvs-topbar__avatar">
              <ShellIcon name="user" />
            </div>
            <div>
              <strong>{profileName ?? 'NVS Tech'}</strong>
              <span>{profileSubtitle ?? 'Operacao local'}</span>
            </div>
          </div>
        </header>

        <main className="nvs-workspace">
          <div className="nvs-page-head">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
