import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootstrapCatalog } from './lib/catalogSource'
import './index.css'

// Le catalogue d'équipements est chargé avant le premier rendu : lots embarqués, lots
// déposés dans `catalog/` à côté de l'application, source distante configurée, puis lots
// et types enregistrés sur ce poste. Un échec de chargement ne bloque jamais l'affichage.
bootstrapCatalog()
  .catch(() => undefined)
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
