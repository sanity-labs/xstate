import {
  deliverEvent,
  executeEffects,
  initialTransition,
  transition,
  type ActorSystemRuntime,
  type AnyActor,
  type AnyActorLogic,
  type EventFromLogic,
  type SnapshotFrom,
} from 'xstate'
import {createDurable, type DurableExecution, type DurableSnapshot} from 'xstate/durable'

import {addressOf, type Engine, type HostRuntime} from './execution'

/**
 * `xstate/durable` as the engine. The adapter is the supported way to be told about root events
 * and timers. The hook never calls `durable.waitForEvent()`: with `captureRootEvents: false` the
 * execution hands root events to `enqueueRootEvent` as they happen, and React's action queue is
 * the loop.
 */
export function durableEngine<TLogic extends AnyActorLogic>(
  logic: TLogic,
  runtime: HostRuntime,
): Engine<TLogic> {
  const durable = createDurable<TLogic>(
    logic,
    {
      enqueueRootEvent: (_source, event) => runtime.dispatchRootEvent(event),
      executeAction: (action, _metadata, actionRuntime) => action.exec(actionRuntime),
      waitForEvent: () => new Promise<never>(() => {}),
      scheduleTimer: (source, timer, delay) => runtime.scheduleTimer(source, timer, delay),
      cancelTimer: (source, timer) => runtime.cancelTimer(source, timer),
      cancelAllTimers: (source) => runtime.cancelAllTimers(source),
    },
    {captureRootEvents: false},
  )
  type Snapshot = DurableSnapshot<TLogic>
  return {
    initialTransition: (input) =>
      durable.initialTransition(
        ...([input] as Parameters<DurableExecution<TLogic>['initialTransition']>),
      ) as unknown as [SnapshotFrom<TLogic>, unknown],
    transition: (snapshot, event) =>
      durable.transition(snapshot as Snapshot, event) as unknown as [SnapshotFrom<TLogic>, unknown],
    executeEffects: (effects) =>
      durable.executeEffects(effects as Parameters<DurableExecution<TLogic>['executeEffects']>[0]),
    getRootRef: (snapshot) => durable.getActorRef(snapshot as Snapshot),
    isRoot: (actor) => addressOf(actor) === durable.rootAddress,
  }
}

interface EffectWithActors {
  actor?: AnyActor
  source?: AnyActor
}

interface SystemWithRuntime {
  runtime?: Partial<ActorSystemRuntime>
}

function systemOf(actor: AnyActor | undefined): SystemWithRuntime | undefined {
  return actor?.system as unknown as SystemWithRuntime | undefined
}

function isRootActor(actor: AnyActor): boolean {
  return !(actor as AnyActor & {_parent?: unknown})._parent
}

/**
 * The pure `initialTransition`/`transition`/`executeEffects` API as the engine.
 *
 * This API has no public handle on the runtime that executes effects. Every executable effect
 * carries the actor it concerns, and that actor's system has an installable `runtime`, which is
 * what `createDurable` sets under the hood. The prototype reaches in the same way, so this engine
 * exists to measure the pure API, not as a supported path.
 */
export function transitionEngine<TLogic extends AnyActorLogic>(
  logic: TLogic,
  runtime: HostRuntime,
): Engine<TLogic> {
  const systems = new WeakSet<object>()
  let root: AnyActor | undefined
  const override: Partial<ActorSystemRuntime> = {
    sendEvent: (source, target, event) => {
      if (isRootActor(target)) {
        runtime.dispatchRootEvent(event)
      } else {
        deliverEvent(source, target, event)
      }
    },
    scheduleTimer: (source, timer, delay) => runtime.scheduleTimer(source, timer, delay),
    cancelTimer: (source, timer) => runtime.cancelTimer(source, timer),
    cancelAllTimers: (source) => runtime.cancelAllTimers(source),
  }
  function adopt(effects: EffectWithActors[]): void {
    for (const effect of effects) {
      for (const actor of [effect.source, effect.actor]) {
        if (actor && isRootActor(actor)) {
          root = actor
        }
        const system = systemOf(actor)
        if (system && !systems.has(system)) {
          systems.add(system)
          system.runtime = override
        }
      }
    }
  }
  return {
    initialTransition: (input) => {
      const result = (
        initialTransition as (logic: TLogic, input?: unknown) => [SnapshotFrom<TLogic>, unknown]
      )(logic, input)
      adopt(result[1] as EffectWithActors[])
      return result
    },
    transition: (snapshot, event) => {
      const result = transition(logic, snapshot, event as EventFromLogic<TLogic>)
      adopt(result[1] as EffectWithActors[])
      return result
    },
    executeEffects: (effects) => executeEffects(effects as Parameters<typeof executeEffects>[0]),
    getRootRef: () => root,
    isRoot: isRootActor,
  }
}
