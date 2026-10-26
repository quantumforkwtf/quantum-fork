import { decodeErrorResult, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, type Hex, isAddress, keccak256, parseAbi, type PublicClient, toFunctionSelector, zeroAddress } from 'viem'
import type { BaseNetwork } from './base.js'

/** contracts/src/QForkAccount.sol */
export const ACCOUNT_ABI = parseAbi([
  'function MAX_OWNERS() view returns (uint256)',
  'function MAX_SPENDERS() view returns (uint256)',
  'function MAX_PER_SPENDER() view returns (uint256)',
  'function owners() view returns (address[])',
  'function isOwner(address account) view returns (bool)',
  'function threshold() view returns (uint8)',
  'function keyset() view returns (bytes32)',
  'function keysetVersion() view returns (uint32)',
  'function proposalCount() view returns (uint256)',
  'function proposal(uint256 id) view returns ((address to, uint64 createdAt, bool executed, bool cancelled, uint256 value, bytes data))',
  'function approvals(uint256 id) view returns (uint256 count)',
  'function hasApproved(uint256 id, address owner) view returns (bool)',
  'function spenders() view returns (address[])',
  'function spenderInfo(address spender) view returns (bool isFrozen, address[] assets, address[] recipients, (address target, bytes4 selector)[] scopes)',
  'function allowance(address spender, address asset) view returns ((uint128 perTransfer, uint128 perPeriod, uint32 period, uint64 validUntil, bool recipientsRestricted) limits, uint256 spentInPeriod, uint256 periodEndsAt)',
  'function recipientAllowed(address spender, address recipient) view returns (bool)',
  'function scope(address spender, address target, bytes4 selector) view returns (uint64 validUntil)',
  'function frozen(address spender) view returns (bool)',
  'function submit(address to, uint256 value, bytes data) returns (uint256 id, bool executed)',
  'function approve(uint256 id)',
  'function revokeApproval(uint256 id)',
  'function execute(uint256 id)',
  'function cancel(uint256 id)',
  'function addOwner(address owner, uint8 newThreshold)',
  'function removeOwner(address owner, uint8 newThreshold)',
  'function setThreshold(uint8 newThreshold)',
  'function setAllowance(address spender, address asset, (uint128 perTransfer, uint128 perPeriod, uint32 period, uint64 validUntil, bool recipientsRestricted) limits)',
  'function setRecipient(address spender, address recipient, bool allowed)',
  'function setScope(address spender, address target, bytes4 selector, uint64 validUntil)',
  'function freeze(address spender)',
  'function unfreeze(address spender)',
  'function rotateKeyset(bytes32 commitment)',
  'function batch(bytes[] calls)',
  'function spend(address asset, address to, uint256 amount)',
  'function scopedCall(address target, bytes data) returns (bytes)',
  'event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 value, bytes data)',
  'event Approved(uint256 indexed id, address indexed owner)',
  'event Executed(uint256 indexed id, address indexed executor)',
  'event Spent(address indexed spender, address indexed asset, address indexed to, uint256 amount, uint256 spentInPeriod)',
  'error NotOwner(address caller)',
  'error NotSelf()',
  'error BadOwners()',
  'error BadThreshold(uint256 threshold, uint256 owners)',
  'error UnknownProposal(uint256 id)',
  'error ProposalClosed(uint256 id)',
  'error AlreadyApproved(uint256 id)',
  'error NotApproved(uint256 id)',
  'error NotEnoughApprovals(uint256 have, uint256 need)',
  'error ExecutionFailed(bytes reason)',
  'error BadAllowance()',
  'error TooManySpenders()',
  'error TooManyEntries()',
  'error Frozen(address spender)',
  'error NoAllowance(address spender, address asset)',
  'error Expired(uint64 validUntil)',
  'error OverTransferLimit(uint256 amount, uint256 limit)',
  'error OverPeriodLimit(uint256 wouldSpend, uint256 limit)',
  'error RecipientNotAllowed(address recipient)',
  'error BadRecipient()',
  'error NotInScope(address target, bytes4 selector)',
  'error TokenMovementNeedsSpend(bytes4 selector)',
  'error TransferFailed()',
])

