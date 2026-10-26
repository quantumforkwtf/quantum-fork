import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { OrganPart } from '../lab/morphology'
import { NET } from '../lib/networkCopy'
import { finishTour, type TourTrack as Track, useTourOpen } from '../lib/tour'
import { exposedParts, LOCI } from '../protocol/ancestors'
import { ancestorGenome, defaultConfig, toChainGenome } from '../protocol/descendant'
import { MODULE_BY_ID } from '../protocol/modules'
import { Link } from '../router'
import ChainOrganism from './ChainOrganism'

interface Step {
  kicker: string
  title: string
  body: ReactNode
  organism: 'ancestor' | 'exposed' | 'descendant'
  highlight?: OrganPart
}

const ANCESTOR = ancestorGenome()
const HYBRID = toChainGenome(defaultConfig('hybrid'))
const EXPOSED = exposedParts()

const SIMPLE: Step[] = [
  {
    kicker: 'The basics',
    title: 'Blockchains are protected by math locks.',
    body: 'Every wallet and every transaction is guarded by cryptography. Today’s locks are excellent against today’s computers.',
    organism: 'ancestor',
  },
  {
    kicker: 'The problem',
    title: 'A big quantum computer could pick some of them.',
    body: 'One that is large enough could break the kind of lock most blockchains use to prove who signed a transaction. That computer doesn’t exist yet, but blockchains take years to change.',
    organism: 'exposed',
    highlight: 'signature',
  },
  {
    kicker: 'What Quantum Fork does',
    title: 'It makes a new copy with new locks.',
    body: 'We take Solana’s design, keep what works, and swap the vulnerable locks for new post-quantum ones. Solana itself doesn’t change. You get a new chain, which we call a descendant.',
    organism: 'descendant',
  },
  {
    kicker: 'How you use it',
    title: 'Pick what you want. We handle the settings.',
    body: 'Choose what you want to build and Quantum Fork chooses the cryptography for you. If you know what you’re doing, you can still change every setting yourself.',
    organism: 'descendant',
  },
  {
    kicker: 'Honest version',
    title: NET.mainnet ? 'Registration is real. The chains are not running yet.' : 'Right now, it runs on devnet.',
    body: `You register a descendant by burning ${NET.mainnet ? '$QFORK' : 'free test tokens'}, and can launch a real token for it. No chain runs a descendant yet. “Post-quantum” means built on new security standards, not unbreakable.`,
    organism: 'descendant',
  },
]

const hybrid = MODULE_BY_ID.hsp

const TECHNICAL: Step[] = [
  {
    kicker: 'Threat model',
    title: 'Shor breaks the signatures, not the hashes.',
    body: 'A cryptographically relevant quantum computer running Shor’s algorithm breaks discrete-log and factoring schemes: Ed25519, secp256k1, BLS12-381, X25519 and RSA. Grover only gives a quadratic speedup against hashes and symmetric ciphers, so SHA-256 and AES-256 keep a wide margin.',
    organism: 'ancestor',
  },
  {
    kicker: 'Ancestor · Base',
    title: `${LOCI.length} cryptographic loci, mapped with sources.`,
    body: 'secp256k1 ECDSA transaction signatures, where the address is a Keccak-256 hash of the public key and an account key cannot rotate. A secp256k1 sequencer key, with settlement on Ethereum’s BLS12-381 validators. BN254 proofs and KZG blob commitments. X25519 transport. The scanner is mapped by hand from public sources; Solana is mapped too.',
    organism: 'exposed',
    highlight: 'signature',
  },
  {
    kicker: 'Descendants, not patches',
    title: 'A new genesis with a new genome.',
    body: 'A descendant is an independent Solana-derived network. Its genome selects modules: suite tags for crypto-agility, Ed25519 + ML-DSA-65 hybrid signatures (FIPS 204), hash-committed key sets so keys can rotate, SLH-DSA recovery (FIPS 205) and X25519MLKEM768 transport.',
    organism: 'descendant',
  },
  {
    kicker: 'Profiles and trade-offs',
    title: 'Every profile buys coverage with compatibility.',
    body: `HYBRID: both signatures must verify (${hybrid.sizeImpact}). PQ FORWARD adds post-quantum validator identity, which breaks consensus compatibility. RESEARCH is lattice-only with no classical fallback. Every module is RESEARCH or COMING SOON.`,
    organism: 'descendant',
  },
  {
    kicker: 'Burns and tiers',
    title: 'Verified server-side or not at all.',
    body: `Registration is paid by burning $QFORK on Base, a tagged transfer to the burn address 0x…dEaD, verified by the server in a finalized block and processed idempotently. ${NET.mainnet ? 'On MAINNET it burns real $QFORK.' : 'Testnet burns a test token with no value. MAINNET registration with $QFORK is not open yet.'} Descendant tokens are real Clanker tokens on Base, verified the same way.`,
    organism: 'descendant',
  },
  {
    kicker: 'What this is not',
    title: 'Not production. Not quantum-proof.',
    body: 'No post-quantum validator client exists yet, larger signatures cost throughput, and BLS vote certificates stay classical. The threat model lists every residual exposure.',
    organism: 'descendant',
  },
]

