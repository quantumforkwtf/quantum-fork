import { AppScanner, type FileClass, parseRepoInput, type RepoRef } from '../src/protocol/appScan.js'
import { HttpError, json, rateLimit, route } from './_lib/http.js'
import { TarReader } from './_lib/tar.js'

/**
 * Scans a public GitHub repository. The archive is streamed, decompressed and
 * scanned in memory, then discarded: no code is stored or logged, and only the
 * report (paths, line numbers and short redacted excerpts) is returned.
 */

const MAX_COMPRESSED_BYTES = 80 * 1024 * 1024
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024
const TIME_BUDGET_MS = 40_000
const SHA = /^[0-9a-f]{40}$/

async function scanGithub(repo: RepoRef) {
  const scanner = new AppScanner()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIME_BUDGET_MS)
  const ref = repo.ref ?? 'HEAD'
  const archive = `https://github.com/${repo.owner}/${repo.name}/archive/${ref.split('/').map(encodeURIComponent).join('/')}.tar.gz`
  try {
    let response: Response
    try {
      response = await fetch(archive, { signal: controller.signal, headers: { 'User-Agent': 'quantum-fork-app-scan' } })
    } catch {
      throw new HttpError(504, 'GITHUB_UNREACHABLE', 'GitHub did not respond in time. Try again in a moment.')
    }
    if (response.status === 404) {
      throw new HttpError(404, 'REPOSITORY_NOT_FOUND', `No public repository${repo.ref ? ` or ref “${repo.ref}”` : ''} found at github.com/${repo.owner}/${repo.name}. Private repositories can’t be scanned here; scan a local copy instead.`)
    }
    if (!response.ok || !response.body) throw new HttpError(502, 'GITHUB_ERROR', `GitHub returned ${response.status} for this repository.`)

    const decoder = new TextDecoder()
    let admitted: FileClass | null = null
    const tar = new TarReader({
      want: (path, size) => {
        const relative = path.slice(path.indexOf('/') + 1)
        admitted = relative ? scanner.admit(relative, size) : null
        return admitted !== null
      },
      file: (path, data) => {
        if (admitted) scanner.addFile(path.slice(path.indexOf('/') + 1), decoder.decode(data), admitted)
        admitted = null
      },
    })

    let compressed = 0
    let unpacked = 0
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, sink) {
          compressed += chunk.length
          sink.enqueue(chunk)
        },
      }),
    )
    const reader = counted.pipeThrough(new DecompressionStream('gzip')).getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        unpacked += value.length
        tar.push(value)
        if (tar.done) break
        if (scanner.full) break
        if (compressed > MAX_COMPRESSED_BYTES || unpacked > MAX_UNPACKED_BYTES) {
          scanner.markTruncated('Stopped early: the repository archive is larger than the scan limit.')
          break
        }
      }
    } catch {
      if (controller.signal.aborted) scanner.markTruncated(`Stopped after ${TIME_BUDGET_MS / 1000} seconds; the rest of the repository was not scanned.`)
      else if (scanner.stats.filesScanned === 0) throw new HttpError(502, 'ARCHIVE_UNREADABLE', 'The repository archive could not be read.')
      else scanner.markTruncated('The archive ended unexpectedly; the report covers the files read before that.')
    } finally {
      void reader.cancel().catch(() => undefined)
    }

    const commit = tar.globals.comment && SHA.test(tar.globals.comment) ? tar.globals.comment : null
    return scanner.report({ kind: 'github', label: `${repo.owner}/${repo.name}`, ref: repo.ref, commit, url: `https://github.com/${repo.owner}/${repo.name}` })
  } finally {
    clearTimeout(timer)
  }
}

export const { GET, POST } = route('scan', {
  async GET(context) {
    const repo = parseRepoInput(context.url.searchParams.get('repo') ?? '', context.url.searchParams.get('ref'))
    if (!repo) throw new HttpError(400, 'INVALID_REPOSITORY', 'Enter a public GitHub repository, like owner/name or a github.com URL.')
    await rateLimit(context, 'scan', 12)
    const report = await scanGithub(repo)
    context.log.info('repository scanned', { files: report.stats.filesScanned, surfaces: report.surfaces.length, truncated: Boolean(report.stats.truncated) })
    return json(report, 200, { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600' })
  },
})
