import type { AncestorId } from './ancestors.js'
import { BASE_CHAIN_ID, BASE_PUBLIC_RPC, type BaseNetwork, type Chain } from './base.js'
import type { DescendantConfig } from './descendant.js'
import { moduleFor } from './modules.js'
import { PROFILE_BY_ID } from './profiles.js'

/**
 * The developer kit for one registered descendant: public configuration only.
 * Nothing here ever contains a private key, seed phrase, API secret or
 * infrastructure credential. Everything it points at exists: the chain the
 * burn and tokens live on (Base or Solana), and the token contracts themselves.
 */

export type KitCluster = 'devnet' | 'testnet' | 'mainnet-beta'

export interface DevKitToken {
  name: string
  symbol: string
  decimals: number
  /** SPL mint on Solana, ERC-20 contract address on Base. */
  mint: string
  kind: 'spl' | 'pumpfun' | 'clanker'
  cluster: KitCluster | BaseNetwork
}

export interface DevKitInput {
  id: string
  code: string
  config: DescendantConfig
  generation: number
  parent: string
  registeredAt: string | null
  /** Chain the burn and tokens live on. */
  chain: Chain
  cluster: KitCluster
  baseNetwork: BaseNetwork
  burnSignature: string | null
  tokens: DevKitToken[]
  siteUrl: string
}

/** The network name the kit points at: a Base network or a Solana cluster. */
export const kitNetwork = (input: Pick<DevKitInput, 'chain' | 'cluster' | 'baseNetwork'>) => (input.chain === 'base' ? input.baseNetwork : input.cluster)

export const kitRpc = (input: Pick<DevKitInput, 'chain' | 'cluster' | 'baseNetwork'>) => (input.chain === 'base' ? BASE_PUBLIC_RPC[input.baseNetwork] : CLUSTER_RPC[input.cluster])

export const CLUSTER_RPC: Record<KitCluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
}

const cliCluster = (cluster: KitCluster) => (cluster === 'mainnet-beta' ? 'mainnet-beta' : cluster)

export interface DescendantManifest {
  spec: 'qfork.descendant/v1'
  code: string
  networkId: string
  name: string
  ancestor: AncestorId
  parent: string
  generation: number
  registered: string | null
  status: 'REGISTERED'
  registration: { chain: Chain; network: string; burnSignature: string | null }
  design: {
    nativeSymbol: string
    profile: string
    modules: { code: string; name: string; status: string }[]
    validators: { count: number; hardware: string }
    note: string
  }
  tokens: DevKitToken[]
  profile: string
}

export function descendantManifest(input: DevKitInput): DescendantManifest {
  const { config } = input
  return {
    spec: 'qfork.descendant/v1',
    code: input.code,
    networkId: config.network.networkId,
    name: config.network.name,
    ancestor: config.ancestor,
    parent: input.parent,
    generation: input.generation,
    registered: input.registeredAt,
    status: 'REGISTERED',
    registration: { chain: input.chain, network: kitNetwork(input), burnSignature: input.burnSignature },
    design: {
      nativeSymbol: config.network.symbol,
      profile: PROFILE_BY_ID[config.profile].name,
      modules: config.modules.map((id) => moduleFor(id, config.ancestor)).map((module) => ({ code: module.code, name: module.name, status: module.status })),
      validators: { count: config.validators.count, hardware: config.validators.hardware },
      note: `A registered design. No chain runs this configuration yet; its burn and tokens live on ${input.chain === 'base' ? 'Base' : 'Solana'}. Module statuses are design statuses.`,
    },
    tokens: input.tokens,
    profile: `${input.siteUrl}/species/${input.id}`,
  }
}

const envKey = (symbol: string) => symbol.replace(/[^A-Z0-9]/g, '_')

export function envExample(input: DevKitInput) {
  if (input.chain === 'base') {
    const lines = [
      `# ${input.code} · ${input.config.network.name}`,
      '# Public configuration only. Never put a private key or seed phrase in this file.',
      '',
      `QF_DESCENDANT=${input.code}`,
      `QF_BASE_NETWORK=${input.baseNetwork}`,
      `QF_BASE_CHAIN_ID=${BASE_CHAIN_ID[input.baseNetwork]}`,
      `QF_BASE_RPC=${BASE_PUBLIC_RPC[input.baseNetwork]}`,
    ]
    if (input.tokens.length) {
      lines.push('', '# Token contracts on Base')
      for (const token of input.tokens) lines.push(`QF_TOKEN_${envKey(token.symbol)}=${token.mint}`)
    }
    return `${lines.join('\n')}\n`
  }
  const lines = [
    `# ${input.code} · ${input.config.network.name}`,
    '# Public configuration only. Never put a private key or seed phrase in this file.',
    '',
    `QF_DESCENDANT=${input.code}`,
    `QF_CLUSTER=${input.cluster}`,
    `QF_SOLANA_RPC=${CLUSTER_RPC[input.cluster]}`,
  ]
  if (input.tokens.length) {
    lines.push('', '# Token mints on Solana')
    for (const token of input.tokens) lines.push(`QF_TOKEN_${envKey(token.symbol)}=${token.mint}`)
  }
  return `${lines.join('\n')}\n`
}

