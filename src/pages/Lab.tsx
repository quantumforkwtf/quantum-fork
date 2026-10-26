import { ArrowLeft, ArrowRight, Copy, Download, ExternalLink, Share2, ShieldAlert } from 'lucide-react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChamberOverlay from '../components/ChamberOverlay'
import { IntentList } from '../components/BuildIntents'
import ExposureMap from '../components/ExposureMap'
import { FaucetPanel } from '../components/Faucet'
import FailurePanel from '../components/FailurePanel'
import GenomeTerminal from '../components/GenomeTerminal'
import HoldToBurn from '../components/HoldToBurn'
import { KeyBank, LabFader, TapeInput } from '../components/LabControls'
import ModuleCard from '../components/ModuleCard'
import { OriginBadge, Pill } from '../components/Status'
import { ReactorViewport, SpecimenViewport } from '../components/Viewports'
import { WalletSheet, WalletSummary } from '../components/WalletControl'
import { CLIENT_CONFIG, configMismatch, explorerAddress, explorerTx, useServerStatus } from '../config'
import type { Choice } from '../lab/genome'
import type { OrganPart } from '../lab/morphology'
import { findDescendant, genomeOf, registrySnapshot, rememberRegistered, updateRemote, useRegistry } from '../lab/registry'
import { createRemoteDeployment, fetchRemoteDeployment, loadPending, savePending, verifyRemoteBurn } from '../lab/testnet'
import { useScan } from '../lab/useScan'
import type { ReactorPhase } from '../lab/protocol'
import { idempotencyKey, report } from '../lib/api'
import { FlowError } from '../lib/failures'
import { formatNumber, usePrefersReducedMotion } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { awaitConfirmation, type PreparedBurn, prepareBurn, signAndSend } from '../lib/solana/burn'
import { type PreparedBaseBurn, prepareBaseBurn, sendBaseBurn } from '../lib/evm/burn'
import { useEvmWallet } from '../lib/evm/wallet'
import { BaseWalletPanel } from '../components/BaseWallet'
import { refreshBalances, useWallet } from '../lib/solana/wallet'
import { copyText, toast } from '../lib/toast'
import { navigate, useLocation } from '../navigation'
import { shortAddress } from '../protocol/address'
import { ANCESTOR_NAME, ANCESTORS, type AncestorId, type CategoryCode, DEFAULT_ANCESTOR, isAncestorId, LOCUS_BY_CODE, MODELS } from '../protocol/ancestors'
import { baseExplorerAddress, baseTier, type Chain } from '../protocol/base'
import type { SolanaNetwork } from '../protocol/config'
import { type DeploymentRecord, HAPPY_PATH, stateLabel } from '../protocol/deployment'
import { applyProfile, defaultConfig, type DeploymentTier, type DescendantConfig, descendantSchema, ancestorGenome, genomeDiff, genomeHash, normalizeConfig, remainingExposure, TIERS } from '../protocol/descendant'
import { dependents, MODULE_BY_ID, PQ_MODULES, type PqModuleId } from '../protocol/modules'
import { CHAIN_BURN_SCALE, PRICING, quoteGenesis } from '../protocol/pricing'
import { PQ_PROFILES, PROFILE_BY_ID, type ProfileId, strainLabel } from '../protocol/profiles'
import { MEMO_PROGRAM, TOKEN_2022_PROGRAM } from '../protocol/verifyBurn'
import { type Answers, blueprintLabHref, compileBlueprint, decodeAnswers, encodeAnswers } from '../protocol/blueprintCompiler'
import { type Blueprint, findBlueprint } from '../protocol/blueprints'
import { BlueprintConfigurator, BlueprintStatusBadge } from '../components/Blueprint'
import { blueprintVisual } from '../lab/blueprintVisual'
import { useRuntime } from '../lab/runtime'
import { Link } from '../router'
import type { OrganismFx } from '../three/types'
import BlueprintStudio from './BlueprintStudio'

const STEPS = ['Ancestor', 'Scan', 'Exposure', 'Profile', 'Configure', 'Review diff', 'Requirement', 'Wallet', 'Burn', 'Verify', 'Register', 'Report'] as const
/** Simple Mode replaces the first five steps with the blueprint configurator. */
const SIMPLE_RAIL = [{ label: 'Blueprint', index: 0 }, ...STEPS.slice(5).map((label, offset) => ({ label, index: offset + 5 }))]
/** The one tier this build can register on. Devnet and mainnet are never offered side by side. */
const SITE_TIER: DeploymentTier = CLIENT_CONFIG.network === 'mainnet-beta' ? 'mainnet' : 'testnet'
const DRAFT_KEY = 'qfork.lab.draft.v3'
/** Drafts saved before Base became the main ancestor. Unregistered ones move to Base on load. */
const LEGACY_DRAFT_KEY = 'qfork.lab.draft.v2'

type LabMode = 'simple' | 'expert'

interface Draft {
  step: number
  config: DescendantConfig
  scanned: boolean
  touched: { symbol: boolean; networkId: boolean }
  parentId: string
  generation: number
  idemKey: string
  remoteId: string | null
  mode: LabMode
  blueprint: { slug: string; answers: Answers } | null
  /** The burn chain the user picked. Unset means Base when Base burns are available, otherwise Solana. */
  chain?: Chain
}

function freshDraft(profile: ProfileId = 'hybrid', ancestor: AncestorId = DEFAULT_ANCESTOR): Draft {
  return {
    step: 0,
    config: defaultConfig(profile, ancestor),
    scanned: false,
    touched: { symbol: false, networkId: false },
    parentId: ancestor,
    generation: 1,
    idemKey: idempotencyKey(),
    remoteId: null,
    mode: 'expert',
    blueprint: null,
  }
}

function blueprintDraft(blueprint: Blueprint, input: Answers): Draft | null {
  const compiled = compileBlueprint(blueprint, input)
  if (!compiled.config) return null
  const expert = blueprint.route === 'expert'
  return {
    ...freshDraft(compiled.config.profile, compiled.config.ancestor),
    config: compiled.config,
    scanned: true,
    step: expert ? 3 : 0,
    mode: expert ? 'expert' : 'simple',
    blueprint: { slug: blueprint.slug, answers: compiled.answers },
  }
}

/** Moves a draft onto another ancestor and keeps the design. A blueprint is recompiled for the new ancestor. */
function rebase(draft: Draft, next: AncestorId): Draft {
  const blueprint = draft.blueprint ? findBlueprint(draft.blueprint.slug) : null
  const recompiled = blueprint && draft.blueprint ? compileBlueprint(blueprint, draft.blueprint.answers, undefined, next).config : null
  const named = draft.touched.symbol || draft.touched.networkId
  const network = named ? draft.config.network : (recompiled?.network ?? defaultConfig(draft.config.profile, next).network)
  const config = normalizeConfig({ ...(recompiled ?? draft.config), ancestor: next, network, tier: draft.config.tier })
  return { ...draft, config, parentId: next, generation: 1, remoteId: null, idemKey: idempotencyKey() }
}

function loadDraft(): Draft | null {
  try {
    const current = window.localStorage.getItem(DRAFT_KEY)
    const raw = current ?? window.localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Partial<Draft>
    const parsed = descendantSchema.safeParse(draft.config)
    if (!parsed.success) return null
    const blueprint = draft.blueprint && findBlueprint(draft.blueprint.slug) ? draft.blueprint : null
    const loaded = { ...freshDraft(), ...draft, config: parsed.data, mode: draft.mode === 'simple' && blueprint ? 'simple' : 'expert', blueprint } as Draft
    const legacy = current === null
    if (legacy) window.localStorage.removeItem(LEGACY_DRAFT_KEY)
    return legacy && !loaded.remoteId && loaded.config.ancestor !== DEFAULT_ANCESTOR && loaded.generation === 1 ? rebase(loaded, DEFAULT_ANCESTOR) : loaded
  } catch {
    return null
  }
}

