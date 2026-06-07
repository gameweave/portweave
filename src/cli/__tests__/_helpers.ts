import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { expect } from 'vitest'
import type { PortweaveError } from '../../errors.ts'
import type { RegistryEntry } from '../../registry/types.ts'
import { withRegistry } from '../../registry/storage.ts'
import type { AllocationKey } from '../../worktree/key.ts'
import type { Result } from '../../result.ts'
import type { RunIo } from '../run.ts'

export interface IoWithCapture extends RunIo {
  stderrOutput: string[]
}

export function makeCapturingIo(cwd: string): IoWithCapture {
  const stderrOutput: string[] = []
  const stderrStream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      stderrOutput.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk)
      cb()
    },
  })
  return {
    cwd: () => cwd,
    env: process.env,
    stderr: stderrStream,
    stderrOutput,
    stdout: process.stdout,
  }
}

export function makeSilentIo(cwd: string): RunIo {
  return {
    cwd: () => cwd,
    env: process.env,
    stderr: new Writable({
      write(_c, _e, cb) {
        cb()
      },
    }),
    stdout: process.stdout,
  }
}

export async function makeTmpGitRepo(config?: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'portweave-test-'))
  execFileSync('git', ['init'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  if (config !== undefined) {
    await writeFile(join(dir, 'portweave.config.json'), JSON.stringify(config))
  }
  return dir
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { force: true, recursive: true })
}

// A capturing Writable plus an accessor for everything written to it. Shared by
// the show and panel command tests, which both assert on stderr/stdout content.
export function makeWritable(): { stream: Writable; value: () => string } {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      cb()
    },
  })
  return {
    stream,
    value: () => Buffer.concat(chunks).toString('utf8'),
  }
}

// ---------------------------------------------------------------------------
// Registry seeding — shared by the show and prune command tests, which both
// drive runShow/runPrune against an XDG-scoped registry.
// ---------------------------------------------------------------------------

// Builds a RegistryEntry whose namespace tracks the key. Ports/lastUsedAt
// default to the shared fixture both test suites assert against.
export function makeEntry(
  key: AllocationKey,
  ports: Record<string, number> = { api: 3104, ws: 3105 },
  lastUsedAt = '2026-01-01T00:00:00.000Z',
): RegistryEntry {
  return { key, lastUsedAt, namespace: key.namespace, ports }
}

export async function seedEntry(
  env: NodeJS.ProcessEnv,
  entry: RegistryEntry,
): Promise<void> {
  await withRegistry((handle) => {
    handle.upsert(entry)
  }, env)
}

// Reads the live registry through withRegistry (post-prune state). The show
// suite reads the on-disk file directly to assert serialized shape; prune only
// needs the surviving entries, so it goes through the handle.
export async function readEntries(
  env: NodeJS.ProcessEnv,
): Promise<readonly RegistryEntry[]> {
  const result = await withRegistry((handle) => handle.entries.slice(), env)
  if (!result.ok) {
    throw new Error(`test read failed: ${result.error.message}`)
  }
  return result.value
}

// ---------------------------------------------------------------------------
// Captured-run helpers — collapse the "two writables, run, assert ok/exitCode"
// boilerplate the show and prune suites repeat per case.
// ---------------------------------------------------------------------------

export interface CapturedStreams {
  stderr: NodeJS.WritableStream
  stdout: NodeJS.WritableStream
}

export interface CommandOutcome {
  readonly exitCode: number
}

export interface RunCapture<T> {
  out: { stream: Writable; value: () => string }
  result: Result<T, PortweaveError>
  serr: { stream: Writable; value: () => string }
}

// Creates a fresh stdout/stderr pair, invokes the command runner with them
// wired in, and hands back both streams plus the result.
export async function runCapture<T extends CommandOutcome>(
  run: (streams: CapturedStreams) => Promise<Result<T, PortweaveError>>,
): Promise<RunCapture<T>> {
  const out = makeWritable()
  const serr = makeWritable()
  const result = await run({ stderr: serr.stream, stdout: out.stream })
  return { out, result, serr }
}

// Asserts the command resolved ok and exited with the expected code.
export function expectExitCode<T extends CommandOutcome>(
  result: Result<T, PortweaveError>,
  exitCode: number,
): void {
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value.exitCode).toBe(exitCode)
  }
}
