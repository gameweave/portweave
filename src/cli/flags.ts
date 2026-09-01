import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, type Result } from '../result.ts'
import type { RunOptions } from './run.ts'

export function validateFlags(
  childArgs: readonly string[],
  options: RunOptions,
): Result<void, PortweaveError> {
  if (options.configPath !== undefined && options.count !== undefined) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        '--config and --count are mutually exclusive',
      ),
    )
  }
  if (childArgs.length === 0) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        'no command provided after --',
      ),
    )
  }
  if (
    options.count !== undefined &&
    (!Number.isInteger(options.count) || options.count <= 0)
  ) {
    return err(
      new PortweaveError(
        PW_ERROR_CODES.CLI_INVALID_FLAGS,
        `--count must be a positive integer, received ${String(options.count)}`,
      ),
    )
  }
  return { ok: true, value: undefined }
}
