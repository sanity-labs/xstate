import {createContext, use, type Context} from 'react'
import type {AnyActorRef} from 'xstate'

export const notProvided: unique symbol = Symbol('notProvided')

type Actor = Pick<AnyActorRef, 'getSnapshot'>

interface Provided {
  readonly actor: Actor
  readonly snapshot: unknown
}

export type SnapshotContext = Context<Provided | null>

const providers = new WeakMap<Actor, SnapshotContext>()

/**
 * The context that carries an actor's snapshot from a provider to the readers below. Each
 * `createActorContext` has one, so a provider keeps its element type when its actor changes.
 */
export function createSnapshotContext(): SnapshotContext {
  return createContext<Provided | null>(null)
}

/** Lets `useProvidedSnapshot(actor)` find the context of the provider that holds `actor`. */
export function registerProvider(actor: Actor, context: SnapshotContext): void {
  providers.set(actor, context)
}

/** The snapshot a provider above holds for `actor`, or `notProvided`. */
export function useProvidedSnapshot(actor: Actor | undefined): unknown {
  const context = actor ? providers.get(actor) : undefined
  const provided = context ? use(context) : null
  return provided && provided.actor === actor ? provided.snapshot : notProvided
}
