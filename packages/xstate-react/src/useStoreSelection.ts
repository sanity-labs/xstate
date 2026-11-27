import {startTransition, useEffect, useLayoutEffect, useOptimistic, useRef, useState} from 'react'

import {reduceOptimistic, type ActorStore, type Entry, type OptimisticAction} from './store'

interface State<T> {
  readonly store: ActorStore | undefined
  readonly entry: Entry
  readonly selected: T
}

const emptyEntry: Entry = {snapshot: undefined, seq: 0, version: -1}

export function isErrored(snapshot: unknown): snapshot is {error: unknown} {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    'status' in snapshot &&
    snapshot.status === 'error' &&
    'error' in snapshot
  )
}

function initialState<T>(store: ActorStore | undefined, selector: (snapshot: any) => T): State<T> {
  const entry = store ? store.read() : emptyEntry
  return {store, entry, selected: selector(entry.snapshot)}
}

/**
 * Holds `selector(snapshot)` of the actor behind `store` in React state, and subscribes to the actor
 * to keep it up to date. This is the only place a snapshot enters React: other readers get it from
 * here through props or context.
 *
 * The snapshot is read from the actor only to initialize the state. Later snapshots arrive as
 * values in state updates, so every update renders, and commits, as one consistent snapshot, in the
 * transition that caused it. Events sent with `sendOptimistic` are previewed with `useOptimistic`
 * until the transition that sent them settles.
 *
 * An errored snapshot is thrown, unless `rethrow` is false: a provider passes it on so that its
 * readers throw it, below any error boundary inside the provider.
 */
export function useStoreSelection<T>(
  store: ActorStore | undefined,
  selector: (snapshot: any) => T,
  compare: (a: T, b: T) => boolean,
  rethrow = true,
): T {
  const [state, setState] = useState(() => initialState(store, selector))
  let current = state
  if (state.store !== store) {
    // A new actor, e.g. one that replaced a stopped actor: its snapshot is read once, like the
    // initial state's.
    current = initialState(store, selector)
    setState(current)
  }
  const [optimistic, addOptimistic] = useOptimistic(current.entry, reduceOptimistic)

  const selectorRef = useRef(selector)
  const compareRef = useRef(compare)
  const stateRef = useRef(current)
  useLayoutEffect(() => {
    selectorRef.current = selector
    compareRef.current = compare
    stateRef.current = current
  })

  useEffect(() => {
    if (!store) {
      return
    }
    let skipped: Entry | undefined

    function apply(entry: Entry): void {
      const previous = stateRef.current
      if (previous.store === store && previous.entry.version >= entry.version) {
        return
      }
      const selected = selectorRef.current(entry.snapshot)
      // The selection did not change, so there is nothing to render. The entry is still the
      // newest base for previews of events sent after it.
      if (
        previous.store === store &&
        !isErrored(entry.snapshot) &&
        compareRef.current(previous.selected, selected)
      ) {
        skipped = entry
        return
      }
      skipped = undefined
      const next: State<T> = {store, entry, selected}
      stateRef.current = next
      if (store?.updates === 'sync') {
        setState(next)
      } else {
        startTransition(() => setState(next))
      }
    }

    const unsubscribe = store.subscribe({
      update: apply,
      optimistic(action) {
        addOptimistic({...action, fallback: skipped} as OptimisticAction)
      },
    })
    // The actor may have moved on between render and subscribing.
    apply(store.read())
    return unsubscribe
  }, [store, addOptimistic])

  const {snapshot} = optimistic
  if (rethrow && isErrored(snapshot)) {
    throw snapshot.error
  }
  const selected = selector(snapshot)
  if (optimistic === current.entry && compare(current.selected, selected)) {
    return current.selected
  }
  return selected
}
