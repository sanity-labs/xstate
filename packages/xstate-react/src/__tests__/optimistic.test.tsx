import {fireEvent} from '@testing-library/dom'
import {act, render, screen} from '@testing-library/react'
import {startTransition, Suspense, use, useLayoutEffect} from 'react'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createMachine, types, type Actor} from 'xstate'

import {createActorContext, useActor, useOptimisticSend} from '../index'
import {counterMachine, deferred, textMachine} from './helpers'

function Field() {
  const [snapshot, , actor] = useActor(textMachine)
  const send = useOptimisticSend(actor)
  return (
    <input
      aria-label="text"
      value={snapshot.context.text}
      onChange={(event) => send({type: 'change', text: event.target.value})}
    />
  )
}

describe('a controlled input', () => {
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('shows what was typed before the transition renders, and keeps the caret', async () => {
    render(<Field />)
    const input = screen.getByLabelText<HTMLInputElement>('text')

    fireEvent.change(input, {target: {value: 'helo'}})
    expect(input.value).toBe('helo')

    input.setSelectionRange(3, 3)
    fireEvent.change(input, {target: {value: 'hello'}})
    input.setSelectionRange(4, 4)
    expect(input.value).toBe('hello')

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(input.value).toBe('hello')
    expect(input.selectionStart).toBe(4)
  })
})

