import { readFileSync } from 'node:fs'
import { blueprintCard } from '../api/_lib/specimen'
import { describe, expect, it } from 'vitest'
import { blueprintLabHref, capabilityStatus, compileBlueprint, decodeAnswers, encodeAnswers, genomeToConfig, resolveAnswers } from '../src/protocol/blueprintCompiler'
import { ACCOUNT_FACTORY_DEPLOYMENTS } from '../src/protocol/account'
import { ACCOUNT_STATUS, BLUEPRINT_BY_SLUG, BLUEPRINTS, COMPONENT_BY_ID, FEATURED_BLUEPRINTS, findBlueprint, INTENTS, STATUS_RANK } from '../src/protocol/blueprints'
import { BURN_OPERATIONS, estimateBurn } from '../src/protocol/burnEngine'
import { defaultConfig, descendantSchema, genomeDiff } from '../src/protocol/descendant'
import { CHAIN_BURN_SCALE, quoteGenesis } from '../src/protocol/pricing'
import { burnChainOf } from '../src/protocol/base'

const bp = (slug: string) => BLUEPRINT_BY_SLUG[slug]

/** Every combination of visible answers a blueprint allows. */
function combinations(slug: string) {
  const blueprint = bp(slug)
  let sets: Record<string, string>[] = [{}]
  for (const question of blueprint.questions) {
    sets = sets.flatMap((answers) => question.options.filter((option) => !option.disabled).map((option) => ({ ...answers, [question.id]: option.id })))
  }
  return sets
}

describe('blueprint catalogue', () => {
  it('has nine blueprints with unique ids, slugs and codes', () => {
    expect(BLUEPRINTS).toHaveLength(9)
    expect(new Set(BLUEPRINTS.map((item) => item.slug)).size).toBe(9)
    expect(BLUEPRINTS.map((item) => item.id)).toEqual(BLUEPRINTS.map((_, index) => `QF-BP-00${index + 1}`))
    expect(FEATURED_BLUEPRINTS.map((item) => item.index)).toEqual(['01', '02', '03', '04', '05', '06'])
  })

  it('routes every intent to a real blueprint', () => {
    for (const intent of INTENTS) expect(findBlueprint(intent.slug)).not.toBeNull()
    expect(findBlueprint('__proto__')).toBeNull()
    expect(findBlueprint('constructor')).toBeNull()
  })

  it('declares only real defaults and option ids', () => {
    for (const blueprint of BLUEPRINTS) {
      for (const question of blueprint.questions) {
        expect(question.options.some((option) => option.id === question.defaultOption && !option.disabled)).toBe(true)
        if (question.showIf) expect(blueprint.questions.some((other) => other.id === question.showIf?.question)).toBe(true)
      }
    }
  })

  it('never claims quantum-proof or a quantum-resistant Solana', () => {
    const text = JSON.stringify(BLUEPRINTS).toLowerCase()
    expect(text).not.toMatch(/(?<!post-)quantum[- ]proof\b/)
    expect(text).not.toMatch(/solana (becomes|is now|will be) quantum/)
    expect(text).not.toMatch(/\baudited\b(?! )/)
  })
})

