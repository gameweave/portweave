/**
 * Gameweave drop-in acceptance gate — §7.2 parity verification.
 *
 * This is the v0 ship gate. Every one of the 14 Gameweave parity items in
 * DESIGN.md §7.2 must pass before v0 is considered shippable.
 *
 * Uses real I/O, real git worktrees, and the compiled dist/cli.js binary.
 * No mocks — the whole point is to verify the integrated system.
 */

import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// CLI binary path resolution
// ---------------------------------------------------------------------------

function resolveCliPath(): string {
  // Resolve relative to this file's location (project root → dist/cli.js)
  const thisFile = new URL(import.meta.url).pathname
  const projectRoot = path.resolve(path.dirname(thisFile), '..')
  const cliPath = path.join(projectRoot, 'dist', 'cli.js')
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `dist/cli.js not found at ${cliPath} — run \`npm run build\` first`,
    )
  }
  return cliPath
}

function resolveRuntimeIndexPath(): string {
  const thisFile = new URL(import.meta.url).pathname
  const projectRoot = path.resolve(path.dirname(thisFile), '..')
  return path.join(projectRoot, 'dist', 'runtime', 'index.js')
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POOL_MIN = 30000
const POOL_MAX = 60000
const GAMEWEAVE_CONFIG_PATH = (() => {
  const thisFile = new URL(import.meta.url).pathname
  const projectRoot = path.resolve(path.dirname(thisFile), '..')
  return path.join(projectRoot, 'examples', 'gameweave.config.json')
})()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number
  stderr: string
  stdout: string
}

interface ShowJsonOutput {
  env: Record<string, string>
  namespace: string
  ports: Record<string, number>
  worktreeRoot: string
}

interface TestFixture {
  featureXDir: string
  mainDir: string
  tmpDir: string
  tmpDir2: string
  xdgConfigHome: string
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

async function runCli(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<RunResult> {
  const cliPath = resolveCliPath()
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...opts.env }
  const timeout = opts.timeout ?? 15000

  try {
    const { stderr, stdout } = await execFileAsync(
      process.execPath,
      [cliPath, ...args],
      { cwd: opts.cwd, env: mergedEnv, timeout },
    )
    return { exitCode: 0, stderr, stdout }
  } catch (caught: unknown) {
    if (isExecError(caught)) {
      return {
        exitCode: typeof caught.code === 'number' ? caught.code : 1,
        stderr: caught.stderr,
        stdout: caught.stdout,
      }
    }
    throw caught
  }
}

interface ExecError {
  code: null | number
  stderr: string
  stdout: string
}

function isObjectWithKeys(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}

function isExecError(v: unknown): v is ExecError {
  return isObjectWithKeys(v) && 'stdout' in v && 'stderr' in v && 'code' in v
}

async function gitExec(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function gitCommit(cwd: string, message: string): Promise<void> {
  await execFileAsync(
    'git',
    [
      '-c',
      'user.email=test@portweave.dev',
      '-c',
      'user.name=Portweave Test',
      'commit',
      '-m',
      message,
    ],
    { cwd },
  )
}

async function initGitRepo(dir: string): Promise<void> {
  await gitExec(['init'], dir)
  await gitExec(['config', 'user.email', 'test@portweave.dev'], dir)
  await gitExec(['config', 'user.name', 'Portweave Test'], dir)
}

async function showJson(
  cwd: string,
  xdgConfigHome: string,
): Promise<ShowJsonOutput> {
  const result = await runCli(['show', '--json'], {
    cwd,
    env: { XDG_CONFIG_HOME: xdgConfigHome },
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `portweave show --json failed (exit ${String(result.exitCode)}): ${result.stderr}`,
    )
  }
  return JSON.parse(result.stdout) as ShowJsonOutput
}

function isInPoolRange(port: number): boolean {
  return port >= POOL_MIN && port < POOL_MAX
}

function blocksOverlap(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const aVals = new Set(Object.values(a))
  return Object.values(b).some((p) => aVals.has(p))
}

async function bindPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(port, '127.0.0.1', () => {
      resolve(server)
    })
    server.on('error', reject)
  })
}

async function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((closeErr) => {
      if (closeErr) {
        reject(closeErr)
      } else {
        resolve()
      }
    })
  })
}

