import {delay, http, HttpResponse} from 'msw'

import * as fakeData from '@/data/fake-data'
import {withLatency} from '@/mocks/latency'

export const handlers = [
  http.get(
    '/api/lessons',
    withLatency('/api/lessons', async ({request}) => {
      const url = new URL(request.url)
      const lessons = await fakeData.getLessons(
        url.searchParams.get('tab') ?? undefined,
        url.searchParams.get('q') ?? undefined,
      )
      return HttpResponse.json(lessons)
    }),
  ),

  http.post<{id: string}>(
    '/api/lesson/:id/toggle',
    withLatency('/api/lesson/:id/toggle', async ({params}) => {
      await fakeData.postLessonToggle(params.id)
      return HttpResponse.json({status: 'ok'})
    }),
  ),

  http.post('/api/login', async () => {
    await delay('real')
    return HttpResponse.json({status: 'ok'})
  }),
]
