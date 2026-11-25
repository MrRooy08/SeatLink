import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ActivationDuration } from './activation-duration'
import SeatDurationEditor from './SeatDurationEditor'
import { useAnchoredPopover } from './useAnchoredPopover'
import styles from './SeatDurationSelector.module.css'

export default function SeatDurationSelector({ label, shortLabel, chairId, value, disabled, selected, open, from,
  onOpen, onClose, onChange, fallbackFocus }: {
  label: string; shortLabel: string; chairId: string; value: ActivationDuration; disabled: boolean; selected: boolean
  open: boolean; from: 'chair' | 'badge'; onOpen: () => void; onClose: () => void
  onChange: (duration: ActivationDuration) => void; fallbackFocus: () => HTMLElement | null
}) {
  const panelId = useId()
  const badgeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useAnchoredPopover({ open, panelRef, badgeRef, chairId, from, onClose, fallbackFocus })
  return <div className={styles.slot}>
    {selected && <button ref={badgeRef} type="button" className={styles.badge} disabled={disabled}
      aria-label={`Edit duration for ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={event => { event.stopPropagation(); onOpen() }}>{value / 60} min <span aria-hidden="true">▾</span></button>}
    {open && createPortal(<SeatDurationEditor panelRef={panelRef} panelId={panelId} label={label} shortLabel={shortLabel}
      value={value} disabled={disabled} onChange={onChange} onClose={onClose} />, document.body)}
  </div>
}