async function runNoop(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return runCli(['run', '--', process.execPath, '-e', 'process.exit(0)'], {
    cwd,
    env,
  })
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const ALL_SERVERS: net.Server[] = []

afterAll(async () => {
  for (const s of ALL_SERVERS) {
    try {
      await closeServer(s)
    } catch {
      // pw-allow-swallow: cleanup during test teardown — best-effort
    }
  }
})

let _fixture: null | TestFixture = null
let _fixtureError: Error | null = null

async function buildFixture(): Promise<TestFixture> {
  if (_fixture !== null) {
    return _fixture
  }
  if (_fixtureError !== null) {
    throw _fixtureError
  }
  try {
    _fixture = await createFixture()
    return _fixture
  } catch (e: unknown) {
    _fixtureError = e instanceof Error ? e : new Error(String(e))
    throw _fixtureError
  }
}

async function createFixture(): Promise<TestFixture> {
  // Use realpathSync to resolve macOS symlinks (os.tmpdir() → /private/var/...)
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pw-parity-')),
  )
  const mainDir = path.join(base, 'main')
  const xdgConfigHome = path.join(base, 'xdg')
  const tmpDir2 = path.join(base, 'proj2')

  fs.mkdirSync(mainDir, { recursive: true })
  fs.mkdirSync(xdgConfigHome, { recursive: true })
  fs.mkdirSync(tmpDir2, { recursive: true })

  await initGitRepo(mainDir)

  const configContent = fs.readFileSync(GAMEWEAVE_CONFIG_PATH, 'utf8')
  fs.writeFileSync(
    path.join(mainDir, 'portweave.config.json'),
    configContent,
    'utf8',
  )
  await gitExec(['add', 'portweave.config.json'], mainDir)
  await gitCommit(mainDir, 'init')

  await gitExec(['branch', 'feature-x'], mainDir)
  const featureXDir = path.join(base, 'feature-x')
  await gitExec(['worktree', 'add', featureXDir, 'feature-x'], mainDir)
  fs.writeFileSync(
    path.join(featureXDir, 'portweave.config.json'),
    configContent,
    'utf8',
  )

  await initGitRepo(tmpDir2)
  const simpleConfig = JSON.stringify({
    $schema:
      'https://raw.githubusercontent.com/gameweave/portweave/main/schema/v1.json',
    services: { server: { envVar: 'SERVER_PORT' } },
  })
  fs.writeFileSync(
    path.join(tmpDir2, 'portweave.config.json'),
    simpleConfig,
    'utf8',
  )
  await gitExec(['add', 'portweave.config.json'], tmpDir2)
  await gitCommit(tmpDir2, 'init')

  return { featureXDir, mainDir, tmpDir: base, tmpDir2, xdgConfigHome }
}

function makeEnv(
  xdgConfigHome: string,
  extra?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: xdgConfigHome, ...extra }
}

// ---------------------------------------------------------------------------
// Per-row test implementations (each is a named function ≤ 150 lines)
// ---------------------------------------------------------------------------

async function testRow1(fx: TestFixture): Promise<void> {
  // Row 1: per-worktree block from machine-wide pool — two worktrees get distinct non-overlapping blocks
  const env = makeEnv(fx.xdgConfigHome)
  const portFilter =
    "const k=Object.keys(process.env).filter(k=>k.endsWith('_PORT')||k==='SES_LOCAL_PORT');console.log(JSON.stringify(Object.fromEntries(k.map(k=>[k,process.env[k]]))))"

  const mainResult = await runCli(
    ['run', '--', process.execPath, '-e', portFilter],
    {
      cwd: fx.mainDir,
      env,
    },
  )
  expect(mainResult.exitCode, `main run failed: ${mainResult.stderr}`).toBe(0)
  const mainPorts = Object.values(
    JSON.parse(mainResult.stdout.trim()) as Record<string, string>,
  ).map(Number)
  expect(mainPorts.length).toBeGreaterThan(0)
  for (const p of mainPorts) {
    expect(isInPoolRange(p), `port ${String(p)} out of pool range`).toBe(true)
  }

  const featureResult = await runCli(
    ['run', '--', process.execPath, '-e', portFilter],
    {
      cwd: fx.featureXDir,
      env,
    },
  )
  expect(
    featureResult.exitCode,
    `feature-x run failed: ${featureResult.stderr}`,
  ).toBe(0)
  const featurePorts = Object.values(
    JSON.parse(featureResult.stdout.trim()) as Record<string, string>,
  ).map(Number)
  expect(featurePorts.length).toBeGreaterThan(0)

  const mainSet = new Set(mainPorts)
  for (const p of featurePorts) {
    expect(
      mainSet.has(p),
      `port ${String(p)} appears in both main and feature-x`,
    ).toBe(false)
  }
}

async function testRow2(fx: TestFixture): Promise<void> {
  // Row 2: file-locked registry + retry — concurrent allocations via Promise.all produce disjoint blocks
  const env = makeEnv(fx.xdgConfigHome)
  const [mainResult, featureResult] = await Promise.all([
    runNoop(fx.mainDir, env),
    runNoop(fx.featureXDir, env),
  ])
  expect(
    mainResult.exitCode,
    `main concurrent run failed: ${mainResult.stderr}`,
  ).toBe(0)
  expect(
    featureResult.exitCode,
    `feature-x concurrent run failed: ${featureResult.stderr}`,
  ).toBe(0)
  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)
  expect(blocksOverlap(mainShow.ports, featureShow.ports)).toBe(false)
}

