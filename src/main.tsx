import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { report } from './lib/api'
import './styles/base.css'
import './styles/organism.css'
import './styles/ui.css'
import './styles/pages.css'
import './styles/protocol.css'
import './styles/blueprints.css'
import './styles/appscan.css'
import './styles/network.css'
import './styles/studio.css'

window.addEventListener('error', (event) => {
  report('error', event.message || 'Script error', { stack: event.error instanceof Error ? event.error.stack : undefined })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  report('unhandledrejection', reason instanceof Error ? reason.message : String(reason), { stack: reason instanceof Error ? reason.stack : undefined })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
