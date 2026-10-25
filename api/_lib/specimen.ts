import { type DeploymentRecord, stateLabel } from '../../src/protocol/deployment.js'
import { EXAMPLE_SPECS } from '../../src/protocol/examples.js'
import { formatBaseUnits } from '../../src/protocol/pricing.js'
import { PROFILE_BY_ID, strainLabel } from '../../src/protocol/profiles.js'
import type { BurnReceipt } from '../../src/protocol/receipt.js'
import type { TokenMetadataJson } from '../../src/protocol/tokens.js'
import { isSignature } from '../../src/protocol/address.js'
import { ANCESTOR_NAME } from '../../src/protocol/ancestors.js'
import { isTxHash } from '../../src/protocol/base.js'
import { recommendedStatus } from '../../src/protocol/blueprintCompiler.js'
import { BLUEPRINTS, findBlueprint } from '../../src/protocol/blueprints.js'
import { getJson, keys, type Store } from './store.js'

/** What a share card and page metadata say about a route. Never invents data it cannot read. */
export interface Card {
  kicker: string
  title: string
  subtitle: string
  lines: string[]
  tone: 'lime' | 'orange' | 'cyan' | 'green' | 'yellow' | 'purple' | 'red' | 'steel' | 'muted'
  description: string
  /** The page title, when it differs from the card's display title. */
  pageTitle?: string
}

/** Blueprint cards are static: everything comes from the catalogue and the compiler's status. */
export function blueprintCard(slug: string): Card | null {
  const blueprint = findBlueprint(slug)
  if (!blueprint) return null
  const status = recommendedStatus(blueprint)
  return {
    kicker: `BLUEPRINT // ${blueprint.id} · ${blueprint.category === 'NETWORK' ? 'NEW NETWORK' : blueprint.category === 'APPLICATION' ? 'APPLICATION' : 'EXPERT MODE'}`,
    title: blueprint.name.toUpperCase(),
    subtitle: `STATUS: ${status}`,
    lines: [blueprint.headline, `IDEAL FOR ${blueprint.idealFor.slice(0, 3).join(' · ')}`],
    tone: blueprint.tone,
    description: `${blueprint.headline} Status: ${status}.`,
    pageTitle: `${blueprint.name} blueprint`,
  }
}

export function pageCard(kind: 'blueprints' | 'build'): Card {
  return kind === 'blueprints'
    ? {
        kicker: `BLUEPRINTS · ${BLUEPRINTS.length} ON FILE`,
        title: 'Build for the quantum future.',
        subtitle: 'NO CODE REQUIRED',
        lines: ['Every blueprint shows its real status.'],
        tone: 'lime',
        description: 'Choose what you want to build. Quantum Fork configures the supported cryptography, network architecture and infrastructure.',
      }
    : {
        kicker: 'BUILD SOMETHING · SIMPLE MODE',
        title: 'What do you want to build?',
        subtitle: 'PICK A GOAL. THE BLUEPRINT PICKS THE CRYPTOGRAPHY.',
        lines: ['Expert Mode is one click away.'],
        tone: 'lime',
        description: 'Tell Quantum Fork what you want to build. It picks the blueprint and configures the cryptography for you.',
      }
}

