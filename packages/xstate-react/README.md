# @sanity-labs/xstate-react

React bindings for [XState](https://stately.ai/docs) v6, built on React's async APIs. There is one hook, `useActor`. Every snapshot change renders in a transition, and `send` sends in a transition, so machine updates render together with the transition they belong to.

The snapshot lives in React state instead of an external store read with `useSyncExternalStore`, which would turn every transition that changes the actor into a blocking update. The component that calls `useActor` is the only subscriber, and passes the snapshot down, so every reader renders the same snapshot in the same commit.

## Requirements

- `react` and `react-dom` `^19.3.1`.
- `xstate` `^6.0.0-beta`. Machines from `xstate` and from `xstate/fsm` both work.
- The [React Compiler](https://react.dev/learn/react-compiler). The hook returns a new tuple on every render and doesn't memoize what you derive from the snapshot: the compiler does.

```sh
pnpm add @sanity-labs/xstate-react xstate@beta
```

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
  const [snapshot, send] = useActor(counterMachine)
  return (
    <button type="button" onClick={() => send({type: 'inc'})}>
      {snapshot.context.count}
    </button>
  )
}
```

`useActor(logic, options)` creates an actor from `logic`, starts it when the component mounts, stops it when it unmounts, and returns `[snapshot, send]`. `options` are the actor's options, like `input`. They are read once, when the actor is created.

`xstate/fsm` machines are logic too:

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {createFSM} from 'xstate/fsm'

const toggleMachine = createFSM({
  initial: 'inactive',
  states: {
    inactive: {on: {toggle: {target: 'active'}}},
    active: {on: {toggle: {target: 'inactive'}}},
  },
})

function Toggle() {
  const [snapshot, send] = useActor(toggleMachine)
  return <button onClick={() => send({type: 'toggle'})}>{snapshot.value}</button>
}
```

### Sharing a snapshot

Pass the snapshot, or values derived from it, and `send` down as props, or through a context of your own. Readers then render the snapshot the owner holds, so a component that mounts while a transition is changing the actor renders the same snapshot as the rest of the tree.

### The first machine, and `key` to start over

The machine passed on the first render is used for the component's lifetime, and `options` are read once. Implementations passed with `machine.provide()` are picked up on every render, so they can close over props and state:

```tsx
import {useActor} from '@sanity-labs/xstate-react'

function Checkout({onPaid}: {onPaid: () => void}) {
  const [snapshot, send] = useActor(checkoutMachine.provide({actions: {notifyPaid: onPaid}}), {
    input: {currency: 'EUR'},
  })
  // ...
}
```

Props the machine should react to after mounting are events. Send them from an effect. `send` wraps the event in `startTransition`, so the change renders as a transition, like one from an event handler:

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

To reset, give the component a new `key`, as you would to reset `useState`. React then unmounts it, stops its actor, and mounts a new one with fresh `input`:

```tsx
<Stepper key={documentId} start={1} limit={10} />
```

The same goes for switching machines:

```tsx
<Editor key={mode} machine={mode === 'draft' ? draftMachine : reviewMachine} />
```

### Restoring a persisted actor

`useActor` also takes an actor you created, like one from `restoreActor`. Create it once, in `useState`'s initializer, so later renders don't create another:

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {useState} from 'react'
import type {Snapshot} from 'xstate'
import {restoreActor} from 'xstate/persist'

function Checkout({persisted}: {persisted: Snapshot<unknown>}) {
  const [actor] = useState(() => restoreActor(checkoutMachine, persisted))
  const [snapshot, send] = useActor(actor)
  // ...
}
```

The hook starts and stops the actor you pass, as it does one it creates, and its snapshot changes render as transitions too. The actor passed on the first render is used for the component's lifetime: to restore a different snapshot, change the component's `key`. Pass it options, like `input`, when you create it, since `useActor` takes no options with an actor.

### Starting and stopping

The actor starts when the component mounts and stops when it unmounts. Stopping waits a microtask, so the unmount and remount that `StrictMode` simulates keep the running actor. v6 actors can't be restarted once stopped, so when a stopped actor's component is shown again, the hook creates a fresh actor from the same machine. For an actor you passed, the fresh actor is created with the same options, so one from `restoreActor` starts again from the snapshot it restored, not from where the stopped actor left off.

`<Activity mode="hidden">` cleans up effects, so an actor that a hidden component owns stops, and the component starts over with a fresh actor when it's shown again. To keep an actor running while part of the tree is hidden, call `useActor` above the `Activity` boundary and pass the snapshot down.

### Transitions

Every snapshot change renders as a transition: the one that sent the event, or a transition of its own. That includes changes `send` didn't cause, like delayed transitions, invoked actors settling and events from child actors. So a part of the tree that suspends on a change keeps showing the previous snapshot instead of falling back to a `Suspense` boundary, and no change reveals a transition that is still suspended. Read `isPending` from `useTransition` to show that work is in progress.

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

As with any state update, a `send` after an `await` in an async transition is no longer part of it: it is a transition of its own. Types added before the `await` aren't tied to it either: React applies them to the next transition that commits. Wrap the `send` in `startTransition` again, and add the types it needs there:

```tsx
startTransition(async () => {
  const draft = await saveDraft()
  startTransition(() => {
    send({type: 'draft.saved', draft})
  })
})
```

### UI that must update right away

A controlled input has to show what was typed right away, but a transition renders later. Keep that value with React's `useOptimistic` in the component that renders it, and send the event from the action that sets it. This is the action prop pattern of the [Async React demo](https://github.com/rickhanlonii/async-react)'s `SearchInput`, `TabList` and `CompleteButton`:

```tsx
import {useActor} from '@sanity-labs/xstate-react'
import {startTransition, useOptimistic} from 'react'

function SearchInput({
  value,
  changeAction,
}: {
  value: string
  changeAction: (value: string) => void | Promise<void>
}) {
  const [inputValue, setInputValue] = useOptimistic(value)
  return (
    <input
      value={inputValue}
      data-pending={inputValue !== value}
      onChange={(event) => {
        const next = event.target.value
        startTransition(async () => {
          setInputValue(next)
          await changeAction(next)
        })
      }}
    />
  )
}

function Search() {
  const [snapshot, send] = useActor(searchMachine)
  return (
    <SearchInput
      value={snapshot.context.query}
      changeAction={(query) => send({type: 'query.change', query})}
    />
  )
}
```

The input shows what was typed, and keeps its caret, while the transition renders the actor's snapshot in the background. A pending transition that suspends stays hidden. Once it commits, the optimistic value gives way to the snapshot's.

## License

MIT
