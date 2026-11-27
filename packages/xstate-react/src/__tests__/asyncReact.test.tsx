import {act, fireEvent, render, screen} from '@testing-library/react'
import {startTransition, Suspense, use, useOptimistic, type ReactNode} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

import {useActor} from '../index'
import {deferred} from './helpers'

// The design components of the Async React demo: they own their optimistic state and call an
// `action` prop inside a transition.
function SearchInput({
  value,
  changeAction,
}: {
  value: string
  changeAction: (value: string) => void | Promise<void>
}) {
  const [inputValue, setInputValue] = useOptimistic(value)
  return (
    <input
      aria-label="search"
      data-pending={inputValue !== value}
      value={inputValue}
      onChange={(event) => {
        const next = event.target.value
        startTransition(async () => {
          setInputValue(next)
          await changeAction(next)
        })
      }}
    />
  )
}

function TabList({
  activeTab,
  changeAction,
  children,
}: {
  activeTab: string
  changeAction: (value: string) => void | Promise<void>
  children: ReactNode
}) {
  const [optimisticTab, setActiveTab] = useOptimistic(activeTab)
  return (
    <div>
      {['all', 'done'].map((tab) => (
        <button
          key={tab}
          type="button"
          aria-pressed={optimisticTab === tab}
          onClick={() =>
            startTransition(async () => {
              setActiveTab(tab)
              await changeAction(tab)
            })
          }
        >
          {tab}
        </button>
      ))}
      {children}
    </div>
  )
}

const routerMachine = createMachine({
  schemas: {
    context: types<{q: string; tab: string}>(),
    events: {'params.set': types<{key: 'q' | 'tab'; value: string}>()},
  },
  context: {q: '', tab: 'all'},
  on: {
    'params.set': ({context, event}) => ({context: {...context, [event.key]: event.value}}),
  },
})

function Lessons({
  q,
  tab,
  lessons,
}: {
  q: string
  tab: string
  lessons: (q: string, tab: string) => Promise<string>
}) {
  return <p data-testid="lessons">{use(lessons(q, tab))}</p>
}

function Home({lessons}: {lessons: (q: string, tab: string) => Promise<string>}) {
  const [snapshot, send] = useActor(routerMachine)
  const {q, tab} = snapshot.context
  return (
    <>
      <SearchInput
        value={q}
        changeAction={(value) => send({type: 'params.set', key: 'q', value})}
      />
      <TabList
        activeTab={tab}
        changeAction={(value) => send({type: 'params.set', key: 'tab', value})}
      >
        <Suspense fallback={<p data-testid="fallback" />}>
          <Lessons q={q} tab={tab} lessons={lessons} />
        </Suspense>
      </TabList>
    </>
  )
}

describe('the Async React demo design components', () => {
  it('keep their optimistic state while the machine updates in their transition', async () => {
    const cache = new Map<string, Promise<string>>()
    const pending = new Map<string, (value: string) => void>()
    const lessons = (q: string, tab: string) => {
      const key = `${tab}:${q}`
      let promise = cache.get(key)
      if (!promise) {
        if (key === 'all:') {
          promise = Promise.resolve(key)
        } else {
          const result = deferred<string>()
          pending.set(key, result.resolve)
          promise = result.promise
        }
        cache.set(key, promise)
      }
      return promise
    }

    await act(async () => render(<Home lessons={lessons} />))
    expect(screen.getByTestId('lessons').textContent).toBe('all:')

    const input = screen.getByLabelText<HTMLInputElement>('search')
    await act(async () => fireEvent.change(input, {target: {value: 'x'}}))
    expect(input.value).toBe('x')
    expect(input.dataset['pending']).toBe('true')
    expect(screen.getByTestId('lessons').textContent).toBe('all:')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => screen.getByRole('button', {name: 'done'}).click())
    expect(screen.getByRole('button', {name: 'done'}).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('lessons').textContent).toBe('all:')

    await act(async () => {
      pending.get('all:x')?.('all:x')
      pending.get('done:x')?.('done:x')
    })
    expect(input.value).toBe('x')
    expect(input.dataset['pending']).toBe('false')
    expect(screen.getByRole('button', {name: 'done'}).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('lessons').textContent).toBe('done:x')
    expect(screen.queryByTestId('fallback')).toBeNull()
  })
})
