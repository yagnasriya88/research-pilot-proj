import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeContext'
import { ToastProvider } from './toast/ToastContext'
import { ToastStack } from './components/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <ToastStack />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
)
