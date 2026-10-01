import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The generated worker only precaches the static build output (shell, scripts,
// styles, bundled woff2 fonts, icons). It has no runtime caching and no fetch
// handling of its own, so notes, backups, and any other request never enter a cache.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // The page asks before activating an update, so a dirty editor is never reloaded.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Scratch',
        short_name: 'Scratch',
        description: 'Short notes, stored encrypted in this browser.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F7F4EE',
        theme_color: '#F7F4EE',
        icons: [
          { src: 'icons/scratch-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/scratch-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/scratch-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png}'],
        globIgnores: ['licenses/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // First install claims the open page so it is offline-ready without a reload.
        // Updates still wait for the page to approve activation.
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [],
      },
    }),
  ],
})
