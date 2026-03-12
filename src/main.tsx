import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import App from './App'
import { useTransferStore } from './stores/transferStore'
import { setupNightlyCleanup } from './utils/transferCleanup'
import './styles/global.css'

const initializeApp = () => {
  useTransferStore.getState().cleanupExpiredRecords()
  setupNightlyCleanup()
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
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
)

initializeApp()