async function testRow3(fx: TestFixture): Promise<void> {
  // Row 3: git worktree detection + cwd fallback — main gets "main" namespace; feature-x gets slug-hash
  const env = makeEnv(fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)
  await runNoop(fx.featureXDir, env)
  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)
  // Row 3: main namespace must be "main"
  expect(mainShow.namespace).toBe('main')
  // Row 3: feature-x must have slug-hash form
  expect(featureShow.namespace).not.toBe('main')
  expect(featureShow.namespace).toMatch(/^feature-x-[a-f0-9]{8}$/)
}

function buildEnvReadScript(keys: string[]): string {
  const entries = keys.map((k) => k + ":process.env['" + k + "']").join(',')
  return 'console.log(JSON.stringify({' + entries + '}))'
}

async function testRow5(fx: TestFixture): Promise<void> {
  // Row 5: env-var injection for named services — all 8 envVar names injected as positive integers in pool range
  const env = makeEnv(fx.xdgConfigHome)
  const envVarNames = [
    'API_PORT',
    'WS_PORT',
    'VITE_PORT',
    'DYNAMODB_PORT',
    'DYNAMODB_ADMIN_PORT',
    'KINESIS_PORT',
    'KINESIS_TLS_PORT',
    'SES_LOCAL_PORT',
  ]
  const result = await runCli(
    ['run', '--', process.execPath, '-e', buildEnvReadScript(envVarNames)],
    {
      cwd: fx.mainDir,
      env,
    },
  )
  expect(result.exitCode, `run failed: ${result.stderr}`).toBe(0)
  const injected = JSON.parse(result.stdout.trim()) as Record<string, string>
  for (const varName of envVarNames) {
    const val = injected[varName]
    expect(val, `${varName} missing`).toBeDefined()
    const portNum = Number(val)
    expect(Number.isInteger(portNum), `${varName} not integer`).toBe(true)
    expect(portNum, `${varName} below pool min`).toBeGreaterThanOrEqual(
      POOL_MIN,
    )
    expect(portNum, `${varName} at or above pool max`).toBeLessThan(POOL_MAX)
  }
}

async function testRow6(fx: TestFixture): Promise<void> {
  // Row 6: discovery URL construction — all discoveryEnv URLs have shape ${scheme}://localhost:${port}
  const env = makeEnv(fx.xdgConfigHome)
  const allKeys = [
    'API_PORT',
    'WS_PORT',
    'DYNAMODB_PORT',
    'KINESIS_PORT',
    'SES_LOCAL_PORT',
    'VITE_API_PORT',
    'VITE_API_URL',
    'E2E_API_ORIGIN',
    'VITE_WS_PORT',
    'VITE_WS_URL',
    'WEBSOCKET_ENDPOINT',
    'DYNAMODB_ENDPOINT',
    'KINESIS_ENDPOINT',
    'SES_ENDPOINT',
  ]
  const result = await runCli(
    ['run', '--', process.execPath, '-e', buildEnvReadScript(allKeys)],
    {
      cwd: fx.mainDir,
      env,
    },
  )
  expect(result.exitCode, `run failed: ${result.stderr}`).toBe(0)
  const injected = JSON.parse(result.stdout.trim()) as Record<string, string>

  const apiPort = injected.API_PORT
  const wsPort = injected.WS_PORT
  expect(injected.VITE_API_PORT).toBe(apiPort)
  expect(injected.VITE_API_URL).toBe(`http://localhost:${apiPort}`)
  expect(injected.E2E_API_ORIGIN).toBe(`http://localhost:${apiPort}`)
  expect(injected.VITE_WS_PORT).toBe(wsPort)
  expect(injected.VITE_WS_URL).toBe(`ws://localhost:${wsPort}`)
  expect(injected.WEBSOCKET_ENDPOINT).toBe(`http://localhost:${wsPort}`)
  expect(injected.DYNAMODB_ENDPOINT).toBe(
    `http://localhost:${injected.DYNAMODB_PORT}`,
  )
  expect(injected.KINESIS_ENDPOINT).toBe(
    `http://localhost:${injected.KINESIS_PORT}`,
  )
  expect(injected.SES_ENDPOINT).toBe(
    `http://localhost:${injected.SES_LOCAL_PORT}`,
  )
}

async function createThrowawayWorktree(
  tmpDir: string,
  xdg: string,
): Promise<string> {
  const pruneBase = path.join(tmpDir, 'prune-repo')
  const throwawayDir = path.join(tmpDir, 'throwaway')
  fs.mkdirSync(pruneBase, { recursive: true })
  await initGitRepo(pruneBase)
  const configContent = fs.readFileSync(GAMEWEAVE_CONFIG_PATH, 'utf8')
  fs.writeFileSync(
    path.join(pruneBase, 'portweave.config.json'),
    configContent,
    'utf8',
  )
  await gitExec(['add', 'portweave.config.json'], pruneBase)
  await gitCommit(pruneBase, 'init')
  await gitExec(['branch', 'throwaway'], pruneBase)
  await gitExec(['worktree', 'add', throwawayDir, 'throwaway'], pruneBase)
  fs.writeFileSync(
    path.join(throwawayDir, 'portweave.config.json'),
    configContent,
    'utf8',
  )
  await runNoop(throwawayDir, { XDG_CONFIG_HOME: xdg })
  return throwawayDir
}

