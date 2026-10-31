import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // App version, also the multiplayer data version: rooms only mix players on identical bundled data.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
