import {startTransition, useActionState, useEffect, useLayoutEffect, useMemo, useState} from 'react'
import {
  deliverEvent,
  stopActor,
  type ActorOptions,
  type AnyActor,
  type AnyActorLogic,
  type EventFromLogic,
  type ExecutableEffectFrom,
  type SnapshotFrom,
  type TimerKey,
} from 'xstate'
import {
  createDurable,
  type DurableEffect,
  type DurableExecution,
  type DurableExecutionAdapter,
  type DurableSnapshot,
} from 'xstate/durable'

/**
 * PALS-150 prototype: `useActor` over `useActionState`, driven by XState v6 durable execution.
 *
 * React's action queue is the drive loop. Each event is an action: it computes
 * `durable.transition(prev, event)` and awaits `durable.executeEffects(effects)` before it returns
 * the next snapshot. Events the live actor tree sends to the root (child completions, child
 * snapshots) and root timers come back as actions through the adapter. The root actor itself is
 * inert: React state is the only copy of its snapshot.
 */

const RESET = {type: 'xstate.react.reset'} as const
const START_FAILED = {type: 'xstate.react.startFailed'} as const

type Clock = NonNullable<ActorOptions<AnyActorLogic>['clock']>
type Dispatch = (event: unknown) => void
type Effects<TLogic extends AnyActorLogic> = DurableEffect<ExecutableEffectFrom<TLogic>>[]

const defaultClock: Clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
}

function timerKey(address: string, timer: TimerKey): string {
  const {occurrence: _occurrence, ...logical} = timer
  return `${address}\u0000${JSON.stringify(logical)}`
}

function addressOf(actor: AnyActor): string {
  return (actor as AnyActor & {address: string}).address
}

/** One durable execution: an inert root, its live children and the timers the host owns. */
class Execution<TLogic extends AnyActorLogic> {
  readonly durable: DurableExecution<TLogic>
  readonly initial: DurableSnapshot<TLogic>
  /** The latest snapshot the action chain produced; the actor tree behind it is live. */
  head: DurableSnapshot<TLogic>
  stopped = false
  private readonly initialEffects: Effects<TLogic>
  private started: Promise<void> | null = null
  private readonly timers = new Map<string, unknown>()
  private readonly clock: Clock
  private readonly dispatch: () => Dispatch | null

  constructor(
    logic: TLogic,
    options: ActorOptions<TLogic> | undefined,
    clock: Clock,
    dispatch: () => Dispatch | null,
  ) {
    this.clock = clock
    this.dispatch = dispatch
    const adapter: DurableExecutionAdapter<TLogic> = {
      enqueueRootEvent: (_source, event) => this.dispatchRootEvent(event),
      executeAction: (action, _metadata, runtime) => action.exec(runtime),
      // Never called: the hook never calls `durable.waitForEvent()`; React's action queue is the loop.
      waitForEvent: () => new Promise<never>(() => {}),
      scheduleTimer: (source, timer, delay) => this.scheduleTimer(source, timer, delay),
      cancelTimer: (source, timer) => this.clearTimer(timerKey(addressOf(source), timer)),
      cancelAllTimers: (source) => {
        const prefix = `${addressOf(source)}\u0000`
        for (const key of this.timers.keys()) {
          if (key.startsWith(prefix)) {
            this.clearTimer(key)
          }
        }
      },
    }
    this.durable = createDurable<TLogic>(logic, adapter, {captureRootEvents: false})
    const [initial, initialEffects] = this.durable.initialTransition(
      ...([options?.input] as Parameters<DurableExecution<TLogic>['initialTransition']>),
    )
    this.initial = initial
    this.head = initial
    this.initialEffects = initialEffects
  }

  start(): Promise<void> {
    this.started ??= this.durable.executeEffects(this.initialEffects)
    return this.started
  }

  async transition(
    prev: DurableSnapshot<TLogic>,
    event: unknown,
  ): Promise<DurableSnapshot<TLogic>> {
    await this.start()
    if (this.stopped) {
      return prev
    }
    const [next, effects] = this.durable.transition(prev, event as EventFromLogic<TLogic>)
    this.head = next
    await this.durable.executeEffects(effects)
    return next
  }

  stop(): void {
    this.stopped = true
    for (const key of this.timers.keys()) {
      this.clearTimer(key)
    }
    const root = this.durable.getActorRef(this.head)
    if (root) {
      stopActor(root)
    }
  }

  private dispatchRootEvent(event: unknown): void {
    if (this.stopped) {
      return
    }
    const dispatch = this.dispatch()
    if (dispatch) {
      startTransition(() => dispatch(event))
    }
  }

  private scheduleTimer(source: AnyActor, timer: TimerKey, delay: number): void {
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
        if (addressOf(source) === this.durable.rootAddress) {
          this.dispatchRootEvent(event)
        } else {
          deliverEvent(source, source, event)
        }
      }, delay),
    )
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
class Host<TLogic extends AnyActorLogic> {
  execution: Execution<TLogic>
  readonly action: (
    prev: DurableSnapshot<TLogic>,
    event: unknown,
  ) => Promise<DurableSnapshot<TLogic>>
  private dispatch: Dispatch | null = null
  private pendingStop: (() => void) | null = null
  private readonly clock: Clock
  private readonly logic: TLogic
  private readonly options: ActorOptions<TLogic> | undefined

  constructor(logic: TLogic, options: ActorOptions<TLogic> | undefined) {
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
      this.execution.start().catch(() => {
        const dispatch = this.dispatch
        if (dispatch && !this.execution.stopped) {
          startTransition(() => dispatch(START_FAILED))
        }
      })
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
    return new Execution(this.logic, this.options, this.clock, () => this.dispatch)
  }

  private async run(
    prev: DurableSnapshot<TLogic>,
    event: unknown,
  ): Promise<DurableSnapshot<TLogic>> {
    if (event === START_FAILED) {
      await this.execution.start()
      return prev
    }
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

function isErrored(snapshot: unknown): snapshot is {error: unknown} {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    'status' in snapshot &&
    snapshot.status === 'error' &&
    'error' in snapshot
  )
}

/** @public */
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  if (!!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine); this prototype has no actor to adopt, the root is inert.`,
    )
  }
  const [host] = useState(() => new Host(logic, options))
  const [snapshot, dispatch, isPending] = useActionState(host.action, host.execution.initial)

  useLayoutEffect(() => {
    host.attach(dispatch)
  }, [host, dispatch])

  const send = useMemo(
    () => (event: EventFromLogic<TLogic>) => {
      // Outside a transition, `dispatch` would be a sync update that suspends on the action.
      startTransition(() => dispatch(event))
    },
    [dispatch],
  )

  useEffect(() => host.connect(), [host])

  const current: unknown = snapshot
  if (isErrored(current)) {
    throw current.error
  }
  return [snapshot, send, isPending]
}
