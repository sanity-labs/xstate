# AGENTS.md

## Cursor Cloud specific instructions

This is the `sanity-labs/xstate` pnpm monorepo (workspaces defined in `pnpm-workspace.yaml`):

- `packages/xstate-react` — the `@sanity-labs/xstate-react` library (XState v6 bindings for React 19 transitions). Built with `tsdown` (configured through `@sanity/tsdown-config` in `packages/xstate-react/tsdown.config.ts`), tested with Vitest.
- `examples/async-react` — a Vite demo of the library, run with `pnpm dev`. It resolves `@sanity-labs/xstate-react` to the workspace source, so it needs no build first. CI typechecks, tests and builds it in the `demo` job.

Standard commands are defined in the root `package.json` scripts and mirror CI (`.github/workflows/ci.yml`): `pnpm build`, `pnpm lint`, `pnpm exec oxfmt --check`, `pnpm knip`, `pnpm test`. Dependencies are installed with `pnpm install` (pnpm version is pinned via `packageManager`).

Non-obvious notes:

- `pnpm lint` runs Oxlint (type-aware + type-check via `.oxlintrc.json` `options`), including the React Compiler rules. `react/rule-suppression` is on, so React Compiler findings cannot be silenced with disable comments: restructure the code instead.
- `pnpm test` runs Vitest with `--typecheck` and runs each suite twice: once normally and once through the React Compiler (the `react-compiler` project in `packages/xstate-react/vitest.config.ts`). The published build is compiled with the React Compiler too.
- `pnpm test:browser` runs `src/__tests__/*.test.tsx` and `src/__tests__/browser` in headless Chromium with Vitest browser mode (`packages/xstate-react/vitest.browser.config.ts`), plain and through the React Compiler. Install the browser first with `pnpm --filter @sanity-labs/xstate-react exec playwright install --with-deps chromium`. `src/__tests__/browser` needs real view transitions, so `pnpm test` excludes it.
- `packages/xstate-react/src/__tests__/upstream` holds tests adapted from `@xstate/react`. They keep upstream's style, so they have their own relaxed `tsconfig.json` and a lint override in `.oxlintrc.json`.
- Snapshots enter React state only in `useStoreSelection`, which subscribes to the actor and is used by `useActor`, the `createActorContext` provider, and `useSelector` outside a provider. Readers below a provider get the snapshot through that provider's context from `snapshotContext.ts`, which `useSelector(actor)` finds by actor. Don't read `actor.getSnapshot()` during render, except to initialize that state.
- `useIdleActorRef` opts out of the React Compiler with `'use no memo'`: it detects Fast Refresh through a `useMemo` that React recomputes on refresh, which a compiler cache slot would not.
- `tsdown` requires Node `^22.18.0 || >=24.11.0`; older Node 22 releases fail with `Failed to import module "unrun"`.
- tsdown owns the `exports` map in `packages/xstate-react/package.json`. Locally `exports` points at `./src/index.ts` and `publishConfig.exports` carries the `dist` entry points, which `pnpm publish` swaps in.
- Agent skills live in `.agents/skills`, with symlinks in `.claude/skills`, and are pinned in `skills-lock.json`. Add or update them with `npx skills add <source> -a cursor -a claude-code`. The `xstate-v6` skill reads the docs that ship in the installed `xstate` package.
