import {render} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import {ActorRefFrom, createActor, createMachine} from 'xstate'
import z from 'zod'

import {useActor} from '../../index'

describe('useActor', () => {
  interface YesNoContext {
    value?: number
  }

  interface YesNoEvent {
    type: 'YES'
  }

  const yesNoMachine = createMachine({
    // types: {} as { context: YesNoContext; events: YesNoEvent },
    schemas: {
      context: z.object({
        value: z.number().optional(),
      }),
      events: z.object({
        type: z.literal('YES'),
      }) as any,
    },
    context: {
      value: undefined,
    },
    initial: 'no',
    states: {
      no: {
        on: {
          YES: {target: 'yes'},
        },
      },
      yes: {
        type: 'final',
      },
    },
  })

  it('state should not become never after checking state with matches', () => {
    const YesNo = () => {
      const [state] = useActor(yesNoMachine)

      if (state.matches('no')) {
        return <span>No</span>
      }

      return <span>Yes: {state.context.value}</span>
    }

    render(<YesNo />)
  })

  // Example from: https://github.com/statelyai/xstate/discussions/1534
  it('spawned actors should be typed correctly', () => {
    const child = createMachine({
      // types: {} as {
      //   context: { bar: number };
      //   events: { type: 'FOO'; data: number };
      // },
      schemas: {
        context: z.object({
          bar: z.number(),
        }),
        events: z.object({
          type: z.literal('FOO'),
          data: z.number(),
        }) as any,
      },
      id: 'myActor',
      context: {
        bar: 1,
      },
      initial: 'ready',
      states: {
        ready: {},
      },
    })

    const m = createMachine({
      initial: 'ready',
      schemas: {
        context: z.object({
          actor: z.custom<ActorRefFrom<typeof child>>().nullable(),
        }),
      },
      context: {
        actor: null,
      },
      states: {
        ready: {
          entry: (_, enq) => ({
            context: {
              actor: enq.spawn(child),
            },
          }),
        },
      },
    })

    interface Props {
      myActor: ActorRefFrom<typeof child>
    }

    function Element({myActor}: Props) {
      const current = myActor.getSnapshot()
      const bar: number = current.context.bar

      // @ts-expect-error
      send({type: 'WHATEVER'})

      return (
        <>
          {bar}
          <div onClick={() => myActor.send({type: 'FOO', data: 1} as any)}>click</div>
        </>
      )
    }

    function App() {
      const [current] = useActor(m)

      if (!current.context.actor) {
        return null
      }

      return <Element myActor={current.context.actor} />
    }

    const noop = (_val: any) => {
      /* ... */
    }

    noop(App)
  })
})

describe('useActor', () => {
  it('should require input to be specified when defined', () => {
    const withInputMachine = createMachine({
      // types: {} as { input: { value: number } },
      schemas: {
        input: z.object({
          value: z.number(),
        }),
      },
      initial: 'idle',
      states: {
        idle: {},
      },
    })

    const Component = () => {
      // @ts-expect-error input is required
      const _ = useActor(withInputMachine)
      return <></>
    }

    render(<Component />)
  })

  it('should not require input when not defined', () => {
    const noInputMachine = createMachine({
      // types: {} as {},
      initial: 'idle',
      states: {
        idle: {},
      },
    })
    const Component = () => {
      const _ = useActor(noInputMachine)
      return <></>
    }

    render(<Component />)
  })
})

describe('the tuple', () => {
  it('is the snapshot and `send`, without the actor', () => {
    const machine = createMachine({initial: 'idle', states: {idle: {}}})
    const check = () => {
      const result = useActor(machine)
      const [snapshot, send] = result
      snapshot.matches('idle')
      send({type: 'ANY'})
      // @ts-expect-error there is no third element
      const _actor = result[2]
      // @ts-expect-error an actor is not logic
      useActor(createActor(machine))
    }

    expect(check).toBeTypeOf('function')
  })
})

it('useActor types work for machines with a specified id and state with an after property #5008', () => {
  // https://github.com/statelyai/xstate/issues/5008
  const cheatCodeMachine = createMachine({
    id: 'cheatCodeMachine',
    initial: 'disabled',
    states: {
      disabled: {
        after: {},
      },
      enabled: {},
    },
  })

  function _useCheatCode(): boolean {
    // This should typecheck without errors
    const [state] = useActor(cheatCodeMachine)

    return state.matches('enabled')
  }
})
