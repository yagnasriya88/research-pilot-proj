import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NotebookPen, Moon, Sun, Home, Library, Sparkles, MessagesSquare } from 'lucide-react'
import { useTheme } from '../theme/ThemeContext'

const NAV_ITEMS: { to: string; label: string; icon: ReactNode; isAgentGroup?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: <Home size={16} /> },
  { to: '/references', label: 'Reference Manager', icon: <Library size={16} /> },
  { to: '/?agent=search', label: 'Research Agents', icon: <Sparkles size={16} />, isAgentGroup: true },
  { to: '/my-chats', label: 'My Chats', icon: <MessagesSquare size={16} /> },
  { to: '/my-notebooks', label: 'My Notebooks', icon: <NotebookPen size={16} /> },
]

// NavLink's built-in isActive only compares pathname, so Dashboard and "Research Agents"
// (both routed to "/") would always match together — compare the `agent` query param too.
// "Research Agents" covers all 3 agent types (its own in-page dropdown switches between
// them, per Dashboard.tsx's AGENTS list), so it's active for *any* agent value, while
// Dashboard is only active when there's no agent param at all.
function isNavItemActive(item: { to: string; isAgentGroup?: boolean }, pathname: string, search: string) {
  const [itemPath] = item.to.split('?')
  if (pathname !== itemPath) return false
  const currentAgent = new URLSearchParams(search).get('agent')
  return item.isAgentGroup ? currentAgent !== null : currentAgent === null
}

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const location = useLocation()
  const { theme, toggle } = useTheme()
  return (
    <>
      {mobileOpen && <div className="drawer-scrim" onClick={onClose} />}
      <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <span className="dot" />
          ResearchPilot
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              // NavLink always appends its own pathname-only "active" class even when className
              // is a string, so it must be a function here to fully replace that logic instead.
              className={() =>
                `sidebar-nav-item${isNavItemActive(item, location.pathname, location.search) ? ' active' : ''}`
              }
            >
              <span className="icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">J</span>
          <div>
            <div className="sidebar-footer-name">Johnson</div>
            <div className="sidebar-footer-email">johnson@example.com</div>
          </div>
          <button
            type="button"
            className="btn btn-icon btn-icon-sm sidebar-theme-toggle"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </aside>
    </>
  )
}
