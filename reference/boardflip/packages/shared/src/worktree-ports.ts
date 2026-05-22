import {
  DEFAULT_API_PORT,
  DEFAULT_AUTH_API_PORT,
  DEFAULT_DYNAMODB_ADMIN_PORT,
  DEFAULT_DYNAMODB_PORT,
  DEFAULT_KINESIS_PORT,
  DEFAULT_KINESIS_TLS_PORT,
  DEFAULT_SES_PORT,
  DEFAULT_VITE_PORT,
  DEFAULT_WS_PORT,
} from './ports.js'

export interface WorktreePorts {
  /** Express API HTTP port */
  api: number
  /** Vite dev server port */
  app: number
  /** Auth API HTTP port (auth.gameweave.com in prod; localhost:3003 in dev) */
  authApi: number
  /** DynamoDB Local port */
  dynamodb: number
  /** DynamoDB Admin UI port */
  dynamodbAdmin: number
  /** Kinesis Local plain port (KINESIS_MOCK_PLAIN_PORT) */
  kinesis: number
  /**
   * Kinesis Local TLS port (KINESIS_MOCK_TLS_PORT). Must be offset alongside
   * the plain port so two worktrees can run kinesis-local concurrently.
   */
  kinesisTls: number
  /** Local SES port */
  ses: number
  /** WebSocket server port */
  ws: number
}

/**
 * Derives a full port map for a given worktree offset.
 * Offset 0 returns the default ports — unchanged from single-worktree usage.
 * Each offset increments every port by 100 to avoid collisions.
 */
export function computePorts(offset: number): WorktreePorts {
  const n = offset * 100
  return {
    api: DEFAULT_API_PORT + n,
    app: DEFAULT_VITE_PORT + n,
    authApi: DEFAULT_AUTH_API_PORT + n,
    dynamodb: DEFAULT_DYNAMODB_PORT + n,
    dynamodbAdmin: DEFAULT_DYNAMODB_ADMIN_PORT + n,
    kinesis: DEFAULT_KINESIS_PORT + n,
    kinesisTls: DEFAULT_KINESIS_TLS_PORT + n,
    ses: DEFAULT_SES_PORT + n,
    ws: DEFAULT_WS_PORT + n,
  }
}
