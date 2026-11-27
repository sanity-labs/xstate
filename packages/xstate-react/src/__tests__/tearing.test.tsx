import {act, render, screen} from '@testing-library/react'
import {
  addTransitionType,
  memo,
  startTransition,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useState,
  ViewTransition,
  type ReactNode,
} from 'react'
import {describe, expect, it, vi} from 'vitest'
import {createActor, type Actor} from 'xstate'

import {createActorContext, useActor, useActorRef, useSelector} from '../index'
import {deferred, recordViewTransitionTypes, textMachine} from './helpers'

type TextActor = Actor<typeof textMachine>

const Text = createActorContext(textMachine)

/** A hook with a subscription per component, initialized from the actor, as a control. */
function usePerComponentText(actor: TextActor): string {
  const [text, setText] = useState(() => actor.getSnapshot().context.text)
  useEffect(() => {
    const subscription = actor.subscribe((snapshot) => setText(snapshot.context.text))
    return () => subscription.unsubscribe()
  }, [actor])
  return text
}

type TextSource = (props: {actor: TextActor; children: (text: string) => ReactNode}) => ReactNode

function ProvidedText({children}: {children: (text: string) => ReactNode}) {
  return children(Text.useSelector((snapshot) => snapshot.context.text))
}

function PerComponentText({actor, children}: Parameters<TextSource>[0]) {
  return children(usePerComponentText(actor))
}

function SelectedText({actor, children}: Parameters<TextSource>[0]) {
  return children(useSelector(actor, (snapshot) => snapshot.context.text))
}

function Gate({text, gate}: {text: string; gate: Promise<void>}) {
  if (text) {
    use(gate)
  }
  return null
}

