import {startTransition, useActionState, useEffect, useLayoutEffect, useMemo, useState} from 'react'
import type {Actor, AnyActorLogic, EventFromLogic, SnapshotFrom} from 'xstate'

import {isErrored} from './execution'

type Message<TLogic extends AnyActorLogic> =
  | {readonly event: EventFromLogic<TLogic>}
  | {readonly snapshot: SnapshotFrom<TLogic>}

/**
 * Bridges a live actor to an action queue. A `send` is an action that sends to the actor and
 * returns the snapshot it has after the synchronous transition. Snapshots the actor produces on
 * its own (timers, children, promises) become actions of their own.
 */
class Bridge<TLogic extends AnyActorLogic> {
  actor: Actor<TLogic>
  readonly initial: SnapshotFrom<TLogic>
  readonly action: (prev: SnapshotFrom<TLogic>, message: Message<TLogic>) => SnapshotFrom<TLogic>
  private dispatch: ((message: Message<TLogic>) => void) | null = null
  private inAction = false
  private pushed: unknown

  constructor(actor: Actor<TLogic>) {
    this.actor = actor
    this.initial = actor.getSnapshot()
    this.pushed = this.initial
    this.action = (_prev, message) => this.run(message)
  }

  attach(dispatch: (message: Message<TLogic>) => void): void {
    this.dispatch = dispatch
  }

  /** Called from the mount effect. Returns the cleanup. */
  subscribe(actor: Actor<TLogic>): () => void {
    this.actor = actor
    const subscription = actor.subscribe({
      next: (snapshot) => this.push(snapshot),
      error: () => this.push(actor.getSnapshot()),
    })
    // The actor may have moved on between render and subscribing, or be a replacement.
    this.push(actor.getSnapshot())
    return () => subscription.unsubscribe()
  }

  private run(message: Message<TLogic>): SnapshotFrom<TLogic> {
    if ('snapshot' in message) {
      return message.snapshot
    }
    // Snapshots the send produces synchronously are what this action returns; the subscription
    // must not turn them into actions of their own.
    this.inAction = true
    try {
      this.actor.send(message.event as never)
    } finally {
      this.inAction = false
    }
    const snapshot = this.actor.getSnapshot()
    this.pushed = snapshot
    return snapshot
  }

  private push(snapshot: SnapshotFrom<TLogic>): void {
    if (this.inAction || snapshot === this.pushed) {
      return
    }
    this.pushed = snapshot
    const dispatch = this.dispatch
    if (dispatch) {
      startTransition(() => dispatch({snapshot}))
    }
  }
}

/**
 * Shape (b): `useActionState` over an existing actor. Returns the actor's snapshot, a `send` that
 * dispatches an action, and whether an action is pending.
 *
 * @public
 */
export function useActorActionState<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  const [bridge] = useState(() => new Bridge(actor))
  const [snapshot, dispatch, isPending] = useActionState<SnapshotFrom<TLogic>, Message<TLogic>>(
    bridge.action,
    bridge.initial,
  )

  useLayoutEffect(() => {
    bridge.attach(dispatch)
  }, [bridge, dispatch])

  useEffect(() => bridge.subscribe(actor), [bridge, actor])

  const send = useMemo(
    () => (event: EventFromLogic<TLogic>) => {
      // Outside a transition, `dispatch` would be a sync update that suspends on the action.
      startTransition(() => dispatch({event}))
    },
    [dispatch],
  )

  const current: unknown = snapshot
  if (isErrored(current)) {
    throw current.error
  }
  return [snapshot, send, isPending]
}
