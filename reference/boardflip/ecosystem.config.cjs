const path = require('path')
const { config: loadEnv } = require('dotenv')

const logsDir = path.resolve(__dirname, '.dev', 'logs')

const rootEnv = loadEnv({
  path: path.resolve(__dirname, '.env'),
})

const fileEnv = rootEnv.parsed ?? {}

// Derive port values: process.env (injected by dev/e2e runner for worktree offsets) wins
// over .env, which wins over hardcoded defaults. Single-worktree usage is unchanged.
const e = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback

const DYNAMODB_PORT = e('DYNAMODB_PORT', '8000')
const DYNAMODB_ENDPOINT = e(
  'DYNAMODB_ENDPOINT',
  `http://localhost:${DYNAMODB_PORT}`,
)
const SES_LOCAL_PORT = e('SES_LOCAL_PORT', '8005')
const KINESIS_PORT = e('KINESIS_PORT', '4568')
// kinesis-local always opens both a plain and a TLS listener; the TLS port
// must be offset per worktree (default 4567) or two worktrees collide on it
// even when the plain port is properly offset.
const KINESIS_TLS_PORT = e('KINESIS_TLS_PORT', '4567')
const API_PORT = e('API_PORT', '3001')
const WS_PORT = e('WS_PORT', '3002')
const VITE_PORT = e('VITE_PORT', '5173')
const VITE_API_PORT = e('VITE_API_PORT', API_PORT)
const VITE_WS_PORT = e('VITE_WS_PORT', WS_PORT)
const namespace = e('GAMEWEAVE_PM2_NAMESPACE', 'main')

const dynamoDbDir = path.resolve(__dirname, '.dev', 'dynamodb')

module.exports = {
  apps: [
    // DynamoDB Local
    {
      name: `dynamodb-local-${namespace}`,
      cwd: path.resolve(__dirname),
      script: 'dynamodb-local',
      args: `-sharedDb -dbPath ${dynamoDbDir} -port ${DYNAMODB_PORT}`,
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      out_file: path.resolve(logsDir, 'dynamodb-local-out.log'),
      error_file: path.resolve(logsDir, 'dynamodb-local-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
    // Local SES (email logging for dev)
    {
      name: `local-ses-${namespace}`,
      cwd: path.resolve(__dirname),
      script: 'npx',
      args: 'tsx scripts/bin/local-ses.ts',
      env: { SES_LOCAL_PORT },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      out_file: path.resolve(logsDir, 'local-ses-out.log'),
      error_file: path.resolve(logsDir, 'local-ses-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
    // DynamoDB Admin UI
    {
      name: `dynamodb-admin-${namespace}`,
      cwd: path.resolve(__dirname),
      script: 'npx',
      args: 'dynamodb-admin',
      env: {
        DYNAMO_ENDPOINT: DYNAMODB_ENDPOINT,
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'dummy',
        AWS_SECRET_ACCESS_KEY: 'dummy',
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      out_file: path.resolve(logsDir, 'dynamodb-admin-out.log'),
      error_file: path.resolve(logsDir, 'dynamodb-admin-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
    // Kinesis Local (must run from its package dir so it can find server.json for TLS)
    {
      name: `kinesis-local-${namespace}`,
      cwd: path.resolve(__dirname, 'node_modules', 'kinesis-local'),
      script: 'node',
      args: 'main.js',
      env: {
        INITIALIZE_STREAMS:
          'gameweave-notifications-local:1,gameweave-game-moves-local:1',
        KINESIS_MOCK_PLAIN_PORT: KINESIS_PORT,
        KINESIS_MOCK_TLS_PORT: KINESIS_TLS_PORT,
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      out_file: path.resolve(logsDir, 'kinesis-local-out.log'),
      error_file: path.resolve(logsDir, 'kinesis-local-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
    // API server
    ...require(path.resolve(__dirname, 'packages/api/ecosystem.config.cjs'))
      .apps,
    // Auth API server (auth.gameweave.com in prod; localhost:3003 in dev)
    ...require(
      path.resolve(__dirname, 'packages/auth-api/ecosystem.config.cjs'),
    ).apps,
    // Vite dev server (app)
    {
      name: `gameweave-app-${namespace}`,
      script: 'npm',
      args: 'run dev --workspace=packages/app',
      cwd: path.resolve(__dirname),
      env: {
        // .env values first, then resolved VITE_PORT always wins so vite.config.ts
        // reads the correct port even if .env omits VITE_PORT
        ...fileEnv,
        API_PORT,
        VITE_API_PORT,
        VITE_PORT,
        VITE_WS_PORT,
        WS_PORT,
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      out_file: path.resolve(logsDir, 'gameweave-app-out.log'),
      error_file: path.resolve(logsDir, 'gameweave-app-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
    // Electron desktop app
    ...require(path.resolve(__dirname, 'packages/desktop/ecosystem.config.cjs'))
      .apps,
  ],
}
