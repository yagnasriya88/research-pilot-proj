import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  NotebookPen,
  Moon,
  Sun,
  Home,
  Library,
  Sparkles,
  MessagesSquare,
  BookMarked,
  LogOut,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../auth/AuthContext'

const NAV_ITEMS: { to: string; label: string; icon: ReactNode; isAgentGroup?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: <Home size={16} /> },
  { to: '/references', label: 'Reference Manager', icon: <Library size={16} /> },
  { to: '/my-books', label: 'My Books', icon: <BookMarked size={16} /> },
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
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ mobileOpen = false, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const { theme, toggle } = useTheme()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      {mobileOpen && <div className="drawer-scrim" onClick={onClose} />}
      <aside className={`sidebar${mobileOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-logo">
          <span className="dot" />
          <span className="sidebar-logo-text">ResearchPilot</span>
          {onToggleCollapse && (
            <button
              type="button"
              className="btn btn-icon btn-icon-sm sidebar-collapse-btn"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
            </button>
          )}
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              // NavLink always appends its own pathname-only "active" class even when className
              // is a string, so it must be a function here to fully replace that logic instead.
              className={() =>
                `sidebar-nav-item${isNavItemActive(item, location.pathname, location.search) ? ' active' : ''}`
              }
            >
              <span className="icon">{item.icon}</span>
              <span className="label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{(user?.name || '?').charAt(0).toUpperCase()}</span>
          <div className="sidebar-footer-info">
            <div className="sidebar-footer-name">{user?.name ?? 'Guest'}</div>
            <div className="sidebar-footer-email">{user?.email ?? ''}</div>
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
          <button
            type="button"
            className="btn btn-icon btn-icon-sm"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>
    </>
  )
}
