import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme, App as AntdApp } from 'antd'
import App from './App'
import { ThemeProvider, useTheme } from './components/ThemeProvider'
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
}

function ThemedApp() {
  const { mode } = useTheme()
  
  return (
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#00b96b',
          borderRadius: 6,
        },
        components: {
          Tree: {
            nodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            nodeSelectedColor: mode === 'dark' ? '#fff' : '#262626',
            directoryNodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            directoryNodeSelectedColor: mode === 'dark' ? '#fff' : '#262626',
          },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
)

initializeApp()