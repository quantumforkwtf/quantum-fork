import { Flame } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/hooks'
import { play } from '../lib/sound'

interface HoldToBurnProps {
  label: string
  busyLabel?: string
  onConfirm: () => void
  disabled?: boolean
  busy?: boolean
  holdMs?: number
  size?: 'md' | 'lg'
  hint?: string
}

/** Press-and-hold confirmation. Releasing early cancels; Enter or Space works the same way. */
export default function HoldToBurn({ label, busyLabel = 'Burning', onConfirm, disabled = false, busy = false, holdMs = 900, size = 'md', hint = 'Hold to confirm' }: HoldToBurnProps) {
  const reduced = usePrefersReducedMotion()
  const [progress, setProgress] = useState(0)
  const frame = useRef(0)
  const start = useRef(0)
  const holding = useRef(false)
  const duration = reduced ? 350 : holdMs

  const stop = useCallback(() => {
    holding.current = false
    cancelAnimationFrame(frame.current)
    setProgress(0)
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const begin = () => {
    if (disabled || busy || holding.current) return
    holding.current = true
    start.current = performance.now()
    play('click')
    const tick = (now: number) => {
      if (!holding.current) return
      const value = Math.min(1, (now - start.current) / duration)
      setProgress(value)
      if (value >= 1) {
        holding.current = false
        setProgress(0)
        onConfirm()
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  return (
    <button
      type="button"
      className={`hold hold-${size} ${progress > 0 ? 'is-holding' : ''} ${busy ? 'is-busy' : ''}`}
      style={{ '--hold': progress } as CSSProperties}
      disabled={disabled || busy}
      aria-label={busy ? busyLabel : `${label}. ${hint}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        begin()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault()
          begin()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') stop()
      }}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-icon" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" className="hold-track" />
          <circle cx="18" cy="18" r="16" className="hold-ring" pathLength={1} />
        </svg>
        <Flame size={size === 'lg' ? 17 : 15} strokeWidth={1.8} />
      </span>
      <span className="hold-text">
        <span className="hold-label">{busy ? busyLabel : label}</span>
        {!busy && <span className="hold-hint">{progress > 0 ? 'Keep holding' : hint}</span>}
      </span>
    </button>
  )
}
