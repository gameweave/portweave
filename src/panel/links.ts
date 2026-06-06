// Clickable-link scheme allowlist (XSS guard): a discoveryEnv URL resolving to
// `javascript:`/`data:`/a DB scheme is dropped from clickable links here, but
// is still injected as a normal env var by env-resolution.
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:'])

export const isSafeLinkUrl = (value: string): boolean =>
  URL.canParse(value) && SAFE_LINK_SCHEMES.has(new URL(value).protocol)
