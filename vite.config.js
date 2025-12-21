import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Use root path for custom domain
  server: {
    host: true
  },
  build: {
    target: 'es2015', // Target ES2015 for better Safari compatibility
    minify: 'esbuild'
  },
  esbuild: {
    target: 'es2015' // Transpile to ES2015 for dev server compatibility
  }
})
