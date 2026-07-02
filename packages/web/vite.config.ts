import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: [
      { find: /^katex$/, replacement: 'katex/dist/katex.min.js' },
    ],
  },
  server: {
    port: 5173,
    // allowedHosts 默认只允许 localhost。如果需要通过自定义域名访问开发服务器，
    // 请在此处添加，或在本地直接修改。
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/apps': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('/use-sync-external-store/')
          ) {
            return 'vendor-react'
          }
          if (
            id.includes('/@radix-ui/') ||
            id.includes('/@floating-ui/') ||
            id.includes('/cmdk/')
          ) {
            return 'vendor-ui'
          }
          if (
            id.includes('/katex/')
          ) {
            return 'vendor-katex'
          }
          if (
            id.includes('/rehype-katex/') ||
            id.includes('/remark-math/') ||
            id.includes('/micromark-extension-math/') ||
            id.includes('/mdast-util-math/')
          ) {
            return
          }
          if (
            id.includes('/@tiptap/')
          ) {
            return 'vendor-tiptap'
          }
          if (id.includes('/prosemirror-')) {
            return 'vendor-prosemirror'
          }
          if (id.includes('/novel/')) {
            return 'vendor-novel'
          }
          if (id.includes('/tiptap-markdown/')) {
            return 'vendor-tiptap-markdown'
          }
          if (
            id.includes('/react-markdown/') ||
            id.includes('/remark-') ||
            id.includes('/rehype-') ||
            id.includes('/micromark') ||
            id.includes('/mdast-') ||
            id.includes('/hast-') ||
            id.includes('/unist-') ||
            id.includes('/highlight.js/')
          ) {
            return 'vendor-markdown'
          }
          if (
            id.includes('/d3/')
          ) {
            return 'vendor-d3'
          }
          if (
            id.includes('/dompurify/') ||
            id.includes('/@braintree/sanitize-url/')
          ) {
            return 'vendor-sanitize'
          }
          if (
            id.includes('/dayjs/') ||
            id.includes('/marked/') ||
            id.includes('/ts-dedent/') ||
            id.includes('/uuid/')
          ) {
            return 'vendor-mermaid-utils'
          }
          if (id.includes('/markmap-lib/')) {
            return 'vendor-markmap-lib'
          }
          if (id.includes('/markmap-view/')) {
            return 'vendor-markmap-view'
          }
          if (id.includes('/markmap-common/')) {
            return 'vendor-markmap-common'
          }
          if (id.includes('/markmap-html-parser/')) {
            return 'vendor-markmap-parser'
          }
        },
      },
    },
  },
})