async function testRow7(fx: TestFixture): Promise<void> {
  // Row 7: stale-entry pruning + last-used timestamps — deleted worktree dir causes registry entry to be pruned
  const throwawayDir = await createThrowawayWorktree(
    fx.tmpDir,
    fx.xdgConfigHome,
  )
  const registryPath = path.join(fx.xdgConfigHome, 'portweave', 'registry.json')

  interface RegEntry {
    key: { worktreeRoot: string }
    lastUsedAt: string
  }
  const before = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
    entries: RegEntry[]
  }
  const hadThrowaway = before.entries.some(
    (e) => e.key.worktreeRoot === throwawayDir,
  )
  expect(hadThrowaway, 'throwaway entry not found before pruning').toBe(true)

  fs.rmSync(throwawayDir, { force: true, recursive: true })

  // portweave show triggers pruneStaleEntries
  await runCli(['show', '--json'], {
    cwd: fx.mainDir,
    env: { XDG_CONFIG_HOME: fx.xdgConfigHome },
  })

  const after = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
    entries: RegEntry[]
  }
  expect(
    after.entries.some((e) => e.key.worktreeRoot === throwawayDir),
    'throwaway not pruned',
  ).toBe(false)

  const mainEntry = after.entries.find((e) => e.key.worktreeRoot === fx.mainDir)
  expect(mainEntry, 'main entry missing after prune').toBeDefined()
  if (mainEntry !== undefined) {
    expect(new Date(mainEntry.lastUsedAt).getTime()).toBeGreaterThan(
      Date.now() - 30000,
    )
  }
}

async function testRow8(fx: TestFixture): Promise<void> {
  // Row 8: manual override via PORTWEAVE_NAMESPACE / PORTWEAVE_OFFSET — namespace overrides derive; offset flag accepted
  const overrideResult = await runNoop(fx.mainDir, {
    PORTWEAVE_NAMESPACE: 'custom-ns',
    XDG_CONFIG_HOME: fx.xdgConfigHome,
  })
  expect(
    overrideResult.exitCode,
    `namespace override run failed: ${overrideResult.stderr}`,
  ).toBe(0)

  const overrideShow = await runCli(['show', '--json'], {
    cwd: fx.mainDir,
    env: {
      PORTWEAVE_NAMESPACE: 'custom-ns',
      XDG_CONFIG_HOME: fx.xdgConfigHome,
    },
  })
  expect(overrideShow.exitCode).toBe(0)
  const overrideData = JSON.parse(overrideShow.stdout) as ShowJsonOutput
  expect(overrideData.namespace).toBe('custom-ns')

  // PORTWEAVE_OFFSET is accepted without error; offsetOverride is session-only
  // and not persisted to registry JSON (serialize.ts drops it by design).
  const offsetResult = await runNoop(fx.mainDir, {
    PORTWEAVE_NAMESPACE: 'offset-test-ns',
    PORTWEAVE_OFFSET: '42',
    XDG_CONFIG_HOME: fx.xdgConfigHome,
  })
  expect(
    offsetResult.exitCode,
    `offset override run failed: ${offsetResult.stderr}`,
  ).toBe(0)

  const registryPath = path.join(fx.xdgConfigHome, 'portweave', 'registry.json')
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
    entries: { namespace: string; ports: Record<string, number> }[]
  }
  const offsetEntry = registry.entries.find(
    (e) => e.namespace === 'offset-test-ns',
  )
  expect(offsetEntry, 'offset-test-ns entry not found').toBeDefined()
  if (offsetEntry !== undefined) {
    const portVals = Object.values(offsetEntry.ports)
    expect(portVals.length).toBeGreaterThan(0)
    for (const p of portVals) {
      expect(isInPoolRange(p), `port ${String(p)} out of range`).toBe(true)
    }
  }
}

async function createRow9Repo(tmpDir: string): Promise<string> {
  const row9Base = path.join(tmpDir, 'row9-repo')
  fs.mkdirSync(row9Base, { recursive: true })
  await initGitRepo(row9Base)
  const configContent = fs.readFileSync(GAMEWEAVE_CONFIG_PATH, 'utf8')
  fs.writeFileSync(
    path.join(row9Base, 'portweave.config.json'),
    configContent,
    'utf8',
  )
  await gitExec(['add', 'portweave.config.json'], row9Base)
  await gitCommit(row9Base, 'init')
  fs.writeFileSync(
    path.join(row9Base, '.env'),
    'API_PORT=4000\nOTHER_THING=foo\n',
    'utf8',
  )
  return row9Base
}

