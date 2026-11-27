import {act, render, screen} from '@testing-library/react'
import {
  addTransitionType,
  startTransition,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useState,
  ViewTransition,
} from 'react'
import {describe, expect, it, vi} from 'vitest'
import {createActor, type Actor} from 'xstate'

import {useActor} from '../index'
import {deferred, recordViewTransitionTypes, textMachine} from './helpers'

type TextActor = Actor<typeof textMachine>
type TextSend = ReturnType<typeof useActor<typeof textMachine>>[1]

/** A hook with a subscription per component, initialized from the actor, as a control. */
function usePerComponentText(actor: TextActor): string {
  const [text, setText] = useState(() => actor.getSnapshot().context.text)
  useEffect(() => {
    const subscription = actor.subscribe((snapshot) => setText(snapshot.context.text))
    return () => subscription.unsubscribe()
  }, [actor])
  return text
}

function Gate({text, gate}: {text: string; gate: Promise<void>}) {
  if (text) {
    use(gate)
  }
  return null
}

describe('one subscriber per actor', () => {
  it("doesn't trigger React's warning about many updates inside `startTransition`", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let send!: TextSend
    function App() {
      const [snapshot, _send] = useActor(textMachine)
      useLayoutEffect(() => {
        send = _send
      })
      return Array.from({length: 20}, (_, i) => <span key={i}>{snapshot.context.text}</span>)
    }
    const {unmount} = render(<App />)
    await act(async () => startTransition(() => send({type: 'change', text: 'a'})))
    expect(warn).not.toHaveBeenCalled()
    unmount()

    const actor = createActor(textMachine).start()
    function Control() {
      return <span>{usePerComponentText(actor)}</span>
    }
    render(Array.from({length: 20}, (_, i) => <Control key={i} />))
    await act(async () => startTransition(() => actor.send({type: 'change', text: 'b'})))
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Detected a large number of updates inside startTransition'),
    )
    warn.mockRestore()
  })
})

describe('a send inside `startTransition`', () => {
  const types = recordViewTransitionTypes()

  it('updates every reader in that transition, with its types', async () => {
    const gate = deferred()
    let send!: (text: string) => void
    function App() {
      const [snapshot, textSend] = useActor(textMachine)
      useLayoutEffect(() => {
        send = (text) => textSend({type: 'change', text})
      })
      const {text} = snapshot.context
      return (
        <ViewTransition>
          <p data-testid="readers">
            <span>{text}</span>
            <Suspense fallback="…">
              <Gate text={text} gate={gate.promise} />
            </Suspense>
            <span>{text}</span>
          </p>
        </ViewTransition>
      )
    }
    render(<App />)

    await act(async () =>
      startTransition(() => {
        addTransitionType('typing')
        send('a')
      }),
    )
    expect(screen.getByTestId('readers').textContent).toBe('')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('readers').textContent).toBe('aa')
    expect(types).toEqual([['typing']])
  })
})

describe('a component mounting during a suspended transition', () => {
  it('renders the snapshot the rest of the tree shows', async () => {
    const gate = deferred()
    const controls = {} as {send: TextSend; mount: () => void}
    function App() {
      const [snapshot, send] = useActor(textMachine)
      const [mounted, setMounted] = useState(false)
      useLayoutEffect(() => {
        controls.send = send
        controls.mount = () => setMounted(true)
      })
      const {text} = snapshot.context
      return (
        <>
          <span data-testid="a">{text}</span>
          <Suspense fallback={null}>
            <Gate text={text} gate={gate.promise} />
          </Suspense>
          {mounted ? <span data-testid="b">{text}</span> : null}
        </>
      )
    }
    render(<App />)

    await act(async () => startTransition(() => controls.send({type: 'change', text: 'a'})))
    await act(async () => controls.mount())
    expect(screen.getByTestId('a').textContent).toBe('')
    expect(screen.getByTestId('b').textContent).toBe('')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('a').textContent).toBe('a')
    expect(screen.getByTestId('b').textContent).toBe('a')
  })

  it('tears with a subscription per component (control)', async () => {
    const actor = createActor(textMachine)
    const gate = deferred()
    function Reader({id}: {id: string}) {
      return <span data-testid={id}>{usePerComponentText(actor)}</span>
    }
    function Gated() {
      return <Gate text={usePerComponentText(actor)} gate={gate.promise} />
    }
    let mount!: () => void
    function Late() {
      const [mounted, setMounted] = useState(false)
      useLayoutEffect(() => {
        mount = () => setMounted(true)
      })
      return mounted ? <Reader id="b" /> : null
    }
    render(
      <>
        <Reader id="a" />
        <Suspense fallback={null}>
          <Gated />
        </Suspense>
        <Late />
      </>,
    )
    actor.start()

    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    await act(async () => mount())
    expect(screen.getByTestId('a').textContent).toBe('')
    expect(screen.getByTestId('b').textContent).toBe('a')
  })
})

function Writer({send}: {send: TextSend}) {
  useLayoutEffect(() => {
    send({type: 'change', text: 'a'})
  }, [send])
  return null
}

function WriterApp() {
  const [snapshot, send] = useActor(textMachine)
  return (
    <>
      <p data-testid="text">{snapshot.context.text}</p>
      <Writer send={send} />
    </>
  )
}

describe('a change between render and subscribing', () => {
  it('is picked up when the hook subscribes', async () => {
    render(<WriterApp />)
    await act(async () => {})
    expect(screen.getByTestId('text').textContent).toBe('a')
  })
})

describe('useActor', () => {
  it('holds the snapshot it returns in state, so it renders with the transition', async () => {
    const gate = deferred()
    let send!: TextSend
    function App() {
      const [snapshot, _send] = useActor(textMachine)
      useLayoutEffect(() => {
        send = _send
      })
      return (
        <Suspense fallback={<p data-testid="fallback" />}>
          <p data-testid="text">{snapshot.context.text}</p>
          <Gate text={snapshot.context.text} gate={gate.promise} />
        </Suspense>
      )
    }
    render(<App />)
    await act(async () => send({type: 'change', text: 'a'}))
    expect(screen.getByTestId('text').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()
    await act(async () => gate.resolve())
    expect(screen.getByTestId('text').textContent).toBe('a')
  })
})
