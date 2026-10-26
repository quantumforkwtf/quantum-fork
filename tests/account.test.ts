import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'
import { type BaseError, createPublicClient, createWalletClient, encodeErrorResult, encodeFunctionData, getAddress, getContractAddress, type Hex, http, keccak256, parseEther, toBytes, toHex, zeroHash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ACCOUNT_ABI,
  ACCOUNT_FACTORY_ABI,
  ACCOUNT_FACTORY_ADDRESS,
  ACCOUNT_FACTORY_DEPLOYMENTS,
  TOKEN_MOVING_SELECTORS,
  type Allowance,
  accountErrorMessage,
  approveCalldata,
  createAccountCalldata,
  describeProposal,
  ETH,
  executeCalldata,
  type KeysetDescriptor,
  keysetCommitment,
  ownerActionCalldata,
  ownerActionsCalldata,
  proposeOwnerAction,
  readAccount,
  selectorOf,
  spendCalldata,
  validateAllowance,
  validateKeyset,
  validateOwners,
  validateScopeSelector,
} from '../src/protocol/account'

/** Anvil's first three development accounts. Public, deterministic, devnet ETH only. */
const OWNER_A = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const OWNER_B = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const AGENT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
const SHOP = '0x00000000000000000000000000000000000005b0' as Hex
const ARTIFACT = new URL('../contracts/out/QForkAccountFactory.sol/QForkAccountFactory.json', import.meta.url)
const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920ca78fbf26c0b4956c'

const descriptor = (): KeysetDescriptor => ({
  version: 1,
  recoveryThreshold: 1,
  keys: [
    { scheme: 'ml-dsa-65', role: 'authorize', publicKey: toHex(ml_dsa65.keygen().publicKey) },
    { scheme: 'slh-dsa-sha2-128s', role: 'recovery', publicKey: toHex(slh_dsa_sha2_128s.keygen().publicKey) },
  ],
})

