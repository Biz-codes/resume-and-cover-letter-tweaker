/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// For src/test/a11yCoverage.test.ts: each component and page (.tsx under src) with the text of
// its sibling .test.tsx, or null if it has none. Read here, on every run, because Vitest's
// module cache would keep a stale file list from import.meta.glob in the test.
function componentTests() {
  const src = new URL('./src/', import.meta.url)
  const tests: Record<string, string | null> = {}
  for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue
    const testFile = new URL(file.replace(/\.tsx$/, '.test.tsx'), src)
    tests[file] = existsSync(testFile) ? readFileSync(testFile, 'utf8') : null
  }
  return tests
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The backend runs on port 8000; the front end calls it at /api.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Keep index.css's text so a11yCoverage.test.ts can check its colors.
    css: { include: [/index\.css/] },
    provide: { componentTests: componentTests() },
  },
})
