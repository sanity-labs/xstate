import react from '@vitejs/plugin-react'
import {defineConfig} from 'vitest/config'

const rcsxAlias =
  process.env['VITE_XSTATE_REACT_IMPL'] === 'rcsx' || process.env['VITE_XSTATE_REACT_SHIM'] === '1'
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
    environment: 'jsdom',
    exclude: ['**/dist/**', '**/node_modules/**', 'src/__tests__/browser/**'],
    typecheck: {
      ignoreSourceErrors: true,
    },
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'default',
          // The CLI `--typecheck` flag does not reach project configs. Only this project runs the
          // type tests: the react-compiler project changes the runtime transform, which they never see.
          typecheck: {enabled: true, ignoreSourceErrors: true},
        },
      },
      {
        extends: true,
        plugins: [react({compiler: {target: '19'}})],
        test: {
          name: 'react-compiler',
        },
      },
    ],
  },
})
