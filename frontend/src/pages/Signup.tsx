import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Library, Lock, Mail, MessagesSquare, Search, User } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { extractErrorMessage } from '../api/client'

export function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await signup(name.trim(), email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not create your account.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-visual">
        <div className="auth-visual-content">
          <div className="auth-visual-brand">
            <span className="dot" />
            ResearchPilot
          </div>
          <h1 className="auth-visual-title">Start your research workspace in seconds.</h1>
          <p className="auth-visual-subtitle">
            One account, one place for every paper, chat, and note you collect along the way.
          </p>
          <ul className="auth-visual-features">
            <li>
              <span className="auth-visual-feature-icon">
                <Search size={16} />
              </span>
              AI-powered search across arXiv &amp; Semantic Scholar
            </li>
            <li>
              <span className="auth-visual-feature-icon">
                <MessagesSquare size={16} />
              </span>
              Chat directly with your PDFs and books
            </li>
            <li>
              <span className="auth-visual-feature-icon">
                <Library size={16} />
              </span>
              Keep every reference organized in one library
            </li>
          </ul>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="auth-card-brand">
            <span className="dot" />
            ResearchPilot
          </div>
          <h2 className="auth-title">Create your account</h2>
          <p className="auth-subtitle">Sign up to get started with ResearchPilot.</p>

          <form onSubmit={handleSubmit}>
            <div className="auth-field-group">
              <label className="field-label" htmlFor="signup-name">
                Name
              </label>
              <div className="auth-input-wrap">
                <User size={16} className="auth-input-icon" />
                <input
                  id="signup-name"
                  type="text"
                  className="text-input auth-input"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="auth-field-group">
              <label className="field-label" htmlFor="signup-email">
                Email
              </label>
              <div className="auth-input-wrap">
                <Mail size={16} className="auth-input-icon" />
                <input
                  id="signup-email"
                  type="email"
                  className="text-input auth-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="auth-field-group">
              <label className="field-label" htmlFor="signup-password">
                Password
              </label>
              <div className="auth-input-wrap">
                <Lock size={16} className="auth-input-icon" />
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="text-input auth-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="auth-input-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="auth-hint">At least 8 characters.</div>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Sign up'}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
