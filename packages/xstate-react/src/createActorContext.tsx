import {createContext, use, type ReactNode} from 'react'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

import {useActorRef, type HookOptions} from './useActorRef'
import {useSelector as useSelectorUnbound} from './useSelector'
import {useSend as useSendUnbound} from './useSend'

/** @public */
export interface ActorContext<TLogic extends AnyActorLogic> {
  useSelector: <T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ) => T
  useActorRef: () => Actor<TLogic>
  /** The provided actor's `send`, with the same transition and optimistic behavior as `useActor`. */
  useSend: () => Actor<TLogic>['send']
  Provider: (props: {
    children: ReactNode
    options?: HookOptions<TLogic>
    logic?: TLogic
    /**
     * An already-created actor (e.g. from `restoreActor`) to provide instead of creating one from
     * `logic` and `options`. Create it once.
     */
    actor?: Actor<TLogic>
  }) => ReactNode
}

/** @public */
export function createActorContext<TLogic extends AnyActorLogic>(
  actorLogic: TLogic,
  actorOptions?: HookOptions<TLogic>,
): ActorContext<TLogic> {
  const ReactContext = createContext<Actor<TLogic> | null>(null)

  function Provider({
    children,
    logic: providedLogic = actorLogic,
    options: providedOptions,
    actor: providedActor,
  }: {
    children: ReactNode
    logic?: TLogic
    options?: HookOptions<TLogic>
    actor?: Actor<TLogic>
  }) {
    const actor = (useActorRef as any)(
      providedActor ?? providedLogic,
      providedActor ? undefined : {...actorOptions, ...providedOptions},
    ) as Actor<TLogic>

    return <ReactContext value={actor}>{children}</ReactContext>
  }

  Provider.displayName = `ActorProvider`

  function useContext(): Actor<TLogic> {
    const actor = use(ReactContext)
    if (!actor) {
      throw new Error(
        `You used a hook from "${Provider.displayName}" but it's not inside a <${Provider.displayName}> component.`,
      )
    }
    return actor
  }

  function useSelector<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ): T {
    return useSelectorUnbound(useContext(), selector, compare)
  }

  function useSend(): Actor<TLogic>['send'] {
    return useSendUnbound(useContext())
  }

  return {Provider, useActorRef: useContext, useSelector, useSend}
}