describe('optimistic previews', () => {
  it('apply an event once when a newer snapshot commits while the preview is pending', async () => {
    let app!: ReturnType<typeof useActor<typeof counterMachine>>
    let send!: ReturnType<typeof useOptimisticSend<(typeof app)[2]>>
    function Counter() {
      const result = useActor(counterMachine, {updates: 'sync'})
      const sendOptimistic = useOptimisticSend(result[2])
      useLayoutEffect(() => {
        app = result
        send = sendOptimistic
      })
      return <p data-testid="count">{result[0].context.count}</p>
    }
    render(<Counter />)
    const actor = app[2]

    const hold = deferred()
    let action!: Promise<void>
    await act(async () => {
      startTransition(() => {
        action = (async () => {
          await Promise.resolve()
          send({type: 'inc'})
          await hold.promise
        })()
        return action
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('1')

    // A snapshot that already includes the increment commits while the preview is pending.
    await act(async () => actor.send({type: 'double'}))
    expect(actor.getSnapshot().context.count).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('2')

    await act(async () => {
      hold.resolve()
      await action
    })
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('rebase an urgent send on the committed snapshot while a transition is pending', async () => {
    const formMachine = createMachine({
      schemas: {
        context: types<{query: string; draft: string}>(),
        events: {search: types<{query: string}>(), type: types<{draft: string}>()},
      },
      context: {query: '', draft: ''},
      on: {
        search: ({event}) => ({context: {query: event.query}}),
        type: ({event}) => ({context: {draft: event.draft}}),
      },
    })
    const results = deferred()
    function Results({query}: {query: string}) {
      if (query) {
        use(results.promise)
      }
      return <p data-testid="query">{query}</p>
    }
    let send!: ReturnType<typeof useActor<typeof formMachine>>[1]
    let sendOptimistic!: typeof send
    function Form() {
      const [snapshot, _send, actor] = useActor(formMachine)
      const _sendOptimistic = useOptimisticSend(actor)
      useLayoutEffect(() => {
        send = _send
        sendOptimistic = _sendOptimistic
      })
      return (
        <>
          <p data-testid="draft">{snapshot.context.draft}</p>
          <Suspense fallback={<p data-testid="fallback" />}>
            <Results query={snapshot.context.query} />
          </Suspense>
        </>
      )
    }
    render(<Form />)

    await act(async () => startTransition(() => send({type: 'search', query: 'xstate'})))
    await act(async () => sendOptimistic({type: 'type', draft: 'x'}))

    // The urgent render shows the draft without the pending search, so nothing suspends.
    expect(screen.getByTestId('draft').textContent).toBe('x')
    expect(screen.getByTestId('query').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => results.resolve())
    expect(screen.getByTestId('draft').textContent).toBe('x')
    expect(screen.getByTestId('query').textContent).toBe('xstate')
  })
})

const searchMachine = createMachine({
  schemas: {
    context: types<{count: number; draft: string; query: string}>(),
    events: {
      inc: types<void>(),
      type: types<{draft: string}>(),
      search: types<{query: string}>(),
    },
  },
  context: {count: 0, draft: '', query: ''},
  on: {
    inc: ({context}) => ({context: {...context, count: context.count + 1}}),
    type: ({context, event}) => ({context: {...context, draft: event.draft}}),
    search: ({context, event}) => ({context: {...context, query: event.query}}),
  },
})

type SearchSend = ReturnType<typeof useActor<typeof searchMachine>>[1]
type SearchActor = ReturnType<typeof useActor<typeof searchMachine>>[2]

function Results({query, promise}: {query: string; promise: Promise<void>}) {
  if (query) {
    use(promise)
  }
  return <p data-testid="query">{query}</p>
}

function Fallback({commits}: {commits: string[]}) {
  useLayoutEffect(() => {
    commits.push('fallback')
  })
  return null
}

function renderSearch(updates: 'transition' | 'sync' = 'transition') {
  const results = deferred()
  const commits: string[] = []
  const controls = {} as {send: SearchSend; sendOptimistic: SearchSend; actor: SearchActor}
  function Search() {
    const [snapshot, send, actor] = useActor(searchMachine, {updates})
    const sendOptimistic = useOptimisticSend(actor)
    const {count, draft, query} = snapshot.context
    useLayoutEffect(() => {
      Object.assign(controls, {send, sendOptimistic, actor})
      commits.push(`${count}|${draft}|${query}`)
    })
    return (
      <Suspense fallback={<Fallback commits={commits} />}>
        <Results query={query} promise={results.promise} />
      </Suspense>
    )
  }
  render(<Search />)
  return {results, commits, controls}
}

describe('a non-idempotent event', () => {
  it('is applied once per send while React rebases its preview', async () => {
    const {results, commits, controls} = renderSearch()

    await act(async () => startTransition(() => controls.send({type: 'search', query: 'xstate'})))
    await act(async () => controls.sendOptimistic({type: 'inc'}))
    await act(async () => controls.sendOptimistic({type: 'inc'}))
    await act(async () => controls.sendOptimistic({type: 'inc'}))
    expect(commits).toEqual(['0||', '1||', '2||', '3||'])

    await act(async () => results.resolve())
    expect(commits).toEqual(['0||', '1||', '2||', '3||', '3||xstate'])
    expect(controls.actor.getSnapshot().context.count).toBe(3)
  })
})

describe('a sync event over a suspended transition', () => {
  it('shows no fallback, and the committed and optimistic snapshots converge in one commit', async () => {
    const {results, commits, controls} = renderSearch()

    await act(async () => startTransition(() => controls.send({type: 'search', query: 'xstate'})))
    await act(async () => controls.sendOptimistic({type: 'type', draft: 'x'}))
    expect(commits).toEqual(['0||', '0|x|'])

    await act(async () => results.resolve())
    expect(commits).toEqual(['0||', '0|x|', '0|x|xstate'])
  })

  it('shows the fallback when the event renders as a regular update (control)', async () => {
    const {commits, controls} = renderSearch('sync')

    await act(async () => startTransition(() => controls.send({type: 'search', query: 'xstate'})))
    await act(async () => controls.actor.send({type: 'type', draft: 'x'}))
    expect(commits).toContain('fallback')
  })
})

describe('a controlled input below a provider', () => {
  const Text = createActorContext(textMachine)
  function ProvidedField() {
    const text = Text.useSelector((snapshot) => snapshot.context.text)
    const send = Text.useOptimisticSend()
    return (
      <input
        aria-label="text"
        value={text}
        onChange={(event) => send({type: 'change', text: event.target.value})}
      />
    )
  }
  function Mirror() {
    return <p data-testid="mirror">{Text.useSelector((snapshot) => snapshot.context.text)}</p>
  }

  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('shows what was typed in every reader right away', async () => {
    render(
      <Text.Provider>
        <ProvidedField />
        <Mirror />
      </Text.Provider>,
    )
    const input = screen.getByLabelText<HTMLInputElement>('text')

    fireEvent.change(input, {target: {value: 'a'}})
    expect(input.value).toBe('a')
    expect(screen.getByTestId('mirror').textContent).toBe('a')

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.getByTestId('mirror').textContent).toBe('a')
  })
})

describe('a child actor in a preview', () => {
  const child = createMachine({
    schemas: {context: types<{pings: number}>(), events: {ping: types<void>()}},
    context: {pings: 0},
    on: {ping: ({context}) => ({context: {pings: context.pings + 1}})},
  })
  const parent = createMachine({
    schemas: {events: {open: types<void>(), search: types<{query: string}>()}},
    context: {query: ''},
    initial: 'closed',
    states: {
      closed: {on: {open: {target: 'open'}}},
      open: {invoke: {id: 'child', src: child}},
    },
    on: {search: ({event}) => ({context: {query: event.query}})},
  })

  it('is a copy that ignores events, replaced by the running child when the transition renders', async () => {
    const results = deferred()
    const seen: unknown[] = []
    const controls = {} as {
      send: ReturnType<typeof useActor<typeof parent>>[1]
      sendOptimistic: ReturnType<typeof useActor<typeof parent>>[1]
    }
    function Parent() {
      const [snapshot, send, actor] = useActor(parent)
      const sendOptimistic = useOptimisticSend(actor)
      const childRef = snapshot.children.child
      useLayoutEffect(() => {
        Object.assign(controls, {send, sendOptimistic})
        if (childRef) {
          seen.push(childRef)
        }
      })
      return (
        <Suspense fallback={null}>
          <Results query={snapshot.context.query} promise={results.promise} />
        </Suspense>
      )
    }
    render(<Parent />)

    await act(async () => startTransition(() => controls.send({type: 'search', query: 'x'})))
    await act(async () => controls.sendOptimistic({type: 'open'}))
    expect(seen).toHaveLength(1)
    const preview = seen[0] as Actor<typeof child>
    preview.send({type: 'ping'})
    expect(preview.getSnapshot().context.pings).toBe(0)

    await act(async () => results.resolve())
    const running = seen.at(-1) as Actor<typeof child>
    expect(running).not.toBe(preview)
    running.send({type: 'ping'})
    expect(running.getSnapshot().context.pings).toBe(1)
  })
})
