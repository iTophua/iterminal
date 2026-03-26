import { useEffect, useState } from 'react'
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
  fadeOut: boolean
}

export function SplashScreen({ steps, progress, fadeOut }: SplashScreenProps) {
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
              <rect x="4" y="8" width="56" height="48" rx="4" fill="var(--color-bg-elevated)" stroke="var(--color-primary)" strokeWidth="2"/>
              <rect x="4" y="8" width="56" height="12" rx="4" fill="var(--color-primary)" opacity="0.2"/>
              <circle cx="14" cy="14" r="3" fill="#ff5f56"/>
              <circle cx="24" cy="14" r="3" fill="#ffbd2e"/>
              <circle cx="34" cy="14" r="3" fill="#27ca40"/>
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

        <div className="splash-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-text">{Math.round(progress)}%</div>
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