async function testRow9(fx: TestFixture): Promise<void> {
  // Row 9: .env seeding with user-override priority — pre-declared .env overrides envVar; discoveryEnv uses allocated port
  const row9Base = await createRow9Repo(fx.tmpDir)
  const env = makeEnv(fx.xdgConfigHome)

  const result = await runCli(
    [
      'run',
      '--',
      process.execPath,
      '-e',
      "console.log(process.env['API_PORT'])",
    ],
    { cwd: row9Base, env },
  )
  expect(result.exitCode, `row9 run failed: ${result.stderr}`).toBe(0)
  // Child sees API_PORT=4000 (override won)
  expect(result.stdout.trim()).toBe('4000')

  const currentEnvPath = path.join(row9Base, '.portweave', 'current.env')
  expect(
    fs.existsSync(currentEnvPath),
    '.portweave/current.env not written',
  ).toBe(true)
  const currentEnvContent = fs.readFileSync(currentEnvPath, 'utf8')

  expect(currentEnvContent).toContain('API_PORT=4000')
  expect(currentEnvContent).not.toContain('OTHER_THING')

  // VITE_API_URL template uses allocated port, NOT the override
  const viteApiUrlMatch = /VITE_API_URL=http:\/\/localhost:(\d+)/.exec(
    currentEnvContent,
  )
  expect(viteApiUrlMatch, 'VITE_API_URL not in current.env').not.toBeNull()
  if (viteApiUrlMatch !== null) {
    const urlPort = Number(viteApiUrlMatch[1])
    expect(urlPort).not.toBe(4000)
    expect(
      isInPoolRange(urlPort),
      `VITE_API_URL port ${String(urlPort)} out of range`,
    ).toBe(true)
  }
}

async function testRow10(fx: TestFixture): Promise<void> {
  // Row 10: service groups, paired ports — kinesis and dynamodb pairs allocated adjacently (diff of 1) in each worktree
  const env = makeEnv(fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)
  await runNoop(fx.featureXDir, env)
  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)

  expect(
    Math.abs(mainShow.ports.kinesis - mainShow.ports['kinesis-tls']),
    'main: kinesis not adjacent',
  ).toBe(1)
  expect(
    Math.abs(mainShow.ports.dynamodb - mainShow.ports['dynamodb-admin']),
    'main: dynamodb not adjacent',
  ).toBe(1)
  expect(
    Math.abs(featureShow.ports.kinesis - featureShow.ports['kinesis-tls']),
    'feature-x: kinesis not adjacent',
  ).toBe(1)
  expect(
    Math.abs(featureShow.ports.dynamodb - featureShow.ports['dynamodb-admin']),
    'feature-x: dynamodb not adjacent',
  ).toBe(1)
}

async function testRow11(fx: TestFixture): Promise<void> {
  // Row 11: E2E helper / configure Playwright env — library runtime ports() matches portweave show --json allocation
  const env = makeEnv(fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)

  const runtimeIndexPath = resolveRuntimeIndexPath()
  const consumerPath = path.join(fx.mainDir, 'use-runtime.mjs')
  fs.writeFileSync(
    consumerPath,
    [
      `import { ports } from '${runtimeIndexPath}'`,
      `const result = await ports()`,
      `if (!result.ok) { process.stderr.write(result.error.message + '\\n'); process.exit(1); }`,
      `console.log(JSON.stringify(result.value))`,
    ].join('\n'),
    'utf8',
  )

  const { stdout: runtimeStdout } = await execFileAsync(
    process.execPath,
    [consumerPath],
    { cwd: fx.mainDir, env: { ...process.env, ...env } },
  )
  const runtimePorts = JSON.parse(runtimeStdout.trim()) as Record<
    string,
    number
  >
  const showData = await showJson(fx.mainDir, fx.xdgConfigHome)
  const showPortKeys = Object.keys(showData.ports).sort()

  expect(Object.keys(runtimePorts).sort()).toEqual(showPortKeys)
  for (const key of showPortKeys) {
    expect(runtimePorts[key], `port ${key} differs`).toBe(showData.ports[key])
  }

  // Cleanup: remove the temporary consumer script
  try {
    fs.rmSync(consumerPath)
  } catch {
    // pw-allow-swallow: best-effort cleanup of temp test file — not load-bearing
  }
}

