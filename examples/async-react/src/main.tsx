import {StrictMode, ViewTransition, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {createRoot} from 'react-dom/client'

import './index.css'

import Home from '@/app/Home'
import Login from '@/app/Login'
import {Card, CardContent} from '@/components/ui/card'
import {NetworkDebugger} from '@/debugger/NetworkDebugger'
import {startMockServer} from '@/mocks/browser'
import {RouterProvider, useRouter} from '@/router/index'

const pageTransition = {
  'navigation-back': 'slide-back',
  'navigation-forward': 'slide-forward',
  'default': 'auto',
}

function Layout({children}: {children: ReactNode}) {
  return (
    <>
      <a
        href="https://github.com/sanity-labs/xstate/tree/main/examples/async-react"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
        className="absolute top-4 right-4 hidden md:block"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-6 fill-current">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a5.9 5.9 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      </a>
      <div className="root flex-1 w-[475px] h-full overflow-hidden">
        <Card className="h-[610px] gap-2 flex flex-col border-solid border rounded-lg">
          <CardContent className="h-full px-0">
            <div className="flex flex-1 flex-col h-full">
              <div className="flex flex-col flex-1 gap-2 h-full">{children}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Routes() {
  const {path} = useRouter().location

  return (
    <>
      {path === '/' && (
        <ViewTransition key={path} default="none" enter={pageTransition} exit={pageTransition}>
          <Layout>
            <Home />
          </Layout>
        </ViewTransition>
      )}
      {path === '/login' && (
        <ViewTransition key={path} default="none" enter={pageTransition} exit={pageTransition}>
          <Layout>
            <div className="flex flex-col gap-6 p-12">
              <Card className="border-none">
                <Login />
              </Card>
            </div>
          </Layout>
        </ViewTransition>
      )}
    </>
  )
}

function App({debuggerContainer}: {debuggerContainer: HTMLElement}) {
  return (
    <StrictMode>
      <RouterProvider>
        <Routes />
        {createPortal(<NetworkDebugger />, debuggerContainer)}
      </RouterProvider>
    </StrictMode>
  )
}

const container = document.getElementById('root')
const debuggerContainer = document.getElementById('debugger')
if (!container || !debuggerContainer) {
  throw new Error('Expected the document to contain #root and #debugger elements')
}

const root = createRoot(container)
void startMockServer()
  .catch((error: unknown) => {
    console.error('The mock server failed to start', error)
  })
  .then(() => {
    root.render(<App debuggerContainer={debuggerContainer} />)
  })
