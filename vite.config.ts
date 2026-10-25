import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

type Handler = (request: Request) => Promise<Response>

/** Serves /api/*.ts with the same Web Request/Response handlers Vercel runs in production. */
function apiDevServer(): Plugin {
  return {
    name: 'qfork-api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)(?:\?|$)/)
        if (!match) return next()
        try {
          const module = (await server.ssrLoadModule(`/api/${match[1]}.ts`)) as Record<string, Handler | undefined>
          const handler = module[req.method ?? 'GET']
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value)
          headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1')
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })
          const response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          server.config.logger.error(`[api] ${error instanceof Error ? error.stack : String(error)}`)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Dev API handler crashed.' } }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Server-only variables (no VITE_ prefix) reach the dev API through process.env, never the bundle.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[key] ??= value
  return {
    plugins: [react(), apiDevServer()],
    define: {
      __BUILD_SHA__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      // three.js is lazy-loaded as its own chunk and only fetched when a 3D view mounts
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('node_modules/three')) return 'engine'
            if (id.includes('node_modules/@solana') || id.includes('node_modules/@wallet-standard') || id.includes('node_modules/@noble')) return 'solana'
            return undefined
          },
        },
      },
    },
  }
})
