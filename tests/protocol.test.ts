import { describe, expect, it } from 'vitest'
import { ANCESTORS, DEFAULT_ANCESTOR, BASE_FINDINGS, BASE_LOCI, exposureCounts, findingsFor, locusStatus, SOLANA_FINDINGS, SOLANA_LOCI } from '../src/protocol/ancestors'
import { resolveConfig, tierAvailability } from '../src/protocol/config'
import { burnMemo, canTransition, type DeploymentRecord, HAPPY_PATH, isTerminalSuccess, parseBurnMemo, STATE_LABEL, stateLabel, transition, TransitionError } from '../src/protocol/deployment'
import { applyProfile, defaultConfig, descendantSchema, genomeDiff, genomeHash, normalizeConfig } from '../src/protocol/descendant'
import { MODULE_BY_ID, moduleFor, PQ_MODULES, withDependencies } from '../src/protocol/modules'
import { assertNoSecrets, devKitFiles, type DevKitInput, descendantManifest, quickstart } from '../src/protocol/devKit'
import { formatBaseUnits, quoteGenesis, toBaseUnits } from '../src/protocol/pricing'
import { SOURCE_BY_ID } from '../src/protocol/sources'
import { MEMO_PROGRAM, type ParsedTx, TOKEN_2022_PROGRAM, verifyBurnTransaction } from '../src/protocol/verifyBurn'

const MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const WALLET = 'Wa11et1111111111111111111111111111111111111'
const ACCOUNT = 'Acc0unt111111111111111111111111111111111111'
const DEPLOYMENT = 'dep_0123456789abcdef'

function burnTx(overrides: { amount?: string; mint?: string; memo?: string; signer?: boolean; err?: unknown; extraProgram?: string; post?: string } = {}): ParsedTx {
  const amount = overrides.amount ?? '125000000000'
  const instructions: ParsedTx['transaction']['message']['instructions'] = [
    {
      programId: TOKEN_2022_PROGRAM,
      program: 'spl-token-2022',
      parsed: { type: 'burnChecked', info: { account: ACCOUNT, mint: overrides.mint ?? MINT, authority: WALLET, tokenAmount: { amount, decimals: 6 } } },
    },
    { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: overrides.memo ?? burnMemo(DEPLOYMENT) },
  ]
  if (overrides.extraProgram) instructions.push({ programId: overrides.extraProgram, data: '', accounts: [] })
  return {
    slot: 42,
    blockTime: 1_760_000_000,
    meta: {
      err: overrides.err ?? null,
      preTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: '500000000000', decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: overrides.post ?? '375000000000', decimals: 6 } }],
    },
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          { pubkey: WALLET, signer: overrides.signer ?? true, writable: true },
          { pubkey: ACCOUNT, signer: false, writable: true },
          { pubkey: MINT, signer: false, writable: true },
        ],
        instructions,
      },
    },
  }
}

const expected = { mint: MINT, amountRaw: 125_000_000_000n, decimals: 6, memo: burnMemo(DEPLOYMENT) }

describe('burn verification', () => {
  it('accepts an exact, signed, memo-bound burn', () => {
    const result = verifyBurnTransaction(burnTx(), expected)
    expect(result).toMatchObject({ ok: true, wallet: WALLET, tokenProgram: TOKEN_2022_PROGRAM, slot: 42 })
  })

  it.each([
    ['missing transaction', null, 'TX_NOT_FOUND'],
    ['failed transaction', burnTx({ err: { InstructionError: [0, 'Custom'] } }), 'TX_FAILED'],
    ['wrong amount', burnTx({ amount: '1' }), 'WRONG_AMOUNT'],
    ['wrong mint', burnTx({ mint: 'Other111111111111111111111111111111111111111' }), 'WRONG_MINT'],
    ['unsigned authority', burnTx({ signer: false }), 'AUTHORITY_NOT_SIGNER'],
    ['memo for another deployment', burnTx({ memo: burnMemo('dep_ffffffffffffffff') }), 'MEMO_MISMATCH'],
    ['unexpected program', burnTx({ extraProgram: '11111111111111111111111111111111' }), 'UNEXPECTED_PROGRAM'],
    ['balance not reduced', burnTx({ post: '500000000000' }), 'BALANCE_MISMATCH'],
  ] as const)('rejects %s', (_label, tx, code) => {
    const result = verifyBurnTransaction(tx, expected)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(code)
  })

  it('parses only well-formed memos', () => {
    expect(parseBurnMemo(burnMemo(DEPLOYMENT))).toEqual({ purpose: 'genesis', deploymentId: DEPLOYMENT })
    expect(parseBurnMemo('qfork:v1:genesis:../../etc')).toBeNull()
  })
})

