import { useEffect, useState, useRef } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import './SplashScreen.css'

export interface InitStep {
  key: string
  label: string
  status: 'pending' | 'loading' | 'done' | 'error'
}

interface SplashScreenProps {
  steps: InitStep[]
  progress: number
  displayProgress: number
  fadeOut: boolean
}

const TERMINAL_LINES = [
  { text: '$ ssh user@server', delay: 300 },
  { text: 'Connecting to server...', delay: 400 },
  { text: '✓ Authentication successful', delay: 500 },
  { text: 'Welcome to iTerminal v2.0', delay: 300 },
]

function TypewriterTerminal() {
  const [currentLine, setCurrentLine] = useState(0)
  const [displayText, setDisplayText] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev)
    }, 530)
    return () => clearInterval(cursorInterval)
  }, [])

  useEffect(() => {
    if (currentLine >= TERMINAL_LINES.length) {
      setCurrentLine(0)
      setDisplayText('')
      return
    }

    const line = TERMINAL_LINES[currentLine]
    let charIndex = 0
    setDisplayText('')

    intervalRef.current = setInterval(() => {
      if (charIndex < line.text.length) {
        setDisplayText(line.text.substring(0, charIndex + 1))
        charIndex++
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setTimeout(() => {
          setCurrentLine(prev => prev + 1)
        }, line.delay)
      }
    }, 50)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [currentLine])

  return (
    <div className="typewriter-terminal">
      <div className="terminal-header">
        <span className="terminal-dot red" />
        <span className="terminal-dot yellow" />
        <span className="terminal-dot green" />
        <span className="terminal-title">iTerminal Preview</span>
      </div>
      <div className="terminal-body">
        {TERMINAL_LINES.slice(0, currentLine).map((line, index) => (
          <div key={index} className="terminal-line">
            {line.text}
          </div>
        ))}
        {currentLine < TERMINAL_LINES.length && (
          <div className="terminal-line current">
            {displayText}
            <span className={`cursor ${showCursor ? 'visible' : ''}`}>█</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function SplashScreen({ steps, displayProgress, fadeOut }: SplashScreenProps) {
  const [logoVisible, setLogoVisible] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setLogoVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''))
  }, [])

  return (
    <div className={`splash-screen ${fadeOut ? 'fade-out' : ''}`}>
      <div className="splash-content">
        <div className={`splash-logo ${logoVisible ? 'visible' : ''}`}>
          <div className="logo-icon">
            <svg viewBox="0 0 64 64" width="80" height="80">
              <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--color-primary)" />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--color-primary) 70%, #00d4aa)" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <rect x="4" y="8" width="56" height="48" rx="4" fill="var(--color-bg-elevated)" stroke="url(#logoGradient)" strokeWidth="2.5" filter="url(#glow)"/>
              <rect x="4" y="8" width="56" height="12" rx="4" fill="var(--color-primary)" opacity="0.25"/>
              <circle cx="14" cy="14" r="3" fill="#ff5f56">
                <animate attributeName="r" values="3;3.5;3" dur="2s" repeatCount="indefinite"/>
              </circle>
              <circle cx="24" cy="14" r="3" fill="#ffbd2e">
                <animate attributeName="r" values="3;3.5;3" dur="2s" begin="0.3s" repeatCount="indefinite"/>
              </circle>
              <circle cx="34" cy="14" r="3" fill="#27ca40">
                <animate attributeName="r" values="3;3.5;3" dur="2s" begin="0.6s" repeatCount="indefinite"/>
              </circle>
              <text x="12" y="36" fill="var(--color-primary)" fontFamily="monospace" fontSize="10">$</text>
              <rect x="22" y="30" width="24" height="2" rx="1" fill="var(--color-primary)" opacity="0.8">
                <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1s" repeatCount="indefinite"/>
              </rect>
              <rect x="12" y="42" width="32" height="2" rx="1" fill="var(--color-text-tertiary)" opacity="0.5"/>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-title">iTerminal</span>
            <span className="logo-subtitle">SSH 连接管理器</span>
          </div>
        </div>

        <TypewriterTerminal />

        <div className="splash-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${displayProgress}%` }} />
            <div className="progress-glow" style={{ left: `${displayProgress}%`, transform: 'translateX(-50%)' }} />
          </div>
          <div className="progress-text">{Math.round(displayProgress)}%</div>
        </div>

        <div className="splash-steps">
          {steps.map((step) => (
            <div key={step.key} className={`step-item ${step.status}`}>
              <span className="step-icon">
                {step.status === 'done' && (
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    <path d="M13.5 4.5L6 12l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {step.status === 'loading' && (
                  <span className="loading-spinner" />
                )}
                {step.status === 'error' && (
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
                {step.status === 'pending' && (
                  <span className="step-dot" />
                )}
              </span>
              <span className="step-label">{step.label}</span>
            </div>
          ))}
        </div>

        <div className="splash-footer">
          {version && <span>v{version}</span>}
          {version && <span className="divider">·</span>}
          <span>© 2026 iTerminal</span>
        </div>
      </div>
    </div>
  )
}
