import { anvilCommand, type ChainDna, type DnaIssue, diffDna, dnaHash, FIELD_BY_PATH, getPath, type Layer, parseDna, type Support, type Target, validateDna } from './chainDna.js'

/**
 * A lineage is a tree of Chain DNA revisions kept by the lab.
 * Recording a branch does not deploy anything and does not change Base.
 */

export const MUTATION_SPEC = 'qfork/mutation/v1'
export const MAX_REVISIONS = 40
const BRANCH = /^[a-z][a-z0-9-]{0,24}$/

export type MutationEffect = 'identity' | 'contract' | 'built-in' | 'local-anvil' | 'dedicated-chain' | 'research' | 'impossible'

export interface ClassifiedChange {
  path: string
  label: string
  from: string
  to: string
  layer: Layer | 'identity'
  effect: MutationEffect
  detail: string
}

export interface UpgradePlan {
  direction: 'upgrade' | 'rollback'
  changes: ClassifiedChange[]
  issues: DnaIssue[]
  applicable: boolean
  anvilBefore: string | null
  anvilAfter: string | null
  summary: string
}

export interface Revision {
  id: string
  parentId: string | null
  branch: string
  version: number
  createdAt: string
  note: string
  dna: ChainDna
  hash: `0x${string}`
}

export interface Lineage {
  spec: typeof MUTATION_SPEC
  id: string
  revisions: Revision[]
}

const STRUCTURAL: Record<string, Layer | 'identity'> = {
  name: 'identity',
  description: 'identity',
  target: 'infrastructure',
  'network.chainId': 'consensus',
  'network.blockTimeMs': 'consensus',
  'network.gasLimit': 'consensus',
  'network.fork': 'infrastructure',
  'economics.baseFeeGwei': 'consensus',
  'economics.distribution': 'contract',
}

function effectFor(target: Target, layer: Layer | 'identity', support: Support | null, path: string): { effect: MutationEffect; detail: string } {
  if (layer === 'identity') return { effect: 'identity', detail: 'A label in this lab. No chain changes.' }
  if (path === 'target') return { effect: 'dedicated-chain', detail: 'Switching target chooses a different kind of environment. It does not modify the chain you were on.' }
  if (layer === 'consensus' || layer === 'execution-client') {
    if (target === 'base') {
      return layer === 'consensus'
        ? { effect: 'impossible', detail: 'Base consensus, sequencing, block time, gas limit and base fee are not something a smart contract can change.' }
        : { effect: 'impossible', detail: 'The EVM and precompiles Base runs are not something a smart contract can change.' }
    }
    if (target === 'local-devnet' && support !== 'unsupported' && support !== 'research') return { effect: 'local-anvil', detail: 'Anvil on this machine can use this setting. Base is unchanged.' }
    if (support === 'research') return { effect: 'research', detail: 'No production implementation. It can be written down here and not deployed.' }
    if (support === 'unsupported') return { effect: 'impossible', detail: 'Not possible on this target.' }
    return { effect: 'dedicated-chain', detail: 'Needs a dedicated chain and its own client. Quantum Fork does not run one.' }
  }
  if (support === 'unsupported') return { effect: 'impossible', detail: 'Not possible on this target, and a contract cannot add it.' }
  if (support === 'research') return { effect: 'research', detail: 'Research only. It can be designed here and not deployed.' }
  if (support === 'infrastructure') return { effect: 'dedicated-chain', detail: 'Needs dedicated chain infrastructure. A contract on Base does not create it.' }
  if (support === 'contracts') return { effect: 'contract', detail: 'A contract you would deploy. It does not change Base. Quantum Fork does not deploy it.' }
  if (layer === 'contract') return { effect: 'contract', detail: 'A contract-level choice. It does not change Base consensus.' }
  if (support === 'native') return { effect: 'built-in', detail: 'The target already works this way. Selecting it deploys nothing.' }
  if (target === 'local-devnet') return { effect: 'local-anvil', detail: 'Anvil can apply this on a local devnet. Base is unchanged.' }
  if (target === 'base') return { effect: 'impossible', detail: 'Base fixes this. A contract cannot change it.' }
  return { effect: 'dedicated-chain', detail: 'Needs a dedicated chain. Quantum Fork does not provision one.' }
}

