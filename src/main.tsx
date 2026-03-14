import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme, App as AntdApp } from 'antd'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#00b96b',
          borderRadius: 6,
        },
        components: {
          Tree: {
            nodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            nodeSelectedColor: '#fff',
            directoryNodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            directoryNodeSelectedColor: '#fff',
          },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
)

initializeApp()