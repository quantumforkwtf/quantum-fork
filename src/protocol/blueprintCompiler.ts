import {
  BLUEPRINT_STATUSES,
  type Blueprint,
  type BlueprintGenome,
  type BlueprintQuestion,
  type BlueprintStatus,
  type CapabilityRef,
  COMPATIBILITY_OVERRIDES,
  COMPONENT_BY_ID,
  type CompatibilityRow,
  type ComponentId,
  type GenomePatch,
  PLATFORM,
  type PlatformId,
  type QuestionOption,
  STATUS_RANK,
} from './blueprints.js'
import type { Chain } from './base.js'
import { type BurnEstimate, estimateBurn } from './burnEngine.js'
import { type DeploymentTier, type DescendantConfig, descendantSchema, normalizeConfig } from './descendant.js'
import { ANCESTOR_NAME, type AncestorId, DEFAULT_ANCESTOR } from './ancestors.js'
import { MODULE_BY_ID, moduleFor, type ModuleStatus, type PqModuleId, withDependencies } from './modules.js'
import { PROFILE_BY_ID, type ProfileId, strainLabel } from './profiles.js'

/**
 * The Blueprint Compiler. Deterministic: the same blueprint, answers and
 * capabilities always produce the same output. No randomness, no clock and no
 * model inference is involved in any cryptographic choice; every choice comes
 * from the blueprint's declared options and the existing profiles and modules.
 */

export type Answers = Record<string, string>

/** What the running deployment can do, as reported by the server. Defaults to nothing. */
export interface RuntimeCapabilities {
  devnetBurn: boolean
  mainnetBurn?: boolean
  /** The chain burns are priced on. Defaults to Solana amounts. */
  burnChain?: Chain
}

export const NO_RUNTIME: RuntimeCapabilities = { devnetBurn: false, mainnetBurn: false }

export interface ResolvedQuestion {
  question: BlueprintQuestion
  option: QuestionOption
  visible: boolean
}

export type ArchitectureKey = 'ANCESTOR' | 'SECURITY PROFILE' | 'AUTHORIZATION' | 'RECOVERY' | 'PRIVACY' | 'NETWORK' | 'STATUS'

export interface ArchitectureRow {
  key: ArchitectureKey
  value: string
  detail: string
}

export interface ComponentRow {
  id: string
  code: string
  name: string
  primitive: string
  status: BlueprintStatus
  source: 'module' | 'component'
  note: string
}

export interface CompilerWarning {
  level: 'info' | 'warn'
  message: string
}

export interface PlanStep {
  label: string
  state: 'AVAILABLE' | 'DEVNET' | 'UNAVAILABLE'
  detail: string
}

export interface BlueprintAction {
  kind: 'build' | 'design' | 'map' | 'scan' | 'expert' | 'none'
  label: string
  href: string | null
  note: string
}

export interface DeploymentPlan {
  steps: PlanStep[]
  tiers: Record<DeploymentTier, { available: boolean; reason: string }>
  action: BlueprintAction
}

export interface CompatibilityReport {
  rows: CompatibilityRow[]
  breaking: number
}

export interface CompiledBlueprint {
  blueprint: Blueprint
  answers: Answers
  questions: ResolvedQuestion[]
  genome: BlueprintGenome
  /** Network blueprints only. Application blueprints never produce a chain configuration. */
  config: DescendantConfig | null
  architecture: ArchitectureRow[]
  components: ComponentRow[]
  status: BlueprintStatus
  /** The parts that hold the status down. */
  statusLimitedBy: string[]
  plan: DeploymentPlan
  warnings: CompilerWarning[]
  compatibility: CompatibilityReport
  burn: BurnEstimate
  valid: boolean
  issues: string[]
}

export const APP_SCAN_PATH = '/quantumize'

const MODULE_TO_BLUEPRINT: Record<ModuleStatus, BlueprintStatus> = {
  PRODUCTION: 'AVAILABLE',
  TESTNET: 'TESTNET',
  EXPERIMENTAL: 'EXPERIMENTAL',
  RESEARCH: 'RESEARCH',
  'COMING SOON': 'COMING SOON',
}

