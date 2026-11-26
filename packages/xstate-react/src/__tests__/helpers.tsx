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
 * types React passes to it, which are the types of the transition that committed.
 */
export function recordViewTransitionTypes(): string[][] {
  const recorded: string[][] = []
  const doc = document as any
  const root = document.documentElement as any
  beforeEach(() => {
    doc.fonts = {status: 'loaded', ready: Promise.resolve()}
    root.getAnimations = () => []
    ;(Element.prototype as any).animate = () => ({finished: Promise.resolve(), cancel() {}})
    doc.startViewTransition = ({update, types}: {update: () => unknown; types?: string[]}) => {
      recorded.push([...(types ?? [])])
      const done = Promise.resolve().then(update)
      return {
        ready: done,
        finished: done,
        updateCallbackDone: done,
        skipTransition() {},
      }
    }
  })
  afterEach(() => {
    recorded.length = 0
    delete doc.startViewTransition
    delete doc.fonts
    delete root.getAnimations
    delete (Element.prototype as any).animate
  })
  return recorded
}
