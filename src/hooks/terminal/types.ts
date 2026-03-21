export interface SessionInfo {
  id: string
  shellId: string
  title: string
}

export interface SplitPaneState {
  id: string
  sessions: SessionInfo[]
  activeSessionId: string | null
}

export type SearchMode = 'normal' | 'regex' | 'wholeWord'