function record(): DeploymentRecord {
  const config = defaultConfig()
  return {
    id: DEPLOYMENT,
    correlationId: 'corr',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    enteredAt: '2026-10-15T00:00:00.000Z',
    state: 'DRAFT',
    tier: 'testnet',
    config,
    genomeHash: '0x00',
    descendantId: 'QF-0001',
    burn: { required: 1, mint: null, network: null, memo: burnMemo(DEPLOYMENT), signature: null, receiptId: null },
    history: [],
    error: null,
    version: 0,
  }
}

describe('deployment state machine', () => {
  it('walks the happy path to registration and refuses shortcuts', () => {
    const now = new Date('2026-10-15T00:00:01Z')
    let current = record()
    expect(() => transition(current, 'REGISTERED', now)).toThrow(TransitionError)
    for (const state of HAPPY_PATH.slice(1)) current = transition(current, state, now)
    expect(current.state).toBe('REGISTERED')
    expect(current.version).toBe(5)
    expect(isTerminalSuccess(current.state)).toBe(true)
    expect(canTransition('BURN_CONFIRMED', 'AWAITING_BURN')).toBe(false)
    expect(canTransition('AWAITING_BURN', 'REGISTERED')).toBe(false)
    expect(canTransition('BURN_FAILED', 'AWAITING_BURN')).toBe(true)
    expect(canTransition('REGISTERED', 'AWAITING_BURN')).toBe(false)
  })

  it('labels states without implying a running network', () => {
    expect(stateLabel('BURN_CONFIRMED', 'devnet')).toMatch(/devnet/)
    for (const label of Object.values(STATE_LABEL)) expect(label).not.toMatch(/online|genesis|provision|validator|simulat/i)
  })
})

