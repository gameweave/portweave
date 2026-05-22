#!/usr/bin/env tsx

import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { exit } from 'node:process'
import log from 'loglevel'
import { setupLocalDynamodb } from '../src/utils/local-dynamodb.ts'
import {
  applyWorktreeEnv,
  resolveEffectiveWorktreePorts,
  seedWorktreeEnvFromDotenv,
} from '../src/utils/apply-worktree-env.ts'
import { setupLocalKinesis } from '../src/utils/local-kinesis.ts'
import {
  computePorts,
  type WorktreePorts,
} from '../src/utils/worktree-ports.ts'
import { resolveWorktreeContext } from '../src/utils/worktree-context.ts'

log.setLevel('info')

const runSpawn = (command: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      resolve(code ?? 1)
    })
    child.on('error', reject)
  })

function printStartupInfo(ports: WorktreePorts, offset: number): void {
  log.info('Starting Gameweave development environment...')
  if (offset > 0) {
    log.info(
      `  (worktree offset: ${String(offset)} — ports shifted by +${String(offset * 100)})`,
    )
  }
  log.info('')
  log.info('Services:')
  log.info(`  DynamoDB Local   → http://localhost:${String(ports.dynamodb)}`)
  log.info(
    `  DynamoDB Admin   → http://localhost:${String(ports.dynamodbAdmin)}`,
  )
  log.info(`  Kinesis Local    → http://localhost:${String(ports.kinesis)}`)
  log.info(`  Local SES        → http://localhost:${String(ports.ses)}`)
  log.info(`  API Server       → http://localhost:${String(ports.api)}`)
  log.info(`  Auth API         → http://localhost:${String(ports.authApi)}`)
  log.info(`  App (Vite)       → http://localhost:${String(ports.app)}`)
  log.info('  Logs             → .dev/logs/')
  log.info('')
}

const main = async (): Promise<void> => {
  const { namespace, offset } = resolveWorktreeContext()
  const ports = computePorts(offset)

  seedWorktreeEnvFromDotenv()
  applyWorktreeEnv(ports, namespace, offset)
  const effectivePorts = resolveEffectiveWorktreePorts(ports)

  const dynamoDbDir = '.dev/dynamodb'
  mkdirSync('.dev/logs', { recursive: true })
  mkdirSync(dynamoDbDir, { recursive: true })

  printStartupInfo(effectivePorts, offset)

  const ecosystem =
    process.env.GAMEWEAVE_PM2_ECOSYSTEM ?? 'ecosystem.config.cjs'
  const pm2Code = await runSpawn('npx', [
    'pm2',
    'start',
    ecosystem,
    '--update-env',
  ])
  if (pm2Code !== 0) {
    exit(pm2Code)
  }

  await setupLocalDynamodb()
  await setupLocalKinesis()
  await runSpawn('npx', ['pm2', 'status'])

  log.info('')
  log.info('Use these commands to manage the dev environment:')
  log.info('  npm run dev:status  → Show process status')
  log.info('  npm run dev:logs    → View logs')
  log.info('  npm run dev:stop    → Stop all services')
  log.info('')
}

main().catch((error: unknown) => {
  log.error('Dev server failed:', error)
  exit(1)
})
