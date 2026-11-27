import {Suspense, use, ViewTransition} from 'react'

import * as data from '@/data/index'
import * as Design from '@/design'
import {useRouter} from '@/router/index'

function LessonList() {
  const {location, revision, send} = useRouter()
  const lessons = use(data.lessons({tab: location.tab, q: location.q, revision}))

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
  const {location, send} = useRouter()

  return (
    <>
      <Design.SearchInput
        value={location.q}
        changeAction={(q) => send({type: 'search.change', q})}
      />
      <Design.TabList
        activeTab={location.tab}
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
