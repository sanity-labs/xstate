import {startTransition} from 'react'
import {transition, type AnyActorLogic, type AnyActorRef} from 'xstate'

/**
 * How snapshot changes reach React when nothing wraps them in a transition, such as delayed
 * transitions, invoked actors settling, and events sent with `actor.send` outside `startTransition`.
 *
 * - `'transition'` (default): as transition updates. They never reveal a transition that is still
 *   suspended, and their visible effect waits for it.
 * - `'sync'`: as regular updates, with the priority of whatever caused them. They render right
 *   away, with the suspended transition's changes, so a `Suspense` boundary waiting on those shows
 *   its fallback.
 *
 * @public
 */
export type Updates = 'transition' | 'sync'

/** @public */
export interface BindingOptions {
  /**
   * How snapshot changes reach React when nothing wraps them in a transition, such as delayed
   * transitions and invoked actors settling. Defaults to `'transition'`.
   */
  updates?: Updates
}

type ReadableActor = Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>

export interface Entry {
  readonly snapshot: unknown
  /** The number of optimistic events the snapshot already includes. */
  readonly seq: number
  /** Increases with every snapshot the actor emits. */
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
  update(entry: Entry): void
  optimistic(action: Omit<OptimisticAction, 'fallback'>): void
}

/**
 * Reads an actor for the hooks that hold its snapshot in React state, through a single
 * subscription to the actor however many of those hooks there are.
 */
export class ActorStore {
  readonly actor: ReadableActor
  updates: Updates = 'transition'
  private head: Entry
  private seq = 0
  private version = 0
  private readonly listeners = new Set<Listener>()
  private unsubscribeActor: (() => void) | undefined

  constructor(actor: ReadableActor) {
    this.actor = actor
    this.head = {snapshot: actor.getSnapshot(), seq: 0, version: 0}
  }

  /** The newest entry, for initializing React state and for checks outside render. */
  read(): Entry {
    if (!this.unsubscribeActor) {
      this.pull(false)
    }
    return this.head
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.unsubscribeActor) {
      const subscription = this.actor.subscribe({
        next: () => this.pull(true),
        error: () => this.pull(true),
      })
      this.unsubscribeActor = () => subscription.unsubscribe()
      this.pull(true)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.unsubscribeActor?.()
        this.unsubscribeActor = undefined
      }
    }
  }

  /** Sends `event` in a transition: the caller's, or a transition of its own. */
  send = (event: unknown): void => {
    startTransition(() => {
      ;(this.actor as AnyActorRef).send(event)
    })
  }

  /**
   * Sends `event` in a transition, and shows its outcome right away with `useOptimistic` until that
   * transition settles.
   */
  sendOptimistic = (event: unknown): void => {
    const seq = ++this.seq
    startTransition(() => {
      const logic = (this.actor as {logic?: AnyActorLogic}).logic
      if (logic) {
        for (const listener of this.listeners) {
          listener.optimistic({logic, event, seq})
        }
      }
      ;(this.actor as AnyActorRef).send(event)
    })
  }

  private pull(notify: boolean): void {
    const snapshot = this.actor.getSnapshot()
    if (snapshot === this.head.snapshot) {
      return
    }
    this.head = {snapshot, seq: this.seq, version: ++this.version}
    if (notify) {
      for (const listener of this.listeners) {
        listener.update(this.head)
      }
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