/** contracts/src/QForkAccountFactory.sol */
export const ACCOUNT_FACTORY_ABI = parseAbi([
  'function create(address[] owners, uint8 threshold, bytes32 keyset, bytes32 salt) returns (address account)',
  'function predict(address creator, address[] owners, uint8 threshold, bytes32 keyset, bytes32 salt) view returns (address)',
  'function accountsOf(address owner) view returns (address[])',
  'function createdBy(address creator) view returns (address[])',
  'function isAccount(address account) view returns (bool)',
  'event AccountCreated(address indexed account, address indexed creator, address[] owners, uint8 threshold, bytes32 keyset)',
])

/** Where contracts/script/DeployAccounts.s.sol puts the factory on every chain (CREATE2, fixed salt). */
export const ACCOUNT_FACTORY_ADDRESS: Hex = '0x24bc9BBC2DdfDfF9E021E546c19F73610A5663ad'
/** Recorded only after the deployed code has been checked against this build. */
export const ACCOUNT_FACTORY_DEPLOYMENTS: Record<BaseNetwork, Hex | null> = { 'base-sepolia': null, base: null }
/** The network the console uses: Base once the factory is recorded there, else Base Sepolia. */
export const ACCOUNT_NETWORK: BaseNetwork = ACCOUNT_FACTORY_DEPLOYMENTS.base ? 'base' : 'base-sepolia'

export const MAX_OWNERS = 16
export const MAX_SPENDERS = 64
export const MAX_PER_SPENDER = 32
export const ETH = zeroAddress

/** Mirrors QForkAccount._movesTokens: these must go through spend(), never scopedCall(). */
export const TOKEN_MOVING_SELECTORS: readonly Hex[] = [
  '0xa9059cbb',
  '0x095ea7b3',
  '0x23b872dd',
  '0x39509351',
  '0xd505accf',
  '0x8fcbaf0c',
  '0xa22cb465',
  '0x42842e0e',
  '0xb88d4fde',
  '0xf242432a',
  '0x2eb2c2d6',
  '0x4000aea0',
  '0x9bd9bbc6',
  '0x62ad1b83',
  '0x959b8c3f',
  '0x87517c45',
  '0x2b67b570',
  '0x2a2d80d1',
]

export interface Allowance {
  perTransfer: bigint
  perPeriod: bigint
  /** Seconds. */
  period: number
  /** Unix seconds. */
  validUntil: number
  recipientsRestricted: boolean
}

export const NO_ALLOWANCE: Allowance = { perTransfer: 0n, perPeriod: 0n, period: 0, validUntil: 0, recipientsRestricted: false }

export type OwnerAction =
  | { kind: 'addOwner'; owner: Hex; threshold: number }
  | { kind: 'removeOwner'; owner: Hex; threshold: number }
  | { kind: 'setThreshold'; threshold: number }
  | { kind: 'setAllowance'; spender: Hex; asset: Hex; limits: Allowance }
  | { kind: 'setRecipient'; spender: Hex; recipient: Hex; allowed: boolean }
  | { kind: 'setScope'; spender: Hex; target: Hex; selector: Hex; validUntil: number }
  | { kind: 'unfreeze'; spender: Hex }
  | { kind: 'rotateKeyset'; commitment: Hex }
  | { kind: 'cancel'; id: bigint }

const limitsArg = (limits: Allowance) => ({ ...limits, validUntil: BigInt(limits.validUntil) })

/** Calldata for an account calling itself; wrap it with submitCalldata(account, 0n, data). */
export function ownerActionCalldata(action: OwnerAction): Hex {
  switch (action.kind) {
    case 'addOwner':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'addOwner', args: [getAddress(action.owner), action.threshold] })
    case 'removeOwner':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'removeOwner', args: [getAddress(action.owner), action.threshold] })
    case 'setThreshold':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'setThreshold', args: [action.threshold] })
    case 'setAllowance':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'setAllowance', args: [getAddress(action.spender), getAddress(action.asset), limitsArg(action.limits)] })
    case 'setRecipient':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'setRecipient', args: [getAddress(action.spender), getAddress(action.recipient), action.allowed] })
    case 'setScope':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'setScope', args: [getAddress(action.spender), getAddress(action.target), action.selector, BigInt(action.validUntil)] })
    case 'unfreeze':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'unfreeze', args: [getAddress(action.spender)] })
    case 'rotateKeyset':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'rotateKeyset', args: [action.commitment] })
    case 'cancel':
      return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'cancel', args: [action.id] })
  }
}

