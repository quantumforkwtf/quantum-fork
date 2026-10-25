import { describe, expect, it } from 'vitest'
import { TarReader } from '../api/_lib/tar'
import { AppScanner, classifyPath, locationUrl, parseRepoInput, reportToMarkdown, scanTexts } from '../src/protocol/appScan'

const SOURCE = { kind: 'paste' as const, label: 'test' }
const ids = (files: { path: string; text: string }[]) => scanTexts(files, SOURCE).surfaces.map((surface) => surface.ruleId)

describe('app scan rules', () => {
  it('finds classical public-key cryptography across languages', () => {
    expect(ids([{ path: 'src/keys.ts', text: "const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })" }])).toEqual(['rsa-signature'])
    expect(ids([{ path: 'src/box.js', text: 'const shared = nacl.box.before(theirPublic, mySecret)' }])).toEqual(['ecdh'])
    expect(ids([{ path: 'app/crypto.py', text: 'key = ec.generate_private_key(ec.SECP384R1())' }])).toEqual(['ecdsa'])
    expect(ids([{ path: 'main.go', text: 'import "crypto/ecdh"' }])).toEqual(['ecdh'])
    expect(ids([{ path: 'Auth.java', text: 'Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");' }])).toEqual(['rsa-encryption'])
    expect(ids([{ path: 'src/token.ts', text: "jwt.sign(payload, key, { algorithm: 'RS256' })" }])).toEqual(['jwt'])
    expect(ids([{ path: 'server.ts', text: 'https.createServer(options, app)' }])).toEqual(['tls'])
  })

  it('does not mistake post-quantum names for classical ones', () => {
    const report = scanTexts([{ path: 'src/pq.ts', text: "const suite = 'ML-DSA-65'\nconst kem = 'X25519MLKEM768'\nconst slh = 'SLH-DSA-SHA2-128s'\nexport type DSA = Signer & {}\ncrypto_sign_open(sig)" }], SOURCE)
    expect(report.surfaces.map((surface) => surface.ruleId)).toEqual(['pq'])
    expect(report.summary.vulnerable).toBe(0)
    expect(report.summary.postQuantum).toBe(3)
  })

  it('reports a line once under its most specific rule', () => {
    expect(ids([{ path: 'src/a.ts', text: "const ecdh = createECDH('prime256v1')" }])).toEqual(['ecdh'])
    expect(ids([{ path: 'deploy/sshd_config', text: 'HostKeyAlgorithms ssh-ed25519,ssh-dss' }])).toEqual(['ssh'])
    expect(ids([{ path: 'src/b.ts', text: "const key = await generateKeyPair('ec', { namedCurve: 'P-256' })" }])).toEqual(['ecdsa'])
  })

  it('recognises classical primitives used inside a post-quantum hybrid', () => {
    const report = scanTexts([{ path: 'src/kem.ts', text: "export const kem = combine(ml_kem768, x25519)\nconst plain = x25519.getSharedSecret(a, b)" }], SOURCE)
    const ecdh = report.surfaces.find((surface) => surface.ruleId === 'ecdh')
    expect(ecdh).toMatchObject({ occurrences: 2, hybridOccurrences: 1, sourceOccurrences: 1 })
    expect(ecdh?.locations.map((location) => location.hybrid)).toEqual([false, true])
    expect(report.summary).toMatchObject({ vulnerableInCode: 1, hybrid: 1 })
  })

  it('ranks application code ahead of comments', () => {
    const report = scanTexts([{ path: 'src/a.ts', text: "// we use createECDH('x') below\nconst e = createECDH(curve)" }], SOURCE)
    expect(report.surfaces[0].occurrences).toBe(2)
    expect(report.surfaces[0].sourceOccurrences).toBe(1)
    expect(report.summary.vulnerableInCode).toBe(1)
    expect(report.surfaces[0].locations.map((location) => location.line)).toEqual([2, 1])
  })

  it('ranks harvest-now exposures first and separates what the app cannot fix', () => {
    const report = scanTexts(
      [
        { path: 'src/a.ts', text: "signTransaction(tx)\nconst ecdh = createECDH('prime256v1')\nconst h = createHash('md5')" },
        { path: 'src/b.ts', text: 'cipher = "aes-128-gcm"' },
      ],
      SOURCE,
    )
    expect(report.surfaces[0].ruleId).toBe('ecdh')
    expect(report.surfaces[0].harvestNow).toBe(true)
    expect(report.summary.outsideApp).toBe(1)
    expect(report.summary.weakened).toBe(1)
    expect(report.summary.classical).toBe(1)
  })

  it('never returns key material', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----'
    const report = scanTexts(
      [
        { path: 'certs/server.key', text: pem },
        { path: 'src/wallet.ts', text: `const signer = Keypair.fromSecretKey(bs58.decode("${'4'.repeat(88)}"))` },
        { path: 'src/evm.ts', text: `privateKeyToAccount('0x${'ab'.repeat(32)}')` },
        { path: 'src/jwk.ts', text: 'const jwk = {"kty":"oct","alg":"A128GCM","k":"XctOhJAkA-pD9Lh7ZgW_2A"}' },
      ],
      SOURCE,
    )
    const text = JSON.stringify(report)
    expect(text).not.toContain('XctOhJAkA')
    expect(text).not.toContain('MIIEvQ')
    expect(text).not.toContain('4'.repeat(40))
    expect(text).not.toContain('ab'.repeat(32))
    expect(report.surfaces.find((surface) => surface.ruleId === 'private-key')?.locations[0].excerpt).toBe('-----BEGIN PRIVATE KEY-----')
  })

  it('marks findings in tests and examples', () => {
    const report = scanTexts([{ path: 'tests/keys.test.ts', text: "generateKeyPairSync('ec', {})" }], SOURCE)
    expect(report.surfaces[0].locations[0].test).toBe(true)
    expect(report.surfaces[0].sourceOccurrences).toBe(0)
  })
})

