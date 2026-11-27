import {startTransition} from 'react'
import {
  deliverEvent,
  stopActor,
  type ActorOptions,
  type AnyActor,
  type AnyActorLogic,
  type EventFromLogic,
  type SnapshotFrom,
  type TimerKey,
} from 'xstate'

/**
 * PALS-175 prototypes: the host side of a `useActionState` driver.
 *
 * React's action queue is the drive loop. Each event is an action: it computes the next snapshot
 * from the previous one and awaits the effects before it returns. Events the live actor tree sends
 * to the root (child completions, child snapshots) and root timers come back as actions. The root
 * actor itself is inert: React state is the only copy of its snapshot.
 *
 * An `Engine` is what computes transitions and executes effects: `xstate/durable` or the pure
 * `initialTransition`/`transition`/`executeEffects` API. Both report to the same `HostRuntime`.
 */

const RESET = {type: 'xstate.react.reset'} as const

export type Clock = NonNullable<ActorOptions<AnyActorLogic>['clock']>
export type Dispatch = (event: unknown) => void

/** What an engine routes to the host: root events and the timers the host owns. */
export interface HostRuntime {
  dispatchRootEvent(event: unknown): void
  scheduleTimer(source: AnyActor, timer: TimerKey, delay: number): void
  cancelTimer(source: AnyActor, timer: TimerKey): void
  cancelAllTimers(source: AnyActor): void
}

export interface Engine<TLogic extends AnyActorLogic, TEffects = unknown> {
  initialTransition(input: unknown): [SnapshotFrom<TLogic>, TEffects]
  transition(
    snapshot: SnapshotFrom<TLogic>,
    event: EventFromLogic<TLogic>,
  ): [SnapshotFrom<TLogic>, TEffects]
  executeEffects(effects: TEffects): Promise<void>
  /** The inert root behind the snapshots, once the engine knows it. */
  getRootRef(snapshot: SnapshotFrom<TLogic>): AnyActor | undefined
  isRoot(actor: AnyActor): boolean
}

export type EngineFactory<TLogic extends AnyActorLogic> = (
  logic: TLogic,
  runtime: HostRuntime,
) => Engine<TLogic>

const defaultClock: Clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
}

function timerKey(address: string, timer: TimerKey): string {
  const {occurrence: _occurrence, ...logical} = timer
  return `${address}\u0000${JSON.stringify(logical)}`
}

export function addressOf(actor: AnyActor): string {
  return (actor as AnyActor & {address: string}).address
}

/** One execution: an inert root, its live children and the timers the host owns. */
export class Execution<TLogic extends AnyActorLogic> implements HostRuntime {
  readonly initial: SnapshotFrom<TLogic>
  /** The latest snapshot the action chain produced; the actor tree behind it is live. */
  head: SnapshotFrom<TLogic>
  stopped = false
  private readonly engine: Engine<TLogic>
  private readonly initialEffects: unknown
  private started: Promise<void> | null = null
  private readonly timers = new Map<string, unknown>()
  private readonly clock: Clock
  private readonly dispatch: () => Dispatch | null

  constructor(
    engineFactory: EngineFactory<TLogic>,
    logic: TLogic,
    options: ActorOptions<TLogic> | undefined,
    clock: Clock,
    dispatch: () => Dispatch | null,
  ) {
    this.clock = clock
    this.dispatch = dispatch
    this.engine = engineFactory(logic, this)
    const [initial, initialEffects] = this.engine.initialTransition(options?.input)
    this.initial = initial
    this.head = initial
    this.initialEffects = initialEffects
  }

  start(): Promise<void> {
    this.started ??= this.engine.executeEffects(this.initialEffects)
    return this.started
  }

  async transition(prev: SnapshotFrom<TLogic>, event: unknown): Promise<SnapshotFrom<TLogic>> {
    await this.start()
    if (this.stopped) {
      return prev
    }
    const [next, effects] = this.engine.transition(prev, event as EventFromLogic<TLogic>)
    this.head = next
    await this.engine.executeEffects(effects)
    return next
  }

