import { describe, expect, it } from 'vitest'
import { defaultDna, dnaHash, retarget } from '../src/protocol/chainDna'
import { branchLineage, classify, extendLineage, parseLineage, planUpgrade, revisionHistory, rollbackLineage, seedLineage } from '../src/protocol/mutation'

const at = '2026-10-25T00:00:00.000Z'

describe('mutation engine', () => {
  it('versions a branch and keeps the whole history', () => {
    const root = defaultDna('base')
    let lineage = seedLineage(root, 'start', at)
    const first = lineage.revisions[0]
    const upgraded = { ...structuredClone(root), execution: { ...root.execution, upgrades: 'uups' as const }, security: { ...root.security, admin: 'multisig' as const } }
    lineage = extendLineage(lineage, first.id, upgraded, 'Proxy and a multisig.', at)
    const tip = lineage.revisions[1]
    expect(tip.version).toBe(2)
    expect(tip.parentId).toBe(first.id)
    expect(revisionHistory(lineage, tip.id).map((revision) => revision.version)).toEqual([1, 2])
    const alternate = { ...structuredClone(root), name: 'Quantum App West' }
    lineage = branchLineage(lineage, first.id, alternate, 'west', 'A name branch.', at)
    expect(revisionHistory(lineage, lineage.revisions[2].id).map((revision) => revision.branch)).toEqual(['trunk', 'west'])
    expect(() => extendLineage(lineage, first.id, alternate, 'again', at)).toThrow(/not the tip/)
    expect(parseLineage(JSON.parse(JSON.stringify(lineage)))?.revisions).toHaveLength(3)
  })

  it('classifies a contract upgrade separately from a Base consensus change', () => {
    const base = defaultDna('base')
    const contracts = { ...structuredClone(base), execution: { ...base.execution, upgrades: 'uups' as const }, security: { ...base.security, admin: 'timelock' as const } }
    const plan = planUpgrade(base, contracts)
    expect(plan.applicable).toBe(true)
    expect(plan.changes.every((change) => change.effect === 'contract')).toBe(true)
    expect(plan.summary).toMatch(/Contract plan/)
    expect(plan.anvilAfter).toBeNull()

    const consensus = { ...structuredClone(base), security: { ...base.security, sequencing: 'decentralized' as const } }
    const refused = planUpgrade(base, consensus)
    expect(refused.applicable).toBe(false)
    expect(refused.changes.find((change) => change.path === 'security.sequencing')?.effect).toBe('impossible')
    expect(refused.summary).toMatch(/cannot be applied/)

    const timed = { ...structuredClone(base), network: { ...base.network, blockTimeMs: 1000 } }
    expect(classify(base, timed).find((change) => change.path === 'network.blockTimeMs')?.effect).toBe('impossible')
  })

  it('treats a local block-time change as an Anvil setting and a rollback as the reverse plan', () => {
    const local = defaultDna('local-devnet')
    const automine = { ...structuredClone(local), network: { ...local.network, blockTimeMs: 0 } }
    const plan = planUpgrade(local, automine)
    expect(plan.applicable).toBe(true)
    expect(plan.changes.find((change) => change.path === 'network.blockTimeMs')?.effect).toBe('local-anvil')
    expect(plan.anvilBefore).toContain('--block-time')
    expect(plan.anvilAfter).not.toContain('--block-time')

    let lineage = seedLineage(local, '', at)
    lineage = extendLineage(lineage, lineage.revisions[0].id, automine, 'Mine on every transaction.', at)
    const back = planUpgrade(lineage.revisions[1].dna, lineage.revisions[0].dna, 'rollback')
    expect(back.direction).toBe('rollback')
    expect(back.changes.find((change) => change.path === 'network.blockTimeMs')?.to).toBe('2000')
    lineage = rollbackLineage(lineage, lineage.revisions[1].id, 'undo', 'Back to two second blocks.', at)
    expect(lineage.revisions[2].dna.network.blockTimeMs).toBe(2000)
    expect(lineage.revisions[2].hash).toBe(dnaHash(local))
  })

  it('refuses to call a target switch a modification of Base', () => {
    const base = defaultDna('base')
    const rollup = retarget(base, 'op-stack')
    const change = classify(base, rollup).find((item) => item.path === 'target')
    expect(change?.effect).toBe('dedicated-chain')
    expect(change?.detail).toMatch(/does not modify/)
    expect(planUpgrade(base, rollup).applicable).toBe(false)
  })
})
