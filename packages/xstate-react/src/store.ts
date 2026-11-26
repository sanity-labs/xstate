import * as React from 'react'
import {startTransition} from 'react'
import {transition, type AnyActorLogic, type AnyActorRef} from 'xstate'

// React has no public way to ask whether code runs inside `startTransition`. Its client internals
// hold the current transition in `T`.
const internals: {T: unknown} | undefined = (React as any)
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

function isInTransition(): boolean {
  return internals?.T != null
}

/**
 * How snapshot changes that `send` did not cause, such as delayed transitions and invoked actors
 * settling, reach React.
 *
 * - `'transition'` (default): as transition updates.
 * - `'sync'`: as regular updates, with the priority of whatever triggered them.
 *
 * @public
 */
export type Updates = 'transition' | 'sync'

/** @public */
export interface BindingOptions {
  /**
   * How snapshot changes that `send` did not cause, such as delayed transitions and invoked
   * actors settling, reach React. Defaults to `'transition'`.
   */
  updates?: Updates
}

type ReadableActor = Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>

export interface Entry {
  readonly snapshot: unknown
  /** The number of events sent through the store that the snapshot already includes. */
  readonly seq: number
  /** Increases with every snapshot the actor emits, to order entries that share a `seq`. */
  readonly version: number
}

export interface OptimisticAction {
  readonly logic: AnyActorLogic
  readonly event: unknown
  readonly seq: number
  /** A newer base than the hook's state, for hooks that skipped updates their selector ignored. */
  readonly fallback: Entry | undefined
}

export interface Listener {
  /** Returns whether the listener scheduled a render for the entry. */
  update(entry: Entry, sentInTransition: boolean): boolean
  optimistic(action: Omit<OptimisticAction, 'fallback'>): void
}

export class ActorStore {
  readonly actor: ReadableActor
  updates: Updates = 'transition'
  head: Entry
  /** The newest entry React has committed, which a component mounting outside a transition sees. */
  committed: Entry
  private seq = 0
  private version = 0
  private sending = 0
  private readonly listeners = new Set<Listener>()
  private readonly lagging = new Set<() => void>()
  private unsubscribeActor: (() => void) | undefined

  constructor(actor: ReadableActor) {
    this.actor = actor
    this.head = {snapshot: actor.getSnapshot(), seq: 0, version: 0}
    this.committed = this.head
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.unsubscribeActor) {
      const subscription = this.actor.subscribe({
        next: () => this.pull(),
        error: () => this.pull(),
      })
      this.unsubscribeActor = () => subscription.unsubscribe()
      this.pull()
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.unsubscribeActor?.()
        this.unsubscribeActor = undefined
        this.committed = this.head
      }
    }
  }

  commit(entry: Entry): void {
    if (entry.version > this.committed.version) {
      this.committed = entry
    }
  }

  /**
   * Registers a reader that mounted showing `committed` while others were rendering a newer
   * snapshot in a transition, to catch up when they commit it. Returns a function that unregisters.
   */
  lag(catchUp: () => void): () => void {
    this.lagging.add(catchUp)
    return () => this.lagging.delete(catchUp)
  }

  /** Called in the layout phase of a commit that included readers of the actor. */
  catchUp(): void {
    for (const catchUp of this.lagging) {
      catchUp()
    }
  }

  send = (event: unknown): void => {
    const seq = ++this.seq
    if (isInTransition()) {
      this.deliver(event)
      return
    }
    // An urgent send, like one from a controlled input's `onChange`: the outcome is previewed with
    // `useOptimistic`, rebased on what is committed, while the snapshot itself updates in a
    // transition.
    startTransition(() => {
      const logic = (this.actor as {logic?: AnyActorLogic}).logic
      if (logic) {
        for (const listener of this.listeners) {
          listener.optimistic({logic, event, seq})
        }
      }
      this.deliver(event)
    })
  }

  private deliver(event: unknown): void {
    this.sending++
    try {
      ;(this.actor as AnyActorRef).send(event)
    } finally {
      this.sending--
    }
  }

  private pull(): void {
    const snapshot = this.actor.getSnapshot()
    if (snapshot === this.head.snapshot) {
      return
    }
    this.head = {snapshot, seq: this.seq, version: ++this.version}
    if (this.listeners.size === 0) {
      this.committed = this.head
      return
    }
    const sentInTransition = this.sending > 0
    let scheduled = false
    for (const listener of this.listeners) {
      scheduled = listener.update(this.head, sentInTransition) || scheduled
    }
    // No reader renders anything different, so React already shows this snapshot.
    if (!scheduled) {
      this.committed = this.head
    }
  }
}

const stores = new WeakMap<ReadableActor, ActorStore>()

export function getStore(actor: ReadableActor): ActorStore {
  let store = stores.get(actor)
  if (!store) {
    store = new ActorStore(actor)
    stores.set(actor, store)
  }
  return store
}

/**
 * The `useOptimistic` reducer. React replays it on top of every new base until the transition that
 * sent the event settles, and the actor has already processed the event by the time any base after
 * the send is read. So an event the base already includes is skipped, instead of applied twice.
 */
export function reduceOptimistic(current: Entry, action: OptimisticAction): Entry {
  const base =
    action.fallback && action.fallback.version > current.version ? action.fallback : current
  if (base.seq >= action.seq) {
    return base
  }
  try {
    const [snapshot] = transition(action.logic, base.snapshot as never, action.event as never)
    return {snapshot, seq: base.seq, version: base.version}
  } catch {
    // The running actor reports the error itself; the preview falls back to the base.
    return base
  }
}