  stop(): void {
    this.stopped = true
    for (const key of this.timers.keys()) {
      this.clearTimer(key)
    }
    const root = this.engine.getRootRef(this.head)
    if (root) {
      stopActor(root)
    }
  }

  dispatchRootEvent(event: unknown): void {
    if (this.stopped) {
      return
    }
    const dispatch = this.dispatch()
    if (dispatch) {
      startTransition(() => dispatch(event))
    }
  }

  scheduleTimer(source: AnyActor, timer: TimerKey, delay: number): void {
    if (this.stopped) {
      return
    }
    const key = timerKey(addressOf(source), timer)
    this.clearTimer(key)
    this.timers.set(
      key,
      this.clock.setTimeout(() => {
        this.timers.delete(key)
        if (this.stopped) {
          return
        }
        const event = {type: 'xstate.timer', ...timer}
        if (this.engine.isRoot(source)) {
          this.dispatchRootEvent(event)
        } else {
          deliverEvent(source, source, event)
        }
      }, delay),
    )
  }

  cancelTimer(source: AnyActor, timer: TimerKey): void {
    this.clearTimer(timerKey(addressOf(source), timer))
  }

  cancelAllTimers(source: AnyActor): void {
    const prefix = `${addressOf(source)}\u0000`
    for (const key of this.timers.keys()) {
      if (key.startsWith(prefix)) {
        this.clearTimer(key)
      }
    }
  }

  private clearTimer(key: string): void {
    const id = this.timers.get(key)
    if (id !== undefined) {
      this.clock.clearTimeout(id)
      this.timers.delete(key)
    }
  }
}

/** What one hook instance owns across renders. Mutation happens in methods only. */
export class Host<TLogic extends AnyActorLogic> {
  execution: Execution<TLogic>
  readonly action: (prev: SnapshotFrom<TLogic>, event: unknown) => Promise<SnapshotFrom<TLogic>>
  private dispatch: Dispatch | null = null
  private pendingStop: (() => void) | null = null
  private readonly clock: Clock
  private readonly engineFactory: EngineFactory<TLogic>
  private readonly logic: TLogic
  private readonly options: ActorOptions<TLogic> | undefined

  constructor(
    engineFactory: EngineFactory<TLogic>,
    logic: TLogic,
    options: ActorOptions<TLogic> | undefined,
  ) {
    this.engineFactory = engineFactory
    this.logic = logic
    this.options = options
    this.clock = options?.clock ?? defaultClock
    this.execution = this.createExecution()
    this.action = (prev, event) => this.run(prev, event)
  }

  attach(dispatch: Dispatch): void {
    this.dispatch = dispatch
  }

  /** Called from the mount effect. Returns the cleanup. */
  connect(): () => void {
    this.pendingStop?.()
    this.pendingStop = null
    if (this.execution.stopped) {
      // Activity showed the component again after its execution stopped: start over, like a
      // fresh actor would.
      const dispatch = this.dispatch
      if (dispatch) {
        startTransition(() => dispatch(RESET))
      }
    } else {
      void this.execution.start()
    }
    return () => {
      // Stopping waits a microtask so that StrictMode's simulated unmount and remount keeps the
      // running execution.
      let canceled = false
      this.pendingStop = () => {
        canceled = true
      }
      queueMicrotask(() => {
        if (!canceled) {
          this.execution.stop()
        }
      })
    }
  }

  private createExecution(): Execution<TLogic> {
    return new Execution(
      this.engineFactory,
      this.logic,
      this.options,
      this.clock,
      () => this.dispatch,
    )
  }

  private async run(prev: SnapshotFrom<TLogic>, event: unknown): Promise<SnapshotFrom<TLogic>> {
    if (event === RESET) {
      if (!this.execution.stopped) {
        return prev
      }
      this.execution = this.createExecution()
      await this.execution.start()
      return this.execution.initial
    }
    return this.execution.transition(prev, event)
  }
}

export function isErrored(snapshot: unknown): snapshot is {error: unknown} {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    'status' in snapshot &&
    snapshot.status === 'error' &&
    'error' in snapshot
  )
}
