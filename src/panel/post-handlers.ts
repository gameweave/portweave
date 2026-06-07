import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PW_ERROR_CODES } from '../errors.ts'
import { readRegistryEntries } from '../registry/storage.ts'
import { launchAt } from './launch.ts'
import { parsePruneKey, pruneAllocation } from './prune.ts'
import type { PanelSecurity } from './security.ts'

// Shared with server.ts (imported there) so these literals are defined once —
// duplicate same-name/value const definitions across files trip constants:check.
export const STATUS_OK = 200
export const STATUS_NOT_FOUND = 404
export const STATUS_SERVER_ERROR = 500
export const MIME_JSON = 'application/json'
export const MIME_HTML = 'text/html'
export const HEADER_CONTENT_TYPE = 'Content-Type'
export const MSG_NOT_FOUND = 'not found'
const STATUS_BAD_REQUEST = 400
const STATUS_FORBIDDEN = 403
const STATUS_UNAVAILABLE = 503
const ROUTE_API_PRUNE = '/api/prune'
const ROUTE_API_OPEN = '/api/open'
const INVALID = PW_ERROR_CODES.CLI_INVALID_FLAGS
const MSG_FORBIDDEN = 'request forbidden'
const MSG_CONFIRM_REQUIRED = 'confirm required'
const MSG_BODY_INVALID = 'invalid request body'
const MSG_PATH_NOT_ALLOWED = 'path not allowed'
const MSG_PRUNE_FAILED = 'prune failed'
const BODY_NOT_BUILT = 'panel UI not built — run npm run build'
const CSRF_TAG_OPEN = '<meta name="pw-csrf" content="'
const HEAD_CLOSE = '</head>'

// node:http does not parse bodies; cap the buffer so a loopback client cannot
// exhaust memory (oversize → 400). 1 MiB is ample for these JSON payloads.
const MAX_BODY_BYTES = 1_048_576

interface OpenBody {
  readonly target?: unknown
  readonly worktreeRoot?: unknown
}

interface PostDeps {
  readonly env: NodeJS.ProcessEnv
  readonly security: PanelSecurity
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { [HEADER_CONTENT_TYPE]: MIME_JSON })
  res.end(JSON.stringify(payload))
}

export function sendHtml(
  res: ServerResponse,
  status: number,
  body: string,
): void {
  res.writeHead(status, { [HEADER_CONTENT_TYPE]: MIME_HTML })
  res.end(body)
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { code, error: message })
}

// Buffer the JSON body up to MAX_BODY_BYTES; resolves the parsed value, or
// undefined on oversize / malformed JSON / a broken stream (all → 400).
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const settle = (value: unknown): void => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        settle(undefined)
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        // pw-allow-swallow: a malformed body is a client error, surfaced as 400
        settle(undefined)
      }
    })
    // pw-allow-swallow: a broken request stream maps to the 400 path
    req.on('error', () => {
      settle(undefined)
    })
  })
}

// Read + require a JSON object body, 400-ing and returning undefined on failure.
async function readObjectBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  const body = await readJsonBody(req)
  if (typeof body !== 'object' || body === null) {
    sendError(res, STATUS_BAD_REQUEST, INVALID, MSG_BODY_INVALID)
    return undefined
  }
  return body as Record<string, unknown>
}

async function handlePrune(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const body = await readObjectBody(req, res)
  if (body === undefined) {
    return
  }
  if (body.confirm !== true) {
    sendError(res, STATUS_BAD_REQUEST, INVALID, MSG_CONFIRM_REQUIRED)
    return
  }
  const key = parsePruneKey(body)
  if (key === undefined) {
    sendError(res, STATUS_BAD_REQUEST, INVALID, MSG_BODY_INVALID)
    return
  }
  const result = await pruneAllocation(key, env)
  if (!result.ok) {
    sendError(res, STATUS_SERVER_ERROR, result.error.code, MSG_PRUNE_FAILED)
    return
  }
  sendJson(res, STATUS_OK, { removed: result.value.removed })
}

// Refuse to open an arbitrary directory: worktreeRoot must match a known
// allocation root (registry read), not merely exist on disk.
async function isKnownAllocationRoot(
  worktreeRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const entries = await readRegistryEntries(env)
  return entries.ok
    ? entries.value.some((e) => e.key.worktreeRoot === worktreeRoot)
    : false
}

async function handleOpen(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const body = (await readObjectBody(req, res)) as OpenBody | undefined
  if (body === undefined) {
    return
  }
  const { target, worktreeRoot } = body
  if (
    (target !== 'editor' && target !== 'terminal') ||
    typeof worktreeRoot !== 'string'
  ) {
    sendError(res, STATUS_BAD_REQUEST, INVALID, MSG_BODY_INVALID)
    return
  }
  if (!(await isKnownAllocationRoot(worktreeRoot, env))) {
    const code = PW_ERROR_CODES.PANEL_PATH_NOT_ALLOWED
    sendError(res, STATUS_FORBIDDEN, code, MSG_PATH_NOT_ALLOWED)
    return
  }
  sendJson(res, STATUS_OK, await launchAt(target, worktreeRoot))
}

// POST dispatcher behind the security gate: /api/prune and /api/open are 403'd
// unless authorizeMutation passes (Host/Origin allowlist + CSRF token). Unknown
// POST path → 404.
export async function dispatchPost(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: PostDeps,
): Promise<void> {
  if (pathname !== ROUTE_API_PRUNE && pathname !== ROUTE_API_OPEN) {
    sendError(res, STATUS_NOT_FOUND, INVALID, MSG_NOT_FOUND)
    return
  }
  if (!deps.security.authorizeMutation(req)) {
    const code = PW_ERROR_CODES.PANEL_REQUEST_FORBIDDEN
    sendError(res, STATUS_FORBIDDEN, code, MSG_FORBIDDEN)
    return
  }
  if (pathname === ROUTE_API_PRUNE) {
    await handlePrune(req, res, deps.env)
    return
  }
  await handleOpen(req, res, deps.env)
}

// Inject the per-session CSRF token as a <meta name="pw-csrf"> so the frontend
// can read it (same-origin) and echo it on mutating fetches; a cross-origin page
// cannot read the HTML body, so cannot forge the header. Exported for unit test.
export function injectCsrfMeta(html: string, csrfToken: string): string {
  const tag = `${CSRF_TAG_OPEN}${csrfToken}">`
  return html.includes(HEAD_CLOSE)
    ? html.replace(HEAD_CLOSE, `${tag}${HEAD_CLOSE}`)
    : `${tag}${html}`
}

// Serve the SPA entry point with the CSRF token injected. A read failure (the
// bundle is unbuilt — nothing to inject) keeps the existing 503 behavior.
export async function serveIndexHtml(
  res: ServerResponse,
  indexPath: string,
  csrfToken: string,
): Promise<void> {
  try {
    const html = await readFile(indexPath, 'utf8')
    sendHtml(res, STATUS_OK, injectCsrfMeta(html, csrfToken))
  } catch {
    // pw-allow-swallow: no index.html means the UI is unbuilt — report 503
    sendHtml(res, STATUS_UNAVAILABLE, BODY_NOT_BUILT)
  }
}
