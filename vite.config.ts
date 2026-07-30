import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 拆分重型依赖：xterm / CodeMirror 语言包都拆成独立 chunk，按需加载，降低启动内存。
        // 不拆的话它们会被静态引用拉进主 bundle。
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // xterm 核心 + addon 全部拆成独立 chunk，由 Terminal 页面（也是懒加载）按需拉取
            if (id.includes('@xterm/')) return 'xterm'
            // CodeMirror 语言包 → 各自独立 chunk
            const langMatch = id.match(/@codemirror\/lang-([a-z]+)/)
            if (langMatch) return `codemirror-lang-${langMatch[1]}`
            if (id.includes('@codemirror/legacy-modes')) return 'codemirror-legacy-modes'
            // 其余 codemirror 核心（language/view/state 等）留在主 bundle
          }
        }
      }
    }
  }
})