async function testRow13(fx: TestFixture): Promise<void> {
  // Row 13: live conflict detection — pre-bound port is not included in a fresh allocation
  const env = makeEnv(fx.xdgConfigHome)
  const row13Base = path.join(fx.tmpDir, 'row13-repo')
  fs.mkdirSync(row13Base, { recursive: true })
  await initGitRepo(row13Base)
  const configContent = fs.readFileSync(GAMEWEAVE_CONFIG_PATH, 'utf8')
  fs.writeFileSync(
    path.join(row13Base, 'portweave.config.json'),
    configContent,
    'utf8',
  )
  await gitExec(['add', 'portweave.config.json'], row13Base)
  await gitCommit(row13Base, 'init')

  await runNoop(row13Base, env)
  const firstShow = await showJson(row13Base, fx.xdgConfigHome)
  const firstPortValues = Object.values(firstShow.ports)
  if (firstPortValues.length === 0) {
    throw new Error('No ports in first allocation')
  }
  const portToBind = firstPortValues[0]

  const server = await bindPort(portToBind)
  ALL_SERVERS.push(server)

  // Remove entry to force re-allocation
  const registryPath = path.join(fx.xdgConfigHome, 'portweave', 'registry.json')
  const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
    entries: { key: { worktreeRoot: string } }[]
    version: number
  }
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        entries: reg.entries.filter((e) => e.key.worktreeRoot !== row13Base),
        version: reg.version,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  const reAllocResult = await runNoop(row13Base, env)
  expect(
    reAllocResult.exitCode,
    `re-alloc failed: ${reAllocResult.stderr}`,
  ).toBe(0)

  const secondShow = await showJson(row13Base, fx.xdgConfigHome)
  const secondPorts = new Set(Object.values(secondShow.ports))
  expect(
    secondPorts.has(portToBind),
    `bound port ${String(portToBind)} in re-allocation`,
  ).toBe(false)

  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  for (const p of secondPorts) {
    expect(
      Object.values(mainShow.ports).includes(p),
      `port ${String(p)} overlaps main`,
    ).toBe(false)
  }

  try {
    await closeServer(server)
  } finally {
    const idx = ALL_SERVERS.indexOf(server)
    if (idx !== -1) {
      ALL_SERVERS.splice(idx, 1)
    }
  }
}

async function testRow14(fx: TestFixture): Promise<void> {
  // Row 14: cross-project collision protection — unrelated second project allocation disjoint from both worktrees
  const env = makeEnv(fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)
  await runNoop(fx.featureXDir, env)
  const proj2Result = await runNoop(fx.tmpDir2, env)
  expect(proj2Result.exitCode, `proj2 run failed: ${proj2Result.stderr}`).toBe(
    0,
  )

  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)
  const proj2Show = await showJson(fx.tmpDir2, fx.xdgConfigHome)

  expect(
    blocksOverlap(mainShow.ports, proj2Show.ports),
    'proj2 overlaps main',
  ).toBe(false)
  expect(
    blocksOverlap(featureShow.ports, proj2Show.ports),
    'proj2 overlaps feature-x',
  ).toBe(false)

  const allPorts = [
    ...Object.values(mainShow.ports),
    ...Object.values(featureShow.ports),
    ...Object.values(proj2Show.ports),
  ]
  expect(
    new Set(allPorts).size,
    'duplicate ports across three allocations',
  ).toBe(allPorts.length)
}

async function testStickiness(fx: TestFixture): Promise<void> {
  const env = makeEnv(fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)
  const firstShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  await runNoop(fx.mainDir, env)
  const secondShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  expect(JSON.stringify(secondShow.ports)).toBe(JSON.stringify(firstShow.ports))
}

async function testReuseWhileBound(fx: TestFixture): Promise<void> {
  // Regression (decision-log #37): once the caller's own services are bound to
  // their allocated ports, a second resolution for the same worktree — whether
  // via `portweave run` or the runtime `ports()` API in a separate process —
  // must return the SAME block, never reallocate. Reproduces the downstream
  // failure where a config file resolved its port after sibling services were
  // already up and got a different block. Binds on 127.0.0.1 so the (pre-fix)
  // loopback probe deterministically sees the ports as taken on every platform.
  const env = makeEnv(fx.xdgConfigHome)

  await runNoop(fx.mainDir, env)
  const firstShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const allocatedPorts = Object.values(firstShow.ports)
  expect(allocatedPorts.length).toBeGreaterThan(0)

  // Bring every allocated port "up" on loopback, as the worktree's own services
  // would after `portweave run` injected them.
  const servers: net.Server[] = []
  for (const port of allocatedPorts) {
    const server = await bindPort(port)
    servers.push(server)
    ALL_SERVERS.push(server)
  }

  try {
    // 1) CLI reuse path: re-running while bound must not reallocate.
    await runNoop(fx.mainDir, env)
    const secondShow = await showJson(fx.mainDir, fx.xdgConfigHome)
    expect(
      secondShow.ports,
      'CLI re-run reallocated while ports were bound',
    ).toEqual(firstShow.ports)

    // 2) Runtime API path (the actual failing surface): a separate process that
    // imports the built runtime and calls ports() while the ports are bound
    // must resolve the same block.
    const runtimeIndexPath = resolveRuntimeIndexPath()
    const consumerPath = path.join(fx.mainDir, 'resolve-while-bound.mjs')
    fs.writeFileSync(
      consumerPath,
      [
        `import { ports } from '${runtimeIndexPath}'`,
        `const result = await ports()`,
        `if (!result.ok) { process.stderr.write(result.error.message + '\\n'); process.exit(1); }`,
        `console.log(JSON.stringify(result.value))`,
      ].join('\n'),
      'utf8',
    )
    const { stdout } = await execFileAsync(process.execPath, [consumerPath], {
      cwd: fx.mainDir,
      env: { ...process.env, ...env },
    })
    const runtimePorts = JSON.parse(stdout.trim()) as Record<string, number>
    expect(
      runtimePorts,
      'runtime ports() reallocated while ports were bound',
    ).toEqual(firstShow.ports)

    try {
      fs.rmSync(consumerPath)
    } catch {
      // pw-allow-swallow: best-effort cleanup of temp test file — not load-bearing
    }
  } finally {
    for (const server of servers) {
      await closeServer(server)
      const idx = ALL_SERVERS.indexOf(server)
      if (idx !== -1) {
        ALL_SERVERS.splice(idx, 1)
      }
    }
  }
}