describe('configuration safety', () => {
  it('defaults every dangerous flag to off', () => {
    const { config } = resolveConfig({}, 'VITE_')
    expect(config.flags).toMatchObject({ realBurns: false, testnetDeployments: false, mainnetDeployments: false, pumpfunData: false })
    expect(config.tokenStatus).toBe('PRELAUNCH')
    expect(config.network).toBe('devnet')
  })

  it('refuses LIVE without a mint and real burns before launch', () => {
    const { config, issues } = resolveConfig({ TOKEN_STATUS: 'LIVE', ENABLE_REAL_BURNS: 'true' })
    expect(config.tokenStatus).toBe('PRELAUNCH')
    expect(config.flags.realBurns).toBe(false)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('keeps mainnet registration off unless every condition is met', () => {
    const full = { SOLANA_NETWORK: 'mainnet-beta', TOKEN_STATUS: 'LIVE', QFORK_MINT: MINT, ENABLE_MAINNET_DEPLOYMENTS: 'true', ENABLE_REAL_BURNS: 'true' }
    expect(tierAvailability(resolveConfig({ SOLANA_NETWORK: 'mainnet-beta', TOKEN_STATUS: 'LIVE', QFORK_MINT: MINT, ENABLE_REAL_BURNS: 'true' }).config, 'mainnet').available).toBe(false)
    expect(tierAvailability(resolveConfig({ ...full, TOKEN_STATUS: 'PRELAUNCH' }).config, 'mainnet').available).toBe(false)
    expect(tierAvailability(resolveConfig({ ...full, SOLANA_NETWORK: 'devnet' }).config, 'mainnet').available).toBe(false)
    const { config } = resolveConfig(full)
    expect(tierAvailability(config, 'mainnet').available).toBe(true)
    expect(tierAvailability(config, 'testnet').available).toBe(false)
  })

  it('allows a devnet rehearsal only when fully configured', () => {
    const { config } = resolveConfig({ SOLANA_NETWORK: 'devnet', TOKEN_STATUS: 'LIVE', QFORK_MINT: MINT, ENABLE_REAL_BURNS: 'true', ENABLE_TESTNET_DEPLOYMENTS: 'true' })
    expect(tierAvailability(config, 'testnet').available).toBe(true)
  })

  it('rejects non-https RPC endpoints', () => {
    const { config } = resolveConfig({ SOLANA_RPC_URL: 'http://evil.example' })
    expect(config.rpcUrl.startsWith('https://')).toBe(true)
  })
})

describe('descendant configuration', () => {
  it('resolves dependencies and validates', () => {
    const config = normalizeConfig({ ...defaultConfig(), profile: 'custom', modules: ['hsp'] })
    expect(config.modules).toEqual(withDependencies(['hsp', 'pqr']))
    expect(descendantSchema.safeParse(config).success).toBe(true)
  })

  it('rejects unknown keys and bad names', () => {
    expect(descendantSchema.safeParse({ ...defaultConfig(), extra: 1 }).success).toBe(false)
    expect(descendantSchema.safeParse({ ...defaultConfig(), network: { name: '<script>', symbol: 'Q', networkId: 'x' } }).success).toBe(false)
  })

  it('hashes deterministically and ignores the tier', async () => {
    const a = defaultConfig()
    expect(await genomeHash(a)).toBe(await genomeHash({ ...a, tier: 'testnet' }))
    expect(await genomeHash(a)).not.toBe(await genomeHash(applyProfile(a, 'research')))
  })

  it('diffs against the ancestor', () => {
    const rows = genomeDiff(defaultConfig())
    expect(rows.find((row) => row.code === 'SIG')?.changed).toBe(true)
    expect(rows.find((row) => row.code === 'HSH')?.changed).toBe(false)
  })
})

describe('pricing', () => {
  it('quotes from the configuration, in integers', () => {
    const quote = quoteGenesis(defaultConfig())
    expect(Number.isSafeInteger(quote.total)).toBe(true)
    expect(quote.total).toBe(quote.lines.reduce((sum, line) => sum + line.amount, 0))
    expect(toBaseUnits(125_000)).toBe(125_000_000_000n)
    expect(formatBaseUnits('125000500000', 6)).toBe('125,000.5')
    expect(() => toBaseUnits(1.5)).toThrow()
  })
})

describe('catalogue integrity', () => {
  it('never claims production, testnet or audits', () => {
    for (const module of PQ_MODULES) {
      expect(['RESEARCH', 'COMING SOON']).toContain(module.status)
      expect(module.audit).toBe('UNAUDITED')
      for (const dependency of module.dependencies) expect(MODULE_BY_ID[dependency]).toBeDefined()
    }
  })

  it('cites a known source on every finding and locus', () => {
    for (const item of [...SOLANA_FINDINGS, ...SOLANA_LOCI]) {
      expect(item.sources.length).toBeGreaterThan(0)
      for (const id of item.sources) expect(SOURCE_BY_ID[id]).toBeDefined()
    }
    expect(locusStatus('SIG')).toBe('EXPOSED')
    expect(exposureCounts().EXPOSED).toBeGreaterThan(0)
  })

  it('models Base with the same loci, sourced findings and unique ids', () => {
    const solanaCodes = SOLANA_LOCI.map((locus) => locus.code)
    expect(BASE_LOCI.map((locus) => locus.code)).toEqual(solanaCodes)
    for (const item of [...BASE_FINDINGS, ...BASE_LOCI]) {
      expect(item.sources.length).toBeGreaterThan(0)
      for (const id of item.sources) expect(SOURCE_BY_ID[id]).toBeDefined()
    }
    const ids = BASE_FINDINGS.map((finding) => finding.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('BASE-')).toBe(true)
    for (const code of solanaCodes) expect(findingsFor(code, 'base').length).toBeGreaterThan(0)
    expect(locusStatus('SIG', 'base')).toBe('EXPOSED')
    expect(locusStatus('HSH', 'base')).toBe('REVIEWED')
    expect(BASE_FINDINGS.some((finding) => finding.status === 'MIGRATION AVAILABLE')).toBe(false)
  })

  it('makes Base the main ancestor, with Solana still sequenced', () => {
    expect(DEFAULT_ANCESTOR).toBe('base')
    expect(ANCESTORS[0]).toMatchObject({ id: 'base', code: 'ANCESTOR 001', status: 'AVAILABLE', lab: true })
    expect(ANCESTORS.filter((ancestor) => ancestor.lab).map((ancestor) => ancestor.id)).toEqual(['base', 'solana'])
  })
})

describe('Base-derived descendants', () => {
  it('defaults to a valid Base descendant and keeps Solana descendants valid', () => {
    const base = defaultConfig()
    const solana = defaultConfig('hybrid', 'solana')
    expect(base.ancestor).toBe('base')
    expect(descendantSchema.safeParse(base).success).toBe(true)
    expect(descendantSchema.safeParse(solana).success).toBe(true)
    expect(base.network.networkId).not.toBe(solana.network.networkId)
  })

  it('diffs against the right ancestor', () => {
    const sig = (ancestor: 'base' | 'solana') => genomeDiff(defaultConfig('hybrid', ancestor)).find((row) => row.code === 'SIG')
    expect(sig('base')?.ancestor).toMatch(/secp256k1/)
    expect(sig('solana')?.ancestor).toMatch(/Ed25519/)
    expect(sig('base')?.changed).toBe(true)
  })

  it('describes modules in the ancestor’s own cryptography', () => {
    expect(moduleFor('hsp').primitive).toMatch(/secp256k1/)
    expect(moduleFor('hsp', 'solana').primitive).toMatch(/Ed25519/)
    expect(moduleFor('hsp', 'solana').code).toBe(MODULE_BY_ID.hsp.code)
  })

  it('hashes the ancestor into the genome', async () => {
    const base = defaultConfig()
    expect(await genomeHash(base)).not.toBe(await genomeHash({ ...base, ancestor: 'solana' }))
  })
})

describe('developer kit', () => {
  const kit = (chain: 'base' | 'solana'): DevKitInput => ({
    id: 'dep_test',
    code: 'QF-0001',
    config: defaultConfig(),
    generation: 1,
    parent: 'base',
    registeredAt: null,
    chain,
    cluster: 'devnet',
    baseNetwork: 'base-sepolia',
    burnSignature: null,
    tokens: chain === 'base' ? [{ name: 'Quantum Base', symbol: 'QBASE', decimals: 18, mint: '0x1111111111111111111111111111111111111111', kind: 'clanker', cluster: 'base-sepolia' }] : [],
    siteUrl: 'https://quantumfork.wtf',
  })

  it('points a Base registration at Base with cast commands', () => {
    const steps = quickstart(kit('base'))
    expect(steps.flatMap((step) => step.commands).every((command) => command.startsWith('cast '))).toBe(true)
    expect(steps[0].commands[0]).toContain('https://sepolia.base.org')
    expect(descendantManifest(kit('base'))).toMatchObject({ ancestor: 'base', registration: { chain: 'base', network: 'base-sepolia' } })
    const files = assertNoSecrets(devKitFiles(kit('base')))
    expect(files.find((file) => file.name === 'qfork.config.ts')?.contents).toContain("from 'viem/chains'")
  })

  it('keeps the Solana kit for Solana registrations', () => {
    expect(quickstart(kit('solana'))[0].commands[0]).toMatch(/^solana config set/)
    expect(descendantManifest(kit('solana')).registration).toEqual({ chain: 'solana', network: 'devnet', burnSignature: null })
  })
})
