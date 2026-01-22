import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Fixes 'SyntaxError: export' in production for modern libs (Three.js/Howler)
    // es2020 is safer for broader browser support with modern features
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
    commonjsOptions: {
      // Helps transpile CJS/ESM mixed modules (often an issue with older Three.js addons)
      transformMixedEsModules: true
    }
  },
  server: {
    // Prevent crashes if API proxies fail locally
    proxy: {} 
  }
})