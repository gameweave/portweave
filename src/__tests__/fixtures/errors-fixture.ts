import { PortweaveError, PW_ERROR_CODES } from '../../errors.ts'

export function throwsPortweaveError(): never {
  throw new PortweaveError(
    PW_ERROR_CODES.REGISTRY_LOCKED,
    'registry currently locked by another process',
  )
}
