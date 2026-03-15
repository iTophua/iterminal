import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'src-tauri'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'src-tauri',
        'src/test',
        '**/*.d.ts',
        '**/*.config.*'
      ]
    }
  },
  server: {
    port: 1430,
    strictPort: true
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false
  }
})