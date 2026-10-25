type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SECRET_KEY = /token|secret|password|authorization|cookie|private|seed|mnemonic|apikey|api_key/i
const BASE58_LONG = /\b[1-9A-HJ-NP-Za-km-z]{32,90}\b/g

/** Shortens addresses and signatures; they are public, but full values are not needed in logs. */
export function redactText(value: string) {
  return value.replace(BASE58_LONG, (match) => `${match.slice(0, 6)}…${match.slice(-4)}`).slice(0, 2000)
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(entry, depth + 1)
    return out
  }
  return value
}

export function createLogger(context: Record<string, unknown>, minimum: Level = 'info') {
  const write = (level: Level, message: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < ORDER[minimum]) return
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...(redact({ ...context, ...fields }) as object) })
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
    info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
  }
}

export type Logger = ReturnType<typeof createLogger>
