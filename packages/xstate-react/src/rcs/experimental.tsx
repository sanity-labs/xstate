// PALS-151 prototype: useActorSnapshot backed by react-concurrent-store's experimental
// committed/head store. It classifies updates by reading React internals and rebases a sync
// update onto the committed snapshot with the source reducer. Readers must be below StoreProvider.
//
// The reducer keeps the committed snapshot when there is no event to replay. useActor has no sync
// send, so an update that arrives outside a transition cannot be rebased onto a pending one: the
// ponyfill reveals the head or keeps the committed snapshot according to its own priority check.
import {useEffect, useState} from 'react'
import {experimental} from 'react-concurrent-store'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

import {isErrored} from '../useActorSnapshot.main'

const {createStoreFromSource, useStoreSelector} = experimental

type Source<TLogic extends AnyActorLogic> = {
  getState: () => SnapshotFrom<TLogic>
  reducer: (snapshot: SnapshotFrom<TLogic>) => SnapshotFrom<TLogic>
}

/** Current actor for a hook's stable store source; avoids a render-time ref read in getState. */
const actors = new WeakMap<Source<any>, Actor<any>>()

function identity<T>(value: T): T {
  return value
}

interface Bound<TLogic extends AnyActorLogic> {
  readonly actor: Actor<TLogic>
  /** Snapshot to reveal until useStoreSelector's cache leaves `staleCache`. */
  readonly snapshot: SnapshotFrom<TLogic>
  /** Selector value observed when `actor` last changed; null once the cache has moved on. */
  readonly staleCache: SnapshotFrom<TLogic> | null
}

export function useActorSnapshot<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): SnapshotFrom<TLogic> {
  // useStoreSelector rejects changing store identities, so one store per hook reads the current
  // actor through a stable source — same replacement case main adjusts during render.
  const [source] = useState(() => {
    const source: Source<TLogic> = {
      getState: () => actors.get(source)!.getSnapshot(),
      reducer: (snapshot) => snapshot,
    }
    return source
  })
  actors.set(source, actor)
  const [store] = useState(() => createStoreFromSource<SnapshotFrom<TLogic>, null>(source))
  const storeSnapshot = useStoreSelector(store, identity)

  const [bound, setBound] = useState<Bound<TLogic>>(() => ({
    actor,
    snapshot: storeSnapshot,
    staleCache: null,
  }))
  if (bound.actor !== actor) {
    setBound({actor, snapshot: actor.getSnapshot(), staleCache: storeSnapshot})
  } else if (bound.staleCache !== null && storeSnapshot !== bound.staleCache) {
    setBound({actor, snapshot: storeSnapshot, staleCache: null})
  }

  const snapshot =
    bound.actor !== actor || (bound.staleCache !== null && storeSnapshot === bound.staleCache)
      ? bound.actor !== actor
        ? actor.getSnapshot()
        : bound.snapshot
      : storeSnapshot

  useEffect(() => {
    actors.set(source, actor)
    const push = () => store.handleUpdate(null)
    const subscription = actor.subscribe({
      next: push,
      error: push,
    })
    push()
    return () => subscription.unsubscribe()
  }, [actor, source, store])

  const value: unknown = snapshot
  if (isErrored(value)) {
    throw value.error
  }
  return snapshot
}

export const StoreProvider = experimental.StoreProvider