export function submitCalldata(to: Hex, value: bigint, data: Hex): Hex {
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'submit', args: [getAddress(to), value, data] })
}

/** One action is sent as itself; several go through batch() so they pass or fail together. */
export function ownerActionsCalldata(actions: OwnerAction[]): Hex {
  if (!actions.length) throw new Error('No actions.')
  if (actions.length === 1) return ownerActionCalldata(actions[0])
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'batch', args: [actions.map(ownerActionCalldata)] })
}

export function proposeOwnerAction(account: Hex, ...actions: OwnerAction[]): Hex {
  return submitCalldata(account, 0n, ownerActionsCalldata(actions))
}

export const approveCalldata = (id: bigint) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'approve', args: [id] })
export const revokeCalldata = (id: bigint) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'revokeApproval', args: [id] })
export const executeCalldata = (id: bigint) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'execute', args: [id] })
export const freezeCalldata = (spender: Hex) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'freeze', args: [getAddress(spender)] })
export const spendCalldata = (asset: Hex, to: Hex, amount: bigint) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'spend', args: [getAddress(asset), getAddress(to), amount] })
export const scopedCallCalldata = (target: Hex, data: Hex) => encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'scopedCall', args: [getAddress(target), data] })

export function createAccountCalldata(owners: Hex[], threshold: number, keyset: Hex, salt: Hex): Hex {
  return encodeFunctionData({ abi: ACCOUNT_FACTORY_ABI, functionName: 'create', args: [owners.map((owner) => getAddress(owner)), threshold, keyset, salt] })
}

/** Checks the inputs the constructor would reject, so a wallet is never asked to sign a revert. */
export function validateOwners(owners: string[], threshold: number): string | null {
  if (!owners.length) return 'Add at least one owner.'
  if (owners.length > MAX_OWNERS) return `At most ${MAX_OWNERS} owners.`
  const seen = new Set<string>()
  for (const owner of owners) {
    if (!isAddress(owner, { strict: false })) return `${owner || 'An empty row'} is not an address.`
    if (owner.toLowerCase() === zeroAddress) return 'The zero address cannot be an owner.'
    if (seen.has(owner.toLowerCase())) return `${owner} is listed twice.`
    seen.add(owner.toLowerCase())
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) return `Approvals needed must be between 1 and ${owners.length}.`
  return null
}

export function validateAllowance(limits: Allowance, now = Math.floor(Date.now() / 1000)): string | null {
  if (limits.perTransfer <= 0n) return 'Set a per-transfer limit above zero.'
  if (limits.perPeriod < limits.perTransfer) return 'The period limit must be at least the per-transfer limit.'
  if (limits.perPeriod >= 2n ** 128n) return 'The period limit is too large.'
  if (limits.period <= 0 || limits.period >= 2 ** 32) return 'Choose a period.'
  if (limits.validUntil <= now) return 'The expiry must be in the future.'
  return null
}

export function validateScopeSelector(selector: string): string | null {
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) return 'A selector is 4 bytes, like 0x12345678.'
  if (TOKEN_MOVING_SELECTORS.includes(selector.toLowerCase() as Hex)) return 'Token transfers and approvals must use a spending allowance, not a call scope.'
  return null
}

/** Accepts a 0x selector or a signature like "bump(uint256)". */
export function selectorOf(input: string): Hex | null {
  const value = input.trim()
  if (/^0x[0-9a-fA-F]{8}$/.test(value)) return value.toLowerCase() as Hex
  if (/^[A-Za-z_$][\w$]*\([^()]*\)$/.test(value)) {
    try {
      return toFunctionSelector(`function ${value}`)
    } catch {
      return null
    }
  }
  return null
}

/* ---------- post-quantum key set ---------- */

export type KeysetScheme = 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87' | 'slh-dsa-sha2-128f' | 'slh-dsa-sha2-128s'
export type KeyRole = 'authorize' | 'recovery' | 'guardian'

export interface KeysetKey {
  scheme: KeysetScheme
  role: KeyRole
  publicKey: Hex
  label?: string
}

/**
 * The public half of an account's post-quantum keys. Only its hash goes on-chain; Base cannot
 * verify these signatures, so the commitment records which keys the owners intend to trust.
 */
export interface KeysetDescriptor {
  version: 1
  keys: KeysetKey[]
  /** How many recovery or guardian keys must agree. */
  recoveryThreshold: number
}