describe('account calldata and validation', () => {
  it('round-trips owner actions through describeProposal', () => {
    const account = '0x1111111111111111111111111111111111111111' as Hex
    const limits: Allowance = { perTransfer: 5n, perPeriod: 10n, period: 86400, validUntil: 2_000_000_000, recipientsRestricted: true }
    for (const action of [
      { kind: 'addOwner', owner: getAddress(SHOP), threshold: 2 },
      { kind: 'setThreshold', threshold: 1 },
      { kind: 'setAllowance', spender: getAddress(SHOP), asset: ETH, limits },
      { kind: 'setScope', spender: getAddress(SHOP), target: account, selector: '0x12345678', validUntil: 7 },
      { kind: 'rotateKeyset', commitment: zeroHash },
      { kind: 'cancel', id: 3n },
    ] as const) {
      expect(describeProposal(account, { to: account, value: 0n, data: ownerActionCalldata(action) })).toEqual({ kind: 'owner-actions', actions: [action] })
    }
    const pair = [
      { kind: 'setAllowance', spender: getAddress(SHOP), asset: ETH, limits },
      { kind: 'setRecipient', spender: getAddress(SHOP), recipient: account, allowed: true },
    ] as const
    expect(describeProposal(account, { to: account, value: 0n, data: ownerActionsCalldata([...pair]) })).toEqual({ kind: 'owner-actions', actions: pair })
    expect(describeProposal(account, { to: SHOP, value: 1n, data: '0x' })).toEqual({ kind: 'transfer', to: SHOP, value: 1n })
    expect(describeProposal(account, { to: SHOP, value: 0n, data: '0xdeadbeef00' })).toMatchObject({ kind: 'call', selector: '0xdeadbeef' })
  })

  it('validates owners, allowances and selectors the way the contract does', () => {
    expect(validateOwners([OWNER_A.address], 1)).toBeNull()
    expect(validateOwners([OWNER_A.address, OWNER_A.address.toLowerCase()], 1)).toMatch(/twice/)
    expect(validateOwners([OWNER_A.address], 2)).toMatch(/between 1 and 1/)
    expect(validateOwners(['0x0000000000000000000000000000000000000000'], 1)).toMatch(/zero/)
    const now = 1_800_000_000
    expect(validateAllowance({ perTransfer: 1n, perPeriod: 2n, period: 3600, validUntil: now + 1, recipientsRestricted: false }, now)).toBeNull()
    expect(validateAllowance({ perTransfer: 3n, perPeriod: 2n, period: 3600, validUntil: now + 1, recipientsRestricted: false }, now)).toMatch(/at least/)
    expect(validateAllowance({ perTransfer: 1n, perPeriod: 2n, period: 3600, validUntil: now, recipientsRestricted: false }, now)).toMatch(/future/)
    expect(validateScopeSelector('0xa9059cbb')).toMatch(/spending allowance/)
    expect(selectorOf('transfer(address,uint256)')).toBe('0xa9059cbb')
    expect(selectorOf('nonsense')).toBeNull()
  })

  it('commits to the same key set regardless of order or labels', () => {
    const set = descriptor()
    expect(validateKeyset(set)).toBeNull()
    const commitment = keysetCommitment(set)
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/)
    expect(keysetCommitment({ ...set, keys: [...set.keys].reverse().map((key) => ({ ...key, label: 'phone', publicKey: key.publicKey.toUpperCase().replace('0X', '0x') as Hex })) })).toBe(commitment)
    expect(keysetCommitment({ ...set, keys: set.keys.map((key) => ({ ...key, role: 'guardian' })) })).not.toBe(commitment)
    expect(keysetCommitment({ ...set, recoveryThreshold: 1, keys: [set.keys[0], { ...set.keys[1], role: 'guardian' }] })).not.toBe(commitment)
  })

  it('rejects malformed key sets', () => {
    const set = descriptor()
    expect(validateKeyset({ ...set, keys: [{ ...set.keys[0], publicKey: '0x1234' }] })).toMatch(/1952 bytes/)
    expect(validateKeyset({ ...set, recoveryThreshold: 2 })).toMatch(/between 1 and 1/)
    expect(validateKeyset({ ...set, keys: [set.keys[0], set.keys[0]], recoveryThreshold: 0 })).toMatch(/twice/)
    expect(() => keysetCommitment({ ...set, keys: [] })).toThrow()
  })

  it('explains reverts, including ones wrapped by a proposal', () => {
    const inner = encodeErrorResult({ abi: ACCOUNT_ABI, errorName: 'BadThreshold', args: [3n, 2n] })
    expect(accountErrorMessage(inner)).toBe('Approvals needed (3) must be between 1 and the number of owners (2).')
    expect(accountErrorMessage(encodeErrorResult({ abi: ACCOUNT_ABI, errorName: 'ExecutionFailed', args: [inner] }))).toBe(accountErrorMessage(inner))
    expect(accountErrorMessage(encodeErrorResult({ abi: ACCOUNT_ABI, errorName: 'ExecutionFailed', args: ['0x'] }))).toBe('The proposed call reverted.')
    expect(accountErrorMessage('0x')).toBeNull()
    expect(accountErrorMessage('0x12345678')).toBeNull()
  })

  it('blocks the same token-moving selectors as the contract', () => {
    const source = readFileSync(new URL('../contracts/src/QForkAccount.sol', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('function _movesTokens'), source.indexOf('}', source.indexOf('function _movesTokens')))
    const inContract = [...body.matchAll(/0x[0-9a-f]{8}/g)].map((match) => match[0])
    expect(new Set(inContract)).toEqual(new Set(TOKEN_MOVING_SELECTORS))
    for (const selector of TOKEN_MOVING_SELECTORS) expect(validateScopeSelector(selector)).toMatch(/spending allowance/)
  })

  it.skipIf(!existsSync(ARTIFACT))('records the factory address the deploy script will produce', () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } }
    const address = getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt: keccak256(toBytes('quantumfork.account-factory.v1')), bytecode: artifact.bytecode.object })
    expect(address).toBe(ACCOUNT_FACTORY_ADDRESS)
    for (const recorded of Object.values(ACCOUNT_FACTORY_DEPLOYMENTS)) if (recorded) expect(getAddress(recorded)).toBe(ACCOUNT_FACTORY_ADDRESS)
  })
})

const nodes: ChildProcess[] = []
afterAll(() => {
  for (const node of nodes) node.kill()
})

