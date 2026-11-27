import {shallowEqual} from '@sanity-labs/xstate-react'
import {Suspense, use, ViewTransition} from 'react'

import * as data from '@/data/index'
import * as Design from '@/design'
import {Router} from '@/router/index'

function LessonList() {
  const query = Router.useSelector(
    ({context}) => ({
      tab: context.location.tab,
      q: context.location.q,
      revision: context.revision,
    }),
    shallowEqual,
  )
  const send = Router.useSend()
  const lessons = use(data.lessons(query))

  async function completeAction(id: string) {
    await data.toggleLesson(id)
    send({type: 'refresh'})
  }

  if (lessons.length === 0) {
    return (
      <ViewTransition key="empty" default="none" enter="auto" exit="auto">
        <Design.EmptyList />
      </ViewTransition>
    )
  }

  return (
    <ViewTransition key="results" default="none" enter="auto" exit="auto">
      <Design.List>
        {lessons.map((item) => (
          // Moves items that stay in the list to their new position, and fades items in and out.
          <ViewTransition key={item.id}>
            <div>
              <ViewTransition default="none">
                <Design.LessonCard item={item}>
                  <Design.CompleteButton
                    complete={item.complete}
                    action={() => completeAction(item.id)}
                  />
                </Design.LessonCard>
              </ViewTransition>
            </div>
          </ViewTransition>
        ))}
      </Design.List>
    </ViewTransition>
  )
}

export default function Home() {
  const send = Router.useSend()
  const sendOptimistic = Router.useOptimisticSend()
  const {draft, q, tab} = Router.useSelector(
    ({context}) => ({draft: context.draft, q: context.location.q, tab: context.location.tab}),
    shallowEqual,
  )

  return (
    <>
      <Design.SearchInput
        value={draft}
        isPending={draft !== q}
        onChange={(value) => {
          // Only the text is previewed: a preview of the search would suspend the list outside of
          // a transition, and replace it with the fallback.
          sendOptimistic({type: 'search.change', value})
          send({type: 'search.submit'})
        }}
      />
      <Design.TabList
        activeTab={tab}
        changeAction={(value) => send({type: 'tab.change', tab: value})}
      >
        {/* Shown only on the first load: later searches and tabs render in transitions, which keep
            the current list on screen while the next one loads. */}
        <Suspense fallback={<Design.FallbackList />}>
          <LessonList />
        </Suspense>
      </Design.TabList>
    </>
  )
}