export const KEYSET_DOMAIN = 'qfork.keyset.v1'
export const KEYSET_ROLES: readonly KeyRole[] = ['authorize', 'recovery', 'guardian']
export const KEYSET_PUBLIC_KEY_BYTES: Record<KeysetScheme, number> = { 'ml-dsa-44': 1312, 'ml-dsa-65': 1952, 'ml-dsa-87': 2592, 'slh-dsa-sha2-128f': 32, 'slh-dsa-sha2-128s': 32 }

export function validateKeyset(descriptor: KeysetDescriptor): string | null {
  if (descriptor.version !== 1) return 'Unknown key set version.'
  if (!descriptor.keys.length) return 'Add at least one key.'
  if (descriptor.keys.length > 32) return 'At most 32 keys.'
  const seen = new Set<string>()
  for (const key of descriptor.keys) {
    if (!(key.scheme in KEYSET_PUBLIC_KEY_BYTES)) return `Unknown scheme ${key.scheme}.`
    if (!KEYSET_ROLES.includes(key.role)) return `Unknown role ${key.role}.`
    if (!/^0x([0-9a-f]{2})+$/i.test(key.publicKey) || (key.publicKey.length - 2) / 2 !== KEYSET_PUBLIC_KEY_BYTES[key.scheme]) return `A ${key.scheme} public key is ${KEYSET_PUBLIC_KEY_BYTES[key.scheme]} bytes.`
    if (seen.has(key.publicKey.toLowerCase())) return 'A key is listed twice.'
    seen.add(key.publicKey.toLowerCase())
  }
  const recoverers = descriptor.keys.filter((key) => key.role !== 'authorize').length
  if (recoverers === 0 ? descriptor.recoveryThreshold !== 0 : descriptor.recoveryThreshold < 1 || descriptor.recoveryThreshold > recoverers) {
    return recoverers === 0 ? 'Without recovery or guardian keys the recovery threshold is 0.' : `The recovery threshold must be between 1 and ${recoverers}.`
  }
  return null
}

/**
 * keccak256(abi.encode(domain, recoveryThreshold, [(scheme, role, keccak256(publicKey))])) with
 * keys sorted by hash, so the same set always commits to the same value. Labels are not committed.
 */
export function keysetCommitment(descriptor: KeysetDescriptor): Hex {
  const problem = validateKeyset(descriptor)
  if (problem) throw new Error(problem)
  const entries = descriptor.keys
    .map((key) => ({ scheme: key.scheme, role: KEYSET_ROLES.indexOf(key.role) + 1, keyHash: keccak256(key.publicKey.toLowerCase() as Hex) }))
    .sort((a, b) => (a.keyHash < b.keyHash ? -1 : a.keyHash > b.keyHash ? 1 : 0))
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint8' }, { type: 'tuple[]', components: [{ name: 'scheme', type: 'string' }, { name: 'role', type: 'uint8' }, { name: 'keyHash', type: 'bytes32' }] }],
      [KEYSET_DOMAIN, descriptor.recoveryThreshold, entries],
    ),
  )
}

/* ---------- reads ---------- */

/** The subset of a viem PublicClient this module needs. */
export type AccountReader = Pick<PublicClient, 'readContract' | 'getBalance'>

export interface SpenderState {
  address: Hex
  frozen: boolean
  allowances: { asset: Hex; limits: Allowance; spentInPeriod: bigint; periodEndsAt: number }[]
  recipients: { address: Hex; allowed: boolean }[]
  scopes: { target: Hex; selector: Hex; validUntil: number }[]
}

export interface ProposalState {
  id: bigint
  to: Hex
  value: bigint
  data: Hex
  createdAt: number
  executed: boolean
  cancelled: boolean
  approvals: number
  approvedBy: Hex[]
}

export interface AccountState {
  address: Hex
  balance: bigint
  owners: Hex[]
  threshold: number
  keyset: Hex
  keysetVersion: number
  proposalCount: bigint
  proposals: ProposalState[]
  spenders: SpenderState[]
}

type RawAllowance = readonly [{ perTransfer: bigint; perPeriod: bigint; period: number; validUntil: bigint; recipientsRestricted: boolean }, bigint, bigint]
type RawProposal = { to: Hex; createdAt: bigint; executed: boolean; cancelled: boolean; value: bigint; data: Hex }

