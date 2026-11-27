// Research (PALS-152): E1 and transition types with the browser's own view transitions, for the
// fate-style reader against `useActor` with a context fan-out. The assertions record the outcomes.
import {render} from '@testing-library/react'
import {
  addTransitionType,
  createContext,
  startTransition,
  Suspense,
  use,
  useLayoutEffect,
  useState,
  ViewTransition,
  type ReactNode,
} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActor, createMachine, types, type Actor} from 'xstate'

import {useActor} from '../../index'
import {useFateActor} from '../research/fateReader'

const machine = createMachine({
  schemas: {context: types<{q: string}>(), events: {set: types<{q: string}>()}},
  context: {q: ''},
  on: {set: ({event}) => ({context: {q: event.q}})},
})
type Snap = ReturnType<Actor<typeof machine>['getSnapshot']>

interface Binding {
  actor: Actor<typeof machine>
  Root: (props: {children: ReactNode}) => ReactNode
  useSnap: () => Snap
}
function makeBinding(variant: 'current' | 'fate'): Binding {
  if (variant === 'current') {
    const actor = createActor(machine)
    const Ctx = createContext<Snap | null>(null)
    return {
      actor,
      Root: function Root({children}) {
        const [snapshot] = useActor(actor)
        return <Ctx value={snapshot}>{children}</Ctx>
      },
      useSnap: () => use(Ctx)!,
    }
  }
  const actor = createActor(machine).start()
  return {actor, Root: ({children}) => children, useSnap: () => useFateActor(actor) as Snap}
}

interface Observed {
  types: string[]
  active: string[]
}
function observeViewTransitions() {
  const observed: Observed[] = []
  const running: Promise<void>[] = []
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
    const native = Document.prototype.startViewTransition.bind(document)
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value(options: StartViewTransitionOptions) {
        const transition = native(options)
        const entry: Observed = {types: [...transition.types], active: []}
        observed.push(entry)
        running.push(
          transition.ready.then(() => {
            entry.active = entry.types.filter((type) =>
              document.documentElement.matches(`:active-view-transition-type(${type})`),
            )
          }),
          transition.finished,
        )
        return transition
      },
    })
  })
  afterEach(async () => {
    await Promise.all(running.splice(0))
    observed.length = 0
    delete (document as {startViewTransition?: unknown}).startViewTransition
    global.IS_REACT_ACT_ENVIRONMENT = true
  })
  return {
    async finished(count: number): Promise<Observed[]> {
      await vi.waitFor(() => expect(observed).toHaveLength(count))
      await Promise.all(running)
      return observed
    },
  }
}

describe('fate-style reader: transition types in a real view transition', () => {
  const viewTransitions = observeViewTransitions()
  const expected = {
    current: {types: ['forward'], active: ['forward']},
    fate: {types: [], active: []},
  }
  for (const variant of ['current', 'fate'] as const) {
    it(`${variant}: ${JSON.stringify(expected[variant].types)}`, async () => {
      const b = makeBinding(variant)
      function Reader() {
        return (
          <ViewTransition>
            <p>{b.useSnap().context.q}</p>
          </ViewTransition>
        )
      }
      const {container} = render(
        <b.Root>
          <Reader />
        </b.Root>,
      )
      startTransition(() => {
        addTransitionType('forward')
        b.actor.send({type: 'set', q: 'x'})
      })
      const [transition] = await viewTransitions.finished(1)
      await vi.waitFor(() => expect(container.textContent).toBe('x'))
      expect(transition).toEqual(expected[variant])
    })
  }
})

describe('fate-style reader: a reader mounting during a suspended transition', () => {
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })
  const never = new Promise<void>(() => {})
  const expected = {current: 'A="" results="" B=""', fate: 'A="" results="" B="a"'}
  for (const variant of ['current', 'fate'] as const) {
    it(`${variant}: ${expected[variant]}`, async () => {
      const b = makeBinding(variant)
      let showB!: () => void
      function Reader({id}: {id: string}) {
        return (
          <span data-testid={id}>
            {id}={JSON.stringify(b.useSnap().context.q)}{' '}
          </span>
        )
      }
      function Results() {
        const {q} = b.useSnap().context
        if (q !== '') {
          use(never)
        }
        return <span>results={JSON.stringify(q)} </span>
      }
      function App() {
        const [shown, setShown] = useState(false)
        useLayoutEffect(() => {
          showB = () => setShown(true)
        })
        return (
          <b.Root>
            <Reader id="A" />
            <Suspense fallback={<span>[FALLBACK] </span>}>
              <Results />
            </Suspense>
            {shown ? <Reader id="B" /> : null}
          </b.Root>
        )
      }
      const {container} = render(<App />)
      startTransition(() => b.actor.send({type: 'set', q: 'a'}))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(container.textContent!.trim()).toBe('A="" results=""')
      showB()
      await vi.waitFor(() => expect(container.querySelector('[data-testid=B]')).not.toBeNull())
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(container.textContent!.trim()).toBe(expected[variant])
    })
  }
})
