import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128f, slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'
import { encodeAbiParameters, getAddress, type Hex, hexToBytes, isAddress, keccak256, toHex, zeroHash } from 'viem'
import { describeProposal, KEYSET_PUBLIC_KEY_BYTES, type KeyRole, type KeysetDescriptor, type KeysetScheme, keysetCommitment, validateKeyset } from './account.js'

/**
 * A co-signer is an ordinary owner of a QForkAccount whose classical key only approves a proposal
 * after it has verified post-quantum signatures from the account's committed key set. Base still
 * checks only the co-signer's ECDSA approval, so the post-quantum check is as trustworthy as the
 * machine running it.
 */
export const COSIGN_DOMAIN = 'qfork.cosign.v1'
export const COSIGN_MAX_SIGNATURES = 32

/** `authorize` needs one daily-key signature; `recovery` needs the key set's recovery threshold. */
export type CosignClass = 'authorize' | 'recovery'

const CLASS_ROLES: Record<CosignClass, readonly KeyRole[]> = { authorize: ['authorize'], recovery: ['recovery', 'guardian'] }
const RECOVERY_ACTIONS = new Set(['addOwner', 'removeOwner', 'setThreshold', 'rotateKeyset'])

const SCHEMES: Record<KeysetScheme, { sign: (msg: Uint8Array, secretKey: Uint8Array) => Uint8Array; verify: (sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array) => boolean; signatureBytes: number }> = {
  'ml-dsa-44': { sign: (m, k) => ml_dsa44.sign(m, k), verify: (s, m, p) => ml_dsa44.verify(s, m, p), signatureBytes: 2420 },
  'ml-dsa-65': { sign: (m, k) => ml_dsa65.sign(m, k), verify: (s, m, p) => ml_dsa65.verify(s, m, p), signatureBytes: 3309 },
  'ml-dsa-87': { sign: (m, k) => ml_dsa87.sign(m, k), verify: (s, m, p) => ml_dsa87.verify(s, m, p), signatureBytes: 4627 },
  'slh-dsa-sha2-128f': { sign: (m, k) => slh_dsa_sha2_128f.sign(m, k), verify: (s, m, p) => slh_dsa_sha2_128f.verify(s, m, p), signatureBytes: 17088 },
  'slh-dsa-sha2-128s': { sign: (m, k) => slh_dsa_sha2_128s.sign(m, k), verify: (s, m, p) => slh_dsa_sha2_128s.verify(s, m, p), signatureBytes: 7856 },
}

export interface CosignTarget {
  chainId: number
  account: Hex
  proposalId: bigint
  to: Hex
  value: bigint
  data: Hex
  /** The on-chain key set commitment the signatures are made under. */
  keyset: Hex
}

/** What every post-quantum key signs: one proposal, on one account, on one chain, under one key set. */
export function cosignDigest(target: CosignTarget): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [COSIGN_DOMAIN, BigInt(target.chainId), getAddress(target.account), target.proposalId, getAddress(target.to), target.value, keccak256(target.data), target.keyset],
    ),
  )
}

export function signCosign(scheme: KeysetScheme, secretKey: Uint8Array, digest: Hex): Hex {
  return toHex(SCHEMES[scheme].sign(hexToBytes(digest), secretKey))
}

export function verifyCosignSignature(scheme: KeysetScheme, publicKey: Hex, signature: Hex, digest: Hex): boolean {
  try {
    return SCHEMES[scheme].verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey))
  } catch {
    return false
  }
}

/** Changes to who controls the account need recovery keys; everything else needs the daily key. */
export function cosignClass(account: Hex, proposal: { to: Hex; value: bigint; data: Hex }): CosignClass {
  if (getAddress(proposal.to) !== getAddress(account)) return 'authorize'
  const described = describeProposal(account, proposal)
  if (described.kind !== 'owner-actions') return 'recovery'
  return described.actions.some((action) => RECOVERY_ACTIONS.has(action.kind)) ? 'recovery' : 'authorize'
}

export interface PqSignature {
  publicKey: Hex
  signature: Hex
}

export interface CosignRequest {
  version: 1
  chainId: number
  account: Hex
  proposalId: bigint
  descriptor: KeysetDescriptor
  signatures: PqSignature[]
}

const isHex = (value: unknown): value is Hex => typeof value === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value)

