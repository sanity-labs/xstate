# @sanity-labs/xstate-react

React bindings for [XState](https://stately.ai/docs) v6, built on React's async APIs: sending an event is a transition, so machine updates render together with the transition they belong to, and controlled inputs stay in sync through `useOptimistic`.

## Requirements

- `react` and `react-dom` `^19.3`. `addTransitionType` is stable from React 19.3.
- `xstate` `^6.0.0-beta`.

```sh
pnpm add @sanity-labs/xstate-react xstate@beta
```

The hooks have the same names and signatures as `@xstate/react` for XState v6.

## Usage

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {createMachine, types} from 'xstate'

const counterMachine = createMachine({
  schemas: {
    context: types<{count: number}>(),
    events: {inc: types<void>()},
  },
  context: {count: 0},
  on: {inc: ({context}) => ({context: {count: context.count + 1}})},
})

function Counter() {
  const [snapshot, send, actor] = useActor(counterMachine)
  return (
    <button type="button" onClick={() => send({type: 'inc'})}>
      {snapshot.context.count}
    </button>
  )
}
```

- `useActor(logic, options)` creates an actor, starts it, and returns `[snapshot, send, actor]`. `useMachine` is a deprecated alias.
- `useActorRef(logic, options)` creates and starts an actor without subscribing to its snapshot.
- `useSelector(actor, selector, compare?)` re-renders only when the selected value changes. `shallowEqual` is exported for use as `compare`.
- `useSend(actor)` returns the same `send` that `useActor` returns, for an actor created with `useActorRef` or received as a prop.
- `createActorContext(logic, options)` returns `{Provider, useSelector, useSend, useActorRef}` for sharing one actor with a subtree.

Use `send` from these hooks rather than `actor.send`: it is the one that takes part in transitions and optimistic updates.

### The first machine, and `key` to start over

The machine passed on the first render is used for the component's lifetime, and `input` is read once. Implementations passed with `machine.provide()` are picked up on every render, so they can close over props and state:

```tsx
import {useActor} from '@sanity-labs/xstate-react'

function Checkout({onPaid}: {onPaid: () => void}) {
  const [snapshot, send] = useActor(checkoutMachine.provide({actions: {notifyPaid: onPaid}}), {
    input: {currency: 'EUR'},
  })
  // ...
}
```

Props the machine should react to after mounting are events. Send them from an effect:

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {useEffect} from 'react'

function Stepper({start, limit}: {start: number; limit: number}) {
  const [snapshot, send] = useActor(stepperMachine, {input: {start}})
  useEffect(() => {
    send({type: 'limit.set', limit})
  }, [send, limit])
  // ...
}
```

To start over with fresh `input`, or to switch to a different machine, give the component a new `key`. React then unmounts it, stops its actor, and mounts a new one:

```tsx
<Stepper key={documentId} start={1} limit={10} />
```

### Transitions

`send` is a transition. The snapshot change it causes renders in the background, so a part of the tree that suspends on it keeps showing the previous snapshot instead of falling back to a `Suspense` boundary. Read `isPending` from `useTransition` to show that work is in progress.

Called inside `startTransition`, `send` joins that transition, including its `addTransitionType` types, so `<ViewTransition>` can animate the change:

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {addTransitionType, startTransition, ViewTransition} from 'react'

function Slides() {
  const [snapshot, send] = useActor(slidesMachine)
  return (
    <>
      <ViewTransition key={snapshot.context.index} enter={{forward: 'slide-in'}}>
        <Slide index={snapshot.context.index} />
      </ViewTransition>
      <button
        type="button"
        onClick={() =>
          startTransition(() => {
            addTransitionType('forward')
            send({type: 'next'})
          })
        }
      >
        Next
      </button>
    </>
  )
}
```

As with any state update, a `send` after an `await` in an async transition is no longer part of it. Wrap it in `startTransition` again:

```tsx
startTransition(async () => {
  const draft = await saveDraft()
  startTransition(() => {
    send({type: 'draft.saved', draft})
  })
})
```

### Controlled inputs

A controlled input has to show what was typed right away, but a transition renders later. When `send` is called outside a transition, as in an `onChange` handler, the event's outcome is computed with XState's `transition()` and shown with `useOptimistic` until the transition renders. The caret stays where it was:

```tsx
import {useActor} from '@sanity-labs/xstate-react'

function Search() {
  const [snapshot, send] = useActor(searchMachine)
  return (
    <input
      value={snapshot.context.query}
      onChange={(event) => send({type: 'query.change', query: event.target.value})}
    />
  )
}
```

Components that manage their own optimistic state and call an action prop inside a transition work too. Pass `send` from the action:

```tsx
import {createActorContext} from '@sanity-labs/xstate-react'

const Router = createActorContext(routerMachine)

function Filters() {
  const tab = Router.useSelector((snapshot) => snapshot.context.tab)
  const send = Router.useSend()
  return <TabList activeTab={tab} changeAction={(value) => send({type: 'tab.set', value})} />
}
```

### Updates `send` did not cause

Delayed transitions, invoked promises and child actors change the snapshot without a `send`. By default these changes render as transitions too. Pass `updates: 'sync'` to render them as regular updates instead:

```tsx
const [snapshot] = useActor(timerMachine, {updates: 'sync'})
```

`send` is a transition either way.

## License

MIT
