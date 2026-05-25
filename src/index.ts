export {
  type Config,
  loadConfig,
  type LoadConfigOptions,
  type ServiceSpec,
  synthesizeAnonymousConfig,
} from './config/index.ts'
export {
  PortweaveError,
  type PortweaveErrorCode,
  PW_ERROR_CODES,
} from './errors.ts'
export { andThen, err, ok, type Result } from './result.ts'
export {
  detectGitWorktreeContext,
  type GitWorktreeContext,
} from './worktree/git.ts'
export { type AllocationKey, resolveAllocationKey } from './worktree/key.ts'
export {
  deriveNamespace,
  MAIN_NAMESPACE,
  namespaceOverride,
  parseExplicitOffset,
  sanitizeNamespace,
} from './worktree/namespace.ts'
