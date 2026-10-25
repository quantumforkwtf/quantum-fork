import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'

interface ChamberOverlayProps {
  title: string
  code: string
  done: boolean
  onClose: () => void
  children: ReactNode
  tone?: 'lime' | 'orange' | 'cyan'
}

export default function ChamberOverlay({ title, code, done, onClose, children, tone = 'lime' }: ChamberOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const panel = ref.current
    if (!done || !panel || panel.scrollHeight <= panel.clientHeight) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(() => panel.scrollTo({ top: panel.scrollHeight, behavior: reduced ? 'auto' : 'smooth' }), 350)
    return () => window.clearTimeout(id)
  }, [done])

  useEffect(() => {
    if (!done) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, onClose])

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} className={`chamber tone-${tone} ${done ? 'is-done' : ''}`} tabIndex={-1}>
        <header className="chamber-head">
          <span className="chamber-title">
            <code>{code}</code>
            {title}
          </span>
          {done ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={1.8} />
            </button>
          ) : (
            <span className="chamber-live">
              <i aria-hidden="true" />
              Live
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}
