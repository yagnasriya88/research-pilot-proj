import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { ReferenceManager } from './pages/ReferenceManager'
import { ChatThread } from './pages/ChatThread'
import { MyChats } from './pages/MyChats'
import { MyNotebooks } from './pages/MyNotebooks'
import { ReaderPage } from './pages/ReaderPage'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <div className="app-shell">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/references" element={<ReferenceManager />} />
            <Route path="/papers/:id/read" element={<ReaderPage />} />
            <Route path="/chats/:chatId" element={<ChatThread />} />
            <Route path="/my-chats" element={<MyChats />} />
            <Route path="/my-notebooks" element={<MyNotebooks />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default App
