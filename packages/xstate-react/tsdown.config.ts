import {defineConfig} from '@sanity/tsdown-config'
import type {UserConfig} from 'tsdown'

// `satisfies Promise<UserConfig>` names the return type through this package's own `tsdown`
// dependency, which keeps the declaration emit portable (TS2883).
export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: ['./src/index.ts'],
  reactCompiler: {target: '19', transform: 'oxc'},
}) satisfies Promise<UserConfig>