describe('one subscriber per actor', () => {
  it('subscribes to the actor once however many components read it', async () => {
    const actor = createActor(textMachine)
    const subscribe = vi.spyOn(actor, 'subscribe')
    function Reader() {
      const text = Text.useSelector((snapshot) => snapshot.context.text)
      const sameActor = useSelector(Text.useActorRef(), (snapshot) => snapshot.context.text)
      return (
        <span>
          {text}
          {sameActor}
        </span>
      )
    }
    render(
      <Text.Provider actor={actor}>
        {Array.from({length: 20}, (_, i) => (
          <Reader key={i} />
        ))}
      </Text.Provider>,
    )
    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it("doesn't trigger React's warning about many updates inside `startTransition`", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const actor = createActor(textMachine).start()
    function Reader() {
      return <span>{Text.useSelector((snapshot) => snapshot.context.text)}</span>
    }
    function Control() {
      return <span>{usePerComponentText(actor)}</span>
    }
    const readers = Array.from({length: 20}, (_, i) => <Reader key={i} />)
    const {unmount} = render(<Text.Provider actor={actor}>{readers}</Text.Provider>)
    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    expect(warn).not.toHaveBeenCalled()
    unmount()

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
    function Reader() {
      return <span>{Text.useSelector((snapshot) => snapshot.context.text)}</span>
    }
    function Gated() {
      const text = Text.useSelector((snapshot) => snapshot.context.text)
      return <Gate text={text} gate={gate.promise} />
    }
    let send!: (text: string) => void
    function Controls() {
      const textSend = Text.useSend()
      useLayoutEffect(() => {
        send = (text) => textSend({type: 'change', text})
      })
      return null
    }
    render(
      <Text.Provider>
        <ViewTransition>
          <p data-testid="readers">
            <Reader />
            <Suspense fallback="…">
              <Gated />
            </Suspense>
            <Reader />
          </p>
        </ViewTransition>
        <Controls />
      </Text.Provider>,
    )

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

function renderMountDuringTransition(Source: TextSource) {
  const actor = createActor(textMachine)
  const gate = deferred()
  function Reader({id}: {id: string}) {
    return <Source actor={actor}>{(text) => <span data-testid={id}>{text}</span>}</Source>
  }
  function Gated() {
    return <Source actor={actor}>{(text) => <Gate text={text} gate={gate.promise} />}</Source>
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
    <Text.Provider actor={actor}>
      <Reader id="a" />
      <Suspense fallback={null}>
        <Gated />
      </Suspense>
      <Late />
    </Text.Provider>,
  )
  return {actor, gate, mount: () => mount()}
}

describe('a component mounting during a suspended transition', () => {
  it('renders the snapshot the rest of the tree shows', async () => {
    const {actor, gate, mount} = renderMountDuringTransition(ProvidedText)

    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    await act(async () => mount())
    expect(screen.getByTestId('a').textContent).toBe('')
    expect(screen.getByTestId('b').textContent).toBe('')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('a').textContent).toBe('a')
    expect(screen.getByTestId('b').textContent).toBe('a')
  })

  it('renders the same with `useSelector(actor)` below the provider', async () => {
    const {actor, gate, mount} = renderMountDuringTransition(SelectedText)

    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    await act(async () => mount())
    expect(screen.getByTestId('a').textContent).toBe('')
    expect(screen.getByTestId('b').textContent).toBe('')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('b').textContent).toBe('a')
  })

  it('tears with a subscription per component (control)', async () => {
    const {actor, mount} = renderMountDuringTransition(PerComponentText)

    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    await act(async () => mount())
    expect(screen.getByTestId('a').textContent).toBe('')
    expect(screen.getByTestId('b').textContent).toBe('a')
  })
})

function renderWriteBeforeSubscribe(Source: TextSource) {
  const actor = createActor(textMachine).start()
  function Reader() {
    return <Source actor={actor}>{(text) => <p data-testid="text">{text}</p>}</Source>
  }
  function Writer() {
    useLayoutEffect(() => {
      actor.send({type: 'change', text: 'a'})
    }, [])
    return null
  }
  render(
    <>
      <Reader />
      <Writer />
    </>,
  )
}

describe('a change between render and subscribing', () => {
  it('is picked up when the hook subscribes', async () => {
    renderWriteBeforeSubscribe(SelectedText)
    await act(async () => {})
    expect(screen.getByTestId('text').textContent).toBe('a')
  })

  it('is missed by a subscription without a re-check (control)', async () => {
    renderWriteBeforeSubscribe(PerComponentText)
    await act(async () => {})
    expect(screen.getByTestId('text').textContent).toBe('')
  })
})

describe('an unchanged selection', () => {
  it('keeps its identity, so what a provider reader renders can bail out', async () => {
    const rendered = vi.fn()
    const Shown = memo(function Shown({value}: {value: {text: string}}) {
      rendered()
      return <p data-testid="text">{value.text}</p>
    })
    const actor = createActor(textMachine)
    function Reader() {
      const value = Text.useSelector(
        (snapshot) => ({text: snapshot.context.text.toUpperCase()}),
        (a, b) => a.text === b.text,
      )
      return <Shown value={value} />
    }
    render(
      <Text.Provider actor={actor}>
        <Reader />
      </Text.Provider>,
    )
    await act(async () => actor.send({type: 'change', text: 'a'}))
    expect(rendered).toHaveBeenCalledTimes(2)
    await act(async () => actor.send({type: 'change', text: 'A'}))
    expect(rendered).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('text').textContent).toBe('A')
  })

  it("doesn't re-render a component that only reads the provided actor", async () => {
    const rendered = vi.fn()
    const actor = createActor(textMachine)
    function ActorOnly() {
      Text.useActorRef()
      rendered()
      return null
    }
    render(
      <Text.Provider actor={actor}>
        <ActorOnly />
      </Text.Provider>,
    )
    await act(async () => actor.send({type: 'change', text: 'a'}))
    expect(rendered).toHaveBeenCalledTimes(1)
  })

  it("doesn't re-render a component that reads through `useSelector` outside a provider", async () => {
    const rendered = vi.fn()
    let actor!: TextActor
    function Reader() {
      const actorRef = useActorRef(textMachine)
      useLayoutEffect(() => {
        actor = actorRef
      })
      const empty = useSelector(actorRef, (snapshot) => snapshot.context.text === '')
      rendered()
      return <p data-testid="empty">{String(empty)}</p>
    }
    render(<Reader />)
    await act(async () => actor.send({type: 'change', text: 'a'}))
    await act(async () => actor.send({type: 'change', text: 'b'}))
    expect(rendered).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('empty').textContent).toBe('false')
  })
})

describe('useActor', () => {
  it('holds the snapshot it returns in state, so it renders with the transition', async () => {
    const gate = deferred()
    let actor!: TextActor
    function App() {
      const [snapshot, , _actor] = useActor(textMachine)
      useLayoutEffect(() => {
        actor = _actor
      })
      return (
        <Suspense fallback={<p data-testid="fallback" />}>
          <p data-testid="text">{snapshot.context.text}</p>
          <Gate text={snapshot.context.text} gate={gate.promise} />
        </Suspense>
      )
    }
    render(<App />)
    await act(async () => startTransition(() => actor.send({type: 'change', text: 'a'})))
    expect(screen.getByTestId('text').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()
    await act(async () => gate.resolve())
    expect(screen.getByTestId('text').textContent).toBe('a')
  })
})