/** Reads everything the console shows. `recent` caps how many of the latest proposals are loaded. */
export async function readAccount(client: AccountReader, address: Hex, recent = 25): Promise<AccountState> {
  const readContract = client.readContract as (call: { address: Hex; abi: typeof ACCOUNT_ABI; functionName: string; args: readonly unknown[] }) => Promise<unknown>
  const read = <T,>(functionName: string, args: readonly unknown[] = []) => readContract({ address, abi: ACCOUNT_ABI, functionName, args }) as Promise<T>
  const [balance, owners, threshold, keyset, keysetVersion, proposalCount, spenders] = await Promise.all([
    client.getBalance({ address }),
    read<Hex[]>('owners'),
    read<number>('threshold'),
    read<Hex>('keyset'),
    read<number>('keysetVersion'),
    read<bigint>('proposalCount'),
    read<Hex[]>('spenders'),
  ])
  const ids: bigint[] = []
  for (let id = proposalCount - 1n; id >= 0n && ids.length < recent; id -= 1n) ids.push(id)
  const proposals = await Promise.all(
    ids.map(async (id): Promise<ProposalState> => {
      const [raw, approvals, approvedBy] = await Promise.all([
        read<RawProposal>('proposal', [id]),
        read<bigint>('approvals', [id]),
        Promise.all(owners.map((owner) => read<boolean>('hasApproved', [id, owner]))).then((flags) => owners.filter((_, index) => flags[index])),
      ])
      return { id, to: raw.to, value: raw.value, data: raw.data, createdAt: Number(raw.createdAt), executed: raw.executed, cancelled: raw.cancelled, approvals: Number(approvals), approvedBy }
    }),
  )
  const spenderStates = await Promise.all(
    spenders.map(async (spender): Promise<SpenderState> => {
      const [isFrozen, assets, recipients, scopes] = await read<readonly [boolean, Hex[], Hex[], { target: Hex; selector: Hex }[]]>('spenderInfo', [spender])
      const [allowances, recipientFlags, scopeExpiries] = await Promise.all([
        Promise.all(assets.map((asset) => read<RawAllowance>('allowance', [spender, asset]))),
        Promise.all(recipients.map((recipient) => read<boolean>('recipientAllowed', [spender, recipient]))),
        Promise.all(scopes.map((entry) => read<bigint>('scope', [spender, entry.target, entry.selector]))),
      ])
      return {
        address: spender,
        frozen: isFrozen,
        allowances: assets.map((asset, index) => {
          const [limits, spentInPeriod, periodEndsAt] = allowances[index]
          return { asset, limits: { ...limits, period: Number(limits.period), validUntil: Number(limits.validUntil) }, spentInPeriod, periodEndsAt: Number(periodEndsAt) }
        }),
        recipients: recipients.map((recipient, index) => ({ address: recipient, allowed: recipientFlags[index] })),
        scopes: scopes.map((entry, index) => ({ target: entry.target, selector: entry.selector, validUntil: Number(scopeExpiries[index]) })),
      }
    }),
  )
  return { address, balance, owners, threshold: Number(threshold), keyset, keysetVersion: Number(keysetVersion), proposalCount, proposals, spenders: spenderStates }
}

/* ---------- display ---------- */

export type DescribedCall =
  | { kind: 'owner-actions'; actions: OwnerAction[] }
  | { kind: 'transfer'; to: Hex; value: bigint }
  | { kind: 'call'; to: Hex; value: bigint; selector: Hex }