function useDraft() {
  const { query } = useLocation()
  const [draft, setDraft] = useState<Draft>(() => {
    const requested = findBlueprint(query.get('blueprint'))
    if (requested) {
      const answers = decodeAnswers(query.get('a'))
      const saved = loadDraft()
      const fresh = blueprintDraft(requested, answers)
      if (saved?.blueprint?.slug === requested.slug && fresh && encodeAnswers(saved.blueprint.answers) === encodeAnswers(fresh.blueprint?.answers ?? {})) return saved
      if (fresh) return fresh
    }
    const profile = query.get('profile') as ProfileId | null
    if (profile && PROFILE_BY_ID[profile]) return { ...freshDraft(profile), step: 3, scanned: true }
    const parent = query.get('parent')
    const source = parent ? findDescendant(registrySnapshot(), parent) : null
    if (source?.config) {
      const config = normalizeConfig({ ...source.config, tier: 'testnet', network: { name: `${source.config.network.name.slice(0, 19)} F${source.generation + 1}`, symbol: source.config.network.symbol, networkId: `${source.config.network.networkId.slice(0, 27)}-f${source.generation + 1}` } })
      return { ...freshDraft(config.profile), config, step: 3, scanned: true, parentId: source.id, generation: source.generation + 1 }
    }
    return loadDraft() ?? freshDraft()
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Draft persistence is best-effort.
    }
  }, [draft])
  return [draft, setDraft] as const
}