function one(path: string, label: string, from: string, to: string, target: Target, layer: Layer | 'identity', support: Support | null, extra?: string): ClassifiedChange {
  const decided = effectFor(target, layer, support, path)
  return { path, label, from, to, layer, effect: decided.effect, detail: extra ? `${decided.detail} ${extra}` : decided.detail }
}

/** Every difference between two configurations, classified by what would have to change. */
export function classify(parent: ChainDna, child: ChainDna): ClassifiedChange[] {
  const changes: ClassifiedChange[] = []
  for (const diff of diffDna(parent, child)) {
    const field = FIELD_BY_PATH[diff.path]
    if (field?.multi) {
      const before = new Set((getPath(parent, diff.path) as string[] | null) ?? [])
      const after = new Set((getPath(child, diff.path) as string[] | null) ?? [])
      for (const value of [...after].sort()) {
        if (before.has(value)) continue
        const option = field.options[value]
        changes.push(one(diff.path, field.label, '—', option?.label ?? value, child.target, field.layer, option?.support[child.target] ?? null, option?.notes?.[child.target]))
      }
      for (const value of [...before].sort()) {
        if (after.has(value)) continue
        const option = field.options[value]
        changes.push(one(diff.path, field.label, option?.label ?? value, '—', child.target, field.layer, option?.support[child.target] ?? null, option?.notes?.[child.target]))
      }
      continue
    }
    if (field) {
      const value = getPath(child, diff.path)
      const option = typeof value === 'string' ? field.options[value] : undefined
      changes.push(one(diff.path, field.label, diff.left, diff.right, child.target, field.layer, option?.support[child.target] ?? null, option?.notes?.[child.target]))
      continue
    }
    const layer = STRUCTURAL[diff.path] ?? 'infrastructure'
    changes.push(one(diff.path, diff.label, diff.left, diff.right, child.target, layer, null))
  }
  return changes
}

/** What moving from one configuration to the other would mean. Nothing here is executed. */
export function planUpgrade(from: ChainDna, to: ChainDna, direction: 'upgrade' | 'rollback' = 'upgrade'): UpgradePlan {
  const changes = classify(from, to)
  const issues = validateDna(to)
  const blocking = changes.some((change) => change.effect === 'impossible' || change.effect === 'dedicated-chain' || change.effect === 'research')
  const errors = issues.some((issue) => issue.level === 'error')
  const contractOnly = changes.every((change) => change.effect === 'identity' || change.effect === 'contract' || change.effect === 'built-in')
  let summary: string
  if (!changes.length) summary = 'Nothing differs.'
  else if (to.target === 'base' && contractOnly && !errors) summary = direction === 'rollback' ? 'Rollback plan for contracts only. Base consensus stays as it is. Nothing is sent.' : 'Contract plan. Base consensus, block time, gas limit, base fee and the EVM stay as Base runs them. Nothing is deployed from here.'
  else if (blocking || errors) summary = 'This plan cannot be applied. The rows below say which changes a contract cannot make.'
  else if (to.target === 'local-devnet') summary = 'Local plan. The Anvil command is what this configuration generates. Base is unchanged.'
  else summary = 'This plan needs a dedicated chain. Quantum Fork does not provision one.'
  return {
    direction,
    changes,
    issues,
    applicable: changes.length > 0 && !blocking && !errors,
    anvilBefore: from.target === 'local-devnet' ? anvilCommand(from) : null,
    anvilAfter: to.target === 'local-devnet' ? anvilCommand(to) : null,
    summary,
  }
}

function revisionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `rev_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function lineageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `lin_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function findRevision(lineage: Lineage, id: string) {
  return lineage.revisions.find((revision) => revision.id === id) ?? null
}

export function isTip(lineage: Lineage, id: string) {
  const revision = findRevision(lineage, id)
  if (!revision) return false
  return !lineage.revisions.some((item) => item.parentId === id && item.branch === revision.branch)
}

/** Root first, then each child down to the selected revision. */
export function revisionHistory(lineage: Lineage, id: string): Revision[] {
  const chain: Revision[] = []
  const seen = new Set<string>()
  let current = findRevision(lineage, id)
  while (current) {
    if (seen.has(current.id)) throw new Error('The history loops.')
    seen.add(current.id)
    chain.push(current)
    if (!current.parentId) break
    const parent = findRevision(lineage, current.parentId)
    if (!parent) throw new Error('A parent revision is missing.')
    current = parent
  }
  return chain.reverse()
}

