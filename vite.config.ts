import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Relaie les appels /api vers le serveur d'authentification optionnel (voir
    // server/README.md) pendant le développement, exactement comme IIS le fait en
    // production (voir DEPLOYMENT.md) — le navigateur voit toujours une seule origine,
    // ce qui évite les soucis de CORS et fait fonctionner le cookie de session normalement.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
})
