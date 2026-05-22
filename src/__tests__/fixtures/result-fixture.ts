import type { Result } from '../../result.ts'

export type SmokeOk = Result<number, string>
export type SmokeErr = Result<never, { code: 'X' }>
