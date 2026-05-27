import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probeBlock, probePort } from '../probe.ts'
import { bindServerOnPort } from './_helpers.ts'

// Pick a port range unlikely to be occupied during tests
const TEST_PORT_BASE = 51200

describe('probePort', () => {
  let boundClose: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (boundClose !== undefined) {
      await boundClose()
      boundClose = undefined
    }
  })

  it('returns "free" for an unbound port', async () => {
    const result = await probePort(TEST_PORT_BASE)
    expect(result).toBe('free')
  })

  it('returns "taken" for a port currently bound by a real server', async () => {
    const server = await bindServerOnPort(TEST_PORT_BASE + 1)
    boundClose = server.close
    const result = await probePort(TEST_PORT_BASE + 1)
    expect(result).toBe('taken')
  })
})

describe('probeBlock', () => {
  let boundCleanup: (() => Promise<void>)[] = []

  beforeEach(() => {
    boundCleanup = []
  })

  afterEach(async () => {
    for (const close of boundCleanup) {
      await close()
    }
  })

  it('returns { allFree: true } when every port in the range is free', async () => {
    const result = await probeBlock(TEST_PORT_BASE + 10, 3)
    expect(result).toEqual({ allFree: true })
  })

  it('returns firstTakenPort on first conflict and short-circuits', async () => {
    const takenPort = TEST_PORT_BASE + 20
    const server = await bindServerOnPort(takenPort)
    boundCleanup.push(server.close)

    const result = await probeBlock(TEST_PORT_BASE + 20, 3)
    expect(result).toEqual({ allFree: false, firstTakenPort: takenPort })
  })

  it('returns firstTakenPort when the conflict is in the middle of the block', async () => {
    const takenPort = TEST_PORT_BASE + 31
    const server = await bindServerOnPort(takenPort)
    boundCleanup.push(server.close)

    // Block [TEST_PORT_BASE+30, TEST_PORT_BASE+32]; middle port is taken
    const result = await probeBlock(TEST_PORT_BASE + 30, 3)
    expect(result).toEqual({ allFree: false, firstTakenPort: takenPort })
  })

  it('returns firstTakenPort when the conflict is the last port in the block', async () => {
    const takenPort = TEST_PORT_BASE + 42
    const server = await bindServerOnPort(takenPort)
    boundCleanup.push(server.close)

    // Block [TEST_PORT_BASE+40, TEST_PORT_BASE+42]; last port is taken
    const result = await probeBlock(TEST_PORT_BASE + 40, 3)
    expect(result).toEqual({ allFree: false, firstTakenPort: takenPort })
  })
})
