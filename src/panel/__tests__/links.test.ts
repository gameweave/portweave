import { describe, expect, it } from 'vitest'
import { isSafeLinkUrl } from '../links.ts'

describe('isSafeLinkUrl', () => {
  it('allows http, https, ws, and wss URLs', () => {
    expect(isSafeLinkUrl('http://localhost:3000')).toBe(true)
    expect(isSafeLinkUrl('https://example.com/path')).toBe(true)
    expect(isSafeLinkUrl('ws://localhost:3001')).toBe(true)
    expect(isSafeLinkUrl('wss://example.com/socket')).toBe(true)
  })

  it('rejects script-execution schemes (XSS vectors)', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('data:text/html,<script>')).toBe(false)
  })

  it('rejects other non-browser schemes', () => {
    expect(isSafeLinkUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeLinkUrl('postgres://localhost:5432/app')).toBe(false)
  })

  it('rejects unparseable or schemeless values', () => {
    expect(isSafeLinkUrl('not a url')).toBe(false)
    expect(isSafeLinkUrl('')).toBe(false)
    expect(isSafeLinkUrl('//example.com')).toBe(false)
    expect(isSafeLinkUrl('localhost:3000')).toBe(false)
  })
})