export function sdkConfig(input: DevKitInput) {
  const first = input.tokens[0]
  if (input.chain === 'base') {
    const chain = input.baseNetwork === 'base' ? 'base' : 'baseSepolia'
    return `// ${input.code} · uses viem against ${input.baseNetwork === 'base' ? 'Base' : 'Base Sepolia'}, where this descendant's
// burn and tokens live. Keys stay in your wallet, never here.
import { createPublicClient, erc20Abi, http, type Address } from 'viem'
import { ${chain} } from 'viem/chains'
import descendant from './descendant.json'

export const client = createPublicClient({ chain: ${chain}, transport: http(process.env.QF_BASE_RPC ?? '${BASE_PUBLIC_RPC[input.baseNetwork]}') })

export const tokens = Object.fromEntries(descendant.tokens.map((token) => [token.symbol, token.mint as Address]))
${first ? `\n// Example: read ${first.symbol}'s supply.\n// const supply = await client.readContract({ address: tokens.${envKey(first.symbol)}, abi: erc20Abi, functionName: 'totalSupply' })\n` : ''}
export { descendant }
`
  }
  return `// ${input.code} · uses @solana/web3.js against Solana ${input.cluster}, where this descendant's
// burn and tokens live. Keys stay in your wallet or keypair file, never here.
import { Connection, PublicKey } from '@solana/web3.js'
import descendant from './descendant.json'

export const connection = new Connection(process.env.QF_SOLANA_RPC ?? '${CLUSTER_RPC[input.cluster]}', 'confirmed')

export const tokens = Object.fromEntries(descendant.tokens.map((token) => [token.symbol, new PublicKey(token.mint)]))
${first ? `\n// Example: read ${first.symbol}'s supply.\n// const supply = await connection.getTokenSupply(tokens.${envKey(first.symbol)})\n` : ''}
export { descendant }
`
}

export interface QuickstartStep {
  id: 'connect' | 'token' | 'balance' | 'transfer'
  title: string
  detail: string
  commands: string[]
}

/** Standard CLI commands against the chain this descendant's tokens live on: Foundry's cast on Base, the Solana CLI on Solana. Every one works today. */
export function quickstart(input: Pick<DevKitInput, 'chain' | 'cluster' | 'baseNetwork' | 'tokens'>): QuickstartStep[] {
  if (input.chain === 'base') {
    const rpc = BASE_PUBLIC_RPC[input.baseNetwork]
    const token = input.tokens[0]?.mint ?? '<TOKEN_ADDRESS>'
    return [
      { id: 'connect', title: 'Connect', detail: `Point Foundry's cast at ${input.baseNetwork}.`, commands: [`cast chain-id --rpc-url ${rpc}`, `cast block-number --rpc-url ${rpc}`] },
      { id: 'token', title: 'Inspect a token', detail: 'Name, supply and decimals, read from the contract.', commands: [`cast call ${token} "name()(string)" --rpc-url ${rpc}`, `cast call ${token} "totalSupply()(uint256)" --rpc-url ${rpc}`] },
      { id: 'balance', title: 'Check a balance', detail: 'Any address’s balance of the token.', commands: [`cast call ${token} "balanceOf(address)(uint256)" <YOUR_ADDRESS> --rpc-url ${rpc}`] },
      { id: 'transfer', title: 'Send tokens', detail: 'Signs with your own encrypted Foundry keystore. Keep it on your machine.', commands: [`cast send ${token} "transfer(address,uint256)" <RECIPIENT_ADDRESS> 10ether --rpc-url ${rpc} --account <YOUR_KEYSTORE>`] },
    ]
  }
  const url = cliCluster(input.cluster)
  const mint = input.tokens[0]?.mint ?? '<TOKEN_MINT>'
  return [
    { id: 'connect', title: 'Connect', detail: `Point the Solana CLI at ${input.cluster}.`, commands: [`solana config set --url ${url}`, 'solana cluster-version'] },
    { id: 'token', title: 'Inspect a token', detail: 'Mint authority, supply and decimals, read from the chain.', commands: [`spl-token display ${mint}`, `spl-token supply ${mint}`] },
    { id: 'balance', title: 'Check a balance', detail: 'Your balance of the token, and the token accounts you hold.', commands: [`spl-token balance ${mint}`, 'spl-token accounts'] },
    { id: 'transfer', title: 'Send tokens', detail: 'Signs with your local keypair. Keep it on your machine.', commands: [`spl-token transfer ${mint} 10 <RECIPIENT_ADDRESS> --fund-recipient`] },
  ]
}

export interface DevKitFile {
  name: string
  type: string
  contents: string
}

export function devKitFiles(input: DevKitInput): DevKitFile[] {
  return [
    { name: 'descendant.json', type: 'application/json', contents: `${JSON.stringify(descendantManifest(input), null, 2)}\n` },
    { name: '.env.example', type: 'text/plain', contents: envExample(input) },
    { name: 'qfork.config.ts', type: 'text/plain', contents: sdkConfig(input) },
  ]
}

const SECRET_PATTERNS = [/private[_ ]?key/i, /secret[_ ]?key/i, /seed[_ ]?phrase/i, /mnemonic/i, /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/, /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/]

/** Defense in depth: refuses to produce a file that looks like it holds key material. Burn signatures are public and allowed. */
export function assertNoSecrets(files: DevKitFile[], allowed: string[] = []) {
  for (const file of files) {
    let body = file.contents.replace(/Never put a private key or seed phrase in this file\./g, '')
    for (const value of allowed) body = body.split(value).join('')
    for (const pattern of SECRET_PATTERNS) if (pattern.test(body)) throw new Error(`${file.name} looks like it contains key material.`)
  }
  return files
}
