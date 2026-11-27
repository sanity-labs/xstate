import {fireEvent} from '@testing-library/dom'
import {act, render, screen} from '@testing-library/react'
import {startTransition, Suspense, use, useLayoutEffect, useOptimistic} from 'react'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

import {useActor} from '../index'
import {deferred, textMachine} from './helpers'

// The leaf owns what must show right away, and calls an action that sends to the actor.
function TextInput({
  value,
  changeAction,
}: {
  value: string
  changeAction: (value: string) => void | Promise<void>
}) {
  const [optimisticValue, setOptimisticValue] = useOptimistic(value)
  return (
    <input
      aria-label="text"
      data-pending={optimisticValue !== value}
      value={optimisticValue}
      onChange={(event) => {
        const next = event.target.value
        startTransition(async () => {
          setOptimisticValue(next)
          await changeAction(next)
        })
      }}
    />
  )
}

function Field() {
  const [snapshot, send] = useActor(textMachine)
  return (
    <TextInput
      value={snapshot.context.text}
      changeAction={(text) => send({type: 'change', text})}
    />
  )
}

describe('a controlled input with `useOptimistic` in the leaf', () => {
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
    expect(input.dataset['pending']).toBe('false')
    expect(input.selectionStart).toBe(4)
  })
})

const searchMachine = createMachine({
  schemas: {
    context: types<{query: string}>(),
    events: {search: types<{query: string}>()},
  },
  context: {query: ''},
  on: {
    search: ({event}) => ({context: {query: event.query}}),
  },
})

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

describe('a leaf over a suspended transition', () => {
  it('shows what was typed, shows no fallback, and converges when the transition renders', async () => {
    const results = deferred()
    const commits: string[] = []
    function Search() {
      const [snapshot, send] = useActor(searchMachine)
      const {query} = snapshot.context
      useLayoutEffect(() => {
        commits.push(query)
      })
      return (
        <>
          <TextInput value={query} changeAction={(value) => send({type: 'search', query: value})} />
          <Suspense fallback={<Fallback commits={commits} />}>
            <Results query={query} promise={results.promise} />
          </Suspense>
        </>
      )
    }
    render(<Search />)
    const input = screen.getByLabelText<HTMLInputElement>('text')

    await act(async () => fireEvent.change(input, {target: {value: 'x'}}))
    expect(input.value).toBe('x')
    expect(input.dataset['pending']).toBe('true')
    expect(screen.getByTestId('query').textContent).toBe('')
    expect(commits).toEqual([''])

    await act(async () => results.resolve())
    expect(input.value).toBe('x')
    expect(input.dataset['pending']).toBe('false')
    expect(screen.getByTestId('query').textContent).toBe('x')
    expect(commits).toEqual(['', 'x'])
  })
})
