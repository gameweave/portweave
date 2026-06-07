import { createReadStream, existsSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  extname,
  join,
  normalize,
  resolve as resolvePath,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { PortweaveError, PW_ERROR_CODES } from '../errors.ts'
import { err, ok, type Result } from '../result.ts'
import { buildPanelSnapshot } from './enrich.ts'
import {
  dispatchPost,
  HEADER_CONTENT_TYPE,
  MIME_HTML,
  MIME_JSON,
  MSG_NOT_FOUND,
  sendHtml,
  sendJson,
  serveIndexHtml,
  STATUS_NOT_FOUND,
  STATUS_OK,
  STATUS_SERVER_ERROR,
} from './post-handlers.ts'
import { createPanelSecurity, type PanelSecurity } from './security.ts'
import { createTriageProvider, type TriageProvider } from './triage-cache.ts'

export interface StartPanelServerOptions {
  env: NodeJS.ProcessEnv
  port: number
  security?: PanelSecurity // injected in tests for a known CSRF/gate
  signal?: AbortSignal
  triage?: TriageProvider // injected in tests to avoid gh/git/du
}

export interface RunningPanelServer {
  readonly closed: Promise<void>
  readonly port: number // the actual bound port (useful when port 0 in tests)
}

interface HandlerDeps {
  readonly env: NodeJS.ProcessEnv
  readonly security: PanelSecurity
  readonly triage: TriageProvider
}

const LOOPBACK_HOST = '127.0.0.1'
const ORIGIN_BASE = `http://${LOOPBACK_HOST}`
const HTTP_METHOD_GET = 'GET'
const HTTP_METHOD_POST = 'POST'
const STATUS_METHOD_NOT_ALLOWED = 405
const HEADER_ALLOW = 'Allow'
const ALLOWED_METHODS = `${HTTP_METHOD_GET}, ${HTTP_METHOD_POST}`
const ROUTE_API_ALLOCATIONS = '/api/allocations'
const ROUTE_ROOT = '/'
const INDEX_FILENAME = 'index.html'
const BODY_METHOD_NOT_ALLOWED = 'method not allowed'

// Bundled UI dir relative to the compiled module (symlink-safe, decision-log
// #36): dist/panel/ at runtime, src/panel/ (no index.html) under Vitest.
const PANEL_ASSET_DIR = fileURLToPath(new URL('./', import.meta.url))

// Partial keeps mimeForFile's octet-stream fallback a real (not dead) branch.
const EXTENSION_MIME_MAP: Readonly<Partial<Record<string, string>>> = {
  '.css': 'text/css',
  '.html': MIME_HTML,
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': MIME_JSON,
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function mimeForFile(filePath: string): string {
  return (
    EXTENSION_MIME_MAP[extname(filePath).toLowerCase()] ??
    'application/octet-stream'
  )
}

async function handleAllocations(
  res: ServerResponse,
  deps: HandlerDeps,
  refresh: boolean,
): Promise<void> {
  // ?refresh=1 forces a recompute on the server's own provider (warming its
  // persistent cache); the ordinary path serves its cache. Still a read.
  const opts = { forceTriage: refresh, triage: deps.triage }
  try {
    sendJson(res, STATUS_OK, await buildPanelSnapshot(deps.env, opts))
  } catch {
    // enrich only throws on an exceptional registry read (corrupt/locked).
    sendJson(res, STATUS_SERVER_ERROR, { error: 'snapshot-failed' })
  }
}

// Asset path inside PANEL_ASSET_DIR, or undefined if it escapes via `..`.
function resolveAssetPath(pathname: string): string | undefined {
  const decoded = normalize(decodeURIComponent(pathname))
  const absolute = resolvePath(PANEL_ASSET_DIR, decoded.replace(/^[/\\]+/, ''))
  const root = resolvePath(PANEL_ASSET_DIR)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return undefined
  }
  return absolute
}

// `/` is read + CSRF-injected (503 when unbuilt); assets stream; else 404.
function handleStatic(
  res: ServerResponse,
  pathname: string,
  csrfToken: string,
): void {
  if (pathname === ROUTE_ROOT) {
    void serveIndexHtml(res, join(PANEL_ASSET_DIR, INDEX_FILENAME), csrfToken)
    return
  }
  const target = resolveAssetPath(pathname)
  if (target === undefined || !existsSync(target)) {
    sendHtml(res, STATUS_NOT_FOUND, MSG_NOT_FOUND)
    return
  }
  res.writeHead(STATUS_OK, { [HEADER_CONTENT_TYPE]: mimeForFile(target) })
  createReadStream(target).pipe(res)
}

function methodNotAllowed(res: ServerResponse): void {
  res.writeHead(STATUS_METHOD_NOT_ALLOWED, {
    [HEADER_ALLOW]: ALLOWED_METHODS,
    [HEADER_CONTENT_TYPE]: MIME_HTML,
  })
  res.end(BODY_METHOD_NOT_ALLOWED)
}

function handleGet(url: URL, res: ServerResponse, deps: HandlerDeps): void {
  if (url.pathname === ROUTE_API_ALLOCATIONS) {
    const refresh = url.searchParams.get('refresh') === '1'
    void handleAllocations(res, deps, refresh)
    return
  }
  handleStatic(res, url.pathname, deps.security.csrfToken)
}

function createHandler(deps: HandlerDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? ROUTE_ROOT, ORIGIN_BASE)
    if (req.method === HTTP_METHOD_GET) {
      handleGet(url, res, deps)
      return
    }
    // /api/allocations is GET-only (POST → 405, not 404); mutating routes go
    // through the security-gated dispatcher.
    const isMutating =
      req.method === HTTP_METHOD_POST && url.pathname !== ROUTE_API_ALLOCATIONS
    if (isMutating) {
      const { env, security } = deps
      void dispatchPost(req, res, url.pathname, { env, security })
      return
    }
    methodNotAllowed(res)
  }
}

