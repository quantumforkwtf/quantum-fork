import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'
import { ArrowRight, ArrowUpRight, Check, Download, KeyRound, Plus, RefreshCw, Snowflake, Trash2, Upload } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { decodeFunctionData, encodeFunctionData, erc20Abi, formatEther, formatUnits, getAddress, type Hex, hexToBytes, isAddress, keccak256, parseUnits, toHex, zeroHash } from 'viem'
import { BaseWalletPanel } from '../components/BaseWallet'
import FailurePanel from '../components/FailurePanel'
import { ACCOUNT_CHAIN_ID, ACCOUNT_FACTORY, ACCOUNT_MAINNET, ACCOUNT_NETWORK, ACCOUNT_NETWORK_LABEL as NET, accountReader, sendAccountTx } from '../lib/evm/account'
import { useEvmWallet } from '../lib/evm/wallet'
import { FlowError } from '../lib/failures'
import { usePageMeta } from '../lib/meta'
import { toast } from '../lib/toast'
import { navigate } from '../navigation'
import {
  ACCOUNT_FACTORY_ABI,
  type AccountState,
  type Allowance,
  approveCalldata,
  createAccountCalldata,
  describeProposal,
  ETH,
  executeCalldata,
  freezeCalldata,
  KEYSET_PUBLIC_KEY_BYTES,
  KEYSET_ROLES,
  type KeyRole,
  type KeysetDescriptor,
  type KeysetScheme,
  keysetCommitment,
  MAX_OWNERS,
  NO_ALLOWANCE,
  type OwnerAction,
  type ProposalState,
  proposeOwnerAction,
  readAccount,
  revokeCalldata,
  selectorOf,
  spendCalldata,
  submitCalldata,
  validateAllowance,
  validateKeyset,
  validateOwners,
  validateScopeSelector,
} from '../protocol/account'
import { type CosignClass, cosignClass, cosignDigest, type PqSignature, signCosign, verifyCosignSignature } from '../protocol/cosigner'
import { shortAddress } from '../protocol/address'
import { baseExplorerAddress, baseExplorerTx } from '../protocol/base'
import { Link } from '../router'

const RECENT = 'qfork.accounts.recent'
const TIER = ACCOUNT_MAINNET ? 'Base' : 'Base Sepolia · testnet'
const PERIODS = [
  { seconds: 3600, label: 'hour' },
  { seconds: 86400, label: 'day' },
  { seconds: 604800, label: 'week' },
  { seconds: 2592000, label: '30 days' },
] as const

type Reader = ReturnType<typeof accountReader>
interface TokenMeta {
  symbol: string
  decimals: number
}
type Tokens = Record<string, TokenMeta>

const now = () => Math.floor(Date.now() / 1000)
const periodLabel = (seconds: number) => PERIODS.find((period) => period.seconds === seconds)?.label ?? `${seconds}s`
const dateOf = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase()
const meta = (tokens: Tokens, asset: Hex): TokenMeta => (same(asset, ETH) ? { symbol: 'ETH', decimals: 18 } : (tokens[asset.toLowerCase()] ?? { symbol: shortAddress(asset), decimals: 18 }))
const amount = (raw: bigint, asset: Hex, tokens: Tokens) => {
  const token = meta(tokens, asset)
  return `${formatUnits(raw, token.decimals)} ${token.symbol}`
}

function recentAccounts(): Hex[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((item): item is Hex => typeof item === 'string' && isAddress(item)).slice(0, 8) : []
  } catch {
    return []
  }
}

function rememberAccount(address: Hex) {
  const list = [getAddress(address), ...recentAccounts().filter((item) => !same(item, address))].slice(0, 8)
  window.localStorage.setItem(RECENT, JSON.stringify(list))
}

function Addr({ value, label }: { value: Hex; label?: string }) {
  return (
    <a className="acct-addr" href={baseExplorerAddress(value, ACCOUNT_NETWORK)} target="_blank" rel="noreferrer noopener" title={value}>
      {label ?? shortAddress(value, 6, 4)}
    </a>
  )
}

function describeAction(action: OwnerAction, tokens: Tokens): ReactNode {
  switch (action.kind) {
    case 'addOwner':
      return (
        <>
          Add owner <Addr value={action.owner} />, approvals needed {action.threshold}
        </>
      )
    case 'removeOwner':
      return (
        <>
          Remove owner <Addr value={action.owner} />, approvals needed {action.threshold}
        </>
      )
    case 'setThreshold':
      return <>Approvals needed becomes {action.threshold}</>
    case 'setAllowance':
      if (action.limits.perPeriod === 0n)
        return (
          <>
            Remove agent <Addr value={action.spender} />’s {meta(tokens, action.asset).symbol} allowance
          </>
        )
      return (
        <>
          Agent <Addr value={action.spender} /> may spend {amount(action.limits.perTransfer, action.asset, tokens)} per transfer, {amount(action.limits.perPeriod, action.asset, tokens)} per {periodLabel(action.limits.period)}, until {dateOf(action.limits.validUntil)}
          {action.limits.recipientsRestricted ? ', allowed recipients only' : ''}
        </>
      )
    case 'setRecipient':
      return (
        <>
          {action.allowed ? 'Allow' : 'Stop'} agent <Addr value={action.spender} /> paying <Addr value={action.recipient} />
        </>
      )
    case 'setScope':
      return action.validUntil === 0 ? (
        <>
          Remove agent <Addr value={action.spender} />’s permission to call <code>{action.selector}</code> on <Addr value={action.target} />
        </>
      ) : (
        <>
          Agent <Addr value={action.spender} /> may call <code>{action.selector}</code> on <Addr value={action.target} /> until {dateOf(action.validUntil)}
        </>
      )
    case 'unfreeze':
      return (
        <>
          Unfreeze agent <Addr value={action.spender} />
        </>
      )
    case 'rotateKeyset':
      return action.commitment === zeroHash ? <>Clear the post-quantum key set</> : <>Commit post-quantum key set {shortAddress(action.commitment, 10, 6)}</>
    case 'cancel':
      return <>Cancel proposal #{action.id.toString()}</>
  }
}

function describeCall(account: Hex, proposal: ProposalState, tokens: Tokens): ReactNode {
  const call = describeProposal(account, proposal)
  if (call.kind === 'owner-actions')
    return call.actions.length === 1 ? (
      describeAction(call.actions[0], tokens)
    ) : (
      <ul className="acct-batch">
        {call.actions.map((action, index) => (
          <li key={index}>{describeAction(action, tokens)}</li>
        ))}
      </ul>
    )
  if (call.kind === 'transfer')
    return (
      <>
        Send {formatEther(call.value)} ETH to <Addr value={call.to} />
      </>
    )
  if (call.selector === '0xa9059cbb') {
    try {
      const { args } = decodeFunctionData({ abi: erc20Abi, data: proposal.data })
      const [to, value] = args as readonly [Hex, bigint]
      return (
        <>
          Send {amount(value, call.to, tokens)} to <Addr value={to} />
        </>
      )
    } catch {
      // Fall through to the generic description.
    }
  }
  return (
    <>
      Call <code>{call.selector}</code> on <Addr value={call.to} />
      {call.value > 0n ? ` with ${formatEther(call.value)} ETH` : ''}
    </>
  )
}

/* ---------- state ---------- */

function useTx(onDone: () => void) {
  const evm = useEvmWallet()
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<Hex | null>(null)
  const [error, setError] = useState<FlowError | null>(null)
  const run = useCallback(
    async (label: string, tx: { to: Hex; data: Hex; value?: bigint }, units?: (raw: bigint) => string) => {
      if (!evm.address) return false
      setBusy(label)
      setSent(null)
      setError(null)
      try {
        const hash = await sendAccountTx({ from: evm.address, ...tx }, setSent, units)
        toast(`${label}: confirmed`)
        setSent(hash)
        onDone()
        return true
      } catch (caught) {
        setError(caught instanceof FlowError ? caught : new FlowError('ACCOUNT_TX_FAILED', (caught as Error)?.message))
        return false
      } finally {
        setBusy(null)
      }
    },
    [evm.address, onDone],
  )
  return { busy, sent, error, run, clear: () => setError(null) }
}

type Tx = ReturnType<typeof useTx>

function TxStatus({ tx }: { tx: Tx }) {
  if (tx.error) return <FailurePanel error={tx.error} actions={<button type="button" className="btn btn-quiet btn-sm" onClick={tx.clear}>Dismiss</button>} />
  if (tx.busy)
    return (
      <p className="acct-pending" role="status">
        <span className="pulse-dot" aria-hidden="true" /> {tx.busy}: {tx.sent ? `waiting for ${NET} to include it…` : 'confirm in your wallet…'}
        {tx.sent && (
          <a href={baseExplorerTx(tx.sent, ACCOUNT_NETWORK)} target="_blank" rel="noreferrer noopener">
            View <ArrowUpRight size={12} strokeWidth={1.8} />
          </a>
        )}
      </p>
    )
  return null
}

