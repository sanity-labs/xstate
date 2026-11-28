import react from '@vitejs/plugin-react'
import {playwright} from '@vitest/browser-playwright'
import {defineConfig} from 'vitest/config'

const rcsxAlias =
  process.env['VITE_XSTATE_REACT_IMPL'] === 'rcsx'
    ? [
        {
          find: /^@testing-library\/react$/,
          replacement: `${import.meta.dirname}/src/rcs/rtl-shim.tsx`,
        },
      ]
    : []

export default defineConfig({
  define: {__XSTATE_REACT_IMPL__: JSON.stringify(process.env['VITE_XSTATE_REACT_IMPL'] ?? '')},
  resolve: {alias: rcsxAlias},
  test: {
    setupFiles: ['vitest-cleanup-after-each.ts'],
    include: ['src/__tests__/*.test.tsx', 'src/__tests__/browser/*.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}],
    },
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {name: 'chromium'},
      },
      {
        extends: true,
        plugins: [react({compiler: {target: '19'}})],
        test: {name: 'chromium-react-compiler'},
      },
    ],
  },
})