describe('compileBlueprint', () => {
  it('is deterministic', () => {
    for (const blueprint of BLUEPRINTS) {
      const a = compileBlueprint(blueprint, { x: 'y' })
      const b = compileBlueprint(blueprint, { x: 'y' })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  it('produces a schema-valid descendant for every network answer combination', () => {
    for (const blueprint of BLUEPRINTS.filter((item) => item.category !== 'APPLICATION')) {
      for (const answers of combinations(blueprint.slug)) {
        const compiled = compileBlueprint(blueprint, answers)
        expect(compiled.valid, `${blueprint.slug} ${JSON.stringify(answers)} ${compiled.issues.join('; ')}`).toBe(true)
        expect(descendantSchema.safeParse(compiled.config).success).toBe(true)
        expect(compiled.config?.tier).toBe('testnet')
      }
    }
  })

  it('never produces a chain configuration or a deployable tier for application blueprints', () => {
    for (const blueprint of BLUEPRINTS.filter((item) => item.category === 'APPLICATION')) {
      for (const answers of combinations(blueprint.slug)) {
        const compiled = compileBlueprint(blueprint, answers, { devnetBurn: true })
        expect(compiled.config).toBeNull()
        expect(compiled.plan.tiers.testnet.available).toBe(false)
        expect(compiled.plan.action.kind).not.toBe('build')
      }
    }
  })

  it('never makes mainnet available', () => {
    for (const blueprint of BLUEPRINTS) expect(compileBlueprint(blueprint, {}, { devnetBurn: true }).plan.tiers.mainnet.available).toBe(false)
  })

  it('takes the status of its least mature required part', () => {
    for (const blueprint of BLUEPRINTS) {
      const compiled = compileBlueprint(blueprint)
      for (const ref of blueprint.requiredCapabilities) expect(STATUS_RANK[compiled.status]).toBeLessThanOrEqual(STATUS_RANK[capabilityStatus(ref).status])
      expect(compiled.statusLimitedBy.length).toBeGreaterThan(0)
    }
    expect(compileBlueprint(bp('quantum-chain')).status).toBe('RESEARCH')
    const vaultStatus = compileBlueprint(bp('quantum-vault')).status
    expect(vaultStatus).not.toBe('RESEARCH')
    expect(STATUS_RANK[vaultStatus]).toBeLessThanOrEqual(STATUS_RANK[ACCOUNT_STATUS])
    expect(compileBlueprint(bp('quantum-ai-economy')).status).toBe('RESEARCH')
    expect(compileBlueprint(bp('enterprise-quantum-network')).status).toBe('COMING SOON')
    expect(compileBlueprint(bp('quantumize-my-app')).status).toBe('AVAILABLE')
    expect(compileBlueprint(bp('quantumize-my-app'), { kind: 'wallet', signin: 'tokens', longevity: 'yes' }).status).toBe('AVAILABLE')
    expect(compileBlueprint(bp('quantumize-my-chain')).status).toBe('AVAILABLE')
  })

  it('marks nothing AVAILABLE that depends on research modules', () => {
    for (const blueprint of BLUEPRINTS) {
      const compiled = compileBlueprint(blueprint)
      if (compiled.status === 'AVAILABLE') expect(blueprint.requiredCapabilities.some((ref) => ref.startsWith('module:'))).toBe(false)
    }
  })

  it('offers BUILD only where the lab can run it, and devnet only when the server allows it', () => {
    const chain = compileBlueprint(bp('quantum-chain'))
    expect(chain.plan.action.kind).toBe('build')
    expect(chain.plan.tiers.testnet.available).toBe(false)
    expect(compileBlueprint(bp('quantum-chain'), {}, { devnetBurn: true }).plan.tiers.testnet.available).toBe(true)

    const enterprise = compileBlueprint(bp('enterprise-quantum-network'), {}, { devnetBurn: true })
    expect(enterprise.plan.action.kind).toBe('design')
    expect(enterprise.plan.tiers.testnet.available).toBe(false)
    expect(compileBlueprint(bp('quantum-ai-economy'), {}, { devnetBurn: true }).plan.tiers.testnet.available).toBe(true)

    expect(compileBlueprint(bp('quantum-vault')).plan.action.kind).toBe('design')
    expect(compileBlueprint(bp('quantumize-my-app')).plan.action).toMatchObject({ kind: 'scan', href: '/quantumize' })
    expect(compileBlueprint(bp('quantumize-my-chain')).plan.action).toMatchObject({ kind: 'scan', href: '/scanner' })
    expect(compileBlueprint(bp('custom')).plan.action.kind).toBe('expert')
  })

  it('applies answers through the existing profiles and modules', () => {
    const broad = compileBlueprint(bp('quantum-chain'), { coverage: 'broad', scale: 'performance', access: 'private' })
    expect(broad.config?.profile).toBe('pq-forward')
    expect(broad.config?.modules).toContain('vid')
    expect(broad.config?.validators).toEqual({ count: 64, hardware: 'high' })
    expect(broad.config?.rpc.access).toBe('private')

    const pqPrivacy = compileBlueprint(bp('private-quantum-network'), { hide: 'amounts', proofs: 'pq' })
    expect(pqPrivacy.config?.modules).toContain('spq')
    expect(pqPrivacy.config?.profile).toBe('custom')
    expect(genomeDiff(pqPrivacy.config!).find((row) => row.code === 'PRF')?.changed).toBe(true)

    const classicalPrivacy = compileBlueprint(bp('private-quantum-network'), { hide: 'amounts', proofs: 'today' })
    expect(classicalPrivacy.config?.privacy).toBe('shielded')
    expect(classicalPrivacy.config?.modules).not.toContain('spq')
    expect(classicalPrivacy.warnings.some((item) => /classical proofs/.test(item.message))).toBe(true)
  })

  it('skips hidden questions and ignores unknown or disabled answers', () => {
    const hidden = resolveAnswers(bp('private-quantum-network'), { hide: 'access', proofs: 'pq' })
    expect(hidden.answers.proofs).toBeUndefined()
    expect(compileBlueprint(bp('private-quantum-network'), { hide: 'access', proofs: 'pq' }).config?.modules).not.toContain('spq')

    const unknown = compileBlueprint(bp('quantum-vault'), { authorize: 'everyone' })
    expect(unknown.answers.authorize).toBe('one')
    expect(unknown.warnings.some((item) => item.level === 'warn')).toBe(true)

    const disabled = compileBlueprint(bp('quantumize-my-chain'), { chain: 'ethereum' })
    expect(disabled.answers.chain).toBe('base')
  })

  it('records the components an answer selects and warns about the unbuilt ones', () => {
    const vault = compileBlueprint(bp('quantum-vault'), { authorize: 'org' })
    expect(vault.genome.components).toContain('org-policy')
    expect(STATUS_RANK[vault.status]).toBeLessThanOrEqual(STATUS_RANK[ACCOUNT_STATUS])
    expect(vault.warnings.some((item) => /is not built/.test(item.message))).toBe(false)

    const enterprise = compileBlueprint(bp('enterprise-quantum-network'))
    expect(enterprise.status).toBe('COMING SOON')
    expect(enterprise.warnings.some((item) => /VALIDATOR PERMISSIONING is not built/.test(item.message))).toBe(true)
  })

  it('labels the account components by where QForkAccount actually runs', () => {
    const expected = ACCOUNT_FACTORY_DEPLOYMENTS.base ? 'AVAILABLE' : ACCOUNT_FACTORY_DEPLOYMENTS['base-sepolia'] ? 'TESTNET' : 'EXPERIMENTAL'
    expect(ACCOUNT_STATUS).toBe(expected)
    for (const id of ['pq-keyset', 'threshold-auth', 'org-policy', 'agent-wallets', 'spending-policy', 'hybrid-auth', 'pq-recovery', 'guardian-recovery'] as const) {
      expect(COMPONENT_BY_ID[id]).toMatchObject({ status: expected, href: '/account' })
      expect(COMPONENT_BY_ID[id].implementation).toMatch(/QForkAccount/)
    }
    for (const id of ['hybrid-auth', 'pq-recovery', 'guardian-recovery'] as const) expect(COMPONENT_BY_ID[id].implementation).toMatch(/server-trusted|Server-trusted/)
    expect(COMPONENT_BY_ID['threshold-auth'].implementation).toMatch(/classical, not hybrid/)
  })

  it('keeps Base classical in the vault readout', () => {
    const vault = compileBlueprint(bp('quantum-vault'))
    expect(vault.architecture.find((row) => row.key === 'NETWORK')?.value).toBe('NO NEW NETWORK')
    expect(vault.architecture.find((row) => row.key === 'ANCESTOR')?.value).toBe('BASE · HOST CHAIN')
    expect(vault.warnings.some((item) => /Base itself stays classical/.test(item.message))).toBe(true)
    expect(vault.blueprint.remainsClassical.join(' ')).toMatch(/does not make Base quantum-resistant/)
  })

  it('compiles network blueprints to Base descendants and lets the scanner plan both ancestors', () => {
    expect(compileBlueprint(bp('quantum-chain')).config?.ancestor).toBe('base')
    for (const chain of ['base', 'solana']) {
      const scan = compileBlueprint(bp('quantumize-my-chain'), { chain })
      expect(scan.plan.steps.find((step) => step.label === 'Descendant plan')?.state).toBe('AVAILABLE')
    }
  })

  it('round-trips answers through a shareable URL', () => {
    const answers = { coverage: 'broad', scale: 'small', access: 'private' }
    expect(decodeAnswers(encodeAnswers(answers))).toEqual(answers)
    expect(decodeAnswers('a:b,<script>:x,c:__proto__x')).toEqual({ a: 'b' })
    expect(blueprintLabHref(bp('quantum-chain'), answers)).toBe('/lab?blueprint=quantum-chain&a=coverage%3Abroad%2Cscale%3Asmall%2Caccess%3Aprivate')
  })

  it('ends at registration and never shows a running chain', () => {
    const steps = compileBlueprint(bp('quantum-chain'), {}, { devnetBurn: true }).plan.steps
    expect(steps.find((step) => step.label === 'QFORK burn')?.state).toBe('DEVNET')
    expect(steps.find((step) => step.label === 'Descendant registered')?.state).toBe('DEVNET')
    expect(steps.find((step) => step.label === 'Running chain')?.state).toBe('UNAVAILABLE')
    const offline = compileBlueprint(bp('quantum-chain')).plan.steps
    expect(offline.find((step) => step.label === 'QFORK burn')?.state).toBe('UNAVAILABLE')
    for (const blueprint of BLUEPRINTS) for (const step of compileBlueprint(blueprint, {}, { devnetBurn: true }).plan.steps) expect(step.detail).not.toMatch(/simulat/i)
  })
})

describe('burn engine', () => {
  it('prices genesis from the provisional parameters and leaves application modules unpriced', () => {
    const config = genomeToConfig(bp('quantum-chain').recommendedGenome) ?? defaultConfig()
    const genesis = estimateBurn('GENESIS', config)
    expect(genesis.basis).toBe('PROVISIONAL')
    expect(genesis.total).toBeGreaterThan(0)
    expect(estimateBurn('APPLICATION_MODULE', null)).toMatchObject({ basis: 'UNPRICED', total: null })
    expect(estimateBurn('NONE', null)).toMatchObject({ basis: 'FREE', total: 0 })
  })

  it('prices burns on Base at the chain scale, matching the Lab quote', () => {
    const config = genomeToConfig(bp('quantum-chain').recommendedGenome) ?? defaultConfig()
    const solana = estimateBurn('GENESIS', config)
    const base = estimateBurn('GENESIS', config, 'base')
    expect(base.total).toBe((solana.total ?? 0) * CHAIN_BURN_SCALE.base)
    expect(base.total).toBe(quoteGenesis(config, 'GENESIS', 'base').total)
    expect(compileBlueprint(bp('quantum-chain'), {}, { devnetBurn: false, burnChain: 'base' }).burn.total).toBe(compileBlueprint(bp('quantum-chain')).burn.total! * CHAIN_BURN_SCALE.base)
  })

  it('reads the burn chain from the record, defaulting legacy records to Solana', () => {
    expect(burnChainOf({ receipt: null, deployment: null }, 'base')).toBe('base')
    expect(burnChainOf({ receipt: {} }, 'base')).toBe('solana')
    expect(burnChainOf({ deployment: { burn: { chain: 'base' } } }, 'solana')).toBe('base')
  })

  it('only genesis is executable today', () => {
    expect(BURN_OPERATIONS.filter((item) => item.status !== 'COMING SOON').map((item) => item.id)).toEqual(['GENESIS'])
  })
})

describe('share previews and routing', () => {
  it('share cards carry the compiled status and reject unknown slugs', () => {
    for (const blueprint of BLUEPRINTS) {
      const card = blueprintCard(blueprint.slug)
      expect(card?.subtitle).toBe(`STATUS: ${compileBlueprint(blueprint).status}`)
      expect(card?.description).toMatch(new RegExp(`Status: ${compileBlueprint(blueprint).status}\\.$`))
    }
    expect(blueprintCard('nope')).toBeNull()
    expect(blueprintCard('__proto__')).toBeNull()
  })

  it('every blueprint page is in the sitemap and rewritten for crawlers', () => {
    const sitemap = readFileSync('public/sitemap.xml', 'utf8')
    for (const blueprint of BLUEPRINTS) expect(sitemap).toContain(`/blueprints/${blueprint.slug}</loc>`)
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites: { source: string; destination: string }[] }
    const sources = vercel.rewrites.map((rule) => rule.source)
    expect(sources.indexOf('/blueprints/:slug')).toBeLessThan(sources.indexOf('/((?!api/).*)'))
  })

  it('network blueprints open the lab; application blueprints open the studio without a burn', () => {
    for (const blueprint of BLUEPRINTS) {
      const { action, tiers } = compileBlueprint(blueprint).plan
      if (blueprint.category === 'APPLICATION') {
        expect(tiers.testnet.available || tiers.mainnet.available).toBe(false)
        if (blueprint.route === 'studio') expect(action.href).toMatch(/^\/lab\?blueprint=|^\/quantumize$/)
      } else {
        expect(action.href).toMatch(new RegExp(`^/lab\\?blueprint=${blueprint.slug}`))
      }
      expect(tiers.mainnet.available).toBe(false)
    }
  })
})
