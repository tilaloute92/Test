import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Application autonome : aucun lien avec l'app de suivi d'équipe à la racine du dépôt.
// `base: './'` permet d'ouvrir le build depuis n'importe quel sous-répertoire (IIS, partage
// réseau, ou même le système de fichiers).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
})
