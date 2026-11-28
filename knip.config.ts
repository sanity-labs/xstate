import type {KnipConfig} from 'knip'

const config: KnipConfig = {
  // `pnpm change` is a pnpm 12 built-in, not a package binary.
  ignoreBinaries: ['change'],
  ignore: ['.agents/skills/**', '.claude/skills/**', 'research/**'],
  workspaces: {
    '.': {},
    'examples/async-react': {
      entry: ['src/main.tsx', 'vite.config.ts'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
      paths: {'@/*': ['./src/*']},
      ignore: ['public/mockServiceWorker.js'],
      // Imported from CSS, which knip does not read.
      ignoreDependencies: ['tailwindcss', 'tw-animate-css'],
    },
    'packages/xstate-react': {
      // rtl-shim.tsx is the vitest alias for @testing-library/react when VITE_XSTATE_REACT_IMPL=rcsx.
      entry: ['src/index.ts', 'src/rcs/rtl-shim.tsx'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
    },
  },
}

export default config