export function capabilityStatus(ref: CapabilityRef): { name: string; status: BlueprintStatus } {
  const [kind, id] = ref.split(':') as ['platform' | 'module' | 'component', string]
  if (kind === 'platform') return { name: PLATFORM[id as PlatformId].name, status: PLATFORM[id as PlatformId].status }
  if (kind === 'module') {
    const module = MODULE_BY_ID[id as PqModuleId]
    return { name: `${module.code} ${module.name}`, status: MODULE_TO_BLUEPRINT[module.status] }
  }
  const component = COMPONENT_BY_ID[id as ComponentId]
  return { name: `${component.code} ${component.name}`, status: component.status }
}

export function statusMeaning(status: BlueprintStatus) {
  return BLUEPRINT_STATUSES.find((item) => item.status === status)?.meaning ?? ''
}

/* ---------- answers ---------- */

const ID = /^[a-z0-9-]{1,32}$/

/** Resolves answers in question order. Unknown, disabled or hidden answers fall back to the default. */
export function resolveAnswers(blueprint: Blueprint, answers: Answers = {}) {
  const resolved: Answers = {}
  const questions: ResolvedQuestion[] = []
  const warnings: CompilerWarning[] = []
  for (const question of blueprint.questions) {
    const visible = !question.showIf || question.showIf.oneOf.includes(resolved[question.showIf.question])
    const fallback = question.options.find((option) => option.id === question.defaultOption) ?? question.options[0]
    const requested = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined
    let option = fallback
    if (requested !== undefined) {
      const match = question.options.find((item) => item.id === requested)
      if (!match) warnings.push({ level: 'warn', message: `Ignored an unknown answer for “${question.prompt}”.` })
      else if (match.disabled) warnings.push({ level: 'warn', message: `${match.label} is ${match.disabled.toLowerCase()}; using ${fallback.label}.` })
      else option = match
    }
    if (visible) resolved[question.id] = option.id
    questions.push({ question, option, visible })
  }
  return { answers: resolved, questions, warnings }
}

export function encodeAnswers(answers: Answers) {
  return Object.entries(answers)
    .map(([key, value]) => `${key}:${value}`)
    .join(',')
}

export function decodeAnswers(raw: string | null): Answers {
  const answers: Answers = {}
  if (!raw) return answers
  for (const pair of raw.split(',').slice(0, 16)) {
    const [key, value] = pair.split(':')
    if (key && value && ID.test(key) && ID.test(value)) answers[key] = value
  }
  return answers
}

export function blueprintLabHref(blueprint: Blueprint, answers?: Answers) {
  const encoded = answers ? encodeAnswers(answers) : ''
  return `/lab?blueprint=${blueprint.slug}${encoded ? `&a=${encodeURIComponent(encoded)}` : ''}`
}

/* ---------- genome ---------- */

