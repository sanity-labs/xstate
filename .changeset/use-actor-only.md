---
'@sanity-labs/xstate-react': minor
---

The API is now a single hook: `useActor(logic, options)`, which returns `[snapshot, send]`.

- Removed `useActorRef`, `useMachine`, `useSelector`, `useSend`, `useOptimisticSend`, `createActorContext`, `shallowEqual`, and the `HookOptions`, `BindingOptions`, `Updates` and `ActorContext` types.
- Removed the `updates: 'sync'` option. Every snapshot change renders in `startTransition`.
- `useActor` no longer returns the actor. It still accepts an already-created actor, like one from `restoreActor`. To start over, change the component's `key`.
- For UI that must update right away, like a controlled input, hold its value with React's `useOptimistic` in the component that renders it, and call `send` from the action that sets it.
- Requires `react` `^19.3.1`. `xstate/fsm` machines work as logic.
