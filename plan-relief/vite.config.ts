import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Version affichée dans l'application (Paramètres, écran de connexion) : permet de vérifier
// qu'un poste fait bien tourner la version installée, et non une copie gardée en cache.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const build = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version} du ${build} UTC`) },
  build: {
    // three.js et pdf.js pèsent à eux seuls plus de 1 Mo : l'avertissement par défaut
    // (500 ko) n'apporte rien ici, le site est servi en interne.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      // Deux pages : l'application, et la page de retour de la connexion Microsoft.
      input: { main: 'index.html', 'auth-redirect': 'auth-redirect.html' },
    },
  },
  server: {
    // Relaie les appels /api vers le service (voir server/README.md) pendant le
    // développement, exactement comme IIS le fait en production (voir DEPLOYMENT.md) :
    // le navigateur voit toujours une seule origine, ce qui fait fonctionner le cookie
    // de session normalement.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4100', changeOrigin: true },
    },
  },
})
