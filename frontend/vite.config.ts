/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Components' own styles (Name.module.css) are read as styles.camelCaseName.
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  server: {
    // The backend runs on port 8000; the front end calls it at /api.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Whole-front-end accessibility checks (test coverage, jsx-a11y lint, color contrast),
    // run before every test run and rerun.
    globalSetup: ['./a11yChecks.ts'],
    // CSS modules keep their plain class names in tests (e.g. "item-name"), so tests can find
    // elements by class without knowing how a build names them.
    css: { include: /\.module\.css$/, modules: { classNameStrategy: 'non-scoped' } },
  },
})
