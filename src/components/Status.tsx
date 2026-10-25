import type { CSSProperties } from 'react'
import { FINDING_STATUSES, type FindingStatus } from '../protocol/ancestors'
import { MODULE_STATUSES, type ModuleStatus } from '../protocol/modules'
import type { Origin } from '../lab/registry'
import { ORIGIN_LABEL } from '../lab/registry'
import { FINDING_TONE, MODULE_TONE } from '../lib/tones'

const ORIGIN_TONE: Record<Origin, string> = {
  ancestor: 'var(--cyan)',
  example: 'var(--muted)',
  registered: 'var(--lime)',
}

function Badge({ label, tone, title }: { label: string; tone: string; title?: string }) {
  return (
    <span className="badge" style={{ '--tone': tone } as CSSProperties} title={title}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}

export function FindingBadge({ status }: { status: FindingStatus }) {
  return <Badge label={status} tone={FINDING_TONE[status]} title={FINDING_STATUSES.find((item) => item.status === status)?.meaning} />
}

export function ModuleBadge({ status }: { status: ModuleStatus }) {
  return <Badge label={status} tone={MODULE_TONE[status]} title={MODULE_STATUSES.find((item) => item.status === status)?.meaning} />
}

export function OriginBadge({ origin }: { origin: Origin }) {
  return <Badge label={ORIGIN_LABEL[origin]} tone={ORIGIN_TONE[origin]} />
}

export function Pill({ label, tone = 'var(--muted)', title }: { label: string; tone?: string; title?: string }) {
  return <Badge label={label} tone={tone} title={title} />
}
