import { useSyncExternalStore } from 'react'

export type SoundName = 'clunk' | 'zap' | 'ding' | 'bzz' | 'click'

const KEY = 'qfork.sound'
let enabled = false
try {
  enabled = window.localStorage.getItem(KEY) === 'on'
} catch {
  enabled = false
}
const listeners = new Set<() => void>()
let context: AudioContext | null = null

export function setSoundEnabled(next: boolean) {
  enabled = next
  try {
    window.localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // Preference persistence is optional.
  }
  listeners.forEach((listener) => listener())
  if (next) play('click')
}

export function useSoundEnabled() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => enabled,
    () => false,
  )
}

function tone(
  ctx: AudioContext,
  type: OscillatorType,
  from: number,
  to: number,
  duration: number,
  volume: number,
  delay = 0,
) {
  const start = ctx.currentTime + delay
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(from, start)
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration)
  gain.gain.setValueAtTime(volume, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

function noise(ctx: AudioContext, duration: number, volume: number, filterHz: number) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length)
  }
  const source = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  source.buffer = buffer
  filter.type = 'lowpass'
  filter.frequency.value = filterHz
  gain.gain.value = volume
  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start()
}

export function play(name: SoundName) {
  if (!enabled) return
  try {
    context ??= new AudioContext()
    const ctx = context
    if (ctx.state === 'suspended') void ctx.resume()
    switch (name) {
      case 'clunk':
        tone(ctx, 'sine', 140, 48, 0.28, 0.5)
        noise(ctx, 0.12, 0.35, 900)
        break
      case 'zap':
        tone(ctx, 'sawtooth', 1800, 120, 0.35, 0.08)
        noise(ctx, 0.3, 0.12, 5000)
        break
      case 'bzz':
        tone(ctx, 'square', 110, 104, 0.5, 0.05)
        break
      case 'ding':
        tone(ctx, 'sine', 1320, 1310, 1.1, 0.22)
        tone(ctx, 'sine', 1980, 1975, 0.8, 0.08, 0.01)
        break
      case 'click':
        tone(ctx, 'square', 900, 600, 0.04, 0.05)
        break
    }
  } catch {
    // Audio is decorative; ignore unsupported environments.
  }
}
