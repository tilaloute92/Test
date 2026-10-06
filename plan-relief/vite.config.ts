import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
