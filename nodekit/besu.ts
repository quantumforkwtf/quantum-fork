import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BESU_VERSION, parseEnode } from '../src/protocol/nodes.js'

export const KIT_HOME = join(homedir(), '.qfork-node')
const BESU_HOME = join(KIT_HOME, 'besu')
const RELEASE = `https://github.com/besu-eth/besu/releases/download/${BESU_VERSION}/besu-${BESU_VERSION}.tar.gz`
const JAVA_HOMES = ['/opt/homebrew/opt/openjdk@25', '/usr/local/opt/openjdk@25', '/opt/homebrew/opt/openjdk', '/usr/local/opt/openjdk', '/usr/lib/jvm/java-25-openjdk', '/usr/lib/jvm/java-25-openjdk-amd64']

/** Besu from QFORK_BESU, the kit's own install, or PATH. */
export function findBesu(): string | null {
  const candidates = [process.env.QFORK_BESU, join(BESU_HOME, `besu-${BESU_VERSION}`, 'bin', 'besu')].filter(Boolean) as string[]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  const which = spawnSync('which', ['besu'], { encoding: 'utf8' })
  return which.status === 0 ? which.stdout.trim() : null
}

/** Besu needs Java 25. Uses JAVA_HOME if set, otherwise a common OpenJDK install. */
export function besuEnv(): NodeJS.ProcessEnv {
  if (process.env.JAVA_HOME) return process.env
  const home = JAVA_HOMES.find((path) => existsSync(join(path, 'bin', 'java')))
  return home ? { ...process.env, JAVA_HOME: home } : process.env
}

/** Downloads the Besu release, checks its published SHA-256 and unpacks it into ~/.qfork-node/besu. */
export async function installBesu(log: (line: string) => void = console.log): Promise<string> {
  const existing = join(BESU_HOME, `besu-${BESU_VERSION}`, 'bin', 'besu')
  if (existsSync(existing)) return existing
  mkdirSync(BESU_HOME, { recursive: true })
  log(`Downloading Besu ${BESU_VERSION} from github.com/besu-eth/besu…`)
  const [archive, checksum] = await Promise.all([fetch(RELEASE), fetch(`${RELEASE}.sha256`)])
  if (!archive.ok || !checksum.ok) throw new Error(`Could not download Besu ${BESU_VERSION} (${archive.status}).`)
  const bytes = Buffer.from(await archive.arrayBuffer())
  const expected = (await checksum.text()).trim().split(/\s+/)[0]?.toLowerCase()
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!expected || actual !== expected) throw new Error('The Besu download does not match its published SHA-256. Nothing was installed.')
  const file = join(BESU_HOME, `besu-${BESU_VERSION}.tar.gz`)
  writeFileSync(file, bytes)
  const untar = spawnSync('tar', ['-xzf', file, '-C', BESU_HOME])
  rmSync(file, { force: true })
  if (untar.status !== 0 || !existsSync(existing)) throw new Error('Could not unpack Besu.')
  log(`Besu ${BESU_VERSION} installed, SHA-256 ${actual.slice(0, 16)}… verified.`)
  return existing
}

export function checkJava(besu: string): string | null {
  const result = spawnSync(besu, ['--version'], { env: besuEnv(), encoding: 'utf8' })
  const out = `${result.stdout}${result.stderr}`
  if (result.status === 0 && /besu\/v/.test(out)) return null
  if (/Java version must be at least/i.test(out) || /Unable to locate a Java Runtime|JAVA_HOME/i.test(out)) return 'Besu needs Java 25. Install it (macOS: brew install openjdk@25) or set JAVA_HOME.'
  return out.trim().split('\n').slice(-1)[0] || 'Besu did not start.'
}

/** Enode hosts must be IP addresses for Besu, so names are resolved here. */
export async function resolveEnodes(enodes: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const enode of enodes) {
    const parsed = parseEnode(enode)
    if (!parsed) continue
    const host = parsed.host.replace(/^\[|\]$/g, '')
    try {
      const address = /^[\d.]+$/.test(host) || host.includes(':') ? host : (await lookup(host, { family: 4 })).address
      resolved.push(`enode://${parsed.publicKey.slice(2)}@${address}:${parsed.port}`)
    } catch {
      // An unresolvable peer is skipped; the others still bootstrap.
    }
  }
  return resolved
}

export interface BesuNodeOptions {
  besu: string
  dataDir: string
  genesisFile: string
  keyFile: string
  p2pPort: number
  /** The address other nodes reach this one at. */
  p2pHost: string
  p2pInterface?: string
  /** The node's own RPC: bound to 127.0.0.1 only, never shared directly. */
  rpcPort: number
  bootnodes: string[]
  logFile?: string
}

export function besuArgs(options: BesuNodeOptions): string[] {
  return [
    `--data-path=${options.dataDir}`,
    `--genesis-file=${options.genesisFile}`,
    `--node-private-key-file=${options.keyFile}`,
    `--p2p-host=${options.p2pHost}`,
    `--p2p-interface=${options.p2pInterface ?? '0.0.0.0'}`,
    `--p2p-port=${options.p2pPort}`,
    ...(options.bootnodes.length ? [`--bootnodes=${options.bootnodes.join(',')}`] : []),
    '--sync-mode=FULL',
    '--rpc-http-enabled',
    '--rpc-http-host=127.0.0.1',
    `--rpc-http-port=${options.rpcPort}`,
    '--rpc-http-api=ETH,NET,WEB3,QBFT',
    '--host-allowlist=localhost,127.0.0.1',
    '--rpc-gas-cap=50000000',
    '--logging=INFO',
  ]
}

export function startBesu(options: BesuNodeOptions): ChildProcess {
  mkdirSync(options.dataDir, { recursive: true })
  const child = spawn(options.besu, besuArgs(options), { env: besuEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  if (options.logFile) {
    const append = (chunk: Buffer) => writeFileSync(options.logFile!, chunk, { flag: 'a' })
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
  }
  return child
}

export const readLog = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '')