function append(lineage: Lineage, parent: Revision, dna: ChainDna, branch: string, note: string, at: string): Lineage {
  if (lineage.revisions.length >= MAX_REVISIONS) throw new Error(`A lineage stops at ${MAX_REVISIONS} revisions.`)
  const parsed = parseDna(dna)
  if (!parsed.ok) throw new Error(parsed.issues[0] ?? 'The configuration is not valid.')
  if (dnaHash(parsed.dna) === parent.hash) throw new Error('Nothing changed.')
  const text = note.trim()
  if (text.length > 160) throw new Error('The note has to be 160 characters or fewer.')
  const next: Revision = { id: revisionId(), parentId: parent.id, branch, version: parent.version + 1, createdAt: at, note: text, dna: parsed.dna, hash: dnaHash(parsed.dna) }
  return { ...lineage, revisions: [...lineage.revisions, next] }
}

export function seedLineage(dna: ChainDna, note = '', at = new Date().toISOString()): Lineage {
  const parsed = parseDna(dna)
  if (!parsed.ok) throw new Error(parsed.issues[0] ?? 'The configuration is not valid.')
  const text = note.trim()
  return {
    spec: MUTATION_SPEC,
    id: lineageId(),
    revisions: [{ id: revisionId(), parentId: null, branch: 'trunk', version: 1, createdAt: at, note: text, dna: parsed.dna, hash: dnaHash(parsed.dna) }],
  }
}

export function extendLineage(lineage: Lineage, parentId: string, dna: ChainDna, note: string, at = new Date().toISOString()) {
  const parent = findRevision(lineage, parentId)
  if (!parent) throw new Error('That revision is not in this lineage.')
  if (!isTip(lineage, parent.id)) throw new Error('This revision is not the tip of its branch. Start an alternative branch from it.')
  return append(lineage, parent, dna, parent.branch, note, at)
}

export function branchLineage(lineage: Lineage, parentId: string, dna: ChainDna, branch: string, note: string, at = new Date().toISOString()) {
  const parent = findRevision(lineage, parentId)
  if (!parent) throw new Error('That revision is not in this lineage.')
  if (!BRANCH.test(branch)) throw new Error('A branch name is lowercase letters, digits and dashes, up to 25 characters.')
  if (branch === parent.branch) throw new Error('An alternative branch needs its own name.')
  if (lineage.revisions.some((revision) => revision.branch === branch)) throw new Error('That branch name is already used.')
  return append(lineage, parent, dna, branch, note, at)
}

/** A new branch whose configuration is the parent of the selected revision. Records a plan; it executes nothing. */
export function rollbackLineage(lineage: Lineage, id: string, branch: string, note: string, at = new Date().toISOString()) {
  const revision = findRevision(lineage, id)
  if (!revision?.parentId) throw new Error('The first revision has nothing to roll back to.')
  const parent = findRevision(lineage, revision.parentId)
  if (!parent) throw new Error('A parent revision is missing.')
  return branchLineage(lineage, revision.id, parent.dna, branch, note || `Roll back to ${parent.branch} v${parent.version}.`, at)
}

export function parseLineage(input: unknown): Lineage | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<Lineage>
  if (raw.spec !== MUTATION_SPEC || typeof raw.id !== 'string' || !Array.isArray(raw.revisions) || raw.revisions.length > MAX_REVISIONS) return null
  const revisions: Revision[] = []
  for (const item of raw.revisions) {
    const revision = item as Partial<Revision>
    const parsed = parseDna(revision.dna)
    if (!parsed.ok || typeof revision.id !== 'string' || typeof revision.branch !== 'string' || typeof revision.version !== 'number' || typeof revision.createdAt !== 'string' || typeof revision.note !== 'string') return null
    if (revision.parentId != null && typeof revision.parentId !== 'string') return null
    if (typeof revision.hash !== 'string' || dnaHash(parsed.dna) !== revision.hash) return null
    revisions.push({ id: revision.id, parentId: revision.parentId ?? null, branch: revision.branch, version: revision.version, createdAt: revision.createdAt, note: revision.note, dna: parsed.dna, hash: revision.hash as `0x${string}` })
  }
  const lineage: Lineage = { spec: MUTATION_SPEC, id: raw.id, revisions }
  try {
    for (const revision of revisions) revisionHistory(lineage, revision.id)
  } catch {
    return null
  }
  return lineage
}
