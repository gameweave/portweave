import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
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
