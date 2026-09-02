/**
 * Exports smoke test — verifies the package.json `exports` field works for
 * real ESM consumers.
 *
 * This test builds the package (via tsconfig.build.json which emits JS),
 * packs it, installs it in a temporary consumer project, and confirms that
 * `import { ports } from 'portweave/runtime'` resolves and runs correctly.
 *
 * Cost: ~10-30s per run due to real build + pack + install + subprocess.
 * Gate via RUN_SMOKE_TESTS=1 per the spec's Open Questions §1 recommendation.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeConsumerProject, makeTmpSmokeDir } from '../exports-smoke.ts'
import { setupScopedXdg } from './_helpers.ts'

setupScopedXdg()

const execFileAsync = promisify(execFile)

const SKIP_SMOKE = process.env.RUN_SMOKE_TESTS !== '1'
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')

// Resolve the repo's real TypeScript compiler. The consumer project does not
// install `typescript`, so `npx tsc` there would fetch the unrelated `tsc`
// npm package (an ancient, broken shim) instead of the compiler. `node <tsc>
// --project <consumer tsconfig>` type-checks the consumer's installed
// portweave types with the repo's pinned compiler; the binary's location does
// not affect module resolution (that follows the compiled files' location).
const TSC_BIN = join(
  dirname(dirname(createRequire(import.meta.url).resolve('typescript'))),
  'bin',
  'tsc',
)

let consumerDir = ''

beforeAll(async () => {
  if (SKIP_SMOKE) {
    return
  }

  // 1. Use the dist/ that `pretest` already built — do NOT rebuild here.
  //
  // This used to run `tsc --build`, which rewrote dist/ *during* the test run
  // while `src/__tests__/cli.test.ts` was spawning dist/cli.js in a parallel
  // worker. The child then loaded a half-written module and died with
  // "does not provide an export named 'startPanelServer'", or `npm pack` read a
  // truncated .js.map and died with "encountered unexpected EOF". Both looked
  // like flakes; both were this race, and one of them failed a release.
  //
  // Packing what pretest built is also closer to what actually ships, since
  // `npm publish` builds via prepublishOnly and then packs that output.
  const builtEntry = join(REPO_ROOT, 'dist', 'cli.js')
  if (!existsSync(builtEntry)) {
    throw new Error(
      `smoke test needs a built dist/ (missing ${builtEntry}). ` +
        'It normally comes from `pretest`; run `npm run build` first if you ' +
        'invoked this file directly.',
    )
  }

  // 2. Pack the package
  const packDir = await makeTmpSmokeDir('pack')
  await execFileAsync('npm', ['pack', '--pack-destination', packDir], {
    cwd: REPO_ROOT,
  })
  const packFiles = (await readdir(packDir)).filter((f) => f.endsWith('.tgz'))
  if (packFiles.length === 0) {
    throw new Error('npm pack produced no .tgz file')
  }
  const packFile = join(packDir, packFiles[0])

  // 3. Set up the consumer project, pinning @types/node to the repo's version
  // so the published-types check uses the Node types the package was built with.
  const repoPkg = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { devDependencies?: Record<string, string> }
  const typesNodeSpec = repoPkg.devDependencies?.['@types/node'] ?? 'latest'
  consumerDir = await makeTmpSmokeDir('consumer')
  await makeConsumerProject(consumerDir, packFile, typesNodeSpec)
}, 120_000)

afterAll(async () => {
  if (consumerDir) {
    await rm(consumerDir, { force: true, recursive: true })
  }
})

function assertOkWithApi(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) {
    return
  }
  if (!('ok' in parsed)) {
    return
  }
  if (!('value' in parsed)) {
    return
  }
  const value = (parsed as { value: Record<string, unknown> }).value
  expect(typeof value.api).toBe('number')
}

// The macOS CI runner intermittently fails the first ESM import of the
// freshly-installed package with a spurious "missing export" (a different
// symbol each run — a partial install/read artifact, not a real export gap).
// Retry once: a re-read resolves it, while a genuine break fails twice.
async function importConsumer(script: string, cwd: string): Promise<string> {
  try {
    const first = await execFileAsync(process.execPath, [script], { cwd })
    return first.stdout
  } catch {
    // pw-allow-swallow: absorb the transient first-import flake; a real failure
    // throws again on the retry below and fails the test.
    const retry = await execFileAsync(process.execPath, [script], { cwd })
    return retry.stdout
  }
}

describe.skipIf(SKIP_SMOKE)(
  'exports smoke test (set RUN_SMOKE_TESTS=1 to run)',
  () => {
    it('ESM consumer can import { ports } from portweave/runtime and get a result', async () => {
      const consumerScript = join(consumerDir, 'consumer.mjs')
      await writeFile(
        consumerScript,
        [
          `import { ports } from 'portweave/runtime'`,
          `const result = await ports()`,
          `process.stdout.write(JSON.stringify(result))`,
        ].join('\n'),
      )
      const stdout = await importConsumer(consumerScript, consumerDir)
      const parsed: unknown = JSON.parse(stdout)
      expect(parsed).toMatchObject({ ok: true })
      assertOkWithApi(parsed)
    })

    it('TypeScript consumer can tsc --noEmit against the published types', async () => {
      const consumerTs = join(consumerDir, 'consumer.ts')
      await writeFile(
        consumerTs,
        [
          `import { ports, env, allocation, namespace, type PortsOptions } from 'portweave/runtime'`,
          `const opts: PortsOptions = {}`,
          `const r1 = await ports(opts)`,
          `const r2 = await env(opts)`,
          `const r3 = await allocation(opts)`,
          `const r4 = await namespace(opts)`,
          `console.log(r1, r2, r3, r4)`,
        ].join('\n'),
      )
      const consumerTsconfig = join(consumerDir, 'tsconfig.json')
      await writeFile(
        consumerTsconfig,
        JSON.stringify({
          compilerOptions: {
            module: 'Node16',
            moduleResolution: 'Node16',
            noEmit: true,
            strict: true,
            target: 'ES2024',
            types: ['node'],
          },
          include: ['consumer.ts'],
        }),
      )
      // Should not throw — if tsc fails the test fails. Use the repo's real
      // compiler (see TSC_BIN) rather than `npx tsc`, which would install the
      // wrong package in the consumer dir.
      await execFileAsync(
        process.execPath,
        [TSC_BIN, '--noEmit', '--project', consumerTsconfig],
        { cwd: consumerDir },
      )
    })
  },
)
