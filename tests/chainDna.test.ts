import { describe, expect, it } from 'vitest'
import { dnaGlyph } from '../src/lab/dnaGlyph'
import {
  anvilArgs,
  type ChainDna,
  chainDnaSchema,
  decodeShare,
  defaultDna,
  diffDna,
  dnaHash,
  encodeShare,
  FIELDS,
  normalizeDna,
  parseDna,
  readiness,
  retarget,
  TARGET_IDS,
  technicalHash,
  validateDna,
} from '../src/protocol/chainDna'

const errors = (dna: ChainDna) => validateDna(dna).filter((issue) => issue.level === 'error')
const edit = (dna: ChainDna, change: (draft: ChainDna) => void) => {
  const next = structuredClone(dna)
  change(next)
  return next
}

describe('Chain DNA schema', () => {
  it('ships valid defaults for every target', () => {
    for (const target of TARGET_IDS) {
      const dna = defaultDna(target)
      expect(chainDnaSchema.safeParse(dna).success).toBe(true)
      expect(errors(dna)).toEqual([])
    }
  })

  it('declares a support level for every target on every option', () => {
    for (const field of FIELDS) for (const option of Object.values(field.options)) for (const target of TARGET_IDS) expect(option.support[target]).toBeTruthy()
  })

  it('rejects unknown keys and malformed documents', () => {
    expect(parseDna({ ...defaultDna(), extra: 1 }).ok).toBe(false)
    expect(parseDna('{not json').ok).toBe(false)
    expect(parseDna({ ...defaultDna(), spec: 'qfork/chain-dna/v0' }).ok).toBe(false)
  })
})

describe('Compatibility checks', () => {
  it('locks what Base fixes', () => {
    const dna = normalizeDna({ ...defaultDna('base'), network: { ...defaultDna('base').network, blockTimeMs: 400, gasLimit: 9_000_000, settlement: 'base' } })
    expect(dna.network).toMatchObject({ chainId: 8453, blockTimeMs: 2000, gasLimit: null })
    const tampered = edit(dna, (draft) => {
      draft.network.blockTimeMs = 400
    })
    expect(errors(tampered).map((issue) => issue.path)).toContain('network.blockTimeMs')
  })

  it('refuses things Base cannot do', () => {
    const dna = edit(defaultDna('base'), (draft) => {
      draft.network.access = 'private'
      draft.economics.nativeCurrency = 'custom'
    })
    expect(errors(dna).map((issue) => issue.path)).toEqual(expect.arrayContaining(['network.access', 'economics.nativeCurrency']))
  })

  it('marks post-quantum authentication as research, never deployable', () => {
    const dna = edit(defaultDna('base'), (draft) => {
      draft.cryptography.auth = 'hybrid-mldsa'
    })
    const warnings = validateDna(dna).filter((issue) => issue.path === 'cryptography.auth')
    expect(warnings.some((issue) => /research only/.test(issue.message))).toBe(true)
    expect(warnings.some((issue) => /EIP-7702.*original ECDSA key/.test(issue.message))).toBe(true)
    expect(readiness(dna).find((item) => item.id === 'research')?.status).toBe('research')
  })

  it('catches cross-field conflicts', () => {
    const base = defaultDna('local-devnet')
    expect(errors(edit(base, (draft) => void (draft.execution.upgrades = 'uups'))).map((issue) => issue.path)).toContain('security.admin')
    expect(errors(edit(base, (draft) => void (draft.security.governance = 'token-vote'))).map((issue) => issue.path)).toContain('security.governance')
    expect(errors(edit(base, (draft) => void (draft.economics.feePolicy = 'sponsored'))).length).toBe(0)
    const noAa = edit(base, (draft) => {
      draft.execution.accountAbstraction = []
      draft.cryptography.rotation = 'smart-account'
      draft.economics.feePolicy = 'sponsored'
    })
    expect(errors(noAa).map((issue) => issue.path)).toEqual(expect.arrayContaining(['cryptography.rotation', 'economics.feePolicy']))
    const token = edit(base, (draft) => {
      draft.economics.token = 'erc20'
      draft.economics.distribution = [{ label: 'Team', pct: 30 }, { label: 'Community', pct: 60 }]
    })
    expect(errors(token).find((issue) => issue.path === 'economics.distribution')?.message).toMatch(/90%/)
  })

  it('protects dedicated rollups from reserved chain IDs', () => {
    const dna = edit(defaultDna('op-stack'), (draft) => void (draft.network.chainId = 8453))
    expect(errors(dna).find((issue) => issue.path === 'network.chainId')?.message).toMatch(/Base/)
    expect(readiness(defaultDna('op-stack')).find((item) => item.id === 'provision')?.status).toBe('blocked')
  })

  it('warns when a fork reuses the real chain ID', () => {
    const dna = edit(defaultDna('local-devnet'), (draft) => {
      draft.network.fork = { source: 'base', block: null }
      draft.network.chainId = 8453
    })
    expect(validateDna(dna).find((issue) => issue.path === 'network.chainId')?.message).toMatch(/valid on base/)
  })

  it('rejects Prague-only features on a Cancun devnet', () => {
    const dna = edit(defaultDna('local-devnet'), (draft) => void (draft.execution.evm = 'cancun'))
    expect(errors(dna).map((issue) => issue.path)).toEqual(expect.arrayContaining(['execution.precompiles', 'execution.accountAbstraction']))
  })

  it('retargets without carrying impossible choices', () => {
    const base = edit(defaultDna('base'), (draft) => void (draft.economics.token = 'clanker'))
    const devnet = retarget(base, 'local-devnet')
    expect(devnet.economics.token).toBe('erc20')
    expect(devnet.network.settlement).toBeNull()
    expect(retarget(base, 'op-stack').network.chainId).not.toBe(84532)
  })
})

