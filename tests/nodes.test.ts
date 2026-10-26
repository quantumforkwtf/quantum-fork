import { type ChildProcess, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, type Hex, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getStore, keys } from '../api/_lib/store'
import { besuEnv, findBesu, startBesu } from '../nodekit/besu'
import { startGateway } from '../nodekit/gateway'
import { type Directory, listingLink, loadOrCreateNodeKey, rpc, signListing, verifySeal } from '../nodekit/kit'
import type { DeploymentRecord } from '../src/protocol/deployment'
import { defaultConfig } from '../src/protocol/descendant'
import {
  besuGenesis,
  descendantChainId,
  enodeAddress,
  enodeOf,
  faultTolerance,
  gatewayRefusal,
  genesisDigest,
  genesisJson,
  isPublicHost,
  isPublicRpcUrl,
  listingMessage,
  type NodeListing,
  networkParams,
  ownerAlloc,
  parseEnode,
  qbftExtraData,
  quorum,
  removalMessage,
  type SealedSpec,
  sealMessage,
  validateListing,
} from '../src/protocol/nodes'
import type { BurnReceipt } from '../src/protocol/receipt'

const now = () => Math.floor(Date.now() / 1000)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('network rules', () => {
  it('derives a stable chain id per network, outside public chain ids', () => {
    const id = descendantChainId('lattice-1')
    expect(id).toBe(descendantChainId('lattice-1'))
    expect(id).not.toBe(descendantChainId('lattice-2'))
    expect(id).toBeGreaterThanOrEqual(1_900_000_000)
    expect(id).toBeLessThan(2_000_000_000)
  })

  it('maps hardware to block timing', () => {
    expect(networkParams({ ...defaultConfig('hybrid', 'base'), validators: { count: 4, hardware: 'high' } })).toMatchObject({ blockPeriodSeconds: 1, requestTimeoutSeconds: 4 })
    expect(networkParams(defaultConfig('hybrid', 'base'))).toMatchObject({ blockPeriodSeconds: 2, requestTimeoutSeconds: 6, gasLimit: 30_000_000 })
  })

  it('tolerates f faulty validators out of 3f + 1', () => {
    expect([1, 2, 3, 4, 6, 7, 10].map(faultTolerance)).toEqual([0, 0, 0, 1, 1, 2, 3])
    expect([1, 2, 3, 4, 5, 7].map(quorum)).toEqual([1, 2, 2, 3, 4, 5])
  })

  it('reads enodes and the address behind them', () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const enode = enodeOf(account.publicKey, 'node.example.org', 30303)
    expect(parseEnode(enode)).toMatchObject({ host: 'node.example.org', port: 30303 })
    expect(enodeAddress(enode)).toBe(account.address)
    expect(parseEnode('enode://abc@node.example.org:30303')).toBeNull()
    expect(parseEnode(enode.replace(':30303', ':70000'))).toBeNull()
  })

  it('lists only public hosts and https RPCs', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.2', '172.20.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', 'box.local', 'nodot']) expect(isPublicHost(host), host).toBe(false)
    for (const host of ['8.8.8.8', 'node.example.org', '[2001:db8::1]']) expect(isPublicHost(host), host).toBe(true)
    expect(isPublicRpcUrl('https://rpc.example.org')).toBe(true)
    expect(isPublicRpcUrl('http://rpc.example.org')).toBe(false)
    expect(isPublicRpcUrl('https://user:pw@rpc.example.org')).toBe(false)
    expect(isPublicRpcUrl('https://127.0.0.1:8545')).toBe(false)
  })

  it('validates listings', () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const listing: NodeListing = { descendant: 'dep_abcdefghijklmnop', role: 'validator', enode: enodeOf(account.publicKey, 'v.example.org', 30303), rpcUrl: null, label: 'mine', operator: account.address, issuedAt: now() }
    expect(validateListing(listing, now())).toBeNull()
    expect(validateListing({ ...listing, descendant: 'not-an-id' }, now())).toMatch(/Unknown descendant/)
    expect(validateListing({ ...listing, enode: null }, now())).toMatch(/needs its enode/)
    expect(validateListing({ ...listing, enode: enodeOf(account.publicKey, '192.168.0.8', 30303) }, now())).toMatch(/public address/)
    expect(validateListing({ ...listing, issuedAt: now() - 3600 }, now())).toMatch(/expired/)
    expect(validateListing({ ...listing, label: 'a\nb' }, now())).toMatch(/label/)
    expect(validateListing({ ...listing, role: 'rpc', enode: null }, now())).toMatch(/https URL/)
    expect(validateListing({ ...listing, role: 'rpc', enode: null, rpcUrl: 'https://rpc.example.org' }, now())).toBeNull()
  })

  it('writes a QBFT genesis with the validators in extraData and only the owner funded', () => {
    const validators = [privateKeyToAccount(generatePrivateKey()).address, privateKeyToAccount(generatePrivateKey()).address]
    const owner = privateKeyToAccount(generatePrivateKey()).address
    const spec: SealedSpec = { descendant: 'dep_abcdefghijklmnop', networkId: 'lattice-1', name: 'Lattice', params: networkParams(defaultConfig('hybrid', 'base')), validators, alloc: ownerAlloc(owner), owner, sealedAt: 1_800_000_000 }
    const genesis = besuGenesis(spec)
    expect(genesis.config).toMatchObject({ chainId: spec.params.chainId, londonBlock: 0, qbft: { blockperiodseconds: 2, epochlength: 30_000 } })
    expect(genesis.extraData).toBe(qbftExtraData(validators))
    expect(Object.keys(genesis.alloc)).toEqual([owner.toLowerCase()])
    expect(genesisDigest(spec)).toBe(genesisDigest(JSON.parse(JSON.stringify(spec)) as SealedSpec))
    expect(sealMessage(spec)).toContain(`Genesis: ${genesisDigest(spec)}`)
  })

  it('lets a shared node answer reads and signed transactions only', () => {
    for (const method of ['eth_blockNumber', 'eth_call', 'eth_sendRawTransaction', 'qbft_getValidatorsByBlockNumber']) expect(gatewayRefusal({ method, params: [] }), method).toBeNull()
    for (const method of ['eth_sendTransaction', 'eth_accounts', 'personal_unlockAccount', 'admin_addPeer', 'debug_traceTransaction', 'qbft_proposeValidatorVote', 'txpool_besuTransactions', 'anvil_setBalance', 'eth_sign', 42]) expect(gatewayRefusal({ method, params: [] }), String(method)).not.toBeNull()
    expect(gatewayRefusal({ method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: '0x3e8' }] })).toBeNull()
    expect(gatewayRefusal({ method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: '0x3e9' }] })).toMatch(/limited/)
    expect(gatewayRefusal({ method: 'eth_getLogs', params: [{ fromBlock: 'earliest', toBlock: 'latest' }] })).toMatch(/numeric/)
    expect(gatewayRefusal({ method: 'eth_getLogs', params: [{ blockHash: `0x${'1'.repeat(64)}` }] })).toBeNull()
  })
})