describe('app scan files', () => {
  it('skips dependencies, lockfiles, secrets, docs and generated code', () => {
    expect(classifyPath('node_modules/elliptic/index.js')).toEqual({ skip: 'directory' })
    expect(classifyPath('package-lock.json')).toEqual({ skip: 'lockfile' })
    expect(classifyPath('.env.production')).toEqual({ skip: 'secrets' })
    expect(classifyPath('README.md')).toEqual({ skip: 'docs' })
    expect(classifyPath('public/app.min.js')).toEqual({ skip: 'generated' })
    expect(classifyPath('src/index.ts')).toEqual({ kind: 'code', language: 'TypeScript' })
    expect(classifyPath('deploy/nginx.conf')).toEqual({ kind: 'config', language: 'Config' })
  })

  it('skips files over the size limit without reading them', () => {
    const scanner = new AppScanner()
    expect(scanner.admit('src/huge.ts', 10 * 1024 * 1024)).toBeNull()
    expect(scanner.report(SOURCE).stats.skipped['too-large']).toBe(1)
  })

  it('reads dependencies from manifests, not from prose', () => {
    const report = scanTexts(
      [
        { path: 'package.json', text: JSON.stringify({ description: 'uses tweetnacl in prose', dependencies: { jsonwebtoken: '^9', '@noble/post-quantum': '^0.4' } }) },
        { path: 'pyproject.toml', text: '[project]\nname = "app"\ndescription = "a solana tool"\ndependencies = [\n  "cryptography>=42",\n  "requests",\n]\n' },
        { path: 'requirements.txt', text: '# comment\necdsa==0.19\n-r base.txt\n' },
        { path: 'Cargo.toml', text: '[package]\nname = "x"\n\n[dependencies]\ned25519-dalek = "2"\nserde = "1"\n' },
        { path: 'go.mod', text: 'module x\n\nrequire (\n\tgithub.com/cloudflare/circl v1.6.0\n)\n' },
      ],
      SOURCE,
    )
    const names = report.dependencies.map((dep) => dep.name).sort()
    expect(names).toEqual(['@noble/post-quantum', 'cryptography', 'ecdsa', 'ed25519-dalek', 'github.com/cloudflare/circl', 'jsonwebtoken'])
    expect(report.dependencies.find((dep) => dep.name === 'jsonwebtoken')?.risk).toBe('REVIEW')
  })
})