const symbolFrom = (name: string) => (name.replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'QF').padEnd(2, 'X')
const networkIdFrom = (name: string) => `qf-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 32).replace(/-$/, '') || 'qf-descendant'

function Station({ index, title, lede, children, tone = 'var(--lime)' }: { index: number; title: string; lede: string; children: ReactNode; tone?: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [index])
  return (
    <section ref={ref} tabIndex={-1} className="station is-current" style={{ '--tone': tone } as CSSProperties} aria-labelledby={`station-${index}`}>
      <header className="station-head">
        <span className="station-num">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <h2 id={`station-${index}`}>{title}</h2>
          <p>{lede}</p>
        </div>
      </header>
      <div className="station-body">{children}</div>
    </section>
  )
}

/** What to do once a descendant is registered. Launching its token is the primary path. */
function RegisteredActions({ id }: { id: string }) {
  const base = `/network/${id}`
  return (
    <div className="genesis-next">
      <p className="genesis-ask">What next?</p>
      <div className="genesis-actions">
        <button type="button" className="btn btn-primary" onClick={() => navigate(`${base}/tokens?launch=1`)}>
          Launch its token <ArrowRight size={15} strokeWidth={1.8} />
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(`${base}/developers`)}>
          Developer kit
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(base)}>
          Open console
        </button>
      </div>
      <div className="genesis-links">
        <Link to={`/species/${id}`}>Public page</Link>
        <Link to={`${base}/cryptography`}>Cryptographic genome</Link>
        <a href={`/lab?parent=${id}`}>Fork it</a>
      </div>
    </div>
  )
}

function PlainInput({ label, value, onChange, maxLength, hint }: { label: string; value: string; onChange: (value: string) => void; maxLength: number; hint?: string }) {
  return (
    <label className="field text-field text-field-sm">
      <span className="field-label">{label}</span>
      <input value={value} maxLength={maxLength} spellCheck={false} autoComplete="off" onChange={(event) => onChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
      {hint && <span className="field-detail">{hint}</span>}
    </label>
  )
}

const HARDWARE: Choice<'standard' | 'high'>[] = [
  { value: 'standard', label: 'STANDARD', detail: 'Commodity validator hardware.' },
  { value: 'high', label: 'HIGH PERFORMANCE', detail: `Faster slots; adds ${formatNumber(PRICING.highPerformanceValidators)} QFORK.` },
]
const RPC: Choice<'public' | 'private'>[] = [
  { value: 'public', label: 'PUBLIC', detail: 'Rate-limited public endpoint.' },
  { value: 'private', label: 'PRIVATE', detail: `Dedicated endpoint; adds ${formatNumber(PRICING.privateRpc)} QFORK.` },
]
const PRIVACY: Choice<'public' | 'shielded'>[] = [
  { value: 'public', label: 'PUBLIC', detail: 'Transparent ledger. Confidential transfers disabled.' },
  { value: 'shielded', label: 'SHIELDED', detail: 'Confidential transfers available. Classical proofs unless PQ-06 is included.' },
]
const RECOVERY: Choice<'none' | 'pq-commitment'>[] = [
  { value: 'none', label: 'NONE', detail: 'No post-quantum recovery path for exposed keys.' },
  { value: 'pq-commitment', label: 'PQ COMMITMENT', detail: 'Accounts pre-commit to a hash-based recovery key (adds PQ-03).' },
]

function TierPicker({ value, onChange, availability }: { value: DeploymentTier; onChange: (tier: DeploymentTier) => void; availability: Record<DeploymentTier, { available: boolean; reason: string }> }) {
  return (
    <div className="field">
      <span className="field-label" id="tier-label">
        DEPLOYMENT TIER
      </span>
      <div className="tier-grid" role="radiogroup" aria-labelledby="tier-label">
        {TIERS.filter((tier) => tier.id === SITE_TIER).map((tier) => {
          const state = availability[tier.id]
          return (
            <button
              key={tier.id}
              type="button"
              role="radio"
              aria-checked={value === tier.id}
              disabled={!state.available}
              className={`tier-card ${value === tier.id ? 'is-active' : ''}`}
              onClick={() => onChange(tier.id)}
            >
              <strong>{tier.label}</strong>
              <span>{tier.detail}</span>
              {!state.available && <small>UNAVAILABLE · {state.reason}</small>}
            </button>
          )
        })}
        {SITE_TIER === 'testnet' && (
          <button type="button" role="radio" aria-checked={false} disabled className="tier-card is-soon">
            <strong>MAINNET</strong>
            <small>COMING SOON</small>
            <span>Register with real $QFORK. Not open yet.</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** Every ancestor this lab knows about. Only sequenced ones can be forked; the rest are listed as coming soon. */
function AncestorRow({ value, onChange }: { value: AncestorId; onChange: (ancestor: AncestorId) => void }) {
  return (
    <div className="field">
      <span className="field-label" id="ancestor-label">
        ANCESTOR CHAIN
      </span>
      <div className="chain-row" role="radiogroup" aria-labelledby="ancestor-label">
        {ANCESTORS.map((ancestor) => {
          const ready = ancestor.lab === true
          return (
            <button
              key={ancestor.id}
              type="button"
              role="radio"
              aria-checked={ancestor.id === value}
              disabled={!ready}
              className={`chain-chip ${ancestor.id === value ? 'is-active' : ''}`}
              onClick={() => isAncestorId(ancestor.id) && onChange(ancestor.id)}
            >
              <strong>{ancestor.name}</strong>
              <small>{ready ? 'SEQUENCED' : ancestor.status === 'AVAILABLE' ? 'SCAN ONLY' : 'COMING SOON'}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ExactTransaction({ prepared, network }: { prepared: PreparedBurn; network: string }) {
  const program = prepared.tokenProgram === TOKEN_2022_PROGRAM ? 'Token-2022' : 'SPL Token'
  return (
    <div className="tx-view" aria-label="Exact transaction">
      <p className="mono-label">Exact transaction · {network} · legacy message</p>
      <ol className="tx-ix">
        <li>
          <code>ComputeBudget</code>
          <span>SetComputeUnitLimit · 40,000 units</span>
        </li>
        <li className="is-key">
          <code>{program}</code>
          <span>
            <b>BurnChecked</b> · {formatNumber(prepared.request.amount)} QFORK ({prepared.amountRaw.toString()} base units, {prepared.decimals} decimals)
          </span>
          <dl>
            <div>
              <dt>Mint</dt>
              <dd>
                <a href={explorerAddress(prepared.request.mint)} target="_blank" rel="noreferrer noopener">
                  {shortAddress(prepared.request.mint, 6, 6)}
                </a>
              </dd>
            </div>
            <div>
              <dt>From account</dt>
              <dd>{shortAddress(prepared.tokenAccount, 6, 6)}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{shortAddress(prepared.request.owner, 6, 6)} (you)</dd>
            </div>
          </dl>
        </li>
        <li>
          <code>Memo</code>
          <span>
            <code>{prepared.request.memo}</code>
          </span>
        </li>
      </ol>
      <dl className="tx-meta">
        <div>
          <dt>Network fee</dt>
          <dd>{Number(prepared.feeLamports) / 1e9} SOL</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd>{((Number(prepared.balanceRaw) - Number(prepared.amountRaw)) / 10 ** prepared.decimals).toLocaleString('en-US')} QFORK</dd>
        </div>
        <div>
          <dt>Dry run</dt>
          <dd className="is-ok">PASSED · {prepared.simulation.unitsConsumed ?? '—'} CU</dd>
        </div>
        <div>
          <dt>Programs</dt>
          <dd>
            {program} · Memo ({shortAddress(MEMO_PROGRAM)}) · ComputeBudget
          </dd>
        </div>
      </dl>
      <p className="tx-note">This is the canonical SPL burn instruction: tokens are destroyed and total supply falls. Nothing is sent to any wallet.</p>
    </div>
  )
}

function ExactBaseTransaction({ prepared }: { prepared: PreparedBaseBurn }) {
  const { request } = prepared
  return (
    <div className="tx-view" aria-label="Exact transaction">
      <p className="mono-label">Exact transaction · {request.network} · chain {request.chainId}</p>
      <ol className="tx-ix">
        <li className="is-key">
          <code>QFORK.burn</code>
          <span>
            <b>burn(uint256)</b> · {formatNumber(request.amount)} QFORK ({prepared.amountRaw.toString()} base units, {prepared.decimals} decimals)
          </span>
          <dl>
            <div>
              <dt>Token contract</dt>
              <dd>
                <a href={baseExplorerAddress(request.token, request.network)} target="_blank" rel="noreferrer noopener">
                  {shortAddress(request.token, 6, 6)}
                </a>
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{shortAddress(request.owner, 6, 6)} (you)</dd>
            </div>
            <div>
              <dt>ETH sent</dt>
              <dd>0</dd>
            </div>
          </dl>
        </li>
        <li>
          <code>Deployment tag</code>
          <span>
            <code>{shortAddress(prepared.tag, 10, 8)}</code> = keccak256(<code>{request.memo}</code>), appended after the amount
          </span>
        </li>
      </ol>
      <dl className="tx-meta">
        <div>
          <dt>Gas (estimate)</dt>
          <dd>{(Number(prepared.feeWei) / 1e18).toFixed(8)} ETH</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd>{((Number(prepared.balanceRaw) - Number(prepared.amountRaw)) / 10 ** prepared.decimals).toLocaleString('en-US')} QFORK</dd>
        </div>
        <div>
          <dt>Dry run</dt>
          <dd className="is-ok">PASSED · {prepared.gas.toString()} gas</dd>
        </div>
      </dl>
      <p className="tx-note">This calls the token’s own burn(): tokens are destroyed and total supply falls. Nothing is sent to any wallet. The server registers the descendant once the block is finalized on Base, usually 15–30 minutes.</p>
    </div>
  )
}

const STATE_PHASE: Partial<Record<DeploymentRecord['state'], ReactorPhase>> = {
  BURN_SUBMITTED: 'sealing',
  BURN_CONFIRMED: 'assembling',
  REGISTERED: 'complete',
}

/** Application blueprints open the studio; the chain scanner blueprint opens the scanner; everything else is the bench. */
export default function Lab() {
  const { query } = useLocation()
  const blueprint = findBlueprint(query.get('blueprint'))
  const raw = query.get('a')
  const answers = useMemo(() => decodeAnswers(raw), [raw])
  const toScanner = blueprint?.route === 'scanner'
  useEffect(() => {
    if (toScanner) navigate(answers.chain === 'solana' ? '/scanner?ancestor=solana' : '/scanner', { replace: true })
  }, [toScanner, answers.chain])
  if (toScanner) return null
  if (blueprint?.category === 'APPLICATION') return <BlueprintStudio key={blueprint.slug} blueprint={blueprint} answers={answers} />
  return <LabBench key={blueprint?.slug ?? 'bench'} />
}

function LabBench() {
  usePageMeta({ title: 'Lab', description: 'Design a post-quantum descendant of Base: answer a few questions in Simple Mode, or set every gene in Expert Mode.', path: '/lab' })
  const [draft, setDraft] = useDraft()
  const runtime = useRuntime()
  const server = useServerStatus()
  const wallet = useWallet()
  const evm = useEvmWallet()
  const registry = useRegistry()
  const reduced = usePrefersReducedMotion()
  const ancestor = draft.config.ancestor
  const ancestorName = ANCESTOR_NAME[ancestor]
  const model = MODELS[ancestor]
  const scanner = useScan(draft.scanned, ancestor)
  const [part, setPart] = useState<OrganPart | null>(null)
  const [locus, setLocus] = useState<CategoryCode | null>(null)
  const [hash, setHash] = useState('')
  const [walletOpen, setWalletOpen] = useState(false)
  const [error, setError] = useState<FlowError | null>(null)
  const [prepared, setPrepared] = useState<PreparedBurn | null>(null)
  const [preparedBase, setPreparedBase] = useState<PreparedBaseBurn | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [burnStage, setBurnStage] = useState<'review' | 'signing' | 'confirming' | 'verifying'>('review')
  const [remote, setRemote] = useState<{ deployment: DeploymentRecord } | null>(null)
  const [intro, setIntro] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const { config, step } = draft
  const tier = config.tier
  const profile = PROFILE_BY_ID[config.profile]
  const diff = useMemo(() => genomeDiff(config), [config])
  const remaining = useMemo(() => remainingExposure(config), [config])
  const validation = useMemo(() => descendantSchema.safeParse(config), [config])
  const issues = validation.success ? [] : validation.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  const genome = useMemo(() => genomeOf({ id: 'draft', code: '', origin: 'registered', config, parentId: draft.parentId, generation: draft.generation, createdAt: '', deployment: null, receipt: null, tokens: [] }), [config, draft.parentId, draft.generation])

  /* ---------- blueprint ---------- */

  const blueprint = draft.blueprint ? findBlueprint(draft.blueprint.slug) : null
  const simple = draft.mode === 'simple' && blueprint !== null
  const choosing = draft.mode === 'simple' && blueprint === null
  const { devnetBurn, mainnetBurn } = runtime
  const compiled = useMemo(
    () => (blueprint && draft.blueprint ? compileBlueprint(blueprint, draft.blueprint.answers, { devnetBurn, mainnetBurn }, draft.config.ancestor) : null),
    [blueprint, draft.blueprint, devnetBurn, mainnetBurn, draft.config.ancestor],
  )
  const customized = Boolean(
    compiled?.config &&
      JSON.stringify([config.profile, config.modules, config.validators, config.rpc, config.economics, config.privacy, config.recovery]) !==
        JSON.stringify([compiled.config.profile, compiled.config.modules, compiled.config.validators, compiled.config.rpc, compiled.config.economics, compiled.config.privacy, compiled.config.recovery]),
  )
  const visual = blueprint ? blueprintVisual(blueprint, config) : null

  const answerBlueprint = (answers: Answers) => {
    if (!blueprint) return
    const next = compileBlueprint(blueprint, answers, undefined, draft.config.ancestor)
    if (!next.config) return
    const fresh = next.config
    setDraft((current) => ({ ...current, blueprint: { slug: blueprint.slug, answers: next.answers }, config: normalizeConfig({ ...fresh, network: current.config.network, tier: current.config.tier }) }))
    navigate(blueprintLabHref(blueprint, next.answers), { replace: true, keepScroll: true })
  }

  const switchMode = (mode: LabMode) => {
    setError(null)
    setDraft((current) => ({
      ...current,
      mode,
      scanned: true,
      step: current.step >= 5 ? current.step : mode === 'expert' ? 3 : 0,
    }))
  }

  const status = server.state === 'ok' ? server.status : null
  const mismatch = status ? configMismatch(status) : null
  const blueprintBlock = compiled && !compiled.plan.tiers[SITE_TIER].available && compiled.status === 'COMING SOON' ? compiled.plan.tiers[SITE_TIER].reason : null
  const researchBlock = config.profile === 'research' && !CLIENT_CONFIG.flags.experimentalPq ? 'The research profile can be designed and exported, not registered.' : null
  const gate = (serverTier: { available: boolean; reason: string } | undefined) =>
    !status || !serverTier
      ? { available: false, reason: server.state === 'loading' ? 'Checking server…' : 'Protocol server unreachable.' }
      : mismatch
        ? { available: false, reason: mismatch }
        : blueprintBlock
          ? { available: false, reason: blueprintBlock }
          : researchBlock
            ? { available: false, reason: researchBlock }
            : serverTier
  const baseStatus = status?.base ?? null
  const baseGate = baseStatus ? gate(baseStatus.registration) : { available: false, reason: server.state === 'loading' ? 'Checking server…' : 'This server does not support Base yet.' }
  /* $QFORK burns on Base. Only a draft already registering on Solana devnet keeps its chain. */
  const chain: Chain = draft.remoteId ? (draft.chain ?? 'solana') : 'base'
  const chainTier: DeploymentTier = chain === 'base' && baseStatus ? baseTier(baseStatus.network) : SITE_TIER
  const tierAvailability: Record<DeploymentTier, { available: boolean; reason: string }> =
    chain === 'base'
      ? { testnet: chainTier === 'testnet' ? baseGate : { available: false, reason: 'Not the Base tier.' }, mainnet: chainTier === 'mainnet' ? baseGate : { available: false, reason: 'Not the Base tier.' } }
      : { testnet: gate(status?.tiers.testnet), mainnet: gate(status?.tiers.mainnet) }
  const quote = useMemo(() => quoteGenesis(config, 'GENESIS', chain), [config, chain])
  const chooseAncestor = (next: AncestorId) => {
    if (next === ancestor) return
    setError(null)
    setPrepared(null)
    setPreparedBase(null)
    setRemote(null)
    scanner.reset()
    setDraft((current) => rebase(current, next))
  }
  const expertStep = (index: number) => !simple && !choosing && step === index

  useEffect(() => {
    let cancelled = false
    void genomeHash(config).then((value) => !cancelled && setHash(value))
    return () => {
      cancelled = true
    }
  }, [config])

  useEffect(() => () => abort.current?.abort(), [])

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const setConfig = (recipe: (current: DescendantConfig) => DescendantConfig) => setDraft((current) => ({ ...current, config: normalizeConfig(recipe(current.config)) }))

  useEffect(() => {
    if (config.tier !== chainTier) setDraft((current) => ({ ...current, config: normalizeConfig({ ...current.config, tier: chainTier }) }))
  }, [config.tier, chainTier, setDraft])
  const go = (next: number) => {
    setError(null)
    update({ step: Math.max(0, Math.min(STEPS.length - 1, next)) })
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  /* ---------- server deployment + live record ---------- */

  const liveDeployment: DeploymentRecord | null = remote?.deployment ?? null

  useEffect(() => {
    if (!draft.remoteId || remote?.deployment.id === draft.remoteId) return
    fetchRemoteDeployment(draft.remoteId)
      .then((data) => setRemote({ deployment: data.deployment }))
      .catch((caught) => setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE')))
  }, [draft.remoteId, remote?.deployment.id])

  const runVerify = useCallback(
    async (deploymentId: string, signature: string, lastValidBlockHeight: number | null) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      const onBase = signature.startsWith('0x')
      try {
        if (lastValidBlockHeight !== null && !onBase) {
          setBurnStage('confirming')
          await awaitConfirmation(signature, lastValidBlockHeight, controller.signal)
        }
        setBurnStage('verifying')
        const verified = await verifyRemoteBurn(deploymentId, signature, (deployment) => setRemote({ deployment }), controller.signal, onBase ? 10_000 : 3000)
        savePending(null)
        setRemote({ deployment: verified.deployment })
        rememberRegistered(verified.deployment, draft.parentId, draft.generation)
        updateRemote(verified.deployment, verified.receipt, [])
        void refreshBalances()
        setDraft((current) => ({ ...current, step: 9 }))
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        const flow = caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE')
        if (flow.code !== 'API_UNAVAILABLE' && flow.code !== 'RPC_UNAVAILABLE') savePending(null)
        report('wallet', `burn flow ${flow.code}`)
        setError(flow)
        setBurnStage('review')
      }
    },
    [draft.parentId, draft.generation, setDraft],
  )

  useEffect(() => {
    const pending = loadPending()
    if (!pending || pending.deploymentId !== draft.remoteId) return
    void runVerify(pending.deploymentId, pending.signature, null)
    // Resume once on mount when a signed burn was interrupted by a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ensureRemote = useCallback(async () => {
    if (remote && remote.deployment.id === draft.remoteId) return remote.deployment
    const data = await createRemoteDeployment(config, draft.idemKey, chain)
    setRemote({ deployment: data.deployment })
    update({ remoteId: data.deployment.id, chain })
    return data.deployment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, draft.remoteId, draft.idemKey, config, chain])

  const review = async () => {
    setError(null)
    setPrepared(null)
    setPreparedBase(null)
    setAcknowledged(false)
    if (chain === 'base' && !evm.address) return setError(new FlowError('EVM_WALLET_NOT_FOUND', 'Connect a Base wallet in the previous step.'))
    if (chain === 'solana' && !wallet.address) return setWalletOpen(true)
    setPreparing(true)
    try {
      const deployment = await ensureRemote()
      if (!deployment.burn.mint) throw new FlowError('SIMULATION_FAILED', 'The server has no QFORK token configured for this chain.')
      if (chain === 'base') {
        if (!baseStatus || !evm.address) throw new FlowError('API_UNAVAILABLE')
        setPreparedBase(
          await prepareBaseBurn({ owner: evm.address, token: deployment.burn.mint as `0x${string}`, amount: deployment.burn.required, memo: deployment.burn.memo, network: baseStatus.network, chainId: baseStatus.chainId }),
        )
      } else if (wallet.address) {
        setPrepared(await prepareBurn({ owner: wallet.address, mint: deployment.burn.mint, amount: deployment.burn.required, memo: deployment.burn.memo }))
      }
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('RPC_UNAVAILABLE'))
    } finally {
      setPreparing(false)
    }
  }

  const burn = async () => {
    if (!remote) return
    if (preparedBase) return burnOnBase(preparedBase)
    if (!prepared) return
    setError(null)
    setBurnStage('signing')
    try {
      const deploymentId = remote.deployment.id
      const sent = await signAndSend(prepared, (signature) => savePending({ deploymentId, signature, lastValidBlockHeight: prepared.lastValidBlockHeight, at: Date.now() }))
      savePending({ deploymentId, signature: sent.signature, lastValidBlockHeight: sent.lastValidBlockHeight, at: Date.now() })
      await runVerify(deploymentId, sent.signature, sent.lastValidBlockHeight)
    } catch (caught) {
      const flow = caught instanceof FlowError ? caught : new FlowError('WALLET_REJECTED')
      if (!flow.extra.signature) savePending(null)
      setError(flow)
      setBurnStage('review')
    }
  }

  const burnOnBase = async (review: PreparedBaseBurn) => {
    if (!remote) return
    setError(null)
    setBurnStage('signing')
    const deploymentId = remote.deployment.id
    try {
      const hash = await sendBaseBurn(review, (sent) => savePending({ deploymentId, signature: sent, lastValidBlockHeight: null, at: Date.now() }))
      await runVerify(deploymentId, hash, null)
    } catch (caught) {
      const flow = caught instanceof FlowError ? caught : new FlowError('WALLET_REJECTED')
      if (flow.extra.signature) {
        void runVerify(deploymentId, flow.extra.signature, null)
      } else {
        savePending(null)
      }
      setError(flow)
      setBurnStage('review')
    }
  }

  useEffect(() => {
    if (step !== 9) return
    setIntro(true)
    const id = window.setTimeout(() => setIntro(false), reduced ? 0 : 1600)
    return () => window.clearTimeout(id)
  }, [step, reduced])

  const registered = liveDeployment?.state === 'REGISTERED'
  useEffect(() => {
    if (!registered || step !== 9) return
    const id = window.setTimeout(() => {
      setRevealed(true)
      update({ step: 10 })
    }, reduced ? 0 : 700)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, step, reduced])

  const reset = () => {
    abort.current?.abort()
    setPrepared(null)
    setPreparedBase(null)
    setRemote(null)
    setRevealed(false)
    setError(null)
    scanner.reset()
    const again = blueprint && draft.blueprint ? blueprintDraft(blueprint, draft.blueprint.answers) : null
    setDraft(again ? { ...again, mode: draft.mode } : { ...freshDraft(config.profile), mode: draft.mode })
  }

  /* ---------- dock organism ---------- */

  const showBlueprint = simple && step < 5
  const ancestorView = step <= 2 && !simple
  const designed = step >= 3 || simple
  const latticeLevel = config.modules.some((id) => id === 'hsp' || id === 'lsp') ? (config.modules.includes('vid') ? 1 : 0.75) : 0.35
  const remainingParts = Array.from(new Set(remaining.map((row) => LOCUS_BY_CODE[row.code].part)))
  const dockFx: OrganismFx = ancestorView ? scanner.fx : { exposed: remainingParts, alert: 0.55, lattice: latticeLevel, scan: 0 }
  const dockGenome = ancestorView ? ancestorGenome(ancestor) : genome

  /* ---------- gating ---------- */

  const blocked: Record<number, string | null> = {
    1: draft.scanned ? null : 'Run the scan to continue.',
    4: issues.length ? 'Fix the highlighted fields.' : null,
    6: !tierAvailability[tier].available ? tierAvailability[tier].reason : null,
    7: (chain === 'base' ? !evm.address : !wallet.address) ? 'Connect a wallet to continue.' : null,
  }
  const canNext = !blocked[step] && step < 8

  const deploymentState = liveDeployment?.state ?? (intro ? 'BURN_CONFIRMED' : null)
  const reactorPhase: ReactorPhase = intro ? 'intake' : deploymentState ? (STATE_PHASE[deploymentState] ?? 'charging') : 'idle'
  const resultId = draft.remoteId
  const result = resultId ? findDescendant(registry, resultId) : null
  const receiptId = remote?.deployment.burn.signature ?? null
  const network = (liveDeployment?.burn.network ?? CLIENT_CONFIG.network) as SolanaNetwork
  const testToken = network !== 'mainnet-beta' && (network as string) !== 'base'

  return (
    <div className="lab">
      <header className="page-head lab-head">
        <p className="eyebrow">
          <span>
            {blueprint ? (
              <>
                <Link to={`/blueprints/${blueprint.slug}`}>Blueprint // {blueprint.id}</Link> ·{' '}
              </>
            ) : (
              'The lab · '
            )}
            Ancestor: {ancestor === 'base' ? 'Base' : 'Solana'} · {tier === 'mainnet' ? 'Mainnet' : `${chain === 'base' ? 'Base Sepolia' : 'Solana devnet'} · test QFORK`}
          </span>
        </p>
        <div className="lab-title">
          <h1>{simple && blueprint ? blueprint.name : choosing ? 'Build something.' : 'Design a descendant.'}</h1>
          <div className="mode-switch" role="radiogroup" aria-label="Lab mode">
            <button type="button" role="radio" aria-checked={draft.mode === 'simple'} className={draft.mode === 'simple' ? 'is-active' : ''} disabled={step >= 8} onClick={() => switchMode('simple')}>
              <strong>Simple</strong>
              <span>I know what I want to build</span>
            </button>
            <button type="button" role="radio" aria-checked={draft.mode === 'expert'} className={draft.mode === 'expert' ? 'is-active' : ''} disabled={step >= 8} onClick={() => switchMode('expert')}>
              <strong>Expert</strong>
              <span>View the cryptographic genome</span>
            </button>
          </div>
        </div>
        <nav className="step-rail" aria-label="Lab steps">
          <ol>
            {(simple || choosing ? SIMPLE_RAIL : STEPS.map((label, index) => ({ label, index }))).map(({ label, index }, position) => {
              const on = index === 0 && (simple || choosing) ? step < 5 : index === step
              const done = index === 0 && (simple || choosing) ? step >= 5 : index < step
              return (
                <li key={label} className={on ? 'is-on' : done ? 'is-done' : ''} aria-current={on ? 'step' : undefined}>
                  <button type="button" disabled={index > step || step >= 8 || (choosing && index > 0)} onClick={() => go(index)}>
                    <span>{String(position + 1).padStart(2, '0')}</span>
                    {label}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
      </header>

      <div className="lab-grid">
        <aside className="dock" aria-label="Live specimen">
          <div className="dock-stage">
            <SpecimenViewport genome={dockGenome} highlight={part} fx={dockFx} motif={showBlueprint ? (visual?.motif ?? null) : null} activity={showBlueprint ? 1 : 0} className="dock-viewport" />
            <div className="dock-top">
              <span className="tag tag-live">
                <i aria-hidden="true" />
                {showBlueprint ? 'BLUEPRINT' : ancestorView ? 'ANCESTOR' : step === 11 ? 'DESCENDANT' : 'DESCENDANT PREVIEW'}
              </span>
              <span className="dock-gen">GEN-{ancestorView ? 0 : draft.generation}</span>
            </div>
            <div className="dock-caption">
              <strong>{ancestorView ? ancestorName : config.network.name}</strong>
              <code>{ancestorView ? `MODEL v${model.model.version}` : hash ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : '…'}</code>
            </div>
          </div>
          <div className="dock-readout">
            <dl className="dock-facts">
              <div>
                <dt>Profile</dt>
                <dd>{designed ? profile.name : 'UNASSIGNED'}</dd>
              </div>
              <div>
                <dt>Modules</dt>
                <dd>{designed ? config.modules.map((id) => MODULE_BY_ID[id].code).join(' ') : '—'}</dd>
              </div>
              <div>
                <dt>Remaining classical</dt>
                <dd>{designed ? `${remaining.length} of ${diff.length} loci` : '—'}</dd>
              </div>
              <div>
                <dt>Requirement</dt>
                <dd>{designed ? `${formatNumber(quote.total)} QFORK · ESTIMATED` : '—'}</dd>
              </div>
              {compiled && (
                <div>
                  <dt>Blueprint</dt>
                  <dd>
                    <BlueprintStatusBadge status={compiled.status} />
                  </dd>
                </div>
              )}
            </dl>
            {profile.warning && designed && <p className="warn">{profile.warning}</p>}
          </div>
        </aside>

        <div className="stations">
          {choosing && step < 5 && (
            <Station index={0} title="What are you building?" lede="Pick the outcome. The compiler decides whether it needs a new network, a vault, an application or modules, and picks the cryptography. You can still change everything in Expert Mode.">
              <IntentList compact />
              <p className="muted">
                Want to compare every option? <Link to="/blueprints">See all blueprints</Link>.
              </p>
            </Station>
          )}

          {simple && step < 5 && compiled && blueprint && (
            <Station index={0} title={blueprint.headline} lede="Simple Mode. You answer plain questions; the blueprint picks the cryptography. Nothing here asks you to choose a primitive." tone={visual?.tone}>
              <BlueprintConfigurator
                compiled={compiled}
                onAnswer={answerBlueprint}
                primary={
                  <button type="button" className="btn btn-primary" disabled={!compiled.valid} onClick={() => go(5)}>
                    {encodeAnswers(compiled.answers) === encodeAnswers(compileBlueprint(blueprint).answers) && !customized ? 'Continue with recommended' : 'Continue'} <ArrowRight size={15} strokeWidth={1.8} />
                  </button>
                }
                note={
                  <>
                    {customized && <p className="callout is-warn">You changed this genome in Expert Mode. Answering a question here re-applies the blueprint and replaces those changes.</p>}
                    <AncestorRow value={ancestor} onChange={chooseAncestor} />
                    <TierPicker value={tier} availability={tierAvailability} onChange={(next) => setConfig((current) => ({ ...current, tier: next }))} />
                  </>
                }
              />
            </Station>
          )}

          {expertStep(0) && (
            <Station index={0} title="Choose an ancestor" lede="A descendant inherits everything from its ancestor except the cryptography you change.">
              <div className="ancestor-grid">
                {ANCESTORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ancestor-card ${item.id === ancestor ? 'is-active' : ''}`}
                    disabled={!item.lab}
                    aria-pressed={item.id === ancestor}
                    onClick={() => isAncestorId(item.id) && chooseAncestor(item.id)}
                  >
                    <code>{item.code}</code>
                    <strong>{item.name}</strong>
                    <Pill label={item.lab ? 'SEQUENCED' : item.status === 'AVAILABLE' ? 'SCAN ONLY' : item.status} tone={item.lab ? 'var(--lime)' : 'var(--faint)'} />
                    {item.scope && <small>{item.scope}</small>}
                  </button>
                ))}
              </div>
            </Station>
          )}

          {expertStep(1) && (
            <Station index={1} title="Scan" lede={`The beam maps every cryptographic dependency of ${ancestor === 'base' ? 'Base' : 'Solana'} onto the organism.`} tone="var(--cyan)">
              <div className="scan-panel">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={scanner.state === 'scanning'}
                  onClick={() => {
                    scanner.run()
                    update({ scanned: true })
                  }}
                >
                  {scanner.state === 'done' ? 'Scan again' : scanner.state === 'scanning' ? 'Scanning…' : 'Run quantum scan'}
                </button>
                <p className="muted">
                  {model.model.kind} v{model.model.version}, compiled {model.model.compiled}. {model.model.disclaimer}
                </p>
              </div>
              <ExposureMap findings={model.findings} loci={model.loci} revealed={scanner.revealed} />
            </Station>
          )}

          {expertStep(2) && (
            <Station index={2} title="Exposure report" lede="Select a locus for the detail. This is what a post-quantum descendant has to address." tone="var(--red)">
              <GenomeTerminal selected={locus} onSelect={setLocus} onHover={setPart} />
              <Link to="/scanner" className="btn btn-quiet btn-sm">
                Full findings with sources <ArrowRight size={13} strokeWidth={1.8} />
              </Link>
            </Station>
          )}

          {expertStep(3) && (
            <Station index={3} title="Profile" lede="A profile bundles modules. Custom lets you choose them individually; dependencies are added for you." tone={profile.color}>
              <div className="profile-pick" role="radiogroup" aria-label="Post-quantum profile">
                {PQ_PROFILES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={config.profile === item.id}
                    className={`profile-card is-selectable ${config.profile === item.id ? 'is-active' : ''} ${item.experimental ? 'is-experimental' : ''}`}
                    style={{ '--tone': item.color } as CSSProperties}
                    onClick={() => setConfig((current) => applyProfile(current, item.id))}
                  >
                    <header>
                      <code>{item.code}</code>
                      {item.warning && <Pill label={item.warning} tone="var(--red)" />}
                    </header>
                    <h3>{item.name}</h3>
                    <p>{item.summary}</p>
                    <ul>
                      {item.tradeoffs.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
              {config.profile === 'research' && (
                <p className="callout is-danger">
                  <ShieldAlert size={16} strokeWidth={1.8} /> RESEARCH PROFILE: NOT FOR PRODUCTION ASSETS. Lattice-only signatures with no classical fallback.
                  {CLIENT_CONFIG.flags.experimentalPq ? '' : ' It can be designed and exported, but not registered (ENABLE_EXPERIMENTAL_PQ is off).'}
                </p>
              )}
              {config.profile === 'custom' && (
                <div className="pq-grid pq-grid-tight">
                  {PQ_MODULES.map((module) => {
                    const selected = config.modules.includes(module.id)
                    const locked = selected && dependents(module.id, config.modules).length > 0
                    return (
                      <ModuleCard
                        key={module.id}
                        module={module}
                        scale={CHAIN_BURN_SCALE[chain]}
                        selected={selected}
                        locked={locked}
                        onToggle={() =>
                          setConfig((current) => ({
                            ...current,
                            modules: selected ? current.modules.filter((id) => id !== module.id) : ([...current.modules, module.id] as PqModuleId[]),
                            recovery: module.id === 'pqr' ? (selected ? 'none' : 'pq-commitment') : current.recovery,
                          }))
                        }
                      />
                    )
                  })}
                </div>
              )}
            </Station>
          )}

          {expertStep(4) && (
            <Station index={4} title="Configure" lede="Identity, validators, RPC, economics, privacy, recovery and deployment tier.">
              <div className="identity-row">
                <TapeInput
                  label="NETWORK NAME"
                  value={config.network.name}
                  maxLength={24}
                  onChange={(raw) => {
                    const name = raw.replace(/[^A-Z0-9 -]/g, '').replace(/\s+/g, ' ').trimStart()
                    setDraft((current) => ({
                      ...current,
                      config: {
                        ...current.config,
                        network: {
                          name,
                          symbol: current.touched.symbol ? current.config.network.symbol : symbolFrom(name),
                          networkId: current.touched.networkId ? current.config.network.networkId : networkIdFrom(name),
                        },
                      },
                    }))
                  }}
                />
                <TapeInput
                  label="SYMBOL"
                  size="sm"
                  value={config.network.symbol}
                  maxLength={6}
                  onChange={(raw) => setDraft((current) => ({ ...current, touched: { ...current.touched, symbol: true }, config: { ...current.config, network: { ...current.config.network, symbol: raw.replace(/[^A-Z0-9]/g, '') } } }))}
                />
              </div>
              <PlainInput
                label="NETWORK ID"
                value={config.network.networkId}
                maxLength={32}
                hint="Lowercase letters, numbers and dashes. The descendant’s permanent identifier."
                onChange={(networkId) => setDraft((current) => ({ ...current, touched: { ...current.touched, networkId: true }, config: { ...current.config, network: { ...current.config.network, networkId } } }))}
              />
              {issues.length > 0 && (
                <ul className="field-errors">
                  {issues.map((issue) => (
                    <li key={issue.path} className="field-error">
                      {issue.path.toUpperCase()}: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="slider-grid">
                <LabFader label="VALIDATORS" value={config.validators.count} min={4} max={128} step={4} onChange={(count) => setConfig((current) => ({ ...current, validators: { ...current.validators, count } }))} />
                <LabFader
                  label="BASE FEE"
                  value={config.economics.baseFeeLamports}
                  min={0}
                  max={50_000}
                  step={500}
                  unit={ancestor === 'base' ? 'µgwei' : 'lamports'}
                  accent="var(--cyan)"
                  onChange={(baseFeeLamports) => setConfig((current) => ({ ...current, economics: { ...current.economics, baseFeeLamports } }))}
                />
                <LabFader label="FEE BURN" value={config.economics.burnPct} min={0} max={100} step={5} unit="%" accent="var(--orange)" onChange={(burnPct) => setConfig((current) => ({ ...current, economics: { ...current.economics, burnPct } }))} />
              </div>
              <KeyBank label="VALIDATOR HARDWARE" options={HARDWARE} value={config.validators.hardware} onChange={(hardware) => setConfig((current) => ({ ...current, validators: { ...current.validators, hardware } }))} />
              <KeyBank label="RPC ACCESS" options={RPC} value={config.rpc.access} onChange={(access) => setConfig((current) => ({ ...current, rpc: { access } }))} />
              <KeyBank label="PRIVACY" options={PRIVACY} value={config.privacy} onChange={(privacy) => setConfig((current) => ({ ...current, privacy }))} />
              <KeyBank label="RECOVERY" options={RECOVERY} value={config.recovery} onChange={(recovery) => setConfig((current) => ({ ...current, recovery }))} />
              <TierPicker value={tier} availability={tierAvailability} onChange={(next) => setConfig((current) => ({ ...current, tier: next }))} />
            </Station>
          )}

          {step === 5 && (
            <Station index={5} title="Review the diff" lede={`${ancestor === 'base' ? 'Base' : 'Solana'} on the left, your descendant on the right. Unchanged rows stay classical.`} tone="var(--yellow)">
              <div className="diff" role="table" aria-label="Genome diff">
                <div className="diff-row diff-head" role="row">
                  <span role="columnheader">LOCUS</span>
                  <span role="columnheader">{ancestorName}</span>
                  <span role="columnheader">{config.network.name}</span>
                </div>
                {diff.map((row) => (
                  <div key={row.code} className={`diff-row ${row.changed ? 'is-changed' : ''}`} role="row" onMouseEnter={() => setPart(LOCUS_BY_CODE[row.code].part)} onMouseLeave={() => setPart(null)}>
                    <span role="cell">
                      <code>{row.code}</code> {row.name}
                    </span>
                    <span role="cell" className="diff-old">
                      {row.ancestor}
                    </span>
                    <span role="cell" className="diff-new">
                      {row.changed ? '+ ' : '= '}
                      {row.descendant}
                      {row.modules.length > 0 && <small> · {row.modules.map((id) => MODULE_BY_ID[id].code).join(', ')}</small>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="remaining">
                <p className="mono-label">Exposure that remains · {remaining.length}</p>
                {remaining.length ? (
                  <ul>
                    {remaining.map((row) => (
                      <li key={row.code}>
                        <code>{row.code}</code> {row.name}: still {row.ancestor}.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Every non-hash locus is addressed by a module. Addressed is not the same as secure: every module is still a design.</p>
                )}
                <p className="callout">
                  A descendant is post-quantum <i>oriented</i>, not quantum-proof. Adding ML-DSA alone does not make a chain quantum-resistant; keys, consensus, bridges, wallets and
                  external infrastructure all have to move too.
                </p>
              </div>
              <dl className="report">
                <div>
                  <dt>Genome hash</dt>
                  <dd>
                    <code>{hash || '…'}</code>
                  </dd>
                </div>
                <div>
                  <dt>Network id</dt>
                  <dd>
                    <code>{config.network.networkId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Validators</dt>
                  <dd>
                    {config.validators.count} · {config.validators.hardware}
                  </dd>
                </div>
                <div>
                  <dt>Registers on</dt>
                  <dd>{tier === 'mainnet' ? 'MAINNET' : CLIENT_CONFIG.network.toUpperCase()}</dd>
                </div>
              </dl>
            </Station>
          )}

          {step === 6 && (
            <Station index={6} title="QFORK requirement" lede={`Computed by the protocol from your configuration. Pricing is ${PRICING.status.toLowerCase()} and may change before launch.`} tone="var(--orange)">
              <table className="quote">
                <tbody>
                  {quote.lines.map((line) => (
                    <tr key={line.label}>
                      <th scope="row">{line.label}</th>
                      <td>{formatNumber(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>
                      {formatNumber(quote.total)} <small>QFORK</small>
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className="tier-explain">
                {chain === 'base' ? (
                  <p className="callout is-warn">
                    {baseStatus?.network === 'base'
                      ? `BASE · Burns ${formatNumber(quote.total)} real $QFORK on Base with the token’s burn() function, permanently. The server verifies the burn once the block is finalized, then registers the descendant.`
                      : `BASE SEPOLIA · Burns ${formatNumber(quote.total)} test QFORK on Base Sepolia. Test tokens have no value. The server verifies the burn once the block is finalized.`}
                  </p>
                ) : tier === 'testnet' ? (
                  <p className="callout is-warn">
                    {CLIENT_CONFIG.network.toUpperCase()} · Burns {formatNumber(quote.total)} devnet test QFORK for real. The server verifies the burn at finalized commitment, then
                    registers the descendant permanently. Test QFORK has no value; the next step can send you some.
                  </p>
                ) : (
                  <p className="callout is-warn">MAINNET · Burns {formatNumber(quote.total)} real $QFORK, permanently. The server verifies the burn, then registers the descendant.</p>
                )}
                <p className="muted">Registering records the design, its receipt and a developer kit, and unlocks launching its token. No chain runs a descendant yet.</p>
                {!tierAvailability[tier].available && <p className="field-error">{tierAvailability[tier].reason}</p>}
              </div>
            </Station>
          )}

          {step === 7 && (
            <Station index={7} title="Wallet" lede="Connect the wallet that will sign the burn. Quantum Fork never sees your keys." tone="var(--cyan)">
              {chain === 'base' ? (
                <>
                  <p className="muted">
                    Network: <b>{baseStatus?.network === 'base' ? 'Base' : 'Base Sepolia'}</b>. The wallet must hold at least {formatNumber(quote.total)} {tier === 'testnet' ? 'test QFORK' : 'QFORK'} on Base and a little ETH for gas. Use a regular account; smart-contract wallets cannot burn here yet.
                  </p>
                  <BaseWalletPanel />
                </>
              ) : (
                <>
              <p className="muted">
                Network: <b>{CLIENT_CONFIG.network}</b>. The wallet must hold at least {formatNumber(quote.total)} {tier === 'testnet' ? 'test QFORK' : 'QFORK'} and a little SOL for the fee.
              </p>
              {wallet.status === 'connected' ? (
                <>
                  <WalletSummary />
                  {tier === 'testnet' && <FaucetPanel need={quote.total} />}
                </>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => setWalletOpen(true)}>
                  Connect wallet
                </button>
              )}
              {wallet.error && <FailurePanel error={wallet.error} />}
                </>
              )}
            </Station>
          )}

          {step === 8 && (
            <Station index={8} title="Burn" lede="Review the exact transaction, then sign it in your wallet." tone="var(--orange)">
                <div className="burn-flow">
                  {!prepared && !preparedBase && (
                    <button type="button" className="btn btn-primary btn-lg" disabled={preparing || (chain === 'base' ? !evm.address : !wallet.address)} onClick={() => void review()}>
                      {preparing ? 'Building and dry-running…' : 'Build transaction for review'}
                    </button>
                  )}
                  {(prepared || preparedBase) && remote && (
                    <div className="sheet-overlay is-inline">
                      <div className="sheet burn-sheet">
                        {preparedBase ? <ExactBaseTransaction prepared={preparedBase} /> : prepared && <ExactTransaction prepared={prepared} network={CLIENT_CONFIG.network} />}
                        <label className="ack">
                          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={burnStage !== 'review'} />
                          <span>
                            I understand this permanently destroys {formatNumber((preparedBase ?? prepared)?.request.amount ?? 0)} {testToken ? 'test QFORK' : 'QFORK'} and cannot be undone. The descendant is registered
                            only after the server verifies the burn.
                          </span>
                        </label>
                        <div className="dialog-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={burnStage !== 'review'}
                            onClick={() => {
                              setPrepared(null)
                              setPreparedBase(null)
                            }}
                          >
                            Cancel
                          </button>
                          <HoldToBurn
                            label="SIGN & BURN"
                            size="lg"
                            disabled={!acknowledged}
                            busy={burnStage !== 'review'}
                            busyLabel={burnStage === 'signing' ? 'Waiting for wallet' : burnStage === 'confirming' ? 'Confirming on-chain' : 'Server verifying'}
                            onConfirm={() => void burn()}
                          />
                        </div>
                        {burnStage === 'verifying' && (
                          <p className="muted">
                            {preparedBase ? 'Waiting for Base to finalize the block, usually 15–30 minutes.' : 'Waiting for finalized commitment, usually under a minute.'} You can reload; verification resumes.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {burnStage !== 'review' && !prepared && <p className="muted">Resuming verification of your signed burn…</p>}
                </div>
              {error && (
                <FailurePanel
                  error={error}
                  actions={
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void review()}>
                      Retry
                    </button>
                  }
                />
              )}
            </Station>
          )}

          {step >= 9 && step <= 10 && (
            <Station index={step} title={step === 9 ? 'Verify' : 'Register'} lede="The server reads the burn from the chain, then registers the descendant." tone="var(--green)">
              <ol className="state-track" aria-label="Deployment state">
                {HAPPY_PATH.slice(2).map((state) => {
                  const current = liveDeployment?.state
                  const reached = liveDeployment?.history.some((item) => item.state === state)
                  return (
                    <li key={state} className={current === state ? 'is-on' : reached ? 'is-done' : ''}>
                      {stateLabel(state, network)}
                    </li>
                  )
                })}
              </ol>
            </Station>
          )}

          {step === 11 && result && (
            <Station index={11} title="Descendant registered." lede={`${result.code} is on the tree. Launch its token next.`} tone="var(--lime)">
              <RegisteredActions id={result.id} />
              <div className="result-card">
                <div>
                  <p className="result-kicker">REGISTERED DESCENDANT</p>
                  <h2>
                    {result.code} <em>{strainLabel(profile)}</em>
                  </h2>
                  <p className="result-meta">
                    {config.network.name} · GEN-{result.generation} · ANCESTOR: {ancestorName}
                  </p>
                  <OriginBadge origin={result.origin} />
                </div>
                <dl className="report">
                  <div>
                    <dt>Genome hash</dt>
                    <dd>
                      <code>{hash}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Burn</dt>
                    <dd>
                      {formatNumber(remote?.deployment.burn.required ?? quote.total)} {testToken ? 'test QFORK' : 'QFORK'} · VERIFIED ON {network === 'mainnet-beta' ? 'MAINNET' : network.toUpperCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>Running chain</dt>
                    <dd>Not built. The design is registered; no network runs it yet.</dd>
                  </div>
                </dl>
                <div className="result-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => navigate(`/species/${result.id}`)}>
                    Open full report
                  </button>
                  {receiptId && (
                    <button type="button" className="btn btn-secondary" onClick={() => navigate(`/burn/${receiptId}`)}>
                      Burn receipt
                    </button>
                  )}
                  {remote?.deployment.burn.signature && (
                    <a className="btn btn-secondary" href={explorerTx(remote.deployment.burn.signature, network)} target="_blank" rel="noreferrer noopener">
                      Explorer <ExternalLink size={13} strokeWidth={1.8} />
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      void copyText(
                        `REGISTERED DESCENDANT ${result.code} · ${strainLabel(profile)} · GEN-${result.generation} · ANCESTOR: ${ancestorName}\n${CLIENT_CONFIG.siteUrl}/species/${result.id}`,
                        'Descendant link copied.',
                      )
                    }
                  >
                    <Share2 size={14} strokeWidth={1.8} /> Share
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify({ ...config, genomeHash: hash }, null, 2)], { type: 'application/json' })
                      const url = URL.createObjectURL(blob)
                      const link = document.createElement('a')
                      link.href = url
                      link.download = `${config.network.networkId}.descendant.json`
                      link.click()
                      URL.revokeObjectURL(url)
                      toast('Descendant configuration exported.')
                    }}
                  >
                    <Download size={14} strokeWidth={1.8} /> Export config
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={reset}>
                    Design another
                  </button>
                </div>
              </div>
            </Station>
          )}

          {step < 8 && !((simple || choosing) && step < 5) && (
            <div className="step-nav">
              <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => go(simple && step === 5 ? 0 : step - 1)}>
                <ArrowLeft size={15} strokeWidth={1.8} /> Back
              </button>
              {blocked[step] && <span className="field-error">{blocked[step]}</span>}
              <button type="button" className="btn btn-primary" disabled={!canNext} onClick={() => go(step + 1)}>
                {STEPS[step + 1]} <ArrowRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          )}
          {step === 8 && (
            <div className="step-nav">
              <button type="button" className="btn btn-secondary" disabled={burnStage !== 'review'} onClick={() => go(7)}>
                <ArrowLeft size={15} strokeWidth={1.8} /> Back
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void copyText(JSON.stringify(config, null, 2), 'Configuration JSON copied.')}>
                <Copy size={13} strokeWidth={1.8} /> Copy configuration
              </button>
            </div>
          )}
        </div>
      </div>

      {(step === 9 || step === 10) && (
        <ChamberOverlay
          title={step === 10 ? 'Descendant registered' : stateLabel(liveDeployment?.state ?? 'BURN_CONFIRMED', network)}
          code="GN"
          done={step === 10}
          onClose={() => update({ step: 11 })}
        >
          <div className={`chamber-stage ${step === 10 ? 'is-genesis' : ''}`}>
            <ReactorViewport
              genome={genome}
              phase={reactorPhase}
              compact
              showResult={false}
              fx={{ exposed: remainingParts, alert: step === 10 ? 0.25 : 0, lattice: step === 10 || reactorPhase === 'complete' ? 1 : 0, scan: 0 }}
              dim={step === 10 ? 1 : 0}
              className="chamber-viewport chamber-viewport-reactor"
            />
          </div>
          <ol className="stages">
            {(['BURN_SUBMITTED', 'BURN_CONFIRMED', 'REGISTERED'] as const).map((state) => {
              const reached = liveDeployment?.history.some((item) => item.state === state)
              return (
                <li key={state} className={liveDeployment?.state === state ? 'is-on' : reached ? 'is-done' : ''}>
                  {stateLabel(state, network).toUpperCase()}
                </li>
              )
            })}
          </ol>
          <div className={`chamber-result genesis-reveal ${step === 10 && revealed ? 'is-shown' : ''}`} aria-live="polite">
            {step === 10 && (
              <>
                <p className="result-kicker">DESCENDANT REGISTERED.</p>
                <h2>
                  {result?.code ?? liveDeployment?.descendantId} <em>is on the tree.</em>
                </h2>
                <p className="result-meta">
                  Burn verified on {network === 'mainnet-beta' ? 'mainnet' : network} · {strainLabel(profile)} · GEN-{draft.generation} · ANCESTOR: {ancestorName}
                </p>
                {resultId && <RegisteredActions id={resultId} />}
              </>
            )}
          </div>
        </ChamberOverlay>
      )}

      {walletOpen && <WalletSheet onClose={() => setWalletOpen(false)} />}
    </div>
  )
}
