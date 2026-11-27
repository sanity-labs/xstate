import {setupWorker} from 'msw/browser'

import {handlers} from '@/mocks/handlers'

export function startMockServer(): Promise<unknown> {
  return setupWorker(...handlers).start({
    onUnhandledFrame: 'bypass',
    serviceWorker: {
      url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
    },
  })
}
