import { ReactNode } from 'react'
import { TerminalTabs, SessionTabItem } from './TerminalTabs'

interface TerminalPaneProps {
  sessions: SessionTabItem[]
  activeSessionId: string | null
  onSessionChange: (sessionId: string) => void
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
  onPaneClick?: () => void
  children: ReactNode
  style?: React.CSSProperties
}

export function TerminalPane({
  sessions,
  activeSessionId,
  onSessionChange,
  onNewSession,
  onCloseSession,
  onPaneClick,
  children,
  style,
}: TerminalPaneProps) {
  return (
    <div 
      style={{ 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        background: 'var(--color-bg-container)',
        ...style,
      }}
      onClick={onPaneClick}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px',
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TerminalTabs
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSessionChange={onSessionChange}
            onNewSession={onNewSession}
            onCloseSession={onCloseSession}
          />
        </div>
      </div>
      
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}