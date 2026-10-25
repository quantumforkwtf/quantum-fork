/**
 * Incremental tar reader for GitHub archives. Feed it decompressed chunks;
 * it calls back with each wanted file and skips the rest without buffering
 * them. Handles ustar prefixes, pax extended headers and GNU long names.
 */

const BLOCK = 512
const MAX_META_BYTES = 1024 * 1024

type EntryKind = 'file' | 'pax' | 'global' | 'longname' | 'other'

interface Entry {
  path: string
  size: number
  kind: EntryKind
  keep: boolean
}

export interface TarHandlers {
  /** Return true to receive the file's bytes. */
  want(path: string, size: number): boolean
  file(path: string, data: Uint8Array): void
}

const decoder = new TextDecoder()

function cstring(bytes: Uint8Array, start: number, length: number) {
  const slice = bytes.subarray(start, start + length)
  const end = slice.indexOf(0)
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end))
}

function octal(bytes: Uint8Array, start: number, length: number) {
  if (bytes[start] & 0x80) {
    let value = 0
    for (let index = start + 1; index < start + length; index++) value = value * 256 + bytes[index]
    return value
  }
  const text = cstring(bytes, start, length).trim()
  return text ? parseInt(text, 8) : 0
}

function concat(parts: Uint8Array[]) {
  if (parts.length === 1) return parts[0]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** "<length> <key>=<value>\n" records, where length counts bytes. */
export function parsePax(data: Uint8Array): Record<string, string> {
  const records: Record<string, string> = {}
  let position = 0
  while (position < data.length) {
    const space = data.indexOf(0x20, position)
    if (space === -1) break
    const length = parseInt(decoder.decode(data.subarray(position, space)), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = decoder.decode(data.subarray(space + 1, position + length - 1))
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    position += length
  }
  return records
}

export class TarReader {
  private buffer = new Uint8Array(0)
  private state: 'header' | 'data' | 'done' = 'header'
  private entry: Entry | null = null
  private remaining = 0
  private padding = 0
  private parts: Uint8Array[] = []
  private pax: Record<string, string> = {}
  private longName: string | null = null
  readonly globals: Record<string, string> = {}

  constructor(private readonly handlers: TarHandlers) {}

  get done() {
    return this.state === 'done'
  }

  push(chunk: Uint8Array) {
    let buffer = this.buffer.length ? concat([this.buffer, chunk]) : chunk
    let offset = 0
    while (this.state !== 'done') {
      if (this.state === 'header') {
        if (buffer.length - offset < BLOCK) break
        this.readHeader(buffer.subarray(offset, offset + BLOCK))
        offset += BLOCK
        continue
      }
      if (this.remaining > 0) {
        const take = Math.min(buffer.length - offset, this.remaining)
        if (take === 0) break
        if (this.entry?.keep) this.parts.push(buffer.slice(offset, offset + take))
        offset += take
        this.remaining -= take
        if (this.remaining > 0) break
      }
      if (this.padding > 0) {
        const take = Math.min(buffer.length - offset, this.padding)
        offset += take
        this.padding -= take
        if (this.padding > 0) break
      }
      this.finishEntry()
    }
    buffer = buffer.slice(offset)
    this.buffer = buffer
  }

  private readHeader(header: Uint8Array) {
    if (header.every((byte) => byte === 0)) {
      this.state = 'done'
      return
    }
    const name = cstring(header, 0, 100)
    const type = String.fromCharCode(header[156] || 0x30)
    const ustar = cstring(header, 257, 6).startsWith('ustar')
    const prefix = ustar ? cstring(header, 345, 155) : ''
    let size = octal(header, 124, 12)
    const kind: EntryKind = type === 'x' ? 'pax' : type === 'g' ? 'global' : type === 'L' ? 'longname' : type === '0' || type === '7' ? 'file' : 'other'
    let path = prefix ? `${prefix}/${name}` : name
    if (kind === 'file' || kind === 'other') {
      if (this.pax.path) path = this.pax.path
      else if (this.longName) path = this.longName
      if (this.pax.size && /^\d+$/.test(this.pax.size)) size = Number(this.pax.size)
    }
    const keep = kind === 'file' ? this.handlers.want(path, size) : kind === 'other' ? false : size <= MAX_META_BYTES
    this.entry = { path, size, kind, keep }
    this.remaining = size
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK
    this.parts = []
    this.state = 'data'
  }

  private finishEntry() {
    const entry = this.entry
    this.state = 'header'
    this.entry = null
    if (!entry) return
    const data = entry.keep ? concat(this.parts) : null
    this.parts = []
    switch (entry.kind) {
      case 'pax':
        this.pax = data ? parsePax(data) : {}
        return
      case 'global':
        if (data) Object.assign(this.globals, parsePax(data))
        return
      case 'longname':
        this.longName = data ? cstring(data, 0, data.length) : null
        return
      default:
        if (entry.kind === 'file' && data) this.handlers.file(entry.path, data)
        this.pax = {}
        this.longName = null
    }
  }
}
