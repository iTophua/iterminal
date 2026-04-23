import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { SplashScreen } from './components/SplashScreen'
import { useAppInitialization } from './hooks/useAppInitialization'
import { useWindowState } from './hooks/useWindowState'
import './styles/global.css'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

const ERROR_RETRY_KEY = 'iterminal_error_retries'
const MAX_ERROR_RETRIES = 2

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo)
  }

  handleReset = () => {
    const retries = parseInt(localStorage.getItem(ERROR_RETRY_KEY) || '0', 10)
    if (retries >= MAX_ERROR_RETRIES) {
      localStorage.removeItem(ERROR_RETRY_KEY)
      this.setState({ hasError: false, error: null })
    } else {
      localStorage.setItem(ERROR_RETRY_KEY, String(retries + 1))
      localStorage.removeItem('iterminal_theme')
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      const retries = parseInt(localStorage.getItem(ERROR_RETRY_KEY) || '0', 10)
      const exhausted = retries >= MAX_ERROR_RETRIES

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: 'var(--color-text, #e0e0e0)',
          background: 'var(--color-bg-base, #1a1a1a)',
          padding: 40,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>
            {exhausted ? '应用无法自动恢复' : '应用启动出错'}
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: 13, opacity: 0.6, maxWidth: 400 }}>
            {exhausted
              ? '多次尝试恢复失败，请手动重启应用或检查日志。'
              : (this.state.error?.message || '未知错误')}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 24px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #00b96b)',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {exhausted ? '清除状态并继续' : (retries > 0 ? '再次重试' : '重置并重试')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AppWithSplash() {
  const { steps, progress, displayProgress, isComplete, hasError } = useAppInitialization()
  const [showSplash, setShowSplash] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useWindowState()

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      const el = document.getElementById('preloader')
      if (el) el.remove()
    }, 15000)
    return () => clearTimeout(safetyTimer)
  }, [])

  useEffect(() => {
    if (isComplete || hasError) {
      const preloader = document.getElementById('preloader')
      if (preloader) {
        preloader.classList.add('fade-out')
        setTimeout(() => preloader.remove(), 300)
      }
      setFadeOut(true)
      const timer = setTimeout(() => setShowSplash(false), hasError ? 3000 : 400)
      return () => clearTimeout(timer)
    }
  }, [isComplete, hasError])

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const isEditable = target.isContentEditable
      const hasAllowAttr = target.closest('[data-allow-contextmenu]')
      const isInTextArea = !!target.closest('.ant-input')

      if (!isInput && !isEditable && !hasAllowAttr && !isInTextArea) {
        e.preventDefault()
      }
    }

    document.addEventListener('contextmenu', handleContextMenu)

    const disableAutocomplete = () => {
      document.querySelectorAll('input:not([autocorrect="off"]), textarea:not([autocorrect="off"])').forEach((el) => {
        el.setAttribute('autocorrect', 'off')
      })
    }

    disableAutocomplete()

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(disableAutocomplete, 100)
    })

    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])

  return (
    <>
      {showSplash && (
        <SplashScreen steps={steps} progress={progress} displayProgress={displayProgress} fadeOut={fadeOut} />
      )}
      <App />
    </>
  )
}

const root = document.getElementById('root')!

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <AppWithSplash />
      </ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)