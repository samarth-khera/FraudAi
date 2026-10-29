import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// On Vercel the backend is a different origin. Without VITE_API_URL every API call would go to the Vercel site
// itself and return the HTML app shell, so fail the build instead of deploying a broken frontend.
if (process.env.VERCEL && !process.env.VITE_API_URL) {
  throw new Error('VITE_API_URL must be set to the backend URL (e.g. https://fraudshield-api.onrender.com) for Vercel builds.')
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Health check used by the header status badge
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
