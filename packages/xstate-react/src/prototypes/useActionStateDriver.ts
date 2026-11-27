import {startTransition, useActionState, useEffect, useLayoutEffect, useMemo, useState} from 'react'
import type {ActorOptions, AnyActorLogic, EventFromLogic, SnapshotFrom} from 'xstate'

import {Host, isErrored, type EngineFactory} from './execution'

/** `useActionState` as the loop of an execution owned by the hook. See `execution.ts`. */
export function useActionStateDriver<TLogic extends AnyActorLogic>(
  engineFactory: EngineFactory<TLogic>,
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  if (!!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `This hook expects actor logic (e.g. a machine); it has no actor to adopt, the root is inert.`,
    )
  }
  const [host] = useState(() => new Host(engineFactory, logic, options))
  const [snapshot, dispatch, isPending] = useActionState<SnapshotFrom<TLogic>, unknown>(
    host.action,
    host.execution.initial,
  )

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
