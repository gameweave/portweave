// Seed PW error codes. PW#### grouped by component in 100-blocks — see
// the table in .ai/specs/result-types/result-types.md.
export const PW_ERROR_CODES = {
  ALLOCATION_EXHAUSTED: 'PW0401',
  ALLOCATION_PRIMARY_SLOT_BUSY: 'PW0402',
  CLI_CHILD_SPAWN_FAILED: 'PW0602',
  CLI_INVALID_FLAGS: 'PW0601',
  CLI_NO_ALLOCATION: 'PW0603',
  CLI_PANEL_PORT_IN_USE: 'PW0604',
  CONFIG_INVALID: 'PW0102',
  CONFIG_MISSING: 'PW0101',
  ENV_BUILD_INVALID: 'PW0501',
  ENV_DOTENV_PARSE_FAILED: 'PW0502',
  ENV_DOTENV_PORT_OVERRIDE_INVALID: 'PW0503',
  GITHUB_GH_UNAVAILABLE: 'PW0801',
  GITHUB_PR_QUERY_FAILED: 'PW0802',
  NOT_A_GIT_REPO: 'PW0201',
  PANEL_LAUNCH_FAILED: 'PW0607',
  PANEL_PATH_NOT_ALLOWED: 'PW0606',
  PANEL_REQUEST_FORBIDDEN: 'PW0605',
  REGISTRY_CORRUPT: 'PW0302',
  REGISTRY_LOCKED: 'PW0301',
  // PW07xx — library-runtime block (see .ai/specs/library-runtime)
  RUNTIME_CONFIG_NOT_FOUND: 'PW0701',
  // PW0702 reserved for future cached-state failure; not emitted at v0
  RUNTIME_NOT_INITIALIZED: 'PW0702',
  WORKTREE_OFFSET_INVALID: 'PW0202',
} as const satisfies Record<string, `PW${number}`>

export type PortweaveErrorCode =
  (typeof PW_ERROR_CODES)[keyof typeof PW_ERROR_CODES]

// Carries a stable PW#### code for cross-module dispatch. The setPrototypeOf
// call is load-bearing for `instanceof` under transpilation — do not remove.
export class PortweaveError extends Error {
  readonly code: PortweaveErrorCode

  constructor(code: PortweaveErrorCode, message: string) {
    super(message)
    this.name = 'PortweaveError'
    this.code = code
    Object.setPrototypeOf(this, PortweaveError.prototype)
  }
}
