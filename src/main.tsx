import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider } from './components/ConfirmProvider.tsx'
// Démarre le suivi automatique de l'historique des versions (voir src/lib/backup.ts) —
// import pour effet de bord uniquement, avant le premier rendu.
import './lib/backup.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
)
