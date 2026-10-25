import { useEffect, useRef, useState } from 'react'
import { type ChainGenome, fingerprint } from '../lab/genome'
import type { OrganPart } from '../lab/morphology'
import type { ReactorPhase } from '../lab/protocol'
import { type Engine, loadEngine, useWebGL, webglFailed } from '../lib/engine'
import { useSeen } from '../lib/hooks'
import { type LayerSpec, type MotifKind, NO_FX, type OrganismFx, type SpecimenMode } from '../three/types'
import ChainOrganism from './ChainOrganism'

/** Mounts a three.js scene on a canvas once; the engine chunk loads on demand. */
function useScene<C extends { dispose(): void }>(create: (engine: Engine, canvas: HTMLCanvasElement) => C) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const createRef = useRef(create)
  createRef.current = create
  const [controller, setController] = useState<C | null>(null)

  useEffect(() => {
    let cancelled = false
    let instance: C | null = null
    const canvas = canvasRef.current
    const lost = (event: Event) => {
      event.preventDefault()
      webglFailed('WebGL context lost')
    }
    canvas?.addEventListener('webglcontextlost', lost)
    loadEngine()
      .then((loaded) => {
        if (cancelled || !canvasRef.current) return
        try {
          instance = createRef.current(loaded, canvasRef.current)
        } catch (error) {
          webglFailed(`3D scene failed to start: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        setController(instance)
      })
      .catch((error: unknown) => webglFailed(`3D engine failed to load: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      cancelled = true
      canvas?.removeEventListener('webglcontextlost', lost)
      instance?.dispose()
      setController(null)
    }
  }, [])

  return { canvasRef, controller }
}

interface SpecimenViewportProps {
  genome: ChainGenome
  highlight?: OrganPart | null
  mode?: SpecimenMode
  modeColor?: string
  interactive?: boolean
  zoom?: number
  flash?: boolean
  fx?: OrganismFx
  motif?: MotifKind | null
  activity?: number
  layers?: LayerSpec[]
  className?: string
  label?: string
}

const NO_LAYERS: LayerSpec[] = []
const layersKey = (layers: LayerSpec[]) => layers.map((layer) => `${layer.key}:${layer.count ?? ''}:${layer.activity ?? ''}`).join('|')

const fxKey = (fx: OrganismFx) => `${fx.exposed.join(',')}|${fx.alert.toFixed(2)}|${fx.lattice.toFixed(2)}|${fx.scan}`

/** Pushes overlay changes to a mounted controller, keyed by value rather than identity. */
function useFx(controller: { setFx(fx: OrganismFx): void } | null, fx: OrganismFx) {
  const latest = useRef(fx)
  latest.current = fx
  const key = fxKey(fx)
  useEffect(() => {
    controller?.setFx(latest.current)
  }, [controller, key])
}

export function SpecimenViewport(props: SpecimenViewportProps) {
  const webgl = useWebGL()
  if (!webgl) {
    return (
      <div className={`viewport viewport-fallback ${props.className ?? ''}`}>
        <ChainOrganism genome={props.genome} highlight={props.highlight ?? null} />
      </div>
    )
  }
  return <SpecimenCanvas {...props} />
}

function SpecimenCanvas({ genome, highlight = null, mode = 'idle', modeColor, interactive = true, zoom, flash = true, fx = NO_FX, motif = null, activity = 0, layers = NO_LAYERS, className = '', label }: SpecimenViewportProps) {
  const fp = fingerprint(genome)
  const latest = useRef({ genome, highlight, fp, fx, motif, activity, layers })
  latest.current = { genome, highlight, fp, fx, motif, activity, layers }
  const shown = useRef(fp)
  const { canvasRef, controller } = useScene((three, canvas) =>
    three.mountSpecimen(canvas, { genome: latest.current.genome, highlight: latest.current.highlight, interactive, zoom, fx: latest.current.fx, motif: latest.current.motif, activity: latest.current.activity, layers: latest.current.layers }),
  )
  useFx(controller, fx)

  const layerKey = layersKey(layers)
  useEffect(() => {
    controller?.setLayers(latest.current.layers)
  }, [controller, layerKey])

  useEffect(() => {
    controller?.setMotif(motif)
  }, [controller, motif])

  useEffect(() => {
    controller?.setActivity(activity)
  }, [controller, activity])

  useEffect(() => {
    if (!controller || shown.current === fp) return
    shown.current = fp
    controller.setGenome(latest.current.genome, { flash })
  }, [controller, fp, flash])

  useEffect(() => {
    controller?.setHighlight(highlight)
  }, [controller, highlight])

  useEffect(() => {
    controller?.setMode(mode, modeColor ? parseInt(modeColor.slice(1), 16) : undefined)
  }, [controller, mode, modeColor])

  return (
    <div className={`viewport ${controller ? 'is-ready' : ''} ${interactive ? 'is-interactive' : ''} ${className}`}>
      <canvas ref={canvasRef} role="img" aria-label={label ?? `${genome.identity.name} organism, rendered in 3D`} />
    </div>
  )
}

interface ReactorViewportProps {
  genome: ChainGenome
  phase: ReactorPhase
  framing?: 'right' | 'center'
  compact?: boolean
  showResult?: boolean
  fx?: OrganismFx
  dim?: number
  motif?: MotifKind | null
  /** Fold the organism away and regrow it when the genome changes. */
  softGenome?: boolean
  className?: string
}

export function ReactorViewport({ genome, phase, framing = 'center', compact = false, showResult = true, fx = NO_FX, dim = 0, motif = null, softGenome = false, className = '' }: ReactorViewportProps) {
  const webgl = useWebGL()
  if (!webgl) {
    return (
      <div className={`viewport viewport-fallback is-${framing} ${className}`}>
        {showResult || phase === 'complete' ? <ChainOrganism genome={genome} /> : <span className="viewport-wait">Reaction in progress</span>}
      </div>
    )
  }
  return <ReactorCanvas genome={genome} phase={phase} framing={framing} compact={compact} showResult={showResult} fx={fx} dim={dim} motif={motif} softGenome={softGenome} className={className} />
}

function ReactorCanvas({ genome, phase, framing, compact, showResult, fx, dim, motif, softGenome, className }: Required<ReactorViewportProps>) {
  const fp = fingerprint(genome)
  const latest = useRef({ genome, phase, showResult, fp, fx, motif, softGenome })
  latest.current = { genome, phase, showResult, fp, fx, motif, softGenome }
  const shown = useRef(fp)
  const { canvasRef, controller } = useScene((three, canvas) =>
    three.mountReactor(canvas, {
      genome: latest.current.genome,
      phase: latest.current.phase,
      framing,
      compact,
      showResult: latest.current.showResult,
      fx: latest.current.fx,
      motif: latest.current.motif,
    }),
  )
  useFx(controller, fx)

  useEffect(() => {
    controller?.setMotif(motif)
  }, [controller, motif])

  useEffect(() => {
    controller?.setDim(dim)
  }, [controller, dim])

  useEffect(() => {
    controller?.setPhase(phase)
  }, [controller, phase])

  useEffect(() => {
    if (!controller || shown.current === fp) return
    shown.current = fp
    controller.setGenome(latest.current.genome, { soft: latest.current.softGenome })
  }, [controller, fp])

  useEffect(() => {
    controller?.setFraming(framing)
  }, [controller, framing])

  return (
    <div className={`viewport viewport-reactor ${controller ? 'is-ready' : ''} ${className}`}>
      <canvas ref={canvasRef} role="img" aria-label="Quantum reactor, rendered in 3D" />
    </div>
  )
}

/** Static 3D render, produced off-screen and cached by genome fingerprint. */
export function OrganismThumb({ genome, size = 240, className = '', motif = null, fx = NO_FX }: { genome: ChainGenome; size?: number; className?: string; motif?: MotifKind | null; fx?: OrganismFx }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useSeen(ref, '200px')
  const fp = `${fingerprint(genome)}|${motif ?? ''}|${fxKey(fx)}`
  const [image, setImage] = useState<{ fp: string; url: string } | null>(null)
  const supported = useWebGL()

  useEffect(() => {
    if (!seen || !supported) return
    let cancelled = false
    void loadEngine()
      .then((three) => (motif ? three.renderBlueprintSnapshot(genome, motif, fx, size) : three.renderOrganismSnapshot(genome, size)))
      .then((url) => {
        if (!cancelled) setImage({ fp, url })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // genome, motif and fx identity are captured by the combined fingerprint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, fp, size, supported])

  const current = image?.fp === fp ? image.url : null
  return (
    <span ref={ref} className={`thumb ${current ? 'is-ready' : ''} ${className}`}>
      {!supported ? (
        <ChainOrganism genome={genome} animated={false} />
      ) : current ? (
        <img src={current} alt="" draggable={false} />
      ) : (
        <span className="thumb-wait" aria-hidden="true" />
      )}
    </span>
  )
}