export async function speciesCard(store: Store, id: string): Promise<Card | null> {
  if (id === 'base') {
    return {
      kicker: 'ANCESTOR 001',
      title: 'BASE',
      subtitle: 'ANCESTOR // GEN-0 · CLASSICAL CRYPTOGRAPHY',
      lines: ['secp256k1 ECDSA signatures', 'Quantum exposure map available'],
      tone: 'cyan',
      description: 'Base’s cryptographic genome: every quantum-relevant dependency, sourced.',
    }
  }
  if (id === 'solana') {
    return {
      kicker: 'ANCESTOR 002',
      title: 'SOLANA',
      subtitle: 'ANCESTOR // GEN-0 · CLASSICAL CRYPTOGRAPHY',
      lines: ['Ed25519 signatures', 'Quantum exposure map available'],
      tone: 'cyan',
      description: 'Solana’s cryptographic genome: every quantum-relevant dependency, sourced.',
    }
  }
  const example = EXAMPLE_SPECS.find((spec) => spec.id === id)
  if (example) {
    const profile = PROFILE_BY_ID[example.config.profile]
    return {
      kicker: `${example.code} · EXAMPLE DATA`,
      title: example.config.network.name,
      subtitle: `${strainLabel(profile)} · GEN-${example.generation} · ANCESTOR: ${ANCESTOR_NAME[example.config.ancestor]}`,
      lines: [profile.summary],
      tone: 'muted',
      description: `Example descendant (${profile.name} profile). Illustrative only; never deployed.`,
    }
  }
  if (/^dep_[a-z0-9]{16,32}$/.test(id) && store.persistent) {
    const record = await getJson<DeploymentRecord>(store, keys.deployment(id))
    if (!record) return null
    const profile = PROFILE_BY_ID[record.config.profile]
    return {
      kicker: `REGISTERED DESCENDANT · ${record.burn.network === 'mainnet-beta' ? 'MAINNET' : (record.burn.network ?? 'devnet').toUpperCase()}`,
      title: `${record.descendantId} ${record.config.network.name}`,
      subtitle: `${strainLabel(profile)} · GEN-1 · ANCESTOR: ${ANCESTOR_NAME[record.config.ancestor]}`,
      lines: [
        `STATUS: ${stateLabel(record.state, record.burn.network).toUpperCase()}`,
        record.burn.receiptId ? (record.tier === 'testnet' ? 'BURN VERIFIED · DEVNET TEST QFORK' : 'BURN VERIFIED ON-CHAIN') : 'BURN NOT VERIFIED',
      ],
      tone: 'lime',
      description: `${record.descendantId} — a ${profile.name} post-quantum-oriented descendant of ${record.config.ancestor === 'base' ? 'Base' : 'Solana'}, registered by a verified QFORK burn.`,
    }
  }
  return null
}

export async function burnCard(store: Store, id: string): Promise<Card | null> {
  if (!(isSignature(id) || isTxHash(id)) || !store.persistent) return null
  const receipt = await getJson<BurnReceipt>(store, keys.receipt(id))
  if (!receipt) return null
  const amount = formatBaseUnits(receipt.amountRaw, receipt.decimals)
  return {
    kicker: `BURN VERIFIED · ${receipt.network.toUpperCase()}`,
    title: `${amount} QFORK`,
    subtitle: `${receipt.purpose} · ${receipt.descendantId} · ANCESTOR: ${ANCESTOR_NAME[receipt.ancestor] ?? 'SOLANA'}`,
    lines: [`SIGNATURE ${id.slice(0, 8)}…${id.slice(-8)}`, receipt.network === 'devnet' || receipt.network === 'base-sepolia' ? 'TESTNET TOKEN · NO VALUE' : receipt.chain === 'base' ? 'ERC-20 BURN · SUPPLY REDUCED' : 'SPL BURN · SUPPLY REDUCED'],
    tone: 'green',
    description: `${amount} QFORK burned ${receipt.chain === 'base' ? 'with an ERC-20 burn on Base' : 'with the SPL burn instruction'} for ${receipt.descendantId}. Verified on-chain by the server.`,
  }
}

/** Square token image: what a token's metadata `image` points at. */
export async function tokenCard(store: Store, mint: string): Promise<{ symbol: string; name: string; descendant: string } | null> {
  if (!store.persistent) return null
  const meta = await getJson<TokenMetadataJson>(store, keys.meta(mint))
  if (!meta) return null
  return { symbol: meta.symbol, name: meta.name, descendant: meta.attributes.find((item) => item.trait_type === 'Descendant')?.value ?? '' }
}
