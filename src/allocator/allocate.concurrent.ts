// Concurrency test surface — kept separate from allocate.ts so the path
// helpers and constants used by the concurrent integration test live next
// to the test rather than polluting the runtime module. Imported only from
// __tests__/allocate.concurrent.test.ts; structure-check requires that a
// .test.ts file has a sibling source module at this location.

import { fileURLToPath } from 'node:url'

const FIXTURE_URL = new URL(
  './__tests__/fixtures/concurrent-allocator.ts',
  import.meta.url,
)

export const CONCURRENT_ALLOCATOR_PATH: string = fileURLToPath(FIXTURE_URL)
export const CONCURRENT_ALLOCATOR_COUNT = 4 as const