export function startPanelServer(
  options: StartPanelServerOptions,
): Promise<Result<RunningPanelServer, PortweaveError>> {
  // The request handler needs security (CSRF/Host allowlist), which depends on
  // the bound port — known only after 'listening' — so attach it there.
  const server = createServer()

  return new Promise<Result<RunningPanelServer, PortweaveError>>((resolve) => {
    server.once('error', (error: Error) => {
      const code = (error as NodeJS.ErrnoException).code
      const message =
        code === 'EADDRINUSE'
          ? `panel port ${String(options.port)} is already in use — pass --port <n> to choose another`
          : `failed to start panel server on port ${String(options.port)}: ${error.message}`
      resolve(
        err(new PortweaveError(PW_ERROR_CODES.CLI_PANEL_PORT_IN_USE, message)),
      )
    })

    server.once('listening', () => {
      const address = server.address()
      const boundPort =
        address !== null && typeof address !== 'string'
          ? address.port
          : options.port
      // One provider + security instance per server, held for the process
      // lifetime so the triage cache persists across Refreshes.
      const triage = options.triage ?? createTriageProvider()
      const security = options.security ?? createPanelSecurity(boundPort)
      const deps = { env: options.env, security, triage }
      server.on('request', createHandler(deps))
      const closed = wireShutdown(server, options.signal)
      resolve(ok({ closed, port: boundPort }))
    })

    server.listen(options.port, LOOPBACK_HOST)
  })
}

// Wire SIGINT/SIGTERM + an optional AbortSignal to server.close(); resolve
// `closed` on 'close'. Listeners removed on teardown so repeat starts in one
// process do not leak. Idempotent during close.
function wireShutdown(
  server: ReturnType<typeof createServer>,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolveClosed) => {
    let closing = false
    const shutdown = (): void => {
      if (closing) {
        return
      }
      closing = true
      server.close()
      // Drop idle keep-alive sockets so 'close' fires promptly on Ctrl-C / abort.
      server.closeAllConnections()
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    let abortHandler: (() => void) | undefined
    if (signal !== undefined) {
      abortHandler = () => {
        shutdown()
      }
      signal.addEventListener('abort', abortHandler)
    }

    server.once('close', () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      if (signal !== undefined && abortHandler !== undefined) {
        signal.removeEventListener('abort', abortHandler)
      }
      resolveClosed()
    })
  })
}
