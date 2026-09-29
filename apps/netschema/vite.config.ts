import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// La version affichée vient du paquet : une seule source, jamais deux à tenir à jour.
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// Application autonome : aucun lien avec l'app de suivi d'équipe à la racine du dépôt.
// `base: './'` permet d'ouvrir le build depuis n'importe quel sous-répertoire (IIS, partage
// réseau, ou même le système de fichiers).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  build: {
    // Le serveur sert les fichiers empreintés avec un cache d'un an : plus les morceaux sont
    // stables, moins une mise à jour coûte de téléchargement. React d'un côté, les données de
    // référence (constructeurs, catalogue, exemple) de l'autre, l'application au milieu.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (/src\/lib\/(vendors|catalogData|sample)\.ts$/.test(id)) return 'reseau'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
