import { describe, expect, it } from 'vitest'
import type { PanelLink } from '../types.ts'
import { isSafeLinkUrl } from '../links.ts'
import { resolveServiceLinks } from '../service-links.ts'

describe('resolveServiceLinks', () => {
  it('synthesizes a localhost link when there are no explicit links', () => {
    const result = resolveServiceLinks([], 31234)

    expect(result).toEqual([{ envVar: '', url: 'http://localhost:31234' }])
  })

  it('leaves an explicit http link unchanged (no synthesized link appended)', () => {
    const explicit: readonly PanelLink[] = [
      { envVar: 'API_URL', url: 'http://localhost:5173' },
    ]

    const result = resolveServiceLinks(explicit, 31234)

    expect(result).toBe(explicit)
    expect(result).toEqual(explicit)
  })

  it('leaves an explicit https link unchanged (no synthesized link appended)', () => {
    const explicit: readonly PanelLink[] = [
      { envVar: 'API_URL', url: 'https://example.com/app' },
    ]

    const result = resolveServiceLinks(explicit, 31234)

    expect(result).toBe(explicit)
  })

  it('preserves a ws-only explicit list and appends a synthesized http link', () => {
    const result = resolveServiceLinks(
      [{ envVar: 'WS', url: 'ws://localhost:9 ' }],
      31234,
    )

    expect(result).toEqual([
      { envVar: 'WS', url: 'ws://localhost:9 ' },
      { envVar: '', url: 'http://localhost:31234' },
    ])
  })

  it('does not synthesize a link when the port is NaN', () => {
    const result = resolveServiceLinks([], Number.NaN)

    expect(result).toEqual([])
  })

  it('does not synthesize a link when the port is a non-integer', () => {
    const explicit: readonly PanelLink[] = [
      { envVar: 'WS', url: 'wss://example.com/socket' },
    ]

    const result = resolveServiceLinks(explicit, 3123.5)

    expect(result).toEqual(explicit)
  })

  it('returns only safe-scheme urls in every branch', () => {
    const cases: readonly { explicit: readonly PanelLink[]; port: number }[] = [
      { explicit: [], port: 31234 },
      { explicit: [{ envVar: 'API_URL', url: 'http://localhost:5173' }], port: 31234 },
      { explicit: [{ envVar: 'WS', url: 'ws://localhost:9 ' }], port: 31234 },
      { explicit: [], port: Number.NaN },
    ]

    for (const { explicit, port } of cases) {
      for (const link of resolveServiceLinks(explicit, port)) {
        expect(isSafeLinkUrl(link.url)).toBe(true)
      }
    }
  })
})