const TRACKS: Record<Track, { steps: Step[]; finish: { label: string; to: string }[] }> = {
  simple: { steps: SIMPLE, finish: [{ label: 'See what Solana is exposed to', to: '/scanner' }, { label: 'Try the lab', to: '/lab' }] },
  technical: { steps: TECHNICAL, finish: [{ label: 'Open the scanner', to: '/scanner' }, { label: 'Read the threat model', to: '/security' }] },
}

export function Tutorial() {
  return useTourOpen() ? <TourDialog /> : null
}

function TourDialog() {
  const [track, setTrack] = useState<Track | null>(null)
  const [index, setIndex] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)

  const close = useCallback((value: Track | 'skipped') => finishTour(value), [])

  const steps = track ? TRACKS[track].steps : []
  const last = index === steps.length - 1

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [track, index])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(track ?? 'skipped')
      if (!track) return
      if (event.key === 'ArrowRight' && !last) setIndex((value) => value + 1)
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1))
      if (event.key === 'Tab' && dialog.current) {
        const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
        const first = focusable[0]
        const end = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          end?.focus()
        } else if (!event.shiftKey && document.activeElement === end) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [track, last, close])

  const step = steps[index]
  return (
    <div className="tour" role="presentation">
      <div ref={dialog} className={`tour-dialog panel ${track ? 'is-touring' : 'is-choosing'}`} role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <button type="button" className="tour-skip" onClick={() => close(track ?? 'skipped')}>
          Skip tour <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>

        {!track || !step ? (
          <div className="tour-choose">
            <p className="eyebrow">Welcome to Quantum Fork</p>
            <h2 id="tour-title">
              A one-minute tour. <span>Pick your version.</span>
            </h2>
            <div className="tour-tracks">
              <button type="button" className="tour-track" data-autofocus onClick={() => setTrack('simple')} style={{ '--tone': 'var(--lime)' } as CSSProperties}>
                <span className="mono-label">Simple · {SIMPLE.length} steps</span>
                <strong>Explain it like I’m new.</strong>
                <span>Plain English. No jargon, no maths.</span>
                <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" className="tour-track" onClick={() => setTrack('technical')} style={{ '--tone': 'var(--cyan)' } as CSSProperties}>
                <span className="mono-label">Technical · {TECHNICAL.length} steps</span>
                <strong>Give me the real thing.</strong>
                <span>Primitives, standards, trade-offs and the threat model.</span>
                <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="tour-step">
            <div className="tour-visual" aria-hidden="true">
              <ChainOrganism genome={step.organism === 'descendant' ? HYBRID : ANCESTOR} highlight={step.highlight ?? (step.organism === 'exposed' ? EXPOSED[0] : null)} />
              <span className="tour-visual-tag">{step.organism === 'descendant' ? 'DESCENDANT · HYBRID PQ' : step.organism === 'exposed' ? 'ANCESTOR · EXPOSED' : 'ANCESTOR · BASE'}</span>
            </div>
            <div className="tour-copy" aria-live="polite">
              <p className="mono-label">
                {track === 'simple' ? 'Simple' : 'Technical'} · {String(index + 1).padStart(2, '0')}/{String(steps.length).padStart(2, '0')} · {step.kicker}
              </p>
              <h2 id="tour-title">{step.title}</h2>
              <p className="tour-body">{step.body}</p>
              <ol className="tour-dots" aria-hidden="true">
                {steps.map((item, position) => (
                  <li key={item.title} className={position === index ? 'is-on' : position < index ? 'is-done' : ''} />
                ))}
              </ol>
              <div className="tour-actions">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => (index === 0 ? setTrack(null) : setIndex(index - 1))}>
                  <ArrowLeft size={14} strokeWidth={1.8} /> {index === 0 ? 'Change version' : 'Back'}
                </button>
                {last ? (
                  <div className="tour-finish">
                    {TRACKS[track].finish.map((item, position) => (
                      <Link key={item.to} to={item.to} className={`btn ${position === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => close(track)} {...(position === 0 ? { 'data-autofocus': true } : {})}>
                        {item.label} {position === 0 && <ArrowRight size={14} strokeWidth={1.8} />}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" data-autofocus onClick={() => setIndex(index + 1)}>
                    Next <ArrowRight size={14} strokeWidth={1.8} />
                  </button>
                )}
              </div>
              {track === 'simple' && index === 0 && (
                <button type="button" className="tour-switch" onClick={() => setTrack('technical')}>
                  Too basic? Switch to the technical version
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
