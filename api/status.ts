import { baseAvailability } from '../src/protocol/base.js'
import { tierAvailability } from '../src/protocol/config.js'
import { faucetAvailability } from './_lib/faucet.js'
import { json, rateLimit, route } from './_lib/http.js'

export const { GET, POST } = route('status', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const { config, issues } = context.env
    return json({
      network: config.network,
      mint: config.mint,
      tokenStatus: config.tokenStatus,
      pumpfunUrl: config.pumpfunUrl,
      flags: config.flags,
      storage: { kind: context.store.kind, persistent: context.store.persistent },
      tiers: {
        testnet: context.store.persistent
          ? tierAvailability(config, 'testnet')
          : { available: false, reason: 'Server storage is not configured, so burn receipts cannot be kept. Registration is switched off.' },
        mainnet: context.store.persistent
          ? tierAvailability(config, 'mainnet')
          : { available: false, reason: 'Server storage is not configured, so burn receipts cannot be kept. Registration is switched off.' },
      },
      base: {
        network: context.env.base.network,
        chainId: context.env.base.chainId,
        token: context.env.base.token,
        tokenStatus: context.env.base.tokenStatus,
        tradeUrl: context.env.base.tradeUrl,
        clankerLaunch: context.env.base.clankerLaunch,
        registry: context.env.base.registry,
        registration: baseAvailability(context.env.base, context.store.persistent),
      },
      faucet: faucetAvailability(context),
      issues: issues.map((issue) => ({ key: issue.key, level: issue.level, message: issue.message })),
      audit: 'UNAUDITED',
      time: new Date().toISOString(),
    })
  },
})