describe.skipIf(!hasAnvil || !existsSync(ARTIFACT))('QForkAccount on a local chain', () => {
  let url: string
  let factory: Hex
  let account: Hex
  const rpc = () => createPublicClient({ transport: http(url) })

  const send = async (signer: typeof OWNER_A, to: Hex, data: Hex, value = 0n) => {
    const hash = await createWalletClient({ account: signer, transport: http(url) }).sendTransaction({ to, data, value, chain: null })
    const receipt = await rpc().waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
    return receipt
  }

  const revertOf = async (signer: typeof OWNER_A, to: Hex, data: Hex) => {
    try {
      await rpc().call({ account: signer, to, data })
    } catch (error) {
      const raw = (error as BaseError).walk?.((cause) => typeof (cause as { data?: unknown }).data === 'string') as { data?: Hex } | undefined
      return accountErrorMessage(raw?.data)
    }
    return null
  }

  beforeAll(async () => {
    const node = spawn('anvil', ['--chain-id', '84532', '--port', '18547', '--silent'], { stdio: 'ignore' })
    nodes.push(node)
    url = 'http://127.0.0.1:18547'
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await rpc().getChainId().then(() => true, () => false)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } }
    const deployed = await rpc().waitForTransactionReceipt({
      hash: await createWalletClient({ account: OWNER_A, transport: http(url) }).deployContract({ abi: ACCOUNT_FACTORY_ABI, bytecode: artifact.bytecode.object, chain: null }),
    })
    factory = deployed.contractAddress!
  })

  it('creates a 2-of-2 account at the predicted address with a key-set commitment', async () => {
    const owners = [OWNER_A.address, OWNER_B.address]
    const commitment = keysetCommitment(descriptor())
    const salt = toHex('first', { size: 32 })
    const predicted = await rpc().readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'predict', args: [OWNER_A.address, owners, 2, commitment, salt] })
    await send(OWNER_A, factory, createAccountCalldata(owners, 2, commitment, salt))
    account = predicted
    expect(await rpc().readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'accountsOf', args: [OWNER_B.address] })).toEqual([predicted])
    expect(await rpc().readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'createdBy', args: [OWNER_A.address] })).toEqual([predicted])
    expect(await rpc().readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'createdBy', args: [OWNER_B.address] })).toEqual([])
    await send(OWNER_A, account, '0x', parseEther('5'))

    const state = await readAccount(rpc(), account)
    expect(state).toMatchObject({ owners, threshold: 2, keyset: commitment, keysetVersion: 1, proposalCount: 0n, spenders: [], balance: parseEther('5') })
  })

  it('needs both owners to grant an agent an allowance, then enforces it', async () => {
    const block = await rpc().getBlock()
    const limits: Allowance = { perTransfer: parseEther('1'), perPeriod: parseEther('1.5'), period: 86400, validUntil: Number(block.timestamp) + 7 * 86400, recipientsRestricted: true }
    await send(
      OWNER_A,
      account,
      proposeOwnerAction(account, { kind: 'setAllowance', spender: AGENT.address, asset: ETH, limits }, { kind: 'setRecipient', spender: AGENT.address, recipient: SHOP, allowed: true }),
    )

    let state = await readAccount(rpc(), account)
    expect(state.proposals.map((proposal) => [proposal.id, proposal.approvals, proposal.executed])).toEqual([[0n, 1, false]])
    expect(state.proposals[0].approvedBy).toEqual([OWNER_A.address])
    expect(describeProposal(account, state.proposals[0])).toMatchObject({ kind: 'owner-actions', actions: [{ kind: 'setAllowance', spender: AGENT.address }, { kind: 'setRecipient' }] })
    expect(await revertOf(AGENT, account, spendCalldata(ETH, SHOP, parseEther('0.5')))).toBe('This agent has no allowance for that asset.')
    expect(await revertOf(OWNER_A, account, executeCalldata(0n))).toBe('It has 1 of 2 approvals.')

    await send(OWNER_B, account, approveCalldata(0n))
    expect((await readAccount(rpc(), account)).proposals[0]).toMatchObject({ approvals: 2, executed: false })
    await send(OWNER_B, account, executeCalldata(0n))
    state = await readAccount(rpc(), account)
    expect(state.proposals[0].executed).toBe(true)
    expect(state.spenders).toEqual([
      { address: AGENT.address, frozen: false, allowances: [{ asset: ETH, limits, spentInPeriod: 0n, periodEndsAt: 0 }], recipients: [{ address: getAddress(SHOP), allowed: true }], scopes: [] },
    ])

    await send(AGENT, account, spendCalldata(ETH, SHOP, parseEther('1')))
    expect(await rpc().getBalance({ address: SHOP })).toBe(parseEther('1'))
    expect(await revertOf(AGENT, account, spendCalldata(ETH, SHOP, parseEther('0.75')))).toMatch(/over the limit/)
    expect(await revertOf(AGENT, account, spendCalldata(ETH, OWNER_A.address, parseEther('0.1')))).toBe('That recipient is not on the allow list.')
    expect(await revertOf(OWNER_A, account, ownerActionCalldata({ kind: 'setThreshold', threshold: 1 }))).toBe('That change has to go through a proposal.')
  })

  it('lets one owner freeze an agent immediately', async () => {
    await send(OWNER_B, account, encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'freeze', args: [AGENT.address] }))
    expect((await readAccount(rpc(), account)).spenders[0].frozen).toBe(true)
    expect(await revertOf(AGENT, account, spendCalldata(ETH, SHOP, 1n))).toBe('This agent is frozen.')
  })
})