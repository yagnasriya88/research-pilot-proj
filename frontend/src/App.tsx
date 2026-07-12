import { useState, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { ReferenceManager } from './pages/ReferenceManager'
import { ChatThread } from './pages/ChatThread'
import { MyChats } from './pages/MyChats'
import { MyNotebooks } from './pages/MyNotebooks'
import { MyBooks } from './pages/MyBooks'
import { ReaderPage } from './pages/ReaderPage'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { useAuth } from './auth/AuthContext'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return (
    <div className="app-shell">
      <Sidebar
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="app-main">
        <div className="mobile-topbar">
          <button
            type="button"
            className="btn btn-icon btn-icon-sm"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={18} />
          </button>
          <span className="mobile-topbar-title">ResearchPilot</span>
        </div>
        <div className="main-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/references" element={<ReferenceManager />} />
        <Route path="/papers/:id/read" element={<ReaderPage sourceType="paper" />} />
        <Route path="/books/:id/read" element={<ReaderPage sourceType="book" />} />
        <Route path="/chats/:chatId" element={<ChatThread />} />
        <Route path="/my-chats" element={<MyChats />} />
        <Route path="/my-books" element={<MyBooks />} />
        <Route path="/my-notebooks" element={<MyNotebooks />} />
      </Route>
    </Routes>
  )
}

export default App
