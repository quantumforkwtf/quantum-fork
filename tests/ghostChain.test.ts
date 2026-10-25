import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { createGhost, resetGhostsForTests, terminateGhost } from '../api/_lib/ghosts'
import { createRecord, remainingMs, transition } from '../src/protocol/ghostChain'

const hasAnvil = spawnSync('anvil', ['--version']).status === 0

describe('ghost chain lifecycle', () => {
  const now = 1_000_000
  const record = () => createRecord({ id: 'gh_abcdef123456', chainId: 424242, port: 18620, lifetime: '15m', now })

  it('starts, expires only at the deadline, and then terminates', () => {
    const created = record()
    expect(created.status).toBe('CREATING')
    expect(created.expiresAt - created.createdAt).toBe(15 * 60_000)
    const running = transition(created, 'started', now)
    expect(() => transition(running, 'expire', created.expiresAt - 1)).toThrow(/not reached/)
    const expiring = transition(running, 'expire', created.expiresAt)
    expect(transition(expiring, 'stopped', created.expiresAt).status).toBe('TERMINATED')
    expect(() => transition(transition(expiring, 'stopped', created.expiresAt), 'started', created.expiresAt)).toThrow(/terminated/)
  })

  it('rejects a skip from creating straight to stopped', () => {
    expect(() => transition(record(), 'stopped', now)).toThrow(/Cannot stopped/)
    expect(remainingMs(transition(record(), 'fail', now, 'disk full'), now)).toBe(0)
  })
})

describe.skipIf(!hasAnvil)('local ghost chain process', () => {
  afterAll(() => resetGhostsForTests())

  it('starts an Anvil, reports its chain, and kills it on terminate', async () => {
    const created = await createGhost('15m')
    expect(created.status).toBe('RUNNING')
    expect(created.rpcOk).toBe(true)
    expect(created.blockNumber).toBe(0)
    expect(created.accounts).toHaveLength(3)
    expect(created.rssKb).toBeGreaterThan(0)
    const chain = await fetch(created.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then((response) => response.json())
    expect(Number(chain.result)).toBe(created.chainId)
    const stopped = await terminateGhost(created.id)
    expect(stopped.status).toBe('TERMINATED')
    expect(stopped.remainingMs).toBe(0)
    let gone = true
    for (let attempt = 0; attempt < 20; attempt += 1) {
      gone = await fetch(created.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then(() => true).catch(() => false)
      if (!gone) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(gone).toBe(false)
  }, 20_000)
})
