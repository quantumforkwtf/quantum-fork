import { type CSSProperties, type KeyboardEvent, useId } from 'react'
import type { Choice } from '../lab/genome'
import { play } from '../lib/sound'

function useRadioKeys<T extends string | number>(options: Choice<T>[], value: T, onChange: (value: T) => void) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const select = (next: number) => {
    const wrapped = (next + options.length) % options.length
    if (options[wrapped].value === value) return
    play('click')
    onChange(options[wrapped].value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !back) return
    event.preventDefault()
    const next = (index + (forward ? 1 : -1) + options.length) % options.length
    select(next)
    const group = event.currentTarget
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }
  return { index, select, onKeyDown }
}

interface KeyBankProps<T extends string | number> {
  label: string
  options: Choice<T>[]
  value: T
  onChange: (value: T) => void
}

/** Segmented control; exactly one option is selected. */
export function KeyBank<T extends string | number>({ label, options, value, onChange }: KeyBankProps<T>) {
  const id = useId()
  const { index, select, onKeyDown } = useRadioKeys(options, value, onChange)
  const accent = options[index].color ?? '#C8FF4D'
  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        onKeyDown={onKeyDown}
        style={{ '--n': options.length, '--i': index, '--accent': accent } as CSSProperties}
      >
        <span className="segmented-thumb" aria-hidden="true" />
        {options.map((option, position) => {
          const active = position === index
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className={active ? 'is-active' : ''}
              onClick={() => select(position)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <p className="field-detail">{options[index].detail}</p>
    </div>
  )
}

interface LabToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  detail?: string
  accent?: string
}

export function LabToggle({ label, checked, onChange, detail, accent }: LabToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-tile ${checked ? 'is-on' : ''}`}
      style={{ '--accent': accent ?? '#C8FF4D' } as CSSProperties}
      onClick={() => {
        play('click')
        onChange(!checked)
      }}
    >
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {detail && <span className="toggle-detail">{detail}</span>}
      </span>
      <span className="switch" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}

interface LabFaderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  format?: (value: number) => string
  onChange: (value: number) => void
  accent?: string
}

export function LabFader({ label, value, min, max, step = 1, unit = '', format, onChange, accent }: LabFaderProps) {
  const id = useId()
  const fraction = (value - min) / (max - min)
  return (
    <div className="field slider" style={{ '--p': fraction, '--accent': accent ?? '#C8FF4D' } as CSSProperties}>
      <div className="slider-head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <output className="slider-value" htmlFor={id}>
          {format ? format(value) : value}
          {unit && <small>{unit}</small>}
        </output>
      </div>
      <div className="slider-track">
        <span className="slider-fill" aria-hidden="true" />
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
      <div className="slider-scale" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

interface TapeInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
  size?: 'lg' | 'sm'
}

export function TapeInput({ label, value, onChange, maxLength = 24, placeholder, size = 'lg' }: TapeInputProps) {
  const id = useId()
  return (
    <div className={`field text-field text-field-${size}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <span className="text-field-count" aria-hidden="true">
        {value.length}/{maxLength}
      </span>
    </div>
  )
}