async function loadTokens(reader: Reader, assets: Hex[]): Promise<Tokens> {
  const unique = [...new Set(assets.filter((asset) => !same(asset, ETH)).map((asset) => asset.toLowerCase() as Hex))]
  const entries = await Promise.all(
    unique.map(async (asset) => {
      try {
        const [symbol, decimals] = await Promise.all([reader.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol' }), reader.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals' })])
        return [asset, { symbol, decimals }] as const
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
}

function assetsIn(state: AccountState): Hex[] {
  const assets: Hex[] = state.spenders.flatMap((spender) => spender.allowances.map((entry) => entry.asset))
  for (const proposal of state.proposals) {
    const call = describeProposal(state.address, proposal)
    if (call.kind === 'owner-actions') for (const action of call.actions) if (action.kind === 'setAllowance') assets.push(action.asset)
    if (call.kind === 'call' && call.selector === '0xa9059cbb') assets.push(call.to)
  }
  return assets
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'ok'; account: AccountState; tokens: Tokens; fromFactory: boolean | null }

function useAccount(address: Hex) {
  const evm = useEvmWallet()
  const reader = useMemo(() => accountReader(evm.chainId), [evm.chainId])
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const code = await reader.getCode({ address })
        if (!code || code === '0x') return live && setLoad({ state: 'missing' })
        const account = await readAccount(reader, address)
        const [tokens, fromFactory] = await Promise.all([
          loadTokens(reader, assetsIn(account)),
          ACCOUNT_FACTORY ? reader.readContract({ address: ACCOUNT_FACTORY, abi: ACCOUNT_FACTORY_ABI, functionName: 'isAccount', args: [address] }).catch(() => null) : Promise.resolve(null),
        ])
        if (live) setLoad({ state: 'ok', account, tokens, fromFactory })
      } catch (error) {
        if (live) setLoad({ state: 'error', message: (error as { shortMessage?: string })?.shortMessage ?? `${NET} could not be read. Try again.` })
      }
    })()
    return () => {
      live = false
    }
  }, [address, reader, tick])
  return { load, refresh, reader }
}

/* ---------- key set ---------- */

interface GeneratedKeyset {
  descriptor: KeysetDescriptor
  commitment: Hex
  file: string
}

/** Someone else's post-quantum public key. They keep the secret half and sign recoveries with it. */
interface GuardianKey {
  scheme: KeysetScheme
  publicKey: Hex
}

function generateKeyset(guardians: GuardianKey[] = [], recoveryThreshold = 1): GeneratedKeyset {
  const authorize = ml_dsa65.keygen()
  const recovery = slh_dsa_sha2_128s.keygen()
  const descriptor: KeysetDescriptor = {
    version: 1,
    recoveryThreshold,
    keys: [
      { scheme: 'ml-dsa-65', role: 'authorize', publicKey: toHex(authorize.publicKey), label: 'Daily key' },
      { scheme: 'slh-dsa-sha2-128s', role: 'recovery', publicKey: toHex(recovery.publicKey), label: 'Recovery key' },
      ...guardians.map((guardian, index) => ({ scheme: guardian.scheme, role: 'guardian' as const, publicKey: guardian.publicKey, label: `Guardian ${index + 1}` })),
    ],
  }
  const commitment = keysetCommitment(descriptor)
  const file = JSON.stringify(
    {
      format: 'qfork.keyset.v1',
      network: ACCOUNT_NETWORK,
      commitment,
      descriptor,
      secretKeys: [
        { scheme: 'ml-dsa-65', role: 'authorize', secretKey: toHex(authorize.secretKey) },
        { scheme: 'slh-dsa-sha2-128s', role: 'recovery', secretKey: toHex(recovery.secretKey) },
      ],
      note: 'Secret keys. Generated in your browser and never sent anywhere. Anyone holding this file holds these post-quantum keys.',
    },
    null,
    2,
  )
  authorize.secretKey.fill(0)
  recovery.secretKey.fill(0)
  return { descriptor, commitment, file }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > 1024 * 1024) throw new Error('That file is too large to be a key file.')
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not JSON.')
  }
}

const isScheme = (value: unknown): value is KeysetScheme => typeof value === 'string' && value in KEYSET_PUBLIC_KEY_BYTES
const isKeyHex = (value: unknown, bytes?: number): value is Hex => typeof value === 'string' && /^0x([0-9a-fA-F]{2})+$/.test(value) && (bytes === undefined || (value.length - 2) / 2 === bytes)

function parseGuardianFile(raw: unknown): GuardianKey {
  const file = raw as { format?: unknown; scheme?: unknown; publicKey?: unknown } | null
  if (file?.format !== 'qfork.guardian.v1' || !isScheme(file.scheme) || !isKeyHex(file.publicKey, KEYSET_PUBLIC_KEY_BYTES[file.scheme])) throw new Error('That is not a Quantum Fork guardian key file.')
  return { scheme: file.scheme, publicKey: file.publicKey }
}

/** Adds guardians' public keys to a key set before it is generated, and sets how many recoverers must agree. */
function GuardianPicker({ guardians, onChange, threshold, onThreshold }: { guardians: GuardianKey[]; onChange: (next: GuardianKey[]) => void; threshold: number; onThreshold: (next: number) => void }) {
  const [error, setError] = useState<string | null>(null)
  const add = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const guardian = parseGuardianFile(await readJsonFile(file))
      if (guardians.some((item) => same(item.publicKey, guardian.publicKey))) throw new Error('That guardian is already added.')
      if (guardians.length >= 8) throw new Error('At most 8 guardians.')
      onChange([...guardians, guardian])
    } catch (caught) {
      setError((caught as Error).message)
    }
  }
  return (
    <div className="acct-guardians">
      {guardians.map((guardian, index) => (
        <div key={guardian.publicKey} className="acct-guardian">
          <span>
            Guardian {index + 1} · {guardian.scheme.toUpperCase()} · <code>{shortAddress(guardian.publicKey, 8, 6)}</code>
          </span>
          <button type="button" className="icon-btn" aria-label={`Remove guardian ${index + 1}`} onClick={() => onChange(guardians.filter((item) => item !== guardian))}>
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      ))}
      <label className="btn btn-quiet btn-sm acct-file">
        <input type="file" accept="application/json,.json" onChange={(event) => void add(event.target.files?.[0]).finally(() => (event.target.value = ''))} />
        <Upload size={14} strokeWidth={1.8} /> Add a guardian’s public key
      </label>
      {guardians.length > 0 && (
        <Field label={`Recovery needs, of ${guardians.length + 1}`} hint={`Your recovery key and the guardians count alike: any ${threshold} of them can approve a change of owners.`}>
          <Stepper value={threshold} min={1} max={guardians.length + 1} onChange={onThreshold} />
        </Field>
      )}
      {error && <small className="acct-bad">{error}</small>}
    </div>
  )
}

/** Generates ML-DSA-65 and SLH-DSA keys locally. The commitment can only be used once the secret file is saved. */
function KeysetMaker({ onReady }: { onReady: (commitment: Hex | null) => void }) {
  const [keys, setKeys] = useState<GeneratedKeyset | null>(null)
  const [saved, setSaved] = useState(false)
  const [guardians, setGuardians] = useState<GuardianKey[]>([])
  const [threshold, setThreshold] = useState(1)
  useEffect(() => onReady(keys && saved ? keys.commitment : null), [keys, saved, onReady])
  useEffect(() => setThreshold((value) => Math.min(value, guardians.length + 1)), [guardians.length])
  if (!keys)
    return (
      <div className="acct-keyset">
        <GuardianPicker guardians={guardians} onChange={setGuardians} threshold={threshold} onThreshold={setThreshold} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setKeys(generateKeyset(guardians, threshold))}>
          <KeyRound size={14} strokeWidth={1.8} /> Generate post-quantum keys
        </button>
      </div>
    )
  return (
    <div className="acct-keyset">
      <dl className="acct-kv">
        {keys.descriptor.keys.map((key) => (
          <div key={key.publicKey}>
            <dt>{key.label}</dt>
            <dd>
              {key.scheme.toUpperCase()} · {key.role} · {(key.publicKey.length - 2) / 2} bytes
            </dd>
          </div>
        ))}
        <div>
          <dt>Recovery</dt>
          <dd>
            {keys.descriptor.recoveryThreshold} of {keys.descriptor.keys.length - 1} recovery and guardian keys
          </dd>
        </div>
        <div>
          <dt>Commitment</dt>
          <dd>
            <code>{shortAddress(keys.commitment, 12, 8)}</code>
          </dd>
        </div>
      </dl>
      <div className="acct-actions">
        <button
          type="button"
          className={`btn btn-sm ${saved ? 'btn-quiet' : 'btn-primary'}`}
          onClick={() => {
            download(`qfork-keyset-${keys.commitment.slice(2, 10)}.json`, keys.file)
            setSaved(true)
          }}
        >
          {saved ? <Check size={14} strokeWidth={1.8} /> : <Download size={14} strokeWidth={1.8} />} {saved ? 'Key file saved' : 'Save the key file'}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            setKeys(null)
            setSaved(false)
          }}
        >
          Discard
        </button>
      </div>
      {!saved && <p className="acct-note">Save the file before continuing. It holds the only copy of the secret keys; Quantum Fork never sees it.</p>}
    </div>
  )
}