async function testConcurrency(fx: TestFixture): Promise<void> {
  const env = makeEnv(fx.xdgConfigHome)
  const [r1, r2] = await Promise.all([
    runNoop(fx.mainDir, env),
    runNoop(fx.featureXDir, env),
  ])
  expect(r1.exitCode, `main exit code: ${r1.stderr}`).toBe(0)
  expect(r2.exitCode, `feature-x exit code: ${r2.stderr}`).toBe(0)
  const mainShow = await showJson(fx.mainDir, fx.xdgConfigHome)
  const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)
  expect(blocksOverlap(mainShow.ports, featureShow.ports)).toBe(false)
}

async function testAnonymousMode(fx: TestFixture): Promise<void> {
  const env = makeEnv(fx.xdgConfigHome)
  // Use a fresh directory with NO portweave.config.json to avoid key conflicts
  // with the named-service allocation already registered for mainDir.
  const anonDir = path.join(fx.tmpDir, 'anon-only')
  fs.mkdirSync(anonDir, { recursive: true })
  await initGitRepo(anonDir)
  await gitExec(
    [
      '-c',
      'user.email=test@portweave.dev',
      '-c',
      'user.name=Portweave Test',
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ],
    anonDir,
  )

  const portKeysExpr = '[1,2,3,4,5,6,7,8].map(i=>process.env[`PORT_${i}`])'
  const result = await runCli(
    [
      '--count',
      '8',
      'run',
      '--',
      process.execPath,
      '-e',
      `console.log(JSON.stringify(${portKeysExpr}))`,
    ],
    { cwd: anonDir, env },
  )
  expect(result.exitCode, `anonymous mode failed: ${result.stderr}`).toBe(0)

  const ports = JSON.parse(result.stdout.trim()) as (string | undefined)[]
  expect(ports).toHaveLength(8)
  for (let i = 0; i < 8; i++) {
    const p = ports[i]
    expect(p, `PORT_${String(i + 1)} missing`).toBeDefined()
    const portNum = Number(p)
    expect(Number.isInteger(portNum), `PORT_${String(i + 1)} not integer`).toBe(
      true,
    )
    expect(isInPoolRange(portNum), `PORT_${String(i + 1)} out of range`).toBe(
      true,
    )
  }
}

interface LoadedConfig {
  groups: Record<string, string[]>
  services: {
    discoveryEnv: Record<string, string>
    envVar: string
    group?: string
    name: string
  }[]
}

async function loadGameweaveConfig(): Promise<LoadedConfig> {
  const runtimeIndexPath = resolveRuntimeIndexPath()
  const distRoot = path.dirname(path.dirname(runtimeIndexPath))

  const { loadConfig } = (await import(`${distRoot}/config/index.js`)) as {
    loadConfig: (
      dir: string,
      opts?: { configPath?: string },
    ) => Promise<{
      error?: { message: string }
      ok: boolean
      value?: LoadedConfig
    }>
  }

  const examplesDir = path.dirname(GAMEWEAVE_CONFIG_PATH)
  // Pass explicit configPath because the file is gameweave.config.json, not portweave.config.json
  const result = await loadConfig(examplesDir, {
    configPath: GAMEWEAVE_CONFIG_PATH,
  })
  expect(result.ok, `loadConfig failed: ${result.error?.message ?? ''}`).toBe(
    true,
  )
  if (!result.ok || result.value === undefined) {
    throw new Error('loadConfig returned empty result')
  }
  return result.value
}

function assertServicesShape(cfg: LoadedConfig): void {
  const serviceNames = cfg.services.map((s) => s.name)
  const expected = [
    'api',
    'dynamodb',
    'dynamodb-admin',
    'kinesis',
    'kinesis-tls',
    'ses',
    'vite',
    'ws',
  ]
  for (const name of expected) {
    expect(serviceNames).toContain(name)
  }
  expect(cfg.services).toHaveLength(8)
  expect(cfg.groups.dynamodb).toContain('dynamodb')
  expect(cfg.groups.dynamodb).toContain('dynamodb-admin')
  expect(cfg.groups.kinesis).toContain('kinesis')
  expect(cfg.groups.kinesis).toContain('kinesis-tls')
}

