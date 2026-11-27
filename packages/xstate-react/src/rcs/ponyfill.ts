// PALS-151 prototype: useActorSnapshot backed by react-concurrent-store's default useStore.
//
// One ponyfill store per actor holds the snapshot. useStore keeps a per-component cache and
// refreshes it inside its own useTransition. The ponyfill has no re-check after subscribe and
// initializes from a value that lags until a listener runs, so retain() notifies when this
// render's snapshot is behind the actor.
import {useEffect, useState} from 'react'
import {createStore, useStore, type ReactStore} from 'react-concurrent-store'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

import {isErrored} from '../useActorSnapshot.main'

interface Bridge<TLogic extends AnyActorLogic> {
  rcs: ReactStore<SnapshotFrom<TLogic>>
  last: SnapshotFrom<TLogic>
  refs: number
  unsubscribe: (() => void) | undefined
}

const bridges = new WeakMap<Actor<any>, Bridge<any>>()

function getBridge<TLogic extends AnyActorLogic>(actor: Actor<TLogic>): Bridge<TLogic> {
  let bridge = bridges.get(actor) as Bridge<TLogic> | undefined
  if (!bridge) {
    const last = actor.getSnapshot()
    bridge = {rcs: createStore(last), last, refs: 0, unsubscribe: undefined}
    bridges.set(actor, bridge)
  }
  return bridge
}

/** One actor subscription while any hook reads it; every new snapshot goes to the ponyfill. */
function retain<TLogic extends AnyActorLogic>(actor: Actor<TLogic>): () => void {
  const bridge = getBridge(actor)
  if (bridge.refs++ === 0) {
    const push = (snapshot: SnapshotFrom<TLogic>) => {
      if (snapshot !== bridge.last) {
        bridge.last = snapshot
        bridge.rcs.update(snapshot)
      }
    }
    const subscription = actor.subscribe({
      next: push,
      error: () => push(actor.getSnapshot()),
    })
    bridge.unsubscribe = () => subscription.unsubscribe()
    push(actor.getSnapshot())
  }
  return () => {
    if (--bridge.refs === 0) {
      bridge.unsubscribe?.()
      bridge.unsubscribe = undefined
    }
  }
}

interface Bound<TLogic extends AnyActorLogic> {
  readonly actor: Actor<TLogic>
  /** Snapshot to reveal until useStore's cache leaves `staleCache`. */
  readonly snapshot: SnapshotFrom<TLogic>
  /** useStore value observed when `actor` last changed; null once the cache has moved on. */
  readonly staleCache: SnapshotFrom<TLogic> | null
}

export function useActorSnapshot<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): SnapshotFrom<TLogic> {
  const bridge = getBridge(actor)
  const storeSnapshot = useStore(bridge.rcs)

  // useStore caches the first store's value and only refreshes on notifications. A replacement
  // actor builds a new store that already holds getSnapshot(), so retain() does not notify, and
  // the cache would keep the previous actor's snapshot — same case main adjusts during render.
  const [bound, setBound] = useState<Bound<TLogic>>(() => ({
    actor,
    snapshot: storeSnapshot,
    staleCache: null,
  }))
  if (bound.actor !== actor) {
    setBound({actor, snapshot: bridge.last, staleCache: storeSnapshot})
  } else if (bound.staleCache !== null && storeSnapshot !== bound.staleCache) {
    setBound({actor, snapshot: storeSnapshot, staleCache: null})
  }

  const snapshot =
    bound.actor !== actor || (bound.staleCache !== null && storeSnapshot === bound.staleCache)
      ? bound.actor !== actor
        ? bridge.last
        : bound.snapshot
      : storeSnapshot

  useEffect(() => retain(actor), [actor])
  useEffect(() => {
    // This render saw an older snapshot than the actor. The ponyfill does not re-check after
    // subscribe, so ask it to deliver the newest one.
    if (storeSnapshot !== bridge.last) {
      bridge.rcs.update(bridge.last)
    }
  }, [bridge, storeSnapshot])

  const value: unknown = snapshot
  if (isErrored(value)) {
    throw value.error
  }
  return snapshot
}
