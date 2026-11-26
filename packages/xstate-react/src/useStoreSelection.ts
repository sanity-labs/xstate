import {
  startTransition,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
} from 'react'

import {reduceOptimistic, type ActorStore, type Entry, type OptimisticAction} from './store'

interface State<T> {
  readonly store: ActorStore | undefined
  readonly entry: Entry | undefined
  readonly selected: T
  /** Whether `entry` came from a snapshot change rather than from mounting. */
  readonly updated: boolean
}

const emptyEntry: Entry = {snapshot: undefined, seq: 0, version: 0}

function isErrored(snapshot: unknown): snapshot is {error: unknown} {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    'status' in snapshot &&
    snapshot.status === 'error' &&
    'error' in snapshot
  )
}

/**
 * Reads `selector(snapshot)` from the actor behind `store`.
 *
 * The snapshot lives in React state, so an update that `send` or a transition causes renders, and
 * commits, together with the rest of that transition. Events sent with the store's `send` are
 * previewed with `useOptimistic` until the transition that sent them settles, which keeps
 * controlled inputs in sync.
 */
export function useStoreSelection<T>(
  store: ActorStore | undefined,
  selector: (snapshot: any) => T,
  compare: (a: T, b: T) => boolean,
): T {
  const [state, setState] = useState<State<T>>(() => {
    const entry = store?.head
    return {store, entry, selected: selector(entry?.snapshot), updated: false}
  })
  const current = state.store === store ? state : undefined
  const base = current ? current.entry : store?.head
  const [optimistic, addOptimistic] = useOptimistic(base ?? emptyEntry, reduceOptimistic)

  const selectorRef = useRef(selector)
  const compareRef = useRef(compare)
  const stateRef = useRef(state)
  const lagTargetRef = useRef<Entry | undefined>(undefined)
  useLayoutEffect(() => {
    selectorRef.current = selector
    compareRef.current = compare
    stateRef.current = state
  })

  // Insertion effects of a commit all run before its layout effects, so by the time a component
  // that mounts in this commit checks `store.committed`, it already includes this commit.
  useInsertionEffect(() => {
    if (store && current?.updated && current.entry) {
      store.commit(current.entry)
    }
  }, [store, current])

  // A component that mounts while a transition is changing the actor renders that transition's
  // snapshot, which is right only if the transition is the render that mounts it. Otherwise it
  // shows the committed snapshot before paint, and catches up when the other readers commit.
  // Only the snapshot the component mounted with is checked, so it is read from `stateRef`.
  useLayoutEffect(() => {
    lagTargetRef.current = undefined
    const mounted = stateRef.current
    if (!store || mounted.store !== store || mounted.updated || mounted.entry === store.committed) {
      return
    }
    const target = mounted.entry
    lagTargetRef.current = target
    const show = (entry: Entry) => {
      const next: State<T> = {
        store,
        entry,
        selected: selectorRef.current(entry.snapshot),
        updated: true,
      }
      stateRef.current = next
      setState(next)
    }
    show(store.committed)
    const stopLagging = store.lag(() => {
      const {committed} = store
      if (committed.version > (stateRef.current.entry?.version ?? 0)) {
        show(committed)
      }
      if (!target || committed.version >= target.version) {
        stopLagging()
      }
    })
    return stopLagging
  }, [store])

  useLayoutEffect(() => {
    if (store && current?.updated) {
      store.catchUp()
    }
  }, [store, current])

  useEffect(() => {
    if (!store) {
      return
    }
    let skipped: Entry | undefined

    function apply(entry: Entry, asTransition: boolean): boolean {
      const previous = stateRef.current
      if (previous.store === store && previous.entry === entry) {
        return false
      }
      const selected = selectorRef.current(entry.snapshot)
      // The selection did not change, so there is nothing to render. The entry is still the
      // newest base for previewing events this component did not render the outcome of.
      if (
        previous.store === store &&
        !isErrored(entry.snapshot) &&
        compareRef.current(previous.selected, selected)
      ) {
        skipped = entry
        return false
      }
      skipped = undefined
      const next: State<T> = {store, entry, selected, updated: true}
      stateRef.current = next
      if (asTransition) {
        startTransition(() => setState(next))
      } else {
        setState(next)
      }
      return true
    }

    const unsubscribe = store.subscribe({
      update(entry, sentInTransition) {
        return apply(entry, sentInTransition || store.updates === 'transition')
      },
      optimistic(action) {
        startTransition(() => addOptimistic({...action, fallback: skipped} as OptimisticAction))
      },
    })
    // The snapshot may have changed between render and subscribing.
    const seen = stateRef.current.store === store ? stateRef.current.entry : undefined
    const known = Math.max(seen?.version ?? -1, lagTargetRef.current?.version ?? -1)
    if (store.head.version > known) {
      apply(store.head, store.updates === 'transition')
    }
    return unsubscribe
  }, [store, addOptimistic])

  const entry = optimistic === emptyEntry ? undefined : optimistic
  const snapshot = entry?.snapshot
  if (isErrored(snapshot)) {
    throw snapshot.error
  }
  if (current && entry === current.entry) {
    const selected = selector(snapshot)
    return compare(current.selected, selected) ? current.selected : selected
  }
  return selector(snapshot)
}
