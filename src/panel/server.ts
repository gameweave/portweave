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

export interface StartPanelServerOptions {
  env: NodeJS.ProcessEnv
  port: number
  signal?: AbortSignal
}

export interface RunningPanelServer {
  /** Resolves when the server has fully closed. */
  readonly closed: Promise<void>
  /** The actual bound port (useful when port 0 was requested in tests). */
  readonly port: number
}

const LOOPBACK_HOST = '127.0.0.1'

const HTTP_METHOD_GET = 'GET'

const STATUS_OK = 200
const STATUS_NOT_FOUND = 404
const STATUS_METHOD_NOT_ALLOWED = 405
const STATUS_SERVER_ERROR = 500
const STATUS_UNAVAILABLE = 503

const HEADER_CONTENT_TYPE = 'Content-Type'
const HEADER_ALLOW = 'Allow'

const MIME_JSON = 'application/json'
const MIME_HTML = 'text/html'
const MIME_CSS = 'text/css'
const MIME_JS = 'text/javascript'
const MIME_SVG = 'image/svg+xml'
const MIME_PNG = 'image/png'
const MIME_ICO = 'image/x-icon'
const MIME_WOFF2 = 'font/woff2'
const MIME_OCTET_STREAM = 'application/octet-stream'

const ROUTE_API_ALLOCATIONS = '/api/allocations'
const ROUTE_ROOT = '/'

const INDEX_FILENAME = 'index.html'

const BODY_NOT_FOUND = 'not found'
const BODY_METHOD_NOT_ALLOWED = 'method not allowed'
const BODY_SNAPSHOT_FAILED = '{"error":"snapshot-failed"}'
const BODY_NOT_BUILT = 'panel UI not built — run npm run build'

// Partial: an unknown extension types as `string | undefined` so the
// MIME_OCTET_STREAM fallback in mimeForFile is a real (not dead) branch.
const EXTENSION_MIME_MAP: Readonly<Partial<Record<string, string>>> = {
  '.css': MIME_CSS,
  '.html': MIME_HTML,
  '.ico': MIME_ICO,
  '.js': MIME_JS,
  '.json': MIME_JSON,
  '.png': MIME_PNG,
  '.svg': MIME_SVG,
  '.woff2': MIME_WOFF2,
}

// Resolve the bundled UI dir relative to the compiled module (symlink-safe per
// decision-log #36). At runtime server.js and the built UI share dist/panel/,
// so the offset is './'; under Vitest it resolves to src/panel/ (no index.html).
const PANEL_ASSET_DIR = fileURLToPath(new URL('./', import.meta.url))

function panelUiIsBuilt(): boolean {
  return existsSync(join(PANEL_ASSET_DIR, INDEX_FILENAME))
}

function mimeForFile(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  return EXTENSION_MIME_MAP[extension] ?? MIME_OCTET_STREAM
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { [HEADER_CONTENT_TYPE]: MIME_HTML })
  res.end(body)
}

async function handleAllocations(
  res: ServerResponse,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const snapshot = await buildPanelSnapshot(env)
    res.writeHead(STATUS_OK, { [HEADER_CONTENT_TYPE]: MIME_JSON })
    res.end(JSON.stringify(snapshot))
  } catch {
    // Defensive: enrich never throws per-entry, so this only fires on an
    // exceptional registry read (corrupt/locked). Failure rides the response.
    res.writeHead(STATUS_SERVER_ERROR, { [HEADER_CONTENT_TYPE]: MIME_JSON })
    res.end(BODY_SNAPSHOT_FAILED)
  }
}

// Resolve a requested asset to an absolute path inside PANEL_ASSET_DIR, or
// undefined if it would escape via `..` — standard path-traversal hygiene even
// on a loopback-only server.
function resolveAssetPath(pathname: string): string | undefined {
  const decoded = normalize(decodeURIComponent(pathname))
  const relative = decoded.replace(/^[/\\]+/, '')
  const absolute = resolvePath(PANEL_ASSET_DIR, relative)
  const root = resolvePath(PANEL_ASSET_DIR)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return undefined
  }
  return absolute
}

function serveFile(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) {
    sendText(res, STATUS_NOT_FOUND, BODY_NOT_FOUND)
    return
  }
  res.writeHead(STATUS_OK, { [HEADER_CONTENT_TYPE]: mimeForFile(filePath) })
  createReadStream(filePath).pipe(res)
}

function handleStatic(res: ServerResponse, pathname: string): void {
  // Only the SPA entry point reports 503 when the bundle is unbuilt (so the
  // cause is clear); unknown asset paths fall through to a normal 404 below.
  if (pathname === ROUTE_ROOT) {
    if (!panelUiIsBuilt()) {
      sendText(res, STATUS_UNAVAILABLE, BODY_NOT_BUILT)
      return
    }
    serveFile(res, join(PANEL_ASSET_DIR, INDEX_FILENAME))
    return
  }
  const target = resolveAssetPath(pathname)
  if (target === undefined) {
    sendText(res, STATUS_NOT_FOUND, BODY_NOT_FOUND)
    return
  }
  serveFile(res, target)
}

function pathnameOf(req: IncomingMessage): string {
  return new URL(req.url ?? ROUTE_ROOT, `http://${LOOPBACK_HOST}`).pathname
}

function createHandler(env: NodeJS.ProcessEnv) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== HTTP_METHOD_GET) {
      res.writeHead(STATUS_METHOD_NOT_ALLOWED, {
        [HEADER_ALLOW]: HTTP_METHOD_GET,
        [HEADER_CONTENT_TYPE]: MIME_HTML,
      })
      res.end(BODY_METHOD_NOT_ALLOWED)
      return
    }
    const pathname = pathnameOf(req)
    if (pathname === ROUTE_API_ALLOCATIONS) {
      void handleAllocations(res, env)
      return
    }
    handleStatic(res, pathname)
  }
}

export function startPanelServer(
  options: StartPanelServerOptions,
): Promise<Result<RunningPanelServer, PortweaveError>> {
  const server = createServer(createHandler(options.env))

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
      const closed = wireShutdown(server, options.signal)
      resolve(ok({ closed, port: boundPort }))
    })

    server.listen(options.port, LOOPBACK_HOST)
  })
}

// Wire SIGINT/SIGTERM and an optional AbortSignal (test stop hook) to
// server.close(); resolve `closed` on the 'close' event. Listeners are removed
// on teardown so repeat startPanelServer calls in one process do not leak (same
// shape as src/cli/spawn.ts). Idempotent: a second trigger during close is a no-op.
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
      // Drop idle keep-alive sockets so 'close' fires promptly on Ctrl-C / abort
      // instead of waiting out keepAliveTimeout for a lingering client.
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