/* ---------- forms ---------- */

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="acct-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function AddressInput({ value, onChange, placeholder = '0x…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const bad = value.trim() !== '' && !isAddress(value.trim(), { strict: false })
  return <input className={`acct-input ${bad ? 'is-bad' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" />
}

function useTokenMeta(reader: Reader, asset: string): TokenMeta | null | 'loading' {
  const [token, setToken] = useState<TokenMeta | null | 'loading'>(null)
  useEffect(() => {
    if (asset === 'eth') return setToken({ symbol: 'ETH', decimals: 18 })
    if (!isAddress(asset.trim(), { strict: false })) return setToken(null)
    let live = true
    setToken('loading')
    void loadTokens(reader, [asset.trim() as Hex]).then((tokens) => live && setToken(tokens[asset.trim().toLowerCase()] ?? null))
    return () => {
      live = false
    }
  }, [asset, reader])
  return token
}

function AssetPicker({ value, onChange, token }: { value: string; onChange: (value: string) => void; token: TokenMeta | null | 'loading' }) {
  const custom = value !== 'eth'
  return (
    <div className="acct-asset">
      <div className="acct-toggle" role="radiogroup" aria-label="Asset">
        <button type="button" role="radio" aria-checked={!custom} className={!custom ? 'is-active' : ''} onClick={() => onChange('eth')}>
          ETH
        </button>
        <button type="button" role="radio" aria-checked={custom} className={custom ? 'is-active' : ''} onClick={() => custom || onChange('')}>
          ERC-20
        </button>
      </div>
      {custom && <AddressInput value={value} onChange={onChange} placeholder="Token address" />}
      {custom && token === null && isAddress(value.trim(), { strict: false }) && <small className="acct-bad">Not an ERC-20 token on {NET}.</small>}
      {custom && token && token !== 'loading' && <small>{token.symbol}</small>}
    </div>
  )
}

function parseAmount(value: string, decimals: number): bigint | null {
  try {
    const parsed = parseUnits(value.trim(), decimals)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

function AgentForm({ account, reader, tx, onDone }: { account: AccountState; reader: Reader; tx: Tx; onDone: () => void }) {
  const [agent, setAgent] = useState('')
  const [asset, setAsset] = useState('eth')
  const [perTransfer, setPerTransfer] = useState('')
  const [perPeriod, setPerPeriod] = useState('')
  const [period, setPeriod] = useState<number>(86400)
  const [days, setDays] = useState('30')
  const [recipients, setRecipients] = useState('')
  const [target, setTarget] = useState('')
  const [fn, setFn] = useState('')
  const token = useTokenMeta(reader, asset)

  const recipientList = recipients
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const decimals = token && token !== 'loading' ? token.decimals : 18
  const limits: Allowance | null = useMemo(() => {
    const transfer = parseAmount(perTransfer, decimals)
    const total = parseAmount(perPeriod, decimals)
    const until = now() + Math.round(Number(days) * 86400)
    if (transfer === null || total === null || !Number.isFinite(until)) return null
    return { perTransfer: transfer, perPeriod: total, period, validUntil: until, recipientsRestricted: recipientList.length > 0 }
  }, [perTransfer, perPeriod, decimals, period, days, recipientList.length])

  const selector = fn.trim() ? selectorOf(fn) : null
  const problem = (() => {
    if (!isAddress(agent.trim(), { strict: false })) return 'Enter the agent’s address.'
    if (same(agent.trim(), account.address)) return 'The account cannot be its own agent.'
    if (asset !== 'eth' && (!token || token === 'loading')) return `Enter a token on ${NET}.`
    if (!limits) return 'Enter both limits.'
    const allowance = validateAllowance(limits)
    if (allowance) return allowance
    if (!(Number(days) > 0)) return 'Choose how many days it lasts.'
    const bad = recipientList.find((item) => !isAddress(item, { strict: false }))
    if (bad) return `${bad} is not an address.`
    if (target.trim() || fn.trim()) {
      if (!isAddress(target.trim(), { strict: false })) return 'Enter the contract the agent may call.'
      if (!selector) return 'Enter a function like swap(uint256) or a 4-byte selector.'
      return validateScopeSelector(selector)
    }
    return null
  })()

  const submit = async () => {
    if (problem || !limits) return
    const spender = getAddress(agent.trim())
    const actions: OwnerAction[] = [{ kind: 'setAllowance', spender, asset: asset === 'eth' ? ETH : getAddress(asset.trim()), limits }]
    for (const recipient of recipientList) actions.push({ kind: 'setRecipient', spender, recipient: getAddress(recipient), allowed: true })
    if (selector) actions.push({ kind: 'setScope', spender, target: getAddress(target.trim()), selector, validUntil: limits.validUntil })
    if (await tx.run('Propose agent limits', { to: account.address, data: proposeOwnerAction(account.address, ...actions) })) {
      setAgent('')
      setPerTransfer('')
      setPerPeriod('')
      setRecipients('')
      setTarget('')
      setFn('')
      onDone()
    }
  }

  const symbol = token && token !== 'loading' ? token.symbol : asset === 'eth' ? 'ETH' : 'tokens'
  return (
    <div className="acct-form">
      <div className="acct-form-grid">
        <Field label="Agent address" hint="A bot, an AI agent or a person. It never becomes an owner.">
          <AddressInput value={agent} onChange={setAgent} />
        </Field>
        <Field label="Asset">
          <AssetPicker value={asset} onChange={setAsset} token={token} />
        </Field>
        <Field label={`Per transfer (${symbol})`}>
          <input className="acct-input" inputMode="decimal" value={perTransfer} onChange={(event) => setPerTransfer(event.target.value)} placeholder="0.01" />
        </Field>
        <Field label={`Per period (${symbol})`}>
          <input className="acct-input" inputMode="decimal" value={perPeriod} onChange={(event) => setPerPeriod(event.target.value)} placeholder="0.05" />
        </Field>
        <Field label="Period">
          <div className="acct-toggle" role="radiogroup" aria-label="Period">
            {PERIODS.map((option) => (
              <button key={option.seconds} type="button" role="radio" aria-checked={period === option.seconds} className={period === option.seconds ? 'is-active' : ''} onClick={() => setPeriod(option.seconds)}>
                {option.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Expires after (days)">
          <input className="acct-input" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
        </Field>
        <Field label="Only pay these recipients (optional)" hint="Leave empty to let it pay anyone. Separate addresses with spaces or commas.">
          <textarea className="acct-input" rows={2} value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="0x…, 0x…" spellCheck={false} />
        </Field>
        <Field label="Also allow one contract call (optional)" hint="The agent can call this one function, without sending value. Token transfers and approvals are refused here.">
          <div className="acct-pair">
            <AddressInput value={target} onChange={setTarget} placeholder="Contract" />
            <input className="acct-input" value={fn} onChange={(event) => setFn(event.target.value)} placeholder="swap(uint256,address)" spellCheck={false} />
          </div>
        </Field>
      </div>
      <div className="acct-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(problem) || Boolean(tx.busy)} onClick={() => void submit()}>
          Propose <ArrowRight size={14} strokeWidth={1.8} />
        </button>
        <span className="acct-note">{problem ?? (account.threshold > 1 ? `Needs ${account.threshold} owner approvals before it applies.` : 'Applies as soon as it confirms.')}</span>
      </div>
    </div>
  )
}

function SendForm({ account, reader, tx }: { account: AccountState; reader: Reader; tx: Tx }) {
  const [asset, setAsset] = useState('eth')
  const [to, setTo] = useState('')
  const [value, setValue] = useState('')
  const token = useTokenMeta(reader, asset)
  const decimals = token && token !== 'loading' ? token.decimals : 18
  const raw = parseAmount(value, decimals)
  const problem = !isAddress(to.trim(), { strict: false }) ? 'Enter a recipient.' : asset !== 'eth' && (!token || token === 'loading') ? `Enter a token on ${NET}.` : raw === null ? 'Enter an amount.' : asset === 'eth' && raw > account.balance ? 'The account does not hold that much ETH.' : null
  const submit = async () => {
    if (problem || raw === null) return
    const recipient = getAddress(to.trim())
    const data = asset === 'eth' ? submitCalldata(recipient, raw, '0x') : submitCalldata(getAddress(asset.trim()), 0n, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, raw] }))
    if (await tx.run('Propose payment', { to: account.address, data })) {
      setTo('')
      setValue('')
    }
  }
  return (
    <div className="acct-form">
      <div className="acct-form-grid">
        <Field label="Asset">
          <AssetPicker value={asset} onChange={setAsset} token={token} />
        </Field>
        <Field label="To">
          <AddressInput value={to} onChange={setTo} />
        </Field>
        <Field label="Amount">
          <input className="acct-input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0.01" />
        </Field>
      </div>
      <div className="acct-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(problem) || Boolean(tx.busy)} onClick={() => void submit()}>
          Propose payment <ArrowRight size={14} strokeWidth={1.8} />
        </button>
        <span className="acct-note">{problem ?? (account.threshold > 1 ? `Sends once ${account.threshold} owners approve.` : 'Sends as soon as it confirms.')}</span>
      </div>
    </div>
  )
}

function OwnersForm({ account, tx }: { account: AccountState; tx: Tx }) {
  const [owner, setOwner] = useState('')
  const [threshold, setThreshold] = useState(account.threshold)
  useEffect(() => setThreshold(account.threshold), [account.threshold])
  const adding = owner.trim() !== ''
  const count = account.owners.length + (adding ? 1 : 0)
  const problem = adding
    ? !isAddress(owner.trim(), { strict: false })
      ? 'Enter the new owner’s address.'
      : account.owners.some((item) => same(item, owner.trim()))
        ? 'Already an owner.'
        : account.owners.length >= MAX_OWNERS
          ? `At most ${MAX_OWNERS} owners.`
          : null
    : threshold === account.threshold
      ? 'Enter an owner to add, or change the approvals needed.'
      : null
  const submit = async () => {
    if (problem) return
    const action: OwnerAction = adding ? { kind: 'addOwner', owner: getAddress(owner.trim()), threshold } : { kind: 'setThreshold', threshold }
    if (await tx.run(adding ? 'Propose new owner' : 'Propose approvals change', { to: account.address, data: proposeOwnerAction(account.address, action) })) setOwner('')
  }
  return (
    <div className="acct-form">
      <div className="acct-form-grid">
        <Field label="Add owner (optional)">
          <AddressInput value={owner} onChange={setOwner} />
        </Field>
        <Field label={`Approvals needed, of ${count}`}>
          <Stepper value={threshold} min={1} max={count} onChange={setThreshold} />
        </Field>
      </div>
      <div className="acct-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(problem) || Boolean(tx.busy)} onClick={() => void submit()}>
          Propose <ArrowRight size={14} strokeWidth={1.8} />
        </button>
        <span className="acct-note">{problem ?? ''}</span>
      </div>
    </div>
  )
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="acct-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer">
        −
      </button>
      <output>{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More">
        +
      </button>
    </div>
  )
}

/* ---------- console sections ---------- */

function Proposals({ account, tokens, me, tx }: { account: AccountState; tokens: Tokens; me: Hex | null; tx: Tx }) {
  const [history, setHistory] = useState(false)
  const open = account.proposals.filter((proposal) => !proposal.executed && !proposal.cancelled)
  const closed = account.proposals.filter((proposal) => proposal.executed || proposal.cancelled)
  const isOwner = account.owners.some((owner) => same(owner, me))
  const row = (proposal: ProposalState) => {
    const approved = proposal.approvedBy.some((owner) => same(owner, me))
    const ready = proposal.approvals >= account.threshold
    const closedLabel = proposal.executed ? 'EXECUTED' : proposal.cancelled ? 'CANCELLED' : null
    return (
      <li key={proposal.id.toString()} className={`acct-proposal ${closedLabel ? 'is-closed' : ''}`}>
        <span className="acct-proposal-id">#{proposal.id.toString()}</span>
        <div className="acct-proposal-body">
          <div>{describeCall(account.address, proposal, tokens)}</div>
          <small>
            {dateOf(proposal.createdAt)} · approved by {proposal.approvedBy.map((owner) => shortAddress(owner)).join(', ') || 'nobody'}
          </small>
        </div>
        <span className={`acct-count ${ready ? 'is-ready' : ''}`}>{closedLabel ?? `${proposal.approvals}/${account.threshold}`}</span>
        {!closedLabel && isOwner && (
          <div className="acct-proposal-actions">
            {!approved && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(tx.busy)} onClick={() => void tx.run(`Approve #${proposal.id}`, { to: account.address, data: approveCalldata(proposal.id) })}>
                Approve
              </button>
            )}
            {ready && (
              <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(tx.busy)} onClick={() => void tx.run(`Execute #${proposal.id}`, { to: account.address, data: executeCalldata(proposal.id) })}>
                Execute
              </button>
            )}
            {approved && !ready && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={Boolean(tx.busy)} onClick={() => void tx.run(`Withdraw approval #${proposal.id}`, { to: account.address, data: revokeCalldata(proposal.id) })}>
                Withdraw
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Propose cancelling"
              aria-label={`Propose cancelling #${proposal.id}`}
              disabled={Boolean(tx.busy)}
              onClick={() => void tx.run(`Propose cancelling #${proposal.id}`, { to: account.address, data: proposeOwnerAction(account.address, { kind: 'cancel', id: proposal.id }) })}
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </li>
    )
  }
  return (
    <section className="acct-section">
      <header>
        <h2>Proposals</h2>
        <span className="mono-label">
          {open.length} open · {account.threshold} of {account.owners.length} to execute
        </span>
      </header>
      {open.length === 0 ? <p className="muted">Nothing waiting for approval.</p> : <ul className="acct-list">{open.map(row)}</ul>}
      {closed.length > 0 && (
        <>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setHistory(!history)}>
            {history ? 'Hide' : 'Show'} history ({closed.length}
            {account.proposalCount > BigInt(account.proposals.length) ? `, latest ${account.proposals.length}` : ''})
          </button>
          {history && <ul className="acct-list">{closed.map(row)}</ul>}
        </>
      )}
    </section>
  )
}

