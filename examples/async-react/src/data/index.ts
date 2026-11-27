import type {Lesson, LessonIcon} from './fake-data'

export interface LessonsQuery {
  tab: string
  q: string
  /** The router's revision, which a refresh increases to fetch again. */
  revision: number
}

const LESSON_ICONS: LessonIcon[] = [
  'lightbulb',
  'shuffle',
  'zap',
  'hourglass',
  'fastforward',
  'puzzle',
]

function isLessonIcon(value: unknown): value is LessonIcon {
  return LESSON_ICONS.some((icon) => icon === value)
}

function parseLesson(value: unknown): Lesson {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('title' in value) ||
    typeof value.title !== 'string' ||
    !('description' in value) ||
    typeof value.description !== 'string' ||
    !('complete' in value) ||
    typeof value.complete !== 'boolean' ||
    !('icon' in value) ||
    !isLessonIcon(value.icon)
  ) {
    throw new TypeError('The lessons endpoint returned a malformed lesson')
  }
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    icon: value.icon,
    complete: value.complete,
  }
}

function parseLessons(value: unknown): Lesson[] {
  if (!Array.isArray(value)) {
    throw new TypeError('The lessons endpoint did not return a list')
  }
  return value.map(parseLesson)
}

async function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${url} failed with ${response.status}`)
  }
  return response.json()
}

const revisions = new Map<number, Map<string, Promise<Lesson[]>>>()

/**
 * One request per tab, search and revision. Every reader of the same query, and the login page's
 * prefetch, gets the same promise, so a list that is already on screen renders without suspending.
 */
export function lessons({tab, q, revision}: LessonsQuery): Promise<Lesson[]> {
  let cache = revisions.get(revision)
  if (!cache) {
    cache = new Map()
    revisions.set(revision, cache)
    // The previous revision is what's on screen until the refresh that replaces it renders.
    for (const older of revisions.keys()) {
      if (older < revision - 1) {
        revisions.delete(older)
      }
    }
  }
  const url = `/api/lessons?${new URLSearchParams({tab, q})}`
  let promise = cache.get(url)
  if (!promise) {
    promise = fetchJson(url).then(parseLessons)
    cache.set(url, promise)
  }
  return promise
}

/**
 * Starts loading the home page's lessons, and settles when they have loaded or after a second,
 * whichever is first.
 */
export function prefetchLessons(revision: number): Promise<unknown> {
  return Promise.race([
    lessons({tab: 'all', q: '', revision}),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ])
}

export async function toggleLesson(id: string): Promise<void> {
  await fetchJson(`/api/lesson/${id}/toggle`, {method: 'POST'})
}

export async function login(credentials: {username: string; password: string}): Promise<void> {
  await fetchJson('/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(credentials),
  })
}