describe('node key', () => {
  it('is created once, owner-only, and reused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfork-node-key-'))
    try {
      const first = loadOrCreateNodeKey(join(dir, 'net'))
      expect(first.created).toBe(true)
      expect(statSync(first.file).mode & 0o777).toBe(0o600)
      const again = loadOrCreateNodeKey(join(dir, 'net'))
      expect(again).toMatchObject({ created: false, address: first.address })
      writeFileSync(join(dir, 'key'), 'nope')
      expect(() => loadOrCreateNodeKey(dir)).toThrow(/not a node key/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/* ---------- the directory API ---------- */

const store = getStore(null)
let nextIp = 0
const post = async (body: unknown) => {
  const { POST } = await import('../api/nodes')
  const response = await POST(new Request('http://localhost/api/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.${(nextIp += 1)}.1` }, body: JSON.stringify(body) }))
  return { status: response.status, body: (await response.json()) as { error: { code: string }; node: { id: string; listing: NodeListing }; network: { genesisHash: Hex }; removed?: string } }
}
const get = async (descendant: string, extra = '') => {
  const { GET } = await import('../api/nodes')
  return GET(new Request(`http://localhost/api/nodes?descendant=${descendant}${extra}`, { headers: { 'x-forwarded-for': `10.8.${(nextIp += 1)}.1` } }))
}

async function seedDescendant(id: string, owner: Hex, chain: 'base' | 'solana' = 'base') {
  const config = { ...defaultConfig('hybrid', chain === 'base' ? 'base' : 'solana'), network: { ...defaultConfig().network, name: 'Lattice', networkId: `lattice-${id.slice(-4)}` } }
  const receiptId = `0x${id.slice(4).padEnd(64, '0')}`
  await store.set(keys.deployment(id), JSON.stringify({ id, config, burn: { receiptId, chain, network: chain === 'base' ? 'base-sepolia' : 'devnet' } } as unknown as DeploymentRecord))
  await store.set(keys.receipt(receiptId), JSON.stringify({ wallet: owner } as BurnReceipt))
}

function operatorNode(descendant: string, host: string, operator = privateKeyToAccount(generatePrivateKey())) {
  const nodeKey = generatePrivateKey()
  const node = privateKeyToAccount(nodeKey)
  const listing: NodeListing = { descendant, role: 'validator', enode: enodeOf(node.publicKey, host, 30303), rpcUrl: null, label: host.split('.')[0]!, operator: operator.address, issuedAt: now() }
  return {
    operator,
    node,
    listing,
    async body(overrides: Partial<NodeListing> = {}) {
      const next = { ...listing, ...overrides }
      const message = listingMessage(next)
      return { action: 'list', listing: next, signature: await operator.signMessage({ message }), nodeSignature: await node.signMessage({ message }) }
    },
  }
}

describe('node directory API', () => {
  const owner = privateKeyToAccount(generatePrivateKey())
  const id = 'dep_nodesapitest0001'

  beforeAll(async () => {
    await seedDescendant(id, owner.address)
    await seedDescendant('dep_nodesapisolana01', owner.address, 'solana')
  })

  it('describes a descendant and whether it can run a network', async () => {
    const body = (await (await get(id)).json()) as Directory
    expect(body.descendant).toMatchObject({ id, name: 'Lattice', ancestor: 'base', chain: 'base', network: 'base-sepolia', owner: owner.address, eligible: true })
    expect(body.descendant.params.chainId).toBe(descendantChainId(body.descendant.networkId))
    expect(body).toMatchObject({ network: null, nodes: [] })
    expect(((await (await get('dep_nodesapisolana01')).json()) as Directory).descendant.eligible).toBe(false)
    expect((await get('dep_doesnotexist00000')).status).toBe(404)
    expect((await get('../etc')).status).toBe(400)
  })

  it('lists a node only with both the operator and node signatures', async () => {
    const a = operatorNode(id, 'a.example.org')
    const good = await a.body()
    expect((await post({ ...good, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: listingMessage(a.listing) }) })).body.error.code).toBe('BAD_SIGNATURE')
    expect((await post({ ...good, nodeSignature: null })).body.error.code).toBe('BAD_NODE_SIGNATURE')
    expect((await post({ ...good, nodeSignature: await owner.signMessage({ message: listingMessage(a.listing) }) })).body.error.code).toBe('BAD_NODE_SIGNATURE')
    expect((await post(await a.body({ enode: a.listing.enode!.replace('a.example.org', '10.0.0.5') }))).body.error.code).toBe('INVALID_LISTING')
    expect((await post(await a.body({ descendant: 'dep_nodesapisolana01' }))).body.error.code).toBe('NOT_RUNNABLE')
    const listed = await post(good)
    expect(listed.status).toBe(201)
    expect(listed.body.node).toMatchObject({ id: a.node.address.toLowerCase(), listing: { operator: a.operator.address } })
    expect((await post(await a.body({ label: 'renamed' }))).status).toBe(200)

    const thief = operatorNode(id, 'a.example.org')
    const stolen = { ...a.listing, operator: thief.operator.address }
    const message = listingMessage(stolen)
    expect((await post({ action: 'list', listing: stolen, signature: await thief.operator.signMessage({ message }), nodeSignature: await thief.node.signMessage({ message }) })).body.error.code).toBe('BAD_NODE_SIGNATURE')

    const nodes = ((await (await get(id)).json()) as Directory).nodes
    expect(nodes.map((node) => node.listing.label)).toEqual(['renamed'])
  })

  it('caps nodes per operator and lets operators remove their own', async () => {
    const operator = privateKeyToAccount(generatePrivateKey())
    const mine = ['b', 'c', 'd', 'e'].map((host) => operatorNode(id, `${host}.example.org`, operator))
    for (const node of mine) expect((await post(await node.body())).status).toBe(201)
    expect((await post(await operatorNode(id, 'f.example.org', operator).body())).body.error.code).toBe('TOO_MANY')

    const target = mine[3]!.node.address.toLowerCase()
    const issuedAt = now()
    const stranger = privateKeyToAccount(generatePrivateKey())
    expect((await post({ action: 'remove', descendant: id, node: target, operator: stranger.address, issuedAt, signature: await stranger.signMessage({ message: removalMessage(id, stranger.address, target, issuedAt) }) })).status).toBe(404)
    expect((await post({ action: 'remove', descendant: id, node: target, operator: operator.address, issuedAt, signature: await stranger.signMessage({ message: removalMessage(id, operator.address, target, issuedAt) }) })).body.error.code).toBe('BAD_SIGNATURE')
    expect((await post({ action: 'remove', descendant: id, node: target, operator: operator.address, issuedAt, signature: await operator.signMessage({ message: removalMessage(id, operator.address, target, issuedAt) }) })).body).toEqual({ removed: target })
    expect(((await (await get(id)).json()) as Directory).nodes).toHaveLength(4)
  })

  it('seals the genesis once, signed by the owner, from listed validators only', async () => {
    const directory = (await (await get(id)).json()) as Directory
    const validators = directory.nodes.map((node) => getAddress(node.id))
    const sealedAt = now()
    const spec: SealedSpec = { descendant: id, networkId: directory.descendant.networkId, name: 'Lattice', params: directory.descendant.params, validators, alloc: ownerAlloc(owner.address), owner: owner.address, sealedAt }
    const signature = await owner.signMessage({ message: sealMessage(spec) })
    const seal = (overrides: Record<string, unknown>) => post({ action: 'seal', descendant: id, validators, sealedAt, signature, ...overrides })

    expect((await seal({ signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: sealMessage(spec) }) })).body.error.code).toBe('BAD_SIGNATURE')
    expect((await seal({ validators: [...validators, privateKeyToAccount(generatePrivateKey()).address] })).body.error.code).toBe('NOT_LISTED')
    expect((await seal({ validators: [validators[0], validators[0]] })).body.error.code).toBe('INVALID_REQUEST')
    expect((await seal({ validators: validators.slice(1) })).body.error.code).toBe('BAD_SIGNATURE')
    const sealed = await seal({})
    expect(sealed.status).toBe(201)
    expect(sealed.body.network.genesisHash).toBe(genesisDigest(spec))
    expect((await seal({})).body.error.code).toBe('SEALED')

    const genesis = await get(id, '&genesis=1')
    expect(genesis.headers.get('content-disposition')).toContain('.genesis.json')
    expect(await genesis.text()).toBe(genesisJson(spec))

    const latest = (await (await get(id)).json()) as Directory
    expect(await verifySeal(latest)).toBeNull()
    expect(await verifySeal({ ...latest, network: { ...latest.network!, spec: { ...latest.network!.spec, alloc: ownerAlloc(validators[0]!) } } })).toMatch(/does not match/)
    expect(await verifySeal({ ...latest, network: { ...latest.network!, spec: { ...latest.network!.spec, owner: validators[0]! } } })).toMatch(/different owner/)
    expect(await verifySeal({ ...latest, network: null })).toMatch(/not sealed/)
  })

  it('builds a listing link signed by the node key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfork-node-link-'))
    try {
      const key = loadOrCreateNodeKey(dir)
      const listing: NodeListing = { descendant: id, role: 'validator', enode: enodeOf(key.publicKey, 'g.example.org', 30303), rpcUrl: null, label: '', operator: owner.address, issuedAt: now() }
      const link = listingLink('https://quantumfork.wtf/', listing, await signListing(key, listing))
      expect(link.startsWith(`https://quantumfork.wtf/network/${id}/nodes#list=`)).toBe(true)
      const payload = JSON.parse(Buffer.from(link.split('#list=')[1]!, 'base64url').toString()) as { listing: NodeListing; nodeSignature: Hex }
      expect(payload.listing).toEqual(listing)
      const signature = await owner.signMessage({ message: listingMessage(listing) })
      expect((await post({ action: 'list', listing, signature, nodeSignature: payload.nodeSignature })).status).toBe(201)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/* ---------- the RPC gateway ---------- */

describe('RPC gateway', () => {
  let upstream: Server
  let gateway: Server
  let url = ''
  const seen: string[] = []

  beforeAll(async () => {
    upstream = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => (raw += chunk))
      request.on('end', () => {
        const call = JSON.parse(raw) as { id: unknown; method: string }
        seen.push(call.method)
        response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: '0x1' }))
      })
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const port = (upstream.address() as { port: number }).port
    const started = await startGateway({ upstream: `http://127.0.0.1:${port}`, port: 0, chainId: 1_900_000_001 })
    gateway = started.server
    url = started.url
  })

  afterAll(() => {
    upstream.close()
    gateway.close()
  })

  const send = (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('forwards allowed calls and never forwards the rest', async () => {
    const answer = await send([{ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber' }, { jsonrpc: '2.0', id: 2, method: 'admin_addPeer', params: ['enode://x'] }, { jsonrpc: '2.0', id: 3, method: 'qbft_proposeValidatorVote', params: [] }])
    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
    const results = (await answer.json()) as { id: number; result?: string; error?: { code: number } }[]
    expect(results.map((result) => result.result ?? result.error?.code)).toEqual(['0x1', -32601, -32601])
    expect(seen).toEqual(['eth_blockNumber'])
  })

  it('refuses oversize bodies and batches', async () => {
    expect((await send('{'.padEnd(200_000, ' '))).status).toBe(413)
    expect((await send(Array.from({ length: 21 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'eth_chainId' })))).status).toBe(400)
    expect((await send('not json')).status).toBe(400)
    expect(await (await fetch(url)).json()).toMatchObject({ name: 'qfork-node-gateway', chainId: 1_900_000_001 })
    const preflight = await fetch(url, { method: 'OPTIONS' })
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
  })
})

/* ---------- a real multi-validator network ---------- */

const besu = findBesu()
const besuWorks = besu !== null && spawnSync(besu, ['--version'], { env: besuEnv(), encoding: 'utf8' }).stdout?.includes('besu/v')

describe.skipIf(!besuWorks)('QBFT network on Besu (4 validators, then a 5th voted in)', () => {
  const root = mkdtempSync(join(tmpdir(), 'qfork-qbft-'))
  const P2P = 30_411
  const RPC = 18_611
  const nodes: { key: ReturnType<typeof loadOrCreateNodeKey>; process: ChildProcess | null; rpc: string; enode: string }[] = []
  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey)
  let spec: SealedSpec
  let genesisFile = ''

  const height = async (node: number) => Number(await rpc<Hex>(nodes[node]!.rpc, 'eth_blockNumber'))
  const start = (index: number, bootnodes: string[]) => {
    const node = nodes[index]!
    node.process = startBesu({ besu: besu!, dataDir: join(root, `n${index}`, 'data'), genesisFile, keyFile: node.key.file, p2pPort: P2P + index, p2pHost: '127.0.0.1', p2pInterface: '127.0.0.1', rpcPort: RPC + index, bootnodes, logFile: join(root, `n${index}`, 'besu.log') })
  }
  const until = async (what: string, check: () => Promise<boolean>, ms: number) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await check().catch(() => false)) return
      await wait(500)
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  beforeAll(async () => {
    process.env.BESU_OPTS = '-Xmx640m'
    for (let index = 0; index < 5; index += 1) {
      const key = loadOrCreateNodeKey(join(root, `n${index}`))
      nodes.push({ key, process: null, rpc: `http://127.0.0.1:${RPC + index}`, enode: enodeOf(key.publicKey, '127.0.0.1', P2P + index) })
    }
    spec = {
      descendant: 'dep_qbftintegration01',
      networkId: 'qbft-it',
      name: 'QBFT integration',
      params: { chainId: descendantChainId('qbft-it'), blockPeriodSeconds: 1, epochLength: 30_000, requestTimeoutSeconds: 4, gasLimit: 30_000_000 },
      validators: nodes.slice(0, 4).map((node) => node.key.address),
      alloc: ownerAlloc(owner.address),
      owner: owner.address,
      sealedAt: now(),
    }
    genesisFile = join(root, 'genesis.json')
    writeFileSync(genesisFile, genesisJson(spec))
    for (let index = 0; index < 4; index += 1) start(index, index === 0 ? [] : [nodes[0]!.enode])
    await until('4 nodes to answer RPC', async () => (await Promise.all([0, 1, 2, 3].map((index) => height(index).then(() => true, () => false)))).every(Boolean), 120_000)
  }, 150_000)

  afterAll(async () => {
    for (const node of nodes) node.process?.kill('SIGKILL')
    await wait(500)
    rmSync(root, { recursive: true, force: true })
  })

  it('agrees on one chain from the sealed genesis', async () => {
    await until('every validator past block 5', async () => (await Promise.all([0, 1, 2, 3].map(height))).every((value) => value >= 5), 90_000)
    const hashes = await Promise.all([0, 1, 2, 3].map((index) => rpc<{ hash: Hex }>(nodes[index]!.rpc, 'eth_getBlockByNumber', ['0x5', false]).then((block) => block.hash)))
    expect(new Set(hashes).size).toBe(1)
    const genesis = await rpc<{ extraData: Hex; timestamp: Hex }>(nodes[2]!.rpc, 'eth_getBlockByNumber', ['0x0', false])
    expect(genesis.extraData).toBe(qbftExtraData(spec.validators))
    expect(await rpc<Hex>(nodes[1]!.rpc, 'eth_chainId')).toBe(`0x${spec.params.chainId.toString(16)}`)
    const validators = await rpc<Hex[]>(nodes[3]!.rpc, 'qbft_getValidatorsByBlockNumber', ['latest'])
    expect(validators.map((address) => getAddress(address)).sort()).toEqual([...spec.validators].sort())
    const proposers = new Set<string>()
    for (let block = 1; block <= 5; block += 1) proposers.add((await rpc<{ miner: Hex }>(nodes[0]!.rpc, 'eth_getBlockByNumber', [`0x${block.toString(16)}`, false])).miner.toLowerCase())
    expect(proposers.size).toBeGreaterThan(1)
  }, 120_000)

  it('takes signed transactions through the gateway and finalizes them on every node', async () => {
    const gateway = await startGateway({ upstream: nodes[1]!.rpc, port: 0, chainId: spec.params.chainId })
    try {
      const recipient = privateKeyToAccount(generatePrivateKey()).address
      const raw = await owner.signTransaction({ chainId: spec.params.chainId, type: 'eip1559', to: recipient, value: parseEther('5'), nonce: 0, gas: 21_000n, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })
      const hash = await rpc<Hex>(gateway.url, 'eth_sendRawTransaction', [raw])
      await expect(rpc(gateway.url, 'qbft_proposeValidatorVote', [recipient, true])).rejects.toThrow(/not available/)
      await until('the transfer to finalize on node 3', async () => (await rpc<{ status: Hex } | null>(nodes[3]!.rpc, 'eth_getTransactionReceipt', [hash]))?.status === '0x1', 30_000)
      expect(BigInt(await rpc<Hex>(nodes[0]!.rpc, 'eth_getBalance', [recipient, 'latest']))).toBe(parseEther('5'))
    } finally {
      gateway.server.close()
    }
  }, 60_000)

  it(`keeps finalizing with one of four validators down (tolerates ${faultTolerance(4)}), and the restarted one catches up`, async () => {
    nodes[3]!.process?.kill('SIGKILL')
    nodes[3]!.process = null
    const before = await height(0)
    await until('blocks with node 3 down', async () => (await height(0)) >= before + 6, 90_000)
    const [a, b] = await Promise.all([height(1), height(2)])
    const common = Math.min(a, b)
    const [hashA, hashB] = await Promise.all([1, 2].map((index) => rpc<{ hash: Hex }>(nodes[index]!.rpc, 'eth_getBlockByNumber', [`0x${common.toString(16)}`, false]).then((block) => block.hash)))
    expect(hashA).toBe(hashB)

    start(3, [nodes[0]!.enode])
    await until('node 3 to catch up after restarting', async () => (await height(3)) >= (await height(0)) - 1, 120_000)
  }, 240_000)

  it('votes a fifth machine in as a validator, and it proposes blocks', async () => {
    start(4, [nodes[0]!.enode, nodes[1]!.enode])
    await until('node 4 to sync', async () => (await height(4)) >= (await height(0)) - 1, 120_000)
    const candidate = nodes[4]!.key.address
    for (const index of [0, 1, 2, 3]) expect(await rpc<boolean>(nodes[index]!.rpc, 'qbft_proposeValidatorVote', [candidate, true])).toBe(true)
    await until('the vote to pass', async () => (await rpc<Hex[]>(nodes[0]!.rpc, 'qbft_getValidatorsByBlockNumber', ['latest'])).some((address) => getAddress(address) === candidate), 120_000)
    const joined = await height(0)
    await until('node 4 to propose a block', async () => {
      const tip = await height(0)
      for (let block = joined + 1; block <= tip; block += 1) {
        if (getAddress((await rpc<{ miner: Hex }>(nodes[0]!.rpc, 'eth_getBlockByNumber', [`0x${block.toString(16)}`, false])).miner) === candidate) return true
      }
      return false
    }, 120_000)
    expect(await rpc<Hex[]>(nodes[4]!.rpc, 'qbft_getValidatorsByBlockNumber', ['latest'])).toHaveLength(5)
  }, 300_000)
})
