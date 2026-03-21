import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { useTransferStore } from './stores/transferStore'
import { setupNightlyCleanup } from './utils/transferCleanup'
import './styles/global.css'

const initializeApp = () => {
  useTransferStore.getState().cleanupExpiredRecords()
  setupNightlyCleanup()
  
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    const isEditable = target.isContentEditable
    const hasAllowAttr = target.closest('[data-allow-contextmenu]')
    const isInTextArea = !!target.closest('.ant-input')
    
    if (!isInput && !isEditable && !hasAllowAttr && !isInTextArea) {
      e.preventDefault()
    }
  })

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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)

initializeApp()