/** Strict parse of an untrusted JSON body. Returns a message instead of throwing. */
export function parseCosignRequest(body: unknown): CosignRequest | string {
  if (!body || typeof body !== 'object') return 'Send a JSON object.'
  const raw = body as Record<string, unknown>
  if (raw.version !== 1) return 'Unknown request version.'
  if (!Number.isSafeInteger(raw.chainId) || (raw.chainId as number) <= 0) return 'chainId must be a positive integer.'
  if (typeof raw.account !== 'string' || !isAddress(raw.account)) return 'account must be an address.'
  if (typeof raw.proposalId !== 'string' || !/^\d{1,78}$/.test(raw.proposalId)) return 'proposalId must be a decimal string.'
  const descriptor = raw.descriptor as KeysetDescriptor | undefined
  if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(descriptor.keys) || descriptor.keys.length > 32) return 'descriptor must be a key set descriptor.'
  if (!Number.isInteger(descriptor.recoveryThreshold)) return 'descriptor: the recovery threshold must be an integer.'
  const clean: KeysetDescriptor = {
    version: descriptor.version,
    recoveryThreshold: descriptor.recoveryThreshold,
    keys: descriptor.keys.map((key) => ({ scheme: key?.scheme, role: key?.role, publicKey: key?.publicKey }) as KeysetDescriptor['keys'][number]),
  }
  const problem = validateKeyset(clean)
  if (problem) return `descriptor: ${problem}`
  if (!Array.isArray(raw.signatures) || raw.signatures.length === 0) return 'Include at least one post-quantum signature.'
  if (raw.signatures.length > COSIGN_MAX_SIGNATURES) return `At most ${COSIGN_MAX_SIGNATURES} signatures.`
  const signatures: PqSignature[] = []
  for (const entry of raw.signatures as Record<string, unknown>[]) {
    if (!entry || !isHex(entry.publicKey) || !isHex(entry.signature)) return 'Each signature needs a hex publicKey and signature.'
    signatures.push({ publicKey: entry.publicKey, signature: entry.signature })
  }
  return { version: 1, chainId: raw.chainId as number, account: getAddress(raw.account), proposalId: BigInt(raw.proposalId), descriptor: clean, signatures }
}

/** The chain facts the co-signer reads itself before deciding. */
export interface CosignChainState {
  chainId: number
  keyset: Hex
  cosignerIsOwner: boolean
  alreadyApproved: boolean
  proposal: { to: Hex; value: bigint; data: Hex; executed: boolean; cancelled: boolean } | null
}

export type CosignCode =
  | 'WRONG_CHAIN'
  | 'NOT_AN_OWNER'
  | 'NO_KEYSET'
  | 'KEYSET_MISMATCH'
  | 'UNKNOWN_PROPOSAL'
  | 'PROPOSAL_CLOSED'
  | 'ALREADY_APPROVED'
  | 'NO_RECOVERY_KEYS'
  | 'NOT_AUTHORIZED'
  | 'NOT_ENOUGH_SIGNATURES'

export type CosignCheck = { ok: true; class: CosignClass; digest: Hex; signers: Hex[] } | { ok: false; code: CosignCode; message: string }

const refuse = (code: CosignCode, message: string): CosignCheck => ({ ok: false, code, message })

/** Decides whether to approve. Pure: everything it relies on comes from the chain state, not the request. */
export function checkCosign(request: CosignRequest, state: CosignChainState): CosignCheck {
  if (request.chainId !== state.chainId) return refuse('WRONG_CHAIN', `This co-signer runs on chain ${state.chainId}.`)
  if (!state.cosignerIsOwner) return refuse('NOT_AN_OWNER', 'This co-signer is not an owner of the account. Add it as an owner first.')
  if (state.keyset === zeroHash) return refuse('NO_KEYSET', 'The account has no post-quantum key set committed.')
  if (keysetCommitment(request.descriptor) !== state.keyset) return refuse('KEYSET_MISMATCH', 'These keys are not the key set committed on-chain.')
  if (!state.proposal) return refuse('UNKNOWN_PROPOSAL', 'There is no such proposal.')
  if (state.proposal.executed || state.proposal.cancelled) return refuse('PROPOSAL_CLOSED', 'The proposal is already executed or cancelled.')
  if (state.alreadyApproved) return refuse('ALREADY_APPROVED', 'The co-signer has already approved this proposal.')

  const kind = cosignClass(request.account, state.proposal)
  const needed = kind === 'authorize' ? 1 : request.descriptor.recoveryThreshold
  if (kind === 'recovery' && needed < 1) return refuse('NO_RECOVERY_KEYS', 'This change needs recovery or guardian keys, and the key set has none.')
  const digest = cosignDigest({ chainId: state.chainId, account: request.account, proposalId: request.proposalId, to: state.proposal.to, value: state.proposal.value, data: state.proposal.data, keyset: state.keyset })

  const allowed = CLASS_ROLES[kind]
  const signers = new Set<string>()
  for (const { publicKey, signature } of request.signatures) {
    const key = request.descriptor.keys.find((item) => item.publicKey.toLowerCase() === publicKey.toLowerCase())
    if (!key || !allowed.includes(key.role) || signers.has(key.publicKey.toLowerCase())) continue
    if ((signature.length - 2) / 2 !== SCHEMES[key.scheme].signatureBytes) continue
    if (verifyCosignSignature(key.scheme, key.publicKey, signature, digest)) signers.add(key.publicKey.toLowerCase())
  }
  if (signers.size < needed) {
    return kind === 'authorize'
      ? refuse('NOT_AUTHORIZED', 'No valid signature from the account’s daily (authorize) key.')
      : refuse('NOT_ENOUGH_SIGNATURES', `This changes who controls the account: it needs ${needed} valid recovery or guardian signature${needed === 1 ? '' : 's'}, and has ${signers.size}.`)
  }
  return { ok: true, class: kind, digest, signers: [...signers] as Hex[] }
}

export const SIGNATURE_BYTES = Object.fromEntries(Object.entries(SCHEMES).map(([scheme, spec]) => [scheme, spec.signatureBytes])) as Record<KeysetScheme, number>
export { KEYSET_PUBLIC_KEY_BYTES }
