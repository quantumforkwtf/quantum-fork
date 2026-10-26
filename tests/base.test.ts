import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Hex, pad } from 'viem'
import { describe, expect, it } from 'vitest'
import { BURN_ADDRESS as DEAD, baseAvailability, burnCalldata, burnedInReceipt, burnTag, ERC20_BURN_ABI, type EvmLog, type EvmReceipt, type EvmTx, resolveBaseConfig, verifyEvmBurn } from '../src/protocol/base'
import { burnMemo } from '../src/protocol/deployment'

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const OTHER = '0x2222222222222222222222222222222222222222' as Hex
const WALLET = '0x3333333333333333333333333333333333333333' as Hex
const ZERO = '0x0000000000000000000000000000000000000000' as Hex
const AMOUNT = 100_000n * 10n ** 18n
const TAG = burnTag(burnMemo('dep_abcdefghijklmnop'))
const EXPECTED = { token: TOKEN, amountRaw: AMOUNT, tag: TAG, chainId: 8453 }

function transferLog(from: Hex, to: Hex, value: bigint, address: Hex = TOKEN): EvmLog {
  return {
    address,
    topics: encodeEventTopics({ abi: ERC20_BURN_ABI, eventName: 'Transfer', args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  }
}

function burnTx(overrides: Partial<EvmTx> = {}): EvmTx {
  return { hash: pad('0x01', { size: 32 }), from: WALLET, to: TOKEN, input: burnCalldata(AMOUNT, TAG), value: 0n, chainId: 8453, ...overrides }
}

function receipt(logs: EvmLog[] = [transferLog(WALLET, DEAD, AMOUNT)], status: EvmReceipt['status'] = 'success'): EvmReceipt {
  return { status, blockNumber: 123n, logs }
}

describe('Base burn verification', () => {
  it('accepts a tagged burn of the exact amount from the wallet', () => {
    const result = verifyEvmBurn(burnTx(), receipt(), EXPECTED)
    expect(result).toEqual({ ok: true, wallet: WALLET, blockNumber: 123n })
  })

  it('rejects missing and reverted transactions', () => {
    expect(verifyEvmBurn(null, null, EXPECTED)).toMatchObject({ ok: false, code: 'TX_NOT_FOUND' })
    expect(verifyEvmBurn(burnTx(), receipt([], 'reverted'), EXPECTED)).toMatchObject({ ok: false, code: 'TX_FAILED' })
  })

  it('rejects a burn on another chain or another contract', () => {
    expect(verifyEvmBurn(burnTx({ chainId: 1 }), receipt(), EXPECTED)).toMatchObject({ code: 'WRONG_CHAIN' })
    expect(verifyEvmBurn(burnTx({ to: OTHER }), receipt(), EXPECTED)).toMatchObject({ code: 'WRONG_CONTRACT' })
  })

  it('builds transfer(0x…dEaD, amount) followed by the tag', () => {
    expect(burnCalldata(AMOUNT, TAG)).toBe(`${encodeFunctionData({ abi: ERC20_BURN_ABI, functionName: 'transfer', args: [DEAD, AMOUNT] })}${TAG.slice(2)}`)
  })

  it('rejects calls that are not a tagged transfer to the burn address', () => {
    const untagged = encodeFunctionData({ abi: ERC20_BURN_ABI, functionName: 'transfer', args: [DEAD, AMOUNT] })
    expect(verifyEvmBurn(burnTx({ input: untagged }), receipt(), EXPECTED)).toMatchObject({ code: 'NOT_A_BURN' })
    for (const to of [ZERO, OTHER, WALLET]) {
      const elsewhere = `${encodeFunctionData({ abi: ERC20_BURN_ABI, functionName: 'transfer', args: [to, AMOUNT] })}${TAG.slice(2)}` as Hex
      expect(verifyEvmBurn(burnTx({ input: elsewhere }), receipt([transferLog(WALLET, to, AMOUNT)]), EXPECTED)).toMatchObject({ code: 'NOT_A_BURN' })
    }
    const burnFn = `${encodeFunctionData({ abi: [{ type: 'function', name: 'burn', inputs: [{ type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }], args: [AMOUNT] })}${TAG.slice(2)}` as Hex
    expect(verifyEvmBurn(burnTx({ input: burnFn }), receipt([transferLog(WALLET, ZERO, AMOUNT)]), EXPECTED)).toMatchObject({ code: 'NOT_A_BURN' })
    const approve = `${encodeFunctionData({ abi: [{ type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }], args: [DEAD, AMOUNT] })}${TAG.slice(2)}` as Hex
    expect(verifyEvmBurn(burnTx({ input: approve }), receipt(), EXPECTED)).toMatchObject({ code: 'NOT_A_BURN' })
  })

  it('rejects the wrong amount or another deployment’s tag', () => {
    expect(verifyEvmBurn(burnTx({ input: burnCalldata(AMOUNT - 1n, TAG) }), receipt(), EXPECTED)).toMatchObject({ code: 'WRONG_AMOUNT' })
    const otherTag = burnTag(burnMemo('dep_zzzzzzzzzzzzzzzz'))
    expect(verifyEvmBurn(burnTx({ input: burnCalldata(AMOUNT, otherTag) }), receipt(), EXPECTED)).toMatchObject({ code: 'TAG_MISMATCH' })
  })

  it('rejects ETH attached to the burn', () => {
    expect(verifyEvmBurn(burnTx({ value: 1n }), receipt(), EXPECTED)).toMatchObject({ code: 'VALUE_SENT' })
  })

  it('requires exactly one transfer of the amount from the wallet to the burn address', () => {
    expect(verifyEvmBurn(burnTx(), receipt([]), EXPECTED)).toMatchObject({ code: 'NO_BURN' })
    expect(verifyEvmBurn(burnTx(), receipt([transferLog(WALLET, DEAD, AMOUNT), transferLog(WALLET, OTHER, 1n)]), EXPECTED)).toMatchObject({ code: 'MULTIPLE_BURNS' })
    expect(verifyEvmBurn(burnTx(), receipt([transferLog(WALLET, OTHER, AMOUNT)]), EXPECTED)).toMatchObject({ code: 'BALANCE_MISMATCH' })
    expect(verifyEvmBurn(burnTx(), receipt([transferLog(WALLET, ZERO, AMOUNT)]), EXPECTED)).toMatchObject({ code: 'BALANCE_MISMATCH' })
    expect(verifyEvmBurn(burnTx(), receipt([transferLog(OTHER, DEAD, AMOUNT)]), EXPECTED)).toMatchObject({ code: 'BALANCE_MISMATCH' })
    expect(verifyEvmBurn(burnTx(), receipt([transferLog(WALLET, DEAD, AMOUNT - 1n)]), EXPECTED)).toMatchObject({ code: 'BALANCE_MISMATCH' })
  })

  it('ignores transfer logs from other contracts', () => {
    const logs = [transferLog(WALLET, OTHER, 5n, OTHER), transferLog(WALLET, DEAD, AMOUNT)]
    expect(verifyEvmBurn(burnTx(), receipt(logs), EXPECTED)).toMatchObject({ ok: true })
  })

  it('notices tokens sent to the burn address even when verification fails', () => {
    expect(burnedInReceipt(receipt([transferLog(WALLET, DEAD, 1n)]), TOKEN)).toBe(true)
    expect(burnedInReceipt(receipt([transferLog(WALLET, ZERO, 1n)]), TOKEN)).toBe(false)
    expect(burnedInReceipt(receipt([transferLog(WALLET, DEAD, 1n)], 'reverted'), TOKEN)).toBe(false)
  })
})

describe('Base configuration', () => {
  it('defaults to Base Sepolia with registration off', () => {
    const { config } = resolveBaseConfig({})
    expect(config).toMatchObject({ network: 'base-sepolia', chainId: 84532, token: null, tokenStatus: 'PRELAUNCH', deployments: false })
    expect(baseAvailability(config, true).available).toBe(false)
  })

  it('keeps registration off without a token, or on mainnet before launch', () => {
    expect(resolveBaseConfig({ ENABLE_BASE_DEPLOYMENTS: 'true' }).config.deployments).toBe(false)
    expect(resolveBaseConfig({ BASE_NETWORK: 'base', QFORK_BASE_TOKEN: TOKEN, ENABLE_BASE_DEPLOYMENTS: 'true' }).config.deployments).toBe(false)
  })

  it('opens mainnet registration only with a live token and the flag', () => {
    const { config } = resolveBaseConfig({ BASE_NETWORK: 'base', QFORK_BASE_TOKEN: TOKEN, BASE_TOKEN_STATUS: 'LIVE', ENABLE_BASE_DEPLOYMENTS: 'true' })
    expect(config).toMatchObject({ network: 'base', chainId: 8453, deployments: true })
    expect(baseAvailability(config, true).available).toBe(true)
    expect(baseAvailability(config, false).available).toBe(false)
  })

  it('rejects a malformed token address', () => {
    const { config, issues } = resolveBaseConfig({ QFORK_BASE_TOKEN: '0x123' })
    expect(config.token).toBeNull()
    expect(issues.some((issue) => issue.key === 'QFORK_BASE_TOKEN')).toBe(true)
  })
})
