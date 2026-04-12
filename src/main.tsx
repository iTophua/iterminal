import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { SplashScreen } from './components/SplashScreen'
import { useAppInitialization } from './hooks/useAppInitialization'
import { useWindowState } from './hooks/useWindowState'
import './styles/global.css'

function AppWithSplash() {
  const { steps, progress, displayProgress, isComplete } = useAppInitialization()
  const [showSplash, setShowSplash] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useWindowState()
  
  useEffect(() => {
    const preloader = document.getElementById('preloader')
    if (preloader) {
      preloader.classList.add('fade-out')
      setTimeout(() => preloader.remove(), 300)
    }
  }, [])
  
  useEffect(() => {
    if (isComplete) {
      setFadeOut(true)
      const timer = setTimeout(() => setShowSplash(false), 400)
      return () => clearTimeout(timer)
    }
  }, [isComplete])
  
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppWithSplash />
    </ThemeProvider>
  </React.StrictMode>
)