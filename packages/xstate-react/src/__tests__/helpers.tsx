import {afterEach, beforeEach} from 'vitest'
import {createMachine, types} from 'xstate'

export const counterMachine = createMachine({
  schemas: {
    context: types<{count: number}>(),
    events: {inc: types<void>(), double: types<void>()},
  },
  context: {count: 0},
  on: {
    inc: ({context}) => ({context: {count: context.count + 1}}),
    double: ({context}) => ({context: {count: context.count * 2}}),
  },
})

export const textMachine = createMachine({
  schemas: {
    context: types<{text: string}>(),
    events: {change: types<{text: string}>()},
  },
  context: {text: ''},
  on: {
    change: ({event}) => ({context: {text: event.text}}),
  },
})

export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return {promise, resolve}
}

/**
 * Installs a `document.startViewTransition` that runs the update at once and records the transition
 * types React passes to it, which are the types of the transition that committed. What the
 * environment lacks for React to start a view transition is stubbed too.
 */
export function recordViewTransitionTypes(): string[][] {
  const recorded: string[][] = []
  const stubs: [object, string, unknown][] = [
    [document, 'startViewTransition', startViewTransition],
    [document, 'fonts', {status: 'loaded', ready: Promise.resolve()}],
    [document.documentElement, 'getAnimations', () => []],
    [Element.prototype, 'animate', () => ({finished: Promise.resolve(), cancel() {}})],
  ]
  const installed: [object, string][] = []
  function startViewTransition({update, types}: {update: () => unknown; types?: string[]}) {
    recorded.push([...(types ?? [])])
    const done = Promise.resolve().then(update)
    return {ready: done, finished: done, updateCallbackDone: done, skipTransition() {}}
  }
  beforeEach(() => {
    for (const [target, key, value] of stubs) {
      if (key === 'startViewTransition' || !(key in target)) {
        Object.defineProperty(target, key, {value, configurable: true, writable: true})
        installed.push([target, key])
      }
    }
  })
  afterEach(() => {
    recorded.length = 0
    for (const [target, key] of installed.splice(0)) {
      delete (target as Record<string, unknown>)[key]
    }
  })
  return recorded
}