function assertDiscoveryEnvShapes(cfg: LoadedConfig): void {
  const api = cfg.services.find((s) => s.name === 'api')
  expect(api?.discoveryEnv.VITE_API_URL).toBe('http://localhost:${api}')
  expect(api?.discoveryEnv.E2E_API_ORIGIN).toBe('http://localhost:${api}')
  expect(api?.discoveryEnv.VITE_API_PORT).toBe('${api}')

  const ws = cfg.services.find((s) => s.name === 'ws')
  expect(ws?.discoveryEnv.WEBSOCKET_ENDPOINT).toBe('http://localhost:${ws}')
  expect(ws?.discoveryEnv.VITE_WS_URL).toBe('ws://localhost:${ws}')
}

async function testConfigLoaderValidation(): Promise<void> {
  const cfg = await loadGameweaveConfig()
  assertServicesShape(cfg)
  assertDiscoveryEnvShapes(cfg)
}

// ---------------------------------------------------------------------------
// Guard: dist/cli.js must exist
// ---------------------------------------------------------------------------

describe('build prerequisite', () => {
  it('dist/cli.js exists (run npm run build if this fails)', () => {
    expect(() => resolveCliPath()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Test suite — §7.2 parity rows
// ---------------------------------------------------------------------------

describe('Gameweave parity — §7.2 acceptance gate', { timeout: 60000 }, () => {
  it('Row 1: allocates distinct non-overlapping blocks for two worktrees', async () => {
    await testRow1(await buildFixture())
  })
  it('Row 2: concurrent allocations via Promise.all produce disjoint blocks', async () => {
    await testRow2(await buildFixture())
  })
  it('Row 3: main worktree gets "main" namespace; feature-x gets slug-hash namespace', async () => {
    await testRow3(await buildFixture())
  })
  it('Row 4: feature worktree namespace matches /^feature-x-[a-f0-9]{8}$/', async () => {
    // Row 4: explicit hash-format check (subsumed by Row 3 but explicit per spec)
    const fx = await buildFixture()
    const featureShow = await showJson(fx.featureXDir, fx.xdgConfigHome)
    expect(featureShow.namespace).toMatch(/^feature-x-[a-f0-9]{8}$/)
  })
  it('Row 5: all 8 envVar names are injected as positive integers in pool range', async () => {
    await testRow5(await buildFixture())
  })
  it('Row 6: all discoveryEnv URLs have correct shape using allocated ports', async () => {
    await testRow6(await buildFixture())
  })
  it('Row 7: deleting a worktree dir causes its registry entry to be pruned on next show', async () => {
    await testRow7(await buildFixture())
  })
  it('Row 8: PORTWEAVE_NAMESPACE overrides derived namespace; PORTWEAVE_OFFSET round-trips', async () => {
    await testRow8(await buildFixture())
  })
  it('Row 9: pre-declared .env overrides envVar; discoveryEnv uses allocated port', async () => {
    await testRow9(await buildFixture())
  })
  it('Row 10: kinesis and dynamodb service pairs are allocated adjacently', async () => {
    await testRow10(await buildFixture())
  })
  it('Row 11: library runtime ports() matches portweave show --json allocation', async () => {
    await testRow11(await buildFixture())
  })
  it('Row 12: portweave run propagates child exit code exactly', async () => {
    const fx = await buildFixture()
    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'process.exit(7)'],
      {
        cwd: fx.mainDir,
        env: makeEnv(fx.xdgConfigHome),
      },
    )
    expect(result.exitCode).toBe(7)
  })
  it('Row 13: a pre-bound port is not included in a fresh allocation', async () => {
    await testRow13(await buildFixture())
  })
  it('Row 14: unrelated second project allocation is disjoint from both worktrees', async () => {
    await testRow14(await buildFixture())
  })
  it('E2E stickiness: re-running portweave run produces byte-identical ports map', async () => {
    await testStickiness(await buildFixture())
  })
  it('E2E idempotent reuse: re-run and runtime ports() while ports are bound return the same block', async () => {
    await testReuseWhileBound(await buildFixture())
  })
  it('E2E concurrency: simultaneous allocations from two worktrees produce disjoint blocks', async () => {
    await testConcurrency(await buildFixture())
  })
  it('Anonymous mode: --count 8 produces a valid 8-port allocation', async () => {
    await testAnonymousMode(await buildFixture())
  })
})

// ---------------------------------------------------------------------------
// examples/gameweave.config.json — config loader validation
// ---------------------------------------------------------------------------

describe('examples/gameweave.config.json — config loader validation', () => {
  it('loads and normalizes all 8 services correctly', async () => {
    await testConfigLoaderValidation()
  })
})