function decodeOwnerActions(data: Hex): OwnerAction[] | null {
  const { functionName, args } = decodeFunctionData({ abi: ACCOUNT_ABI, data })
  const a = (args ?? []) as readonly unknown[]
  switch (functionName) {
    case 'addOwner':
    case 'removeOwner':
      return [{ kind: functionName, owner: a[0] as Hex, threshold: Number(a[1]) }]
    case 'setThreshold':
      return [{ kind: 'setThreshold', threshold: Number(a[0]) }]
    case 'setAllowance': {
      const limits = a[2] as RawAllowance[0]
      return [{ kind: 'setAllowance', spender: a[0] as Hex, asset: a[1] as Hex, limits: { ...limits, period: Number(limits.period), validUntil: Number(limits.validUntil) } }]
    }
    case 'setRecipient':
      return [{ kind: 'setRecipient', spender: a[0] as Hex, recipient: a[1] as Hex, allowed: a[2] as boolean }]
    case 'setScope':
      return [{ kind: 'setScope', spender: a[0] as Hex, target: a[1] as Hex, selector: a[2] as Hex, validUntil: Number(a[3]) }]
    case 'unfreeze':
      return [{ kind: 'unfreeze', spender: a[0] as Hex }]
    case 'rotateKeyset':
      return [{ kind: 'rotateKeyset', commitment: a[0] as Hex }]
    case 'cancel':
      return [{ kind: 'cancel', id: a[0] as bigint }]
    case 'batch': {
      const actions = (a[0] as Hex[]).map(decodeOwnerActions)
      return actions.every(Boolean) ? actions.flatMap((action) => action!) : null
    }
    default:
      return null
  }
}

/** Classifies a proposal: admin actions on the account itself, a plain ETH transfer, or another call. */
export function describeProposal(account: Hex, proposal: { to: Hex; value: bigint; data: Hex }): DescribedCall {
  if (proposal.to.toLowerCase() === account.toLowerCase() && proposal.value === 0n && proposal.data.length >= 10) {
    try {
      const actions = decodeOwnerActions(proposal.data)
      if (actions) return { kind: 'owner-actions', actions }
    } catch {
      // Not an account function; fall through to a generic call.
    }
  }
  if (proposal.data === '0x') return { kind: 'transfer', to: proposal.to, value: proposal.value }
  return { kind: 'call', to: proposal.to, value: proposal.value, selector: proposal.data.slice(0, 10) as Hex }
}

type Units = (raw: bigint) => string

const ERROR_TEXT: Record<string, (args: readonly unknown[], units: Units) => string> = {
  NotOwner: () => 'Only an owner of this account can do that.',
  NotSelf: () => 'That change has to go through a proposal.',
  BadOwners: () => 'The owner list is invalid.',
  BadThreshold: (a) => `Approvals needed (${a[0]}) must be between 1 and the number of owners (${a[1]}).`,
  UnknownProposal: (a) => `Proposal #${a[0]} does not exist.`,
  ProposalClosed: (a) => `Proposal #${a[0]} was already executed or cancelled.`,
  AlreadyApproved: (a) => `You already approved proposal #${a[0]}.`,
  NotApproved: (a) => `You have not approved proposal #${a[0]}.`,
  NotEnoughApprovals: (a) => `It has ${a[0]} of ${a[1]} approvals.`,
  BadAllowance: () => 'The allowance is invalid: check the limits and the expiry.',
  TooManySpenders: () => `An account can have at most ${MAX_SPENDERS} agents.`,
  TooManyEntries: () => `An agent can have at most ${MAX_PER_SPENDER} assets, recipients or scopes.`,
  Frozen: () => 'This agent is frozen.',
  NoAllowance: () => 'This agent has no allowance for that asset.',
  Expired: () => 'The permission has expired.',
  OverTransferLimit: (a, units) => `That is over the per-transfer limit of ${units(a[1] as bigint)}.`,
  OverPeriodLimit: (a, units) => `That would bring this period's spending to ${units(a[0] as bigint)}, over the limit of ${units(a[1] as bigint)}.`,
  RecipientNotAllowed: () => 'That recipient is not on the allow list.',
  BadRecipient: () => 'Cannot send to the zero address or to the account itself.',
  NotInScope: () => 'This agent is not allowed to make that call.',
  TokenMovementNeedsSpend: () => 'Token transfers and approvals must use a spending allowance.',
  TransferFailed: () => 'The token transfer failed.',
}

/** Turns revert data into a sentence, unwrapping ExecutionFailed. `units` formats spending amounts. */
export function accountErrorMessage(data: Hex | undefined, units: Units = String): string | null {
  if (!data || data === '0x') return null
  try {
    const decoded = decodeErrorResult({ abi: ACCOUNT_ABI, data })
    if (decoded.errorName === 'ExecutionFailed') return accountErrorMessage((decoded.args as readonly [Hex])[0], units) ?? 'The proposed call reverted.'
    return ERROR_TEXT[decoded.errorName]?.((decoded.args ?? []) as readonly unknown[], units) ?? decoded.errorName
  } catch {
    return null
  }
}
