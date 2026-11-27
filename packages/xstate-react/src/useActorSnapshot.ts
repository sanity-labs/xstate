import {startTransition, useEffect, useState} from 'react'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

interface State<TLogic extends AnyActorLogic> {
  readonly actor: Actor<TLogic>
  readonly snapshot: SnapshotFrom<TLogic>
}

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
 * Holds the snapshot of `actor` in React state, and subscribes to the actor to keep it up to date.
 * This is the only place a snapshot enters React.
 *
 * The snapshot is read from the actor only to initialize the state. Later snapshots arrive as
 * values in state updates, and every one of them is a transition: the one that sent the event, or
 * a transition of its own. So a snapshot change never reveals a transition that is still
 * suspended, and every update renders, and commits, one consistent snapshot.
 */
export function useActorSnapshot<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): SnapshotFrom<TLogic> {
  const [state, setState] = useState<State<TLogic>>(() => ({actor, snapshot: actor.getSnapshot()}))
  let current = state
  if (state.actor !== actor) {
    // A new actor, e.g. one that replaced a stopped actor: its snapshot is read once, like the
    // initial state's.
    current = {actor, snapshot: actor.getSnapshot()}
    setState(current)
  }

  useEffect(() => {
    let pushed: unknown = undefined
    function update(snapshot: SnapshotFrom<TLogic>): void {
      if (snapshot === pushed) {
        return
      }
      pushed = snapshot
      startTransition(() => {
        setState((previous) =>
          previous.actor === actor && previous.snapshot === snapshot ? previous : {actor, snapshot},
        )
      })
    }
    const subscription = actor.subscribe({
      next: update,
      error: () => update(actor.getSnapshot()),
    })
    // The actor may have moved on between render and subscribing.
    update(actor.getSnapshot())
    return () => subscription.unsubscribe()
  }, [actor])

  const snapshot: unknown = current.snapshot
  if (isErrored(snapshot)) {
    throw snapshot.error
  }
  return current.snapshot
}
