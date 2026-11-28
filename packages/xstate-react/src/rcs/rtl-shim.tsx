import * as RTL from '@testing-library/react/dist/index.js'
// PALS-151 prototype: when VITE_XSTATE_REACT_IMPL=rcsx, `@testing-library/react` resolves here so
// every `render` puts the ponyfill's required `<StoreProvider>` above the tree under test.
import type {ComponentType, ReactNode} from 'react'

import {StoreProvider} from './experimental'

// Named re-exports: `export *` from the CJS build has no static names in browser mode.
export const {act, cleanup, configure, fireEvent, screen, waitFor, within} = RTL

type Wrapper = ComponentType<{children: ReactNode}>

function withProvider(Inner: Wrapper | undefined): Wrapper {
  return function ProvidedWrapper({children}) {
    return <StoreProvider>{Inner ? <Inner>{children}</Inner> : children}</StoreProvider>
  }
}

export function render(ui: ReactNode, options?: RTL.RenderOptions): RTL.RenderResult {
  return RTL.render(ui, {...options, wrapper: withProvider(options?.wrapper as Wrapper)})
}

export function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: RTL.RenderHookOptions<Props>,
): RTL.RenderHookResult<Result, Props> {
  return RTL.renderHook(callback, {
    ...options,
    wrapper: withProvider(options?.wrapper as Wrapper),
  } as RTL.RenderHookOptions<Props>)
}
