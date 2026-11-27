# xstate v6 × React 19.3 experiments (react 19.3.1, react-dom 19.3.1, xstate 6.0.0-beta.5, @xstate/react 7.0.0-beta.0, jotai 3.0.2, react-concurrent-store 0.0.1, jsdom 31)
Run: `node <file>.mjs` (node_modules symlinked from ../t). Outputs saved as *.out.
- e1-transition-and-mount-tear.mjs: send() in startTransition + Suspense; then urgent mount of a new reader while the transition is pending.
- e3-timesliced-tear.mjs: real scheduler, 120 slow readers, second mutation 12ms into a time-sliced transition render. Commits recorded via <Profiler onRender>.
- e4-reducer-runtime.mjs: Q3 prototype: useReducer(pure transition()) + post-commit effect runner with host runtime (timers, invoked async child).
- e5 / e5b: rebase hazard for effect dedupe (positional ids vs dispatched-event identity).
- e6-sync-over-pending.mjs: sync event while a suspended transition is pending (leak vs useOptimistic vs reducer rebase).
- e7-mount-gap.mjs: write between render and subscribe.
- probe-system*.mjs: experimental systemTransition: effect ids, async result, virtual time, rebase.

## Running from this repo

`research/` is not a pnpm workspace package and is not published. Install its pinned dependencies with npm, outside the workspace:

```sh
cd research && npm install --no-package-lock && node e1-transition-and-mount-tear.mjs
```

The `.out` files hold stdout only. E3 and E8 also print React's "large number of updates inside startTransition" warning to stderr. On re-runs, every output matches its recording except the E8 time-sliced section, whose commit sequences vary from run to run; one re-run showed a torn commit for `renderRead+subscribe`. `t.mjs` and `probe-effects.mjs` have no recorded output.

## Fate-style reader (PALS-152)

A prototype of fate's `useSnapshot` for an actor: `useSyncExternalStore` over a thenable snapshot, wrapped in `useDeferredValue`, unwrapped with `use()`. It lives in the package so it runs plain and through the React Compiler:

- `packages/xstate-react/src/__tests__/research/fateReader.tsx`: the prototype, and plain uSES of the same thenable as a control.
- `packages/xstate-react/src/__tests__/research/fateReader.test.tsx`: E1, E3, E6, transition types, React's >10 updates warning and render cost, against `useActor` with a context fan-out. `pnpm test` writes `plain.out` and `compiler.out` to `$FATE_READER_OUT` (default `/tmp/fate-reader`). Recorded: `fate-reader-plain.out`, `fate-reader-compiler.out`.
- `packages/xstate-react/src/__tests__/browser/fateReader.test.tsx`: E1 and transition types in Chromium with the browser's own view transitions (`pnpm test:browser`).

Result: `useDeferredValue` hides the uSES fallback, but a reader mounting during a pending transition renders the head snapshot (E1), a send blocks the main thread for a sync render of the old values before the transition render (E3 commits `0, 0, 2`; about 53 ms vs 9 ms for `useActor` with 120 readers), every reader renders twice per change, and `addTransitionType` types don't reach `<ViewTransition>` unless another state update shares the transition.