describe('repository input', () => {
  it('accepts owner/name and github.com URLs', () => {
    expect(parseRepoInput('vercel/next.js')).toEqual({ owner: 'vercel', name: 'next.js', ref: null })
    expect(parseRepoInput('https://github.com/panva/jose.git')).toEqual({ owner: 'panva', name: 'jose', ref: null })
    expect(parseRepoInput('github.com/a/b/tree/release/v2')).toEqual({ owner: 'a', name: 'b', ref: 'release/v2' })
    expect(parseRepoInput('a/b', 'main')).toEqual({ owner: 'a', name: 'b', ref: 'main' })
  })

  it('rejects anything that could leave github.com/<owner>/<repo>', () => {
    for (const input of ['', 'a', '../x/y', 'https://evil.com/a/b', 'a/..', 'a b/c', '-a/b']) expect(parseRepoInput(input)).toBeNull()
    expect(parseRepoInput('a/b', '../../etc')).toBeNull()
    expect(parseRepoInput('a/b', 'main?x=1')).toBeNull()
  })

  it('links findings to the scanned commit', () => {
    const source = { kind: 'github' as const, label: 'a/b', commit: 'f'.repeat(40), url: 'https://github.com/a/b' }
    expect(locationUrl(source, { path: 'src/x y.ts', line: 3, excerpt: '', test: false, comment: false, hybrid: false })).toBe(`https://github.com/a/b/blob/${'f'.repeat(40)}/src/x%20y.ts#L3`)
  })

  it('exports markdown', () => {
    const report = scanTexts([{ path: 'src/a.ts', text: "createECDH('prime256v1')" }], SOURCE)
    expect(reportToMarkdown(report)).toContain('## Elliptic-curve key exchange (ECDH, X25519)')
  })
})

/* ---------- tar ---------- */

function header(name: string, size: number, type = '0') {
  const block = new Uint8Array(512)
  const write = (text: string, offset: number) => block.set(new TextEncoder().encode(text), offset)
  write(name, 0)
  write(size.toString(8).padStart(11, '0'), 124)
  write(type, 156)
  write('ustar', 257)
  return block
}

function pad(data: Uint8Array) {
  const out = new Uint8Array(Math.ceil(data.length / 512) * 512)
  out.set(data)
  return out
}

function paxRecord(key: string, value: string) {
  const body = ` ${key}=${value}\n`
  let length = body.length + 1
  while (`${length}${body}`.length !== length) length = `${length}${body}`.length
  return `${length}${body}`
}

function tarball(entries: { name: string; text: string; type?: string }[]) {
  const blocks: Uint8Array[] = []
  for (const entry of entries) {
    const data = new TextEncoder().encode(entry.text)
    blocks.push(header(entry.name, data.length, entry.type), pad(data))
  }
  blocks.push(new Uint8Array(1024))
  const total = blocks.reduce((sum, block) => sum + block.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  return out
}

describe('tar reader', () => {
  it('reads files across arbitrary chunk boundaries, with pax and long names', () => {
    const long = `repo-abc/${'deep/'.repeat(30)}file.ts`
    const archive = tarball([
      { name: 'pax_global_header', text: paxRecord('comment', 'a'.repeat(40)), type: 'g' },
      { name: 'repo-abc/', text: '', type: '5' },
      { name: 'repo-abc/src/a.ts', text: "createECDH('x')" },
      { name: 'PaxHeader', text: paxRecord('path', long), type: 'x' },
      { name: 'ignored-name', text: 'export const y = 1' },
      { name: 'repo-abc/big.bin', text: 'x'.repeat(3000) },
    ])
    for (const size of [1, 7, 511, 512, 513, 4096, archive.length]) {
      const files: Record<string, string> = {}
      const reader = new TarReader({ want: (path) => !path.endsWith('.bin'), file: (path, data) => (files[path] = new TextDecoder().decode(data)) })
      for (let offset = 0; offset < archive.length; offset += size) reader.push(archive.subarray(offset, offset + size))
      expect(reader.done).toBe(true)
      expect(reader.globals.comment).toBe('a'.repeat(40))
      expect(files).toEqual({ 'repo-abc/src/a.ts': "createECDH('x')", [long]: 'export const y = 1' })
    }
  })
})
