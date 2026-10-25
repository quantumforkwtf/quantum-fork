import { z } from 'zod'
import { json, rateLimit, readJson, route } from './_lib/http.js'

const reportSchema = z
  .object({
    kind: z.enum(['error', 'unhandledrejection', 'webgl', 'wallet', 'rpc', 'boundary']),
    message: z.string().max(500),
    route: z.string().max(120).optional(),
    stack: z.string().max(2000).optional(),
    correlationId: z.string().max(64).optional(),
  })
  .strict()

/** Client error intake. Stored only in function logs; redacted by the logger. */
export const { GET, POST } = route('log', {
  async POST(context) {
    await rateLimit(context, 'log', 20)
    const report = await readJson(context, reportSchema)
    context.log.warn('client report', { ...report, userAgent: context.request.headers.get('user-agent')?.slice(0, 160) })
    return json({ ok: true }, 202)
  },
})
