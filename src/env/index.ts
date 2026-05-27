export { buildEnvMap } from './build.ts'
export {
  buildMetadata,
  PORTWEAVE_NAMESPACE_VAR,
  PW_METADATA_FIELDS,
  PW_METADATA_PREFIX,
  type PwMetadataField,
} from './metadata.ts'
export { type ResolvedEnv, resolveEnv } from './resolve.ts'
export { evaluateTemplate } from './templates.ts'