function applyPatch(genome: BlueprintGenome, patch: GenomePatch): BlueprintGenome {
  const { network, components, ...rest } = patch
  return {
    ...genome,
    ...rest,
    network: genome.network && network ? { ...genome.network, ...network } : genome.network,
    components: components ? [...genome.components, ...components.filter((id) => !genome.components.includes(id))] : genome.components,
  }
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

/** The descendant configuration a network genome stands for, built only from existing profiles and modules. */
export function genomeToConfig(genome: BlueprintGenome, parent: AncestorId = DEFAULT_ANCESTOR): DescendantConfig | null {
  if (!genome.network || !genome.pqProfile) return null
  const requested: ProfileId = genome.pqProfile
  const standard = withDependencies(PROFILE_BY_ID[requested].modules)
  const wanted = new Set<PqModuleId>(standard)
  if (genome.privacy === 'shielded-pq') wanted.add('spq')
  if (genome.recovery === 'none') wanted.delete('pqr')
  const modules = withDependencies([...wanted])
  const profile: ProfileId = requested !== 'custom' && !sameSet(modules, standard) ? 'custom' : requested
  const { name, symbol, networkId, validators, hardware, rpc, baseFeeLamports, burnPct } = genome.network
  return normalizeConfig({
    ancestor: parent,
    profile,
    modules,
    network: { name, symbol, networkId },
    validators: { count: validators, hardware },
    rpc: { access: rpc },
    economics: { baseFeeLamports, burnPct },
    privacy: genome.privacy === 'public' || genome.privacy === 'not-applicable' ? 'public' : 'shielded',
    recovery: modules.includes('pqr') ? 'pq-commitment' : 'none',
    tier: 'testnet',
  })
}

/* ---------- readouts ---------- */

const RECOVERY_LABEL: Record<BlueprintGenome['recovery'], string> = {
  none: 'NONE',
  'pq-commitment': 'PQ RECOVERY KEY',
  guardians: 'RECOVERY GUARDIANS',
  custom: 'CUSTOM · EXPERT MODE',
}

const PRIVACY_LABEL: Record<BlueprintGenome['privacy'], [string, string]> = {
  public: ['PUBLIC LEDGER', 'Balances and transfers are visible on the ledger.'],
  shielded: ['CONFIDENTIAL BALANCES', 'Uses today’s confidential-transfer proofs, which are classical.'],
  'shielded-pq': ['CONFIDENTIAL · PQ PROOFS', 'Hash-based proofs and ML-KEM encryption. Research only.'],
  'not-applicable': ['UNCHANGED', 'This blueprint does not change privacy.'],
}

function authorizationLabel(genome: BlueprintGenome, config: DescendantConfig | null): [string, string] {
  switch (genome.authorization) {
    case 'network-accounts':
      if (genome.networkType === 'existing-chain') return ['UNCHANGED', 'Scanning reads the chain’s design; it changes nothing.']
      if (config?.modules.includes('lsp')) return ['LATTICE SIGNATURES', 'Post-quantum signatures only. No classical fallback.']
      if (config?.modules.includes('hsp')) return ['HYBRID SIGNATURES', 'Classical and post-quantum signatures; both must verify.']
      return ['PER MODULE SELECTION', 'Set by the modules chosen in Expert Mode.']
    case 'single-owner':
      return genome.networkType === 'existing-app' ? ['UNCHANGED', 'Your app’s own sign-in is mapped, not replaced.'] : ['ONE OWNER · HYBRID', 'One owner signs classically and authorizes post-quantum.']
    case 'multi-owner':
      return ['MULTIPLE OWNERS · THRESHOLD', 'A set number of owners must approve, each with hybrid keys.']
    case 'organization':
      return ['ORGANIZATION POLICY', 'Roles and approval rules. Not specified yet.']
    case 'agent-policy':
      return ['AGENT POLICIES', 'Owners bound what agents may spend. Not specified yet.']
  }
}

function networkLabel(genome: BlueprintGenome): [string, string] {
  const shape = genome.network
  switch (genome.networkType) {
    case 'independent':
      return [`INDEPENDENT L1 · ${shape?.validators} VALIDATORS`, `Native asset ${shape?.symbol}. ${shape?.rpc === 'private' ? 'Private' : 'Public'} RPC, as designed. No chain runs it yet.`]
    case 'private':
      return [`PRIVATE NETWORK · ${shape?.validators} VALIDATORS`, `${shape?.rpc === 'private' ? 'Private' : 'Public'} RPC, as designed. No chain runs it yet.`]
    case 'permissioned':
      return [`ORGANIZATION NETWORK · ${shape?.validators} VALIDATORS`, 'Permissioning is not built, so the design records it without enforcing it.']
    case 'on-base':
      return ['NO NEW NETWORK', 'Runs as a contract on Base. Base itself stays classical.']
    case 'existing-app':
      return ['NO NEW NETWORK', 'Your application stays where it is.']
    case 'existing-chain':
      return ['NO NEW NETWORK', 'A descendant plan can follow in the lab.']
  }
}

function ancestorLabel(blueprint: Blueprint, genome: BlueprintGenome, parent: AncestorId): [string, string] {
  if (genome.networkType === 'on-base') return ['BASE · HOST CHAIN', 'The vault is a contract on Base.']
  if (genome.networkType === 'existing-app') return ['YOUR APPLICATION', genome.subject ?? 'Existing application']
  if (genome.networkType === 'existing-chain') return [genome.subject ?? 'BASE', 'Scanned with the exposure model.']
  return [ANCESTOR_NAME[parent], blueprint.category === 'EXPERT' ? 'Classical ancestor // GEN-0. You choose every gene.' : 'Classical ancestor // GEN-0']
}

function securityLabel(genome: BlueprintGenome): [string, string] {
  if (genome.pqProfile) {
    const profile = PROFILE_BY_ID[genome.pqProfile]
    return [strainLabel(profile), profile.summary]
  }
  if (genome.networkType === 'existing-app') return ['MIGRATION MAP', 'Each classical surface, with its post-quantum replacement.']
  if (genome.networkType === 'existing-chain') return ['EXPOSURE SCAN', 'Every quantum-relevant dependency, sourced.']
  return genome.security === 'advanced'
    ? ['HYBRID AUTHORIZATION + PQ TRANSPORT', 'Hybrid authorization, plus post-quantum key exchange to signing services.']
    : ['HYBRID AUTHORIZATION', 'A classical signature and a post-quantum authorization, both required.']
}

function componentRows(config: DescendantConfig | null, genome: BlueprintGenome): ComponentRow[] {
  const rows: ComponentRow[] = []
  for (const id of config?.modules ?? []) {
    const module = moduleFor(id, config?.ancestor)
    rows.push({ id, code: module.code, name: module.name, primitive: module.primitive, status: MODULE_TO_BLUEPRINT[module.status], source: 'module', note: module.implementation })
  }
  for (const id of genome.components) {
    const component = COMPONENT_BY_ID[id]
    rows.push({ id, code: component.code, name: component.name, primitive: component.primitive, status: component.status, source: 'component', note: component.implementation })
  }
  return rows
}

/* ---------- compile ---------- */

export function compileBlueprint(blueprint: Blueprint, input: Answers = {}, runtime: RuntimeCapabilities = NO_RUNTIME, parent: AncestorId = DEFAULT_ANCESTOR): CompiledBlueprint {
  const resolved = resolveAnswers(blueprint, input)
  const warnings: CompilerWarning[] = [...resolved.warnings]

  let genome: BlueprintGenome = { ...blueprint.recommendedGenome, components: [...blueprint.recommendedGenome.components] }
  for (const item of resolved.questions) if (item.visible) genome = applyPatch(genome, item.option.patch)

  const config = blueprint.category === 'APPLICATION' ? null : genomeToConfig(genome, parent)
  const issues: string[] = []
  if (blueprint.category !== 'APPLICATION') {
    if (!config) issues.push('The blueprint does not define a network.')
    else {
      const parsed = descendantSchema.safeParse(config)
      if (!parsed.success) issues.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
    }
  }
  const valid = issues.length === 0

  /* status: the least mature required part, including anything the answers added */
  const refs = [...blueprint.requiredCapabilities, ...genome.components.filter((id) => !COMPONENT_BY_ID[id].advisory).map((id) => `component:${id}` as CapabilityRef)]
  const parts = Array.from(new Set(refs)).map((ref) => capabilityStatus(ref))
  const floor = Math.min(...parts.map((part) => STATUS_RANK[part.status]))
  const status = (Object.keys(STATUS_RANK) as BlueprintStatus[]).find((key) => STATUS_RANK[key] === floor) ?? 'COMING SOON'
  const statusLimitedBy = parts.filter((part) => STATUS_RANK[part.status] === floor).map((part) => part.name)

  /* readouts */
  const [ancestor, ancestorDetail] = ancestorLabel(blueprint, genome, parent)
  const [security, securityDetail] = securityLabel(genome)
  const [authorization, authorizationDetail] = authorizationLabel(genome, config)
  const [privacy, privacyDetail] = PRIVACY_LABEL[genome.privacy]
  const [networkValue, networkDetail] = networkLabel(genome)
  const architecture: ArchitectureRow[] = [
    { key: 'ANCESTOR', value: ancestor, detail: ancestorDetail },
    { key: 'SECURITY PROFILE', value: security, detail: securityDetail },
    { key: 'AUTHORIZATION', value: authorization, detail: authorizationDetail },
    { key: 'RECOVERY', value: RECOVERY_LABEL[genome.recovery], detail: genome.recovery === 'none' ? 'No recovery path.' : genome.recovery === 'custom' ? 'Left for Expert Mode.' : 'Hash-based keys, committed in advance.' },
    { key: 'PRIVACY', value: privacy, detail: privacyDetail },
    { key: 'NETWORK', value: networkValue, detail: networkDetail },
    { key: 'STATUS', value: status, detail: statusMeaning(status) },
  ]

  const components = componentRows(config, genome)

  /* warnings */
  if (genome.pqProfile && PROFILE_BY_ID[genome.pqProfile].warning) warnings.push({ level: 'warn', message: `${PROFILE_BY_ID[genome.pqProfile].name}: ${PROFILE_BY_ID[genome.pqProfile].warning}.` })
  for (const id of config?.modules ?? []) {
    const warning = MODULE_BY_ID[id].warning
    if (warning) warnings.push({ level: 'info', message: `${MODULE_BY_ID[id].code}: ${warning}` })
  }
  for (const id of genome.components) {
    const component = COMPONENT_BY_ID[id]
    if (component.advisory) {
      if (component.status === 'COMING SOON') warnings.push({ level: 'info', message: `${component.name}: ${component.summary}` })
    } else if (component.status === 'COMING SOON') warnings.push({ level: 'warn', message: `${component.name} is not built. It is recorded in the blueprint only.` })
  }
  if (genome.privacy === 'shielded' && !config?.modules.includes('spq')) warnings.push({ level: 'warn', message: 'Confidential balances use today’s classical proofs. They are not post-quantum.' })
  if (genome.networkType === 'on-base') warnings.push({ level: 'info', message: 'Base itself stays classical. The vault protects what it holds; it does not change the chain.' })
  if (genome.recovery === 'custom') warnings.push({ level: 'info', message: 'Recovery is left for Expert Mode.' })

  /* plan */
  const isNetwork = blueprint.route === 'lab' || blueprint.route === 'expert'
  const buildable = isNetwork && valid && status !== 'COMING SOON'
  const mainnetAvailable = buildable && Boolean(runtime.mainnetBurn)
  const testnetAvailable = buildable && runtime.devnetBurn && !mainnetAvailable
  const registrable = mainnetAvailable || testnetAvailable
  const unavailable = !isNetwork ? 'Application blueprints do not register a descendant.' : status === 'COMING SOON' ? 'This blueprint depends on components that are not built, so it can be designed but not registered.' : !valid ? 'Fix the configuration first.' : 'Registration is not enabled on this server.'
  const tiers: DeploymentPlan['tiers'] = {
    testnet: testnetAvailable ? { available: true, reason: 'Burn devnet test QFORK. Test tokens have no value.' } : { available: false, reason: unavailable },
    mainnet: mainnetAvailable ? { available: true, reason: 'Burn $QFORK, verified on-chain by the server.' } : { available: false, reason: unavailable },
  }
  const burnState: PlanStep['state'] = mainnetAvailable ? 'AVAILABLE' : testnetAvailable ? 'DEVNET' : 'UNAVAILABLE'
  const burnDetail = mainnetAvailable ? '$QFORK from your wallet, verified on-chain by the server.' : testnetAvailable ? 'Devnet test QFORK from your wallet, verified on-chain by the server.' : unavailable
  const launchDetail = registrable ? 'A Clanker token on Base, created from your wallet.' : 'A Clanker token on Base, created from your wallet once the descendant is registered.'

  const href = blueprintLabHref(blueprint, resolved.answers)
  let action: BlueprintAction
  let steps: PlanStep[]
  if (isNetwork) {
    steps = [
      { label: 'Genome configured', state: 'AVAILABLE', detail: 'Compiled from the blueprint and your answers.' },
      { label: 'Configuration validated', state: valid ? 'AVAILABLE' : 'UNAVAILABLE', detail: valid ? 'Checked against the descendant schema.' : issues[0] },
      { label: 'QFORK burn', state: burnState, detail: burnDetail },
      { label: 'Descendant registered', state: burnState, detail: 'A permanent record with a burn receipt, a public page and a developer kit.' },
      { label: 'Token launch', state: registrable ? 'AVAILABLE' : 'UNAVAILABLE', detail: launchDetail },
      { label: 'Running chain', state: 'UNAVAILABLE', detail: 'Not built. No sequencer, RPC or explorer runs a descendant yet.' },
    ]
    action =
      blueprint.route === 'expert'
        ? { kind: 'expert', label: blueprint.cta, href, note: 'Every module and parameter.' }
        : buildable
          ? { kind: 'build', label: blueprint.cta, href, note: mainnetAvailable ? 'Design it in the lab, then burn $QFORK to register it.' : testnetAvailable ? 'Design it in the lab, then burn devnet test QFORK to register it.' : 'Design it in the lab. Registration is not enabled on this server.' }
          : valid
            ? { kind: 'design', label: 'Design genome', href, note: 'Some components are not built, so this blueprint can be designed but not registered.' }
            : { kind: 'none', label: 'Unavailable', href: null, note: issues[0] }
  } else if (blueprint.route === 'scanner') {
    const solana = genome.subject === 'SOLANA'
    steps = [
      { label: 'Exposure scan', state: 'AVAILABLE', detail: `${solana ? 'Solana' : 'Base'}, from the sourced exposure model.` },
      { label: 'Descendant plan', state: 'AVAILABLE', detail: 'Designed in the lab from the scan.' },
    ]
    action = { kind: 'scan', label: blueprint.cta, href: solana ? '/scanner?ancestor=solana' : '/scanner', note: 'Opens the scanner. Free; nothing is burned.' }
  } else {
    const mapping = genome.components.includes('surface-map')
    steps = mapping
      ? [
          { label: 'Repository scan', state: 'AVAILABLE', detail: 'A public GitHub repository, a local folder or pasted code.' },
          { label: 'Fix-first report', state: 'AVAILABLE', detail: 'Findings ranked by risk, with a replacement and a standard for each.' },
          { label: 'Surface map', state: 'AVAILABLE', detail: 'A checklist from your answers, for what code alone cannot show.' },
          { label: 'Upgrades', state: 'UNAVAILABLE', detail: 'Made in your own stack. Quantum Fork never modifies your code.' },
        ]
      : [
          { label: 'Genome configured', state: 'AVAILABLE', detail: 'Compiled from the blueprint and your answers.' },
          { label: 'Vault program', state: 'UNAVAILABLE', detail: 'Not written. Nothing can be deployed.' },
          { label: 'QFORK burn', state: 'UNAVAILABLE', detail: 'No application module can be burned for in this build.' },
        ]
    action = mapping
      ? { kind: 'scan', label: blueprint.cta, href: APP_SCAN_PATH, note: 'Free; nothing is burned. Public repositories are scanned on the server and discarded; local folders never leave your browser.' }
      : { kind: 'design', label: 'Design genome', href, note: 'Explore the vault genome. Building it needs a vault program, which does not exist yet.' }
  }

  /* compatibility */
  const overrides = config ? (COMPATIBILITY_OVERRIDES[config.profile] ?? []) : []
  const rows = [...blueprint.compatibility.filter((row) => !overrides.some((item) => item.label === row.label)), ...overrides]
  if (config?.modules.includes('bmp')) rows.push({ label: 'Bridges', verdict: 'BREAKING', detail: 'Classical-only bridges are refused.' })
  if (config?.modules.includes('vid')) rows.push({ label: 'Validators', verdict: 'BREAKING', detail: 'Consensus-breaking: every validator upgrades together.' })
  const compatibility: CompatibilityReport = { rows, breaking: rows.filter((row) => row.verdict === 'BREAKING').length }

  const burn = estimateBurn(blueprint.qforkBurnModel, config, runtime.burnChain)

  return { blueprint, answers: resolved.answers, questions: resolved.questions, genome, config, architecture, components, status, statusLimitedBy, plan: { steps, tiers, action }, warnings, compatibility, burn, valid, issues }
}

/** Statuses for every blueprint at its recommended answers. */
export function recommendedStatus(blueprint: Blueprint): BlueprintStatus {
  return compileBlueprint(blueprint).status
}
