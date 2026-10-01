import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], css: true, exclude: [...configDefaults.exclude, 'tests/e2e/**'] },
})
