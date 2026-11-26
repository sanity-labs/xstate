import react from '@vitejs/plugin-react'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['vitest-cleanup-after-each.ts'],
    environment: 'jsdom',
    exclude: ['**/dist/**', '**/node_modules/**'],
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