describe('Hashing, fingerprint, sharing and comparison', () => {
  it('hashes canonically: key order does not matter, content does', () => {
    const dna = defaultDna('base')
    const reverse = (value: unknown): unknown =>
      value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value
    const reordered = reverse(dna) as ChainDna
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(dna))
    expect(dnaHash(reordered)).toBe(dnaHash(dna))
    expect(dnaHash(edit(dna, (draft) => void (draft.security.admin = 'multisig')))).not.toBe(dnaHash(dna))
  })

  it('keeps the genome when only the name changes', () => {
    const dna = defaultDna('base')
    const renamed = edit(dna, (draft) => void (draft.name = 'Something Else'))
    expect(dnaHash(renamed)).not.toBe(dnaHash(dna))
    expect(technicalHash(renamed)).toBe(technicalHash(dna))
    expect(dnaGlyph(renamed)).toEqual(dnaGlyph(dna))
  })

  it('derives the glyph from real properties', () => {
    const dna = defaultDna('base')
    const research = edit(dna, (draft) => void (draft.cryptography.auth = 'mldsa'))
    const ring = (value: ChainDna) => dnaGlyph(value).rings.find((item) => item.category === 'cryptography')!
    expect(ring(dna).arcs.map((arc) => arc.support)).toEqual(['native', 'native'])
    expect(ring(research).arcs.map((arc) => arc.support)).toContain('research')
    const automine = edit(defaultDna('local-devnet'), (draft) => void (draft.network.blockTimeMs = 0))
    expect(dnaGlyph(automine).ticks.length).toBeGreaterThan(dnaGlyph(defaultDna('local-devnet')).ticks.length)
  })

  it('round-trips through a share link', () => {
    const dna = edit(defaultDna('local-devnet'), (draft) => {
      draft.name = 'Ünïcode test'.replace(/[^\x20-\x7e]/g, 'u')
      draft.description = 'Lattice – “quoted” ✓'
    })
    const decoded = decodeShare(encodeShare(dna))
    expect(decoded.ok && dnaHash(decoded.dna)).toBe(dnaHash(dna))
    expect(decodeShare('!!').ok).toBe(false)
  })

  it('lists field-level differences', () => {
    const left = defaultDna('local-devnet')
    const right = edit(left, (draft) => {
      draft.network.blockTimeMs = 5000
      draft.security.admin = 'multisig'
    })
    expect(diffDna(left, right).map((item) => [item.path, item.left, item.right])).toEqual([
      ['network.blockTimeMs', '2000', '5000'],
      ['security.admin', 'none', 'multisig'],
    ])
    expect(diffDna(left, left)).toEqual([])
  })

  it('generates Anvil flags only for devnets', () => {
    expect(anvilArgs(defaultDna('base'))).toEqual([])
    const args = anvilArgs(edit(defaultDna('local-devnet'), (draft) => void (draft.network.fork = { source: 'base-sepolia', block: 123 })))
    expect(args).toEqual(expect.arrayContaining(['--network', 'optimism', '--hardfork', 'isthmus', '--fork-url', 'https://sepolia.base.org', '--fork-block-number', '123']))
  })
})