function Agents({ account, tokens, me, tx }: { account: AccountState; tokens: Tokens; me: Hex | null; tx: Tx }) {
  const isOwner = account.owners.some((owner) => same(owner, me))
  const t = now()
  return (
    <section className="acct-section">
      <header>
        <h2>Agents</h2>
        <span className="mono-label">{account.spenders.length} configured</span>
      </header>
      {account.spenders.length === 0 && <p className="muted">No agents yet. An agent can spend inside its limits without asking the owners each time.</p>}
      <ul className="acct-agents">
        {account.spenders.map((spender) => {
          const live = spender.allowances.filter((entry) => entry.limits.perPeriod > 0n)
          return (
            <li key={spender.address} className={`acct-agent ${spender.frozen ? 'is-frozen' : ''}`}>
              <header>
                <Addr value={spender.address} label={shortAddress(spender.address, 8, 6)} />
                {spender.frozen && <span className="tag">FROZEN</span>}
                {same(spender.address, me) && <span className="tag">YOU</span>}
                {isOwner && (
                  <div className="acct-proposal-actions">
                    {spender.frozen ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={Boolean(tx.busy)}
                        onClick={() => void tx.run('Propose unfreeze', { to: account.address, data: proposeOwnerAction(account.address, { kind: 'unfreeze', spender: spender.address }) })}
                      >
                        Propose unfreeze
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(tx.busy)} title="Takes effect at once. Unfreezing needs the approvals." onClick={() => void tx.run('Freeze agent', { to: account.address, data: freezeCalldata(spender.address) })}>
                        <Snowflake size={13} strokeWidth={1.8} /> Freeze now
                      </button>
                    )}
                  </div>
                )}
              </header>
              {live.length === 0 && spender.scopes.every((entry) => entry.validUntil <= t) && <p className="muted">No active permissions.</p>}
              {live.map((entry) => {
                const expired = entry.limits.validUntil <= t
                const windowOpen = entry.periodEndsAt > t
                const spent = windowOpen ? entry.spentInPeriod : 0n
                const left = entry.limits.perPeriod - spent
                return (
                  <div key={entry.asset} className="acct-allowance">
                    <div className="acct-meter" aria-hidden="true">
                      <span style={{ width: `${Number((spent * 1000n) / entry.limits.perPeriod) / 10}%` }} />
                    </div>
                    <dl className="acct-kv">
                      <div>
                        <dt>{meta(tokens, entry.asset).symbol}</dt>
                        <dd>
                          {amount(left, entry.asset, tokens)} left this {periodLabel(entry.limits.period)}
                        </dd>
                      </div>
                      <div>
                        <dt>Limits</dt>
                        <dd>
                          {amount(entry.limits.perTransfer, entry.asset, tokens)} per transfer · {amount(entry.limits.perPeriod, entry.asset, tokens)} per {periodLabel(entry.limits.period)}
                        </dd>
                      </div>
                      <div>
                        <dt>{expired ? 'Expired' : 'Expires'}</dt>
                        <dd>{dateOf(entry.limits.validUntil)}</dd>
                      </div>
                      {entry.limits.recipientsRestricted && (
                        <div>
                          <dt>Recipients</dt>
                          <dd>
                            {spender.recipients
                              .filter((item) => item.allowed)
                              .map((item) => (
                                <Addr key={item.address} value={item.address} />
                              ))}
                            {!spender.recipients.some((item) => item.allowed) && 'none allowed'}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {isOwner && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Propose removing this allowance"
                        aria-label="Propose removing this allowance"
                        disabled={Boolean(tx.busy)}
                        onClick={() => void tx.run('Propose removing allowance', { to: account.address, data: proposeOwnerAction(account.address, { kind: 'setAllowance', spender: spender.address, asset: entry.asset, limits: NO_ALLOWANCE }) })}
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                )
              })}
              {spender.scopes
                .filter((entry) => entry.validUntil > t)
                .map((entry) => (
                  <p key={`${entry.target}${entry.selector}`} className="acct-scope">
                    May call <code>{entry.selector}</code> on <Addr value={entry.target} /> until {dateOf(entry.validUntil)}
                  </p>
                ))}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AgentSpend({ account, tokens, me, tx }: { account: AccountState; tokens: Tokens; me: Hex; tx: Tx }) {
  const spender = account.spenders.find((item) => same(item.address, me))
  const usable = spender?.allowances.filter((entry) => entry.limits.perPeriod > 0n && entry.limits.validUntil > now()) ?? []
  const [asset, setAsset] = useState<Hex | null>(usable[0]?.asset ?? null)
  const [to, setTo] = useState('')
  const [value, setValue] = useState('')
  if (!spender || !usable.length) return null
  const chosen = usable.find((entry) => same(entry.asset, asset)) ?? usable[0]
  const raw = parseAmount(value, meta(tokens, chosen.asset).decimals)
  const problem = spender.frozen ? 'You are frozen by an owner.' : !isAddress(to.trim(), { strict: false }) ? 'Enter a recipient.' : raw === null ? 'Enter an amount.' : raw > chosen.limits.perTransfer ? 'Over your per-transfer limit.' : null
  return (
    <section className="acct-section acct-you">
      <header>
        <h2>Spend as agent</h2>
        <span className="mono-label">The contract checks every limit</span>
      </header>
      <div className="acct-form">
        <div className="acct-form-grid">
          <Field label="Asset">
            <div className="acct-toggle" role="radiogroup" aria-label="Asset">
              {usable.map((entry) => (
                <button key={entry.asset} type="button" role="radio" aria-checked={same(entry.asset, chosen.asset)} className={same(entry.asset, chosen.asset) ? 'is-active' : ''} onClick={() => setAsset(entry.asset)}>
                  {meta(tokens, entry.asset).symbol}
                </button>
              ))}
            </div>
          </Field>
          <Field label="To">
            <AddressInput value={to} onChange={setTo} />
          </Field>
          <Field label="Amount">
            <input className="acct-input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
        </div>
        <div className="acct-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={Boolean(problem) || Boolean(tx.busy)}
            onClick={() =>
              raw !== null &&
              void tx.run('Spend', { to: account.address, data: spendCalldata(chosen.asset, getAddress(to.trim()), raw) }, (units) => amount(units, chosen.asset, tokens)).then((ok) => ok && setValue(''))
            }
          >
            Send
          </button>
          <span className="acct-note">{problem ?? ''}</span>
        </div>
      </div>
    </section>
  )
}

function Keyset({ account, isOwner, tx }: { account: AccountState; isOwner: boolean; tx: Tx }) {
  const [rotating, setRotating] = useState(false)
  const [commitment, setCommitment] = useState<Hex | null>(null)
  return (
    <section className="acct-section">
      <header>
        <h2>Post-quantum key set</h2>
        <span className="mono-label">{account.keysetVersion ? `Version ${account.keysetVersion}` : 'None committed'}</span>
      </header>
      <p className="acct-note">
        The account stores a hash of its owners’ ML-DSA and SLH-DSA public keys. Base cannot check post-quantum signatures, so today the account is still controlled by its owners’ ordinary wallets. The commitment fixes, publicly and in advance, which post-quantum keys are trusted for recovery.
      </p>
      {account.keyset !== zeroHash && (
        <p>
          <code className="acct-hash">{account.keyset}</code>
        </p>
      )}
      {isOwner &&
        (rotating ? (
          <div className="acct-form">
            <KeysetMaker onReady={setCommitment} />
            <div className="acct-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!commitment || Boolean(tx.busy)}
                onClick={() =>
                  commitment &&
                  void tx.run('Propose key set', { to: account.address, data: proposeOwnerAction(account.address, { kind: 'rotateKeyset', commitment }) }).then((ok) => {
                    if (ok) setRotating(false)
                  })
                }
              >
                Propose this key set
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRotating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRotating(true)}>
            <KeyRound size={14} strokeWidth={1.8} /> {account.keysetVersion ? 'Rotate key set' : 'Commit a key set'}
          </button>
        ))}
    </section>
  )
}

/* ---------- co-signer ---------- */

const COSIGNER_URL = 'qfork.cosigner.url'
const COSIGNER_DEFAULT_URL = 'http://127.0.0.1:7454'
const COSIGNER_COMMAND = `npm run cosigner${ACCOUNT_MAINNET ? '' : ' -- --network base-sepolia'}`

interface CosignerInfo {
  address: Hex
  chainId: number
  mode: 'self-hosted' | 'hosted'
  balance: bigint | null
}

interface LoadedKeys {
  descriptor: KeysetDescriptor
  secretKeys: { scheme: KeysetScheme; role: KeyRole; secretKey: Hex }[]
}

function parseKeyFile(raw: unknown): LoadedKeys {
  const file = raw as { format?: unknown; descriptor?: KeysetDescriptor; secretKeys?: unknown } | null
  if (file?.format !== 'qfork.keyset.v1' || !file.descriptor || !Array.isArray(file.secretKeys)) throw new Error('That is not a Quantum Fork key file.')
  const problem = validateKeyset(file.descriptor)
  if (problem) throw new Error(`The key file’s key set is invalid: ${problem}`)
  const secretKeys = file.secretKeys.map((entry) => {
    const key = entry as { scheme?: unknown; role?: unknown; secretKey?: unknown }
    if (!isScheme(key.scheme) || !KEYSET_ROLES.includes(key.role as KeyRole) || !isKeyHex(key.secretKey)) throw new Error('The key file has a malformed secret key.')
    return { scheme: key.scheme, role: key.role as KeyRole, secretKey: key.secretKey }
  })
  return { descriptor: file.descriptor, secretKeys }
}

/** Accepts a signature object, an array of them, or one per line. */
function parseSignatures(text: string): PqSignature[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  let items: unknown[]
  try {
    const parsed = JSON.parse(trimmed) as unknown
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    items = trimmed.split(/\n+/).map((line) => {
      try {
        return JSON.parse(line) as unknown
      } catch {
        throw new Error('Paste guardian signatures exactly as they were copied.')
      }
    })
  }
  return items.map((item) => {
    const entry = item as { publicKey?: unknown; signature?: unknown }
    if (!isKeyHex(entry?.publicKey) || !isKeyHex(entry?.signature)) throw new Error('Each guardian signature needs a publicKey and a signature.')
    return { publicKey: entry.publicKey, signature: entry.signature }
  })
}

const digestOf = (account: AccountState, proposal: ProposalState) =>
  cosignDigest({ chainId: ACCOUNT_CHAIN_ID, account: account.address, proposalId: proposal.id, to: proposal.to, value: proposal.value, data: proposal.data, keyset: account.keyset })

/** Signs with every key in the file that may approve this kind of proposal, keeping those the key set recognises. */
function signWithFile(keys: LoadedKeys, roles: readonly KeyRole[], digest: Hex): PqSignature[] {
  const signatures: PqSignature[] = []
  for (const secret of keys.secretKeys.filter((key) => roles.includes(key.role))) {
    const signature = signCosign(secret.scheme, hexToBytes(secret.secretKey), digest)
    const match = keys.descriptor.keys.find((key) => key.scheme === secret.scheme && key.role === secret.role && !signatures.some((item) => same(item.publicKey, key.publicKey)) && verifyCosignSignature(key.scheme, key.publicKey, signature, digest))
    if (match) signatures.push({ publicKey: match.publicKey, signature })
  }
  return signatures
}

const yieldToPaint = () => new Promise((resolve) => setTimeout(resolve, 30))

function KeyFileInput({ label, onLoad }: { label: string; onLoad: (raw: unknown) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <label className="btn btn-secondary btn-sm acct-file">
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setError(null)
            readJsonFile(file).then(onLoad).catch((caught: Error) => setError(caught.message))
          }}
        />
        <Upload size={14} strokeWidth={1.8} /> {label}
      </label>
      {error && <small className="acct-bad">{error}</small>}
    </>
  )
}

function useCosignerInfo(where: 'self' | 'hosted', url: string, reader: Reader) {
  const [info, setInfo] = useState<{ state: 'idle' | 'loading' } | { state: 'ok'; info: CosignerInfo } | { state: 'error'; message: string }>({ state: 'idle' })
  const check = useCallback(async () => {
    setInfo({ state: 'loading' })
    try {
      const response = await fetch(where === 'hosted' ? '/api/cosign' : `${url.replace(/\/$/, '')}/v1/info`, { headers: { Accept: 'application/json' } })
      const body = (await response.json()) as { address?: Hex | null; chainId?: number; mode?: CosignerInfo['mode']; enabled?: boolean; name?: string }
      if (where === 'hosted' && body.enabled === false) return setInfo({ state: 'error', message: 'The hosted co-signer is not switched on yet. Run your own instead.' })
      if (body.name !== 'qfork-cosigner' || !body.address || !isAddress(body.address)) throw new Error('That address does not answer like a Quantum Fork co-signer.')
      if (body.chainId !== ACCOUNT_CHAIN_ID) return setInfo({ state: 'error', message: `That co-signer runs on chain ${body.chainId}; this account is on ${NET}. Start it with \`${COSIGNER_COMMAND}\`.` })
      const balance = await reader.getBalance({ address: body.address }).catch(() => null)
      setInfo({ state: 'ok', info: { address: getAddress(body.address), chainId: body.chainId, mode: body.mode ?? (where === 'hosted' ? 'hosted' : 'self-hosted'), balance } })
    } catch (caught) {
      setInfo({ state: 'error', message: where === 'self' ? `Nothing answered at ${url}. Start the co-signer on this machine with \`${COSIGNER_COMMAND}\`.` : ((caught as Error).message ?? 'The hosted co-signer did not answer.') })
    }
  }, [where, url, reader])
  return { info, check }
}

/**
 * Sends a proposal to the account's co-signer with post-quantum signatures. The co-signer is one
 * owner among several; it approves only after checking those signatures against the key set.
 */
function Cosigner({ account, reader, isOwner, tx, onDone }: { account: AccountState; reader: Reader; isOwner: boolean; tx: Tx; onDone: () => void }) {
  const [where, setWhere] = useState<'self' | 'hosted'>('self')
  const [url, setUrl] = useState(() => localStorage.getItem(COSIGNER_URL) ?? COSIGNER_DEFAULT_URL)
  const { info, check } = useCosignerInfo(where, url, reader)
  const [keys, setKeys] = useState<LoadedKeys | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: true; hash: Hex; kind: CosignClass } | { ok: false; message: string } | null>(null)

  useEffect(() => {
    if (where === 'hosted') void check()
  }, [where, check])

  const cosigner = info.state === 'ok' ? info.info : null
  const cosignerOwns = Boolean(cosigner && account.owners.some((owner) => same(owner, cosigner.address)))
  const open = account.proposals.filter((proposal) => !proposal.executed && !proposal.cancelled)
  const waiting = cosigner ? open.filter((proposal) => !proposal.approvedBy.some((owner) => same(owner, cosigner.address))) : open
  const proposal = waiting.find((item) => item.id.toString() === selected) ?? waiting[0] ?? null
  const kind = proposal ? cosignClass(account.address, proposal) : null
  const needed = kind === 'recovery' ? (keys?.descriptor.recoveryThreshold ?? null) : 1

  const loadKeys = (raw: unknown) => {
    setKeyError(null)
    try {
      const loaded = parseKeyFile(raw)
      if (keysetCommitment(loaded.descriptor) !== account.keyset) throw new Error('This key file is not the key set committed to this account.')
      setKeys(loaded)
    } catch (caught) {
      setKeys(null)
      setKeyError((caught as Error).message)
    }
  }

  const send = async () => {
    if (!proposal || !keys || !kind || !cosigner) return
    setResult(null)
    try {
      const extra = parseSignatures(pasted)
      setBusy(kind === 'recovery' ? 'Signing with your recovery key (SLH-DSA takes a few seconds)…' : 'Signing with your daily key…')
      await yieldToPaint()
      const digest = digestOf(account, proposal)
      const signatures = [...signWithFile(keys, kind === 'authorize' ? ['authorize'] : ['recovery', 'guardian'], digest), ...extra]
      setBusy('Waiting for the co-signer to check the signatures and approve on-chain…')
      const response = await fetch(where === 'hosted' ? '/api/cosign' : `${url.replace(/\/$/, '')}/v1/cosign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, chainId: ACCOUNT_CHAIN_ID, account: account.address, proposalId: proposal.id.toString(), descriptor: keys.descriptor, signatures }),
      })
      const body = (await response.json().catch(() => null)) as { hash?: Hex; class?: CosignClass; error?: { message?: string } } | null
      if (!response.ok || !body?.hash) throw new Error(body?.error?.message ?? `The co-signer answered ${response.status}.`)
      setResult({ ok: true, hash: body.hash, kind: body.class ?? kind })
      toast(`Co-signer approved #${proposal.id}`)
      onDone()
    } catch (caught) {
      setResult({ ok: false, message: (caught as Error)?.message ?? 'The co-signer could not be reached.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="acct-section">
      <header>
        <h2>Post-quantum co-signer</h2>
        <span className="mono-label">{cosigner ? (cosignerOwns ? 'Owner of this account' : 'Not an owner yet') : 'Not connected'}</span>
      </header>
      <p className="acct-note">
        A co-signer is one more owner of the account. It approves a proposal only after checking a post-quantum signature: your ML-DSA daily key for payments and other actions, or your SLH-DSA recovery key and guardians for changes to the owners, threshold or key set. Base itself still only checks the co-signer’s ordinary signature, so you are trusting the machine it runs on to do that check. With 2 of 3 owners (your wallet, the co-signer, a backup wallet), losing any one of them, or having one stolen, is not enough to move funds.
      </p>

      <div className="acct-form">
        <div className="acct-field">
          <span>Co-signer</span>
          <div className="acct-toggle" role="radiogroup" aria-label="Co-signer">
            <button type="button" role="radio" aria-checked={where === 'self'} className={where === 'self' ? 'is-active' : ''} onClick={() => setWhere('self')}>
              On this machine
            </button>
            <button type="button" role="radio" aria-checked={where === 'hosted'} className={where === 'hosted' ? 'is-active' : ''} onClick={() => setWhere('hosted')}>
              Hosted · server-trusted
            </button>
          </div>
          <small>
            {where === 'self' ? (
              <>
                Run <code>{COSIGNER_COMMAND}</code> from the Quantum Fork repository. It listens on 127.0.0.1 only and keeps its key in <code>~/.qfork-cosigner</code>.
              </>
            ) : (
              'Run by Quantum Fork. You trust our server to check the post-quantum signatures before it approves.'
            )}
          </small>
        </div>
        {where === 'self' && (
          <div className="acct-inline">
            <input className="acct-input" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} aria-label="Co-signer address" />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={info.state === 'loading'}
              onClick={() => {
                localStorage.setItem(COSIGNER_URL, url)
                void check()
              }}
            >
              {info.state === 'loading' ? 'Checking…' : 'Connect'}
            </button>
          </div>
        )}
        {info.state === 'error' && <p className="callout is-warn">{info.message}</p>}
        {cosigner && (
          <dl className="acct-kv">
            <div>
              <dt>Co-signer</dt>
              <dd>
                <Addr value={cosigner.address} label={shortAddress(cosigner.address, 6, 4)} /> · {cosigner.mode === 'hosted' ? 'hosted, server-trusted' : 'on this machine'}
              </dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd>
                {cosigner.balance === null ? 'unknown' : `${Number(formatEther(cosigner.balance)).toLocaleString(undefined, { maximumFractionDigits: 5 })} ETH`}
                {cosigner.balance === 0n && cosigner.mode !== 'hosted' && ' · send it a little ETH so it can pay for approvals'}
              </dd>
            </div>
          </dl>
        )}
        {cosigner && !cosignerOwns && isOwner && (
          <div className="acct-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(tx.busy)}
              onClick={() => void tx.run('Propose adding the co-signer', { to: account.address, data: proposeOwnerAction(account.address, { kind: 'addOwner', owner: cosigner.address, threshold: Math.min(Math.max(account.threshold, 2), account.owners.length + 1) }) })}
            >
              <Plus size={14} strokeWidth={1.8} /> Propose adding it as an owner
            </button>
            <span className="acct-note">
              {account.owners.length === 1
                ? 'Makes it 2 of 2. Then add a backup wallet as a third owner, so a lost wallet can be replaced with your recovery key.'
                : account.threshold < 2
                  ? `Raises approvals to 2 of ${account.owners.length + 1}, so nothing moves without the co-signer or a second wallet.`
                  : `Keeps ${account.threshold} approvals, now of ${account.owners.length + 1} owners.`}
            </span>
          </div>
        )}
      </div>

      {cosigner && cosignerOwns && account.keyset === zeroHash && <p className="callout">Commit a post-quantum key set below first; the co-signer has nothing to check signatures against.</p>}
      {cosigner && cosignerOwns && account.keyset !== zeroHash && (
        <div className="acct-form">
          {waiting.length === 0 ? (
            <p className="muted">No open proposal is waiting for the co-signer.</p>
          ) : (
            <Field label="Proposal">
              <select className="acct-input" value={proposal?.id.toString() ?? ''} onChange={(event) => setSelected(event.target.value)}>
                {waiting.map((item) => (
                  <option key={item.id.toString()} value={item.id.toString()}>
                    #{item.id.toString()} · {cosignClass(account.address, item) === 'recovery' ? 'changes who controls the account' : describeProposal(account.address, item).kind === 'transfer' ? 'payment' : 'action'}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {proposal && (
            <>
              <div className="acct-proposal-preview">{describeCall(account.address, proposal, {})}</div>
              <p className="acct-note">
                {kind === 'authorize'
                  ? 'Needs one signature from your ML-DSA daily key.'
                  : `Changes owners, the threshold or the key set: needs ${needed ?? 'the recovery threshold of'} signature${needed === 1 ? '' : 's'} from your recovery key or guardians.`}
              </p>
              <div className="acct-field">
                <span>Your key file</span>
                <KeyFileInput label={keys ? 'Key file loaded · replace' : 'Load your key file'} onLoad={loadKeys} />
                <small>{keyError ? <span className="acct-bad">{keyError}</span> : 'Read in this browser and signed here. The secret keys are never sent anywhere.'}</small>
              </div>
              {kind === 'recovery' && (
                <Field label="Guardian signatures" hint="Each guardian opens this account page, uses “Sign as a guardian” below and sends you what it copies.">
                  <textarea className="acct-input" rows={3} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder='{"publicKey":"0x…","signature":"0x…"}' spellCheck={false} />
                </Field>
              )}
              <div className="acct-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={!keys || Boolean(busy)} onClick={() => void send()}>
                  <KeyRound size={14} strokeWidth={1.8} /> Sign and send to the co-signer
                </button>
              </div>
            </>
          )}
          {busy && (
            <p className="acct-pending" role="status">
              <span className="pulse-dot" aria-hidden="true" /> {busy}
            </p>
          )}
          {result?.ok === false && <p className="callout is-warn">{result.message}</p>}
          {result?.ok && (
            <p className="callout">
              The co-signer approved it ({result.kind === 'recovery' ? 'recovery keys' : 'daily key'} checked).{' '}
              <a href={baseExplorerTx(result.hash, ACCOUNT_NETWORK)} target="_blank" rel="noreferrer noopener">
                View the approval <ArrowUpRight size={12} strokeWidth={1.8} />
              </a>
              {isOwner && ' Execute it from Proposals once it has enough approvals.'}
            </p>
          )}
        </div>
      )}
      <Disclosure title="Guardian tools">
        <GuardianTools account={account} />
      </Disclosure>
    </section>
  )
}

function makeGuardianKey() {
  const key = ml_dsa65.keygen()
  const publicKey = toHex(key.publicKey)
  const name = `qfork-guardian-${keccak256(publicKey).slice(2, 10)}`
  download(`${name}.secret.json`, JSON.stringify({ format: 'qfork.guardian.v1', scheme: 'ml-dsa-65', publicKey, secretKey: toHex(key.secretKey), note: 'Guardian secret key. Generated in your browser and never sent anywhere. Keep it; use it only to sign recoveries you agree with.' }, null, 2))
  download(`${name}.public.json`, JSON.stringify({ format: 'qfork.guardian.v1', scheme: 'ml-dsa-65', publicKey }, null, 2))
  key.secretKey.fill(0)
}

/** For a guardian: make a key, or sign one of this account's proposals and hand the signature to an owner. */
function GuardianTools({ account }: { account: AccountState }) {
  const [made, setMade] = useState(false)
  const [guardian, setGuardian] = useState<{ scheme: KeysetScheme; publicKey: Hex; secretKey: Hex } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const open = account.proposals.filter((proposal) => !proposal.executed && !proposal.cancelled && cosignClass(account.address, proposal) === 'recovery')
  const proposal = open.find((item) => item.id.toString() === selected) ?? open[0] ?? null
  return (
    <div className="acct-form">
      <div className="acct-field">
        <span>Become a guardian</span>
        <div className="acct-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              makeGuardianKey()
              setMade(true)
            }}
          >
            <Download size={14} strokeWidth={1.8} /> Make a guardian key
          </button>
        </div>
        <small>{made ? 'Two files were saved. Keep the .secret.json file; send the .public.json file to the account owner to add to their key set.' : 'Generates an ML-DSA-65 key in this browser.'}</small>
      </div>
      <div className="acct-field">
        <span>Sign as a guardian</span>
        <KeyFileInput
          label={guardian ? 'Guardian key loaded · replace' : 'Load your guardian secret file'}
          onLoad={(raw) => {
            setError(null)
            setSignature(null)
            const file = raw as { secretKey?: unknown } | null
            try {
              const parsed = parseGuardianFile(raw)
              if (!isKeyHex(file?.secretKey)) throw new Error('Load the .secret.json file; the public one cannot sign.')
              setGuardian({ ...parsed, secretKey: file.secretKey })
            } catch (caught) {
              setError((caught as Error).message)
            }
          }}
        />
        {error && <small className="acct-bad">{error}</small>}
      </div>
      {guardian && (
        <>
          {open.length === 0 ? (
            <p className="muted">There is no open recovery proposal on this account to sign.</p>
          ) : (
            <Field label="Recovery to sign">
              <select className="acct-input" value={proposal?.id.toString() ?? ''} onChange={(event) => setSelected(event.target.value)}>
                {open.map((item) => (
                  <option key={item.id.toString()} value={item.id.toString()}>
                    #{item.id.toString()}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {proposal && (
            <>
              <div className="acct-proposal-preview">{describeCall(account.address, proposal, {})}</div>
              <div className="acct-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const digest = digestOf(account, proposal)
                    const signed = signCosign(guardian.scheme, hexToBytes(guardian.secretKey), digest)
                    const text = JSON.stringify({ publicKey: guardian.publicKey, signature: signed, account: account.address, proposal: proposal.id.toString() })
                    setSignature(text)
                    void navigator.clipboard?.writeText(text).then(() => toast('Guardian signature copied. Send it to the account owner.'))
                  }}
                >
                  <KeyRound size={14} strokeWidth={1.8} /> Sign #{proposal.id.toString()} and copy
                </button>
              </div>
              <p className="acct-note">Only sign a recovery you have confirmed with the owner yourself. The signature covers exactly this proposal on this account.</p>
              {signature && <textarea className="acct-input" rows={3} readOnly value={signature} onFocus={(event) => event.target.select()} aria-label="Guardian signature" />}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Owners({ account, me, tx }: { account: AccountState; me: Hex | null; tx: Tx }) {
  const isOwner = account.owners.some((owner) => same(owner, me))
  return (
    <section className="acct-section">
      <header>
        <h2>Owners</h2>
        <span className="mono-label">
          {account.threshold} of {account.owners.length} approve
        </span>
      </header>
      <ul className="acct-owners">
        {account.owners.map((owner) => (
          <li key={owner}>
            <Addr value={owner} label={owner} />
            {same(owner, me) && <span className="tag">YOU</span>}
            {isOwner && account.owners.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                title="Propose removing this owner"
                aria-label={`Propose removing ${owner}`}
                disabled={Boolean(tx.busy)}
                onClick={() =>
                  void tx.run('Propose removing owner', { to: account.address, data: proposeOwnerAction(account.address, { kind: 'removeOwner', owner, threshold: Math.min(account.threshold, account.owners.length - 1) }) })
                }
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && <OwnersForm account={account} tx={tx} />}
    </section>
  )
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`acct-disclosure ${open ? 'is-open' : ''}`}>
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={14} strokeWidth={1.8} /> {title}
      </button>
      {open && children}
    </div>
  )
}

export function AccountConsole({ address }: { address: Hex }) {
  usePageMeta({ title: 'Account', description: `A Quantum Fork smart account on ${NET}: shared ownership, agent spending limits and a post-quantum key set.`, path: `/account/${address}` })
  const evm = useEvmWallet()
  const { load, refresh, reader } = useAccount(address)
  const tx = useTx(refresh)
  useEffect(() => {
    if (load.state === 'ok') rememberAccount(address)
  }, [load.state, address])

  if (load.state === 'loading') return <p className="muted page-head">Reading {NET}…</p>
  if (load.state === 'missing' || load.state === 'error')
    return (
      <div className="page-head not-found">
        <p className="eyebrow">
          <Link to="/account">Accounts</Link> · {NET}
        </p>
        <h1>{load.state === 'missing' ? 'No account here.' : 'Unavailable.'}</h1>
        <p className="section-lede">{load.state === 'missing' ? `There is no contract at ${address} on ${NET}.` : load.message}</p>
        <Link to="/account" className="btn btn-primary">
          All accounts
        </Link>
      </div>
    )

  const { account, tokens, fromFactory } = load
  const me = evm.address
  const isOwner = account.owners.some((owner) => same(owner, me))
  const isAgent = account.spenders.some((spender) => same(spender.address, me))
  return (
    <div className="acct">
      <header className="page-head acct-head">
        <p className="eyebrow">
          <Link to="/account">Accounts</Link> · {TIER}
        </p>
        <h1 className="acct-title">
          <Addr value={account.address} label={shortAddress(account.address, 6, 4)} />
        </h1>
        <dl className="acct-stats">
          <div>
            <dt>Balance</dt>
            <dd>{formatEther(account.balance)} ETH</dd>
          </div>
          <div>
            <dt>Approvals</dt>
            <dd>
              {account.threshold} of {account.owners.length}
            </dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>{account.spenders.length}</dd>
          </div>
          <div>
            <dt>You are</dt>
            <dd>{!me ? 'not connected' : isOwner ? 'an owner' : isAgent ? 'an agent' : 'a viewer'}</dd>
          </div>
        </dl>
        <div className="acct-actions">
          <button type="button" className="btn btn-quiet btn-sm" onClick={refresh}>
            <RefreshCw size={13} strokeWidth={1.8} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(account.address)
              toast(`Address copied. Send ${NET} ETH or tokens to it to fund the account.`)
            }}
          >
            Copy address to fund
          </button>
        </div>
        {fromFactory === false && <p className="callout is-warn">This contract was not created by the Quantum Fork account factory. It answers like an account, but its code is not the one this page was built for.</p>}
        {me && evm.chainId !== ACCOUNT_CHAIN_ID && <p className="callout">Your wallet is on another network. It will be asked to switch to {NET} before anything is sent.</p>}
      </header>

      {!me && (
        <section className="acct-section">
          <header>
            <h2>Connect to act</h2>
          </header>
          <p className="muted">Anyone can read this account. Owners and agents connect a wallet to propose, approve or spend.</p>
          <BaseWalletPanel />
        </section>
      )}

      <TxStatus tx={tx} />

      {me && isAgent && <AgentSpend account={account} tokens={tokens} me={me} tx={tx} />}
      <Proposals account={account} tokens={tokens} me={me} tx={tx} />
      {isOwner && (
        <div className="acct-new">
          <Disclosure title="Add an agent">
            <AgentForm account={account} reader={reader} tx={tx} onDone={refresh} />
          </Disclosure>
          <Disclosure title="Send funds">
            <SendForm account={account} reader={reader} tx={tx} />
          </Disclosure>
        </div>
      )}
      <Cosigner account={account} reader={reader} isOwner={isOwner} tx={tx} onDone={refresh} />
      <Agents account={account} tokens={tokens} me={me} tx={tx} />
      <Owners account={account} me={me} tx={tx} />
      <Keyset account={account} isOwner={isOwner} tx={tx} />
    </div>
  )
}

/* ---------- index ---------- */

function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

function CreateAccount({ me, reader }: { me: Hex; reader: Reader }) {
  const [owners, setOwners] = useState<string[]>([me])
  const [threshold, setThreshold] = useState(1)
  const [withKeys, setWithKeys] = useState(true)
  const [commitment, setCommitment] = useState<Hex | null>(null)
  const [salt] = useState(randomSalt)
  const [predicted, setPredicted] = useState<Hex | null>(null)
  const tx = useTx(useCallback(() => undefined, []))
  useEffect(() => {
    setOwners((list) => (list[0] && !same(list[0], me) && list.length === 1 ? [me] : list))
  }, [me])

  const ownersKey = owners.map((owner) => owner.trim()).join(',')
  const clean = useMemo(() => ownersKey.split(','), [ownersKey])
  const keyset = withKeys ? commitment : zeroHash
  const problem = validateOwners(clean, threshold) ?? (withKeys && !commitment ? 'Generate the key set and save the key file, or choose Later.' : null)
  useEffect(() => {
    setPredicted(null)
    if (problem || !ACCOUNT_FACTORY || !keyset) return
    let live = true
    void reader
      .readContract({ address: ACCOUNT_FACTORY, abi: ACCOUNT_FACTORY_ABI, functionName: 'predict', args: [me, clean.map((owner) => getAddress(owner)), threshold, keyset, salt] })
      .then((address) => live && setPredicted(address))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [problem, keyset, threshold, salt, me, reader, clean])

  const create = async () => {
    if (problem || !ACCOUNT_FACTORY || !keyset) return
    const ok = await tx.run('Create account', { to: ACCOUNT_FACTORY, data: createAccountCalldata(clean as Hex[], threshold, keyset, salt) })
    if (ok && predicted) {
      rememberAccount(predicted)
      navigate(`/account/${predicted}`)
    }
  }

  return (
    <section className="acct-section">
      <header>
        <h2>New account</h2>
        <span className="mono-label">{ACCOUNT_MAINNET ? 'Base · costs a little ETH for gas' : 'Base Sepolia · free test ETH for gas'}</span>
      </header>
      <div className="acct-form">
        <Field label={`Owners (${clean.length} of ${MAX_OWNERS})`} hint="Each owner is an ordinary Base wallet. You can add or remove owners later through a proposal.">
          <div className="acct-owner-rows">
            {owners.map((owner, index) => (
              <div key={index} className="acct-pair">
                <AddressInput value={owner} onChange={(value) => setOwners(owners.map((item, i) => (i === index ? value : item)))} />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove owner"
                  disabled={owners.length === 1}
                  onClick={() => {
                    setOwners(owners.filter((_, i) => i !== index))
                    setThreshold(Math.min(threshold, owners.length - 1))
                  }}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              </div>
            ))}
            {owners.length < MAX_OWNERS && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOwners([...owners, ''])}>
                <Plus size={14} strokeWidth={1.8} /> Add owner
              </button>
            )}
          </div>
        </Field>
        <Field label={`Approvals needed, of ${clean.length}`} hint={threshold === 1 ? 'Any one owner can act alone.' : `Every change needs ${threshold} owners to approve it.`}>
          <Stepper value={threshold} min={1} max={Math.max(1, clean.length)} onChange={setThreshold} />
        </Field>
        <div className="acct-field">
          <span>Post-quantum key set</span>
          <div className="acct-toggle" role="radiogroup" aria-label="Post-quantum key set">
            <button type="button" role="radio" aria-checked={withKeys} className={withKeys ? 'is-active' : ''} onClick={() => setWithKeys(true)}>
              Commit one
            </button>
            <button type="button" role="radio" aria-checked={!withKeys} className={!withKeys ? 'is-active' : ''} onClick={() => setWithKeys(false)}>
              Later
            </button>
          </div>
          {withKeys && <KeysetMaker onReady={setCommitment} />}
          <small>An ML-DSA-65 daily key and an SLH-DSA recovery key are generated in this browser, plus any guardians’ public keys you add. Only a hash of the public keys is stored on-chain.</small>
        </div>
      </div>
      <TxStatus tx={tx} />
      <div className="acct-actions">
        <button type="button" className="btn btn-primary" disabled={Boolean(problem) || !ACCOUNT_FACTORY || Boolean(tx.busy)} onClick={() => void create()}>
          Create account <ArrowRight size={15} strokeWidth={1.8} />
        </button>
        <span className="acct-note">{!ACCOUNT_FACTORY ? `The account factory is not deployed on ${NET} yet.` : (problem ?? (predicted ? `It will live at ${shortAddress(predicted, 6, 4)}.` : ''))}</span>
      </div>
    </section>
  )
}

function useMyAccounts(me: Hex | null, reader: Reader) {
  const [accounts, setAccounts] = useState<Hex[] | null>(null)
  useEffect(() => {
    if (!me || !ACCOUNT_FACTORY) return setAccounts(null)
    let live = true
    const factory = ACCOUNT_FACTORY
    void Promise.all([
      reader.readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'createdBy', args: [me] }),
      reader.readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'accountsOf', args: [me] }),
    ])
      .then(([created, owned]) => live && setAccounts([...created, ...owned].filter((account, index, list) => list.findIndex((other) => same(other, account)) === index)))
      .catch(() => live && setAccounts([]))
    return () => {
      live = false
    }
  }, [me, reader])
  return accounts
}

export default function Accounts() {
  usePageMeta({ title: 'Accounts', description: `Shared smart accounts on ${NET} with owner approvals, agent spending limits and a committed post-quantum key set.`, path: '/account' })
  const evm = useEvmWallet()
  const reader = useMemo(() => accountReader(evm.chainId), [evm.chainId])
  const mine = useMyAccounts(evm.address, reader)
  const [recent] = useState(recentAccounts)
  const [open, setOpen] = useState('')
  const others = recent.filter((item) => !mine?.some((account) => same(account, item)))
  return (
    <div className="acct">
      <header className="page-head">
        <p className="eyebrow">QFork Accounts · {TIER}</p>
        <h1>Shared wallets with agent limits.</h1>
        <p className="section-lede">
          A smart-contract account owned by one or more wallets. Owners approve changes together, agents spend inside limits the contract enforces, and any owner can freeze an agent at once. A post-quantum key set is committed on-chain for recovery. Base itself still runs on ECDSA, and so do the owners’ wallets.
        </p>
      </header>

      {!ACCOUNT_FACTORY && <p className="callout">The account factory has not been deployed to {NET} yet. Everything below works the moment it is.</p>}
      {ACCOUNT_FACTORY && ACCOUNT_MAINNET && <p className="callout is-warn">These accounts hold real funds on Base. The contracts are open source and tested, but have not had an external audit. Start with small amounts.</p>}

      {!evm.address ? (
        <section className="acct-section">
          <header>
            <h2>Connect a wallet</h2>
            <span className="mono-label">Needs {NET} ETH for gas</span>
          </header>
          <BaseWalletPanel />
        </section>
      ) : (
        <>
          {mine && mine.length > 0 && (
            <section className="acct-section">
              <header>
                <h2>Your accounts</h2>
                <span className="mono-label">{mine.length} created or owned</span>
              </header>
              <ul className="acct-index">
                {mine.map((account) => (
                  <li key={account}>
                    <Link to={`/account/${account}`}>
                      <code>{account}</code> <ArrowRight size={14} strokeWidth={1.8} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <CreateAccount me={evm.address} reader={reader} />
        </>
      )}

      <section className="acct-section">
        <header>
          <h2>Open an account</h2>
          <span className="mono-label">Agents and viewers start here</span>
        </header>
        <div className="acct-pair">
          <AddressInput value={open} onChange={setOpen} placeholder="Account address" />
          <button type="button" className="btn btn-secondary btn-sm" disabled={!isAddress(open.trim(), { strict: false })} onClick={() => navigate(`/account/${getAddress(open.trim())}`)}>
            Open
          </button>
        </div>
        {others.length > 0 && (
          <ul className="acct-index">
            {others.map((account) => (
              <li key={account}>
                <Link to={`/account/${account}`}>
                  <code>{account}</code> <span className="muted">recent</span> <ArrowRight size={14} strokeWidth={1.8} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
