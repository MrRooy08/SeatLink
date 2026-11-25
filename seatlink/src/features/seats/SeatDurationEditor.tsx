import { useState } from 'react'
import type { RefObject } from 'react'
import { activationDurations, parseActivationMinutes } from './activation-duration'
import type { ActivationDuration } from './activation-duration'
import styles from './SeatDurationSelector.module.css'

// Mounted only while open, so every opening starts from the applied value.
export default function SeatDurationEditor({ panelRef, panelId, label, shortLabel, value, disabled, onChange, onClose }: {
  panelRef: RefObject<HTMLDivElement | null>; panelId: string; label: string; shortLabel: string
  value: ActivationDuration; disabled: boolean; onChange: (duration: ActivationDuration) => void; onClose: () => void
}) {
  const [draft, setDraft] = useState(() => String(value / 60))
  const parsed = parseActivationMinutes(draft)
  const inputId = `${panelId}-custom`
  function apply() {
    if (disabled || parsed.seconds === null) return
    onChange(parsed.seconds)
    onClose()
  }
  return <div ref={panelRef} id={panelId} className={styles.popover} role="dialog" aria-labelledby={`${panelId}-title`}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.target instanceof HTMLInputElement) {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply() }
        // Arrow/Home/End keep their normal text-editing behaviour in the input.
      } else if ((event.target as HTMLElement).closest('[data-duration-presets]') && ['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-duration-presets] button')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('*')].filter(element =>
          (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && !element.disabled)
        const index = controls.indexOf(document.activeElement as HTMLElement)
        if (event.shiftKey ? index === 0 : index === controls.length - 1) { event.preventDefault(); onClose() }
      }
    }}>
    <h3 id={`${panelId}-title`}>Seat {shortLabel} · Duration</h3>
    <div className={styles.options} role="group" aria-label={`Duration for ${label}`} data-duration-presets>
      {activationDurations.map(duration => <button key={duration} type="button" disabled={disabled}
        aria-label={`${duration / 60} minutes for ${label}`} aria-pressed={duration === value}
        onClick={() => { onChange(duration); onClose() }}>{duration / 60}</button>)}
      <span className={styles.unit}>min</span>
    </div>
    <div className={styles.customRow}>
      <label htmlFor={inputId}>Custom duration</label>
      <input id={inputId} type="text" inputMode="numeric" pattern="[0-9]*" value={draft} disabled={disabled}
        aria-invalid={!!parsed.error} aria-describedby={`${inputId}-unit${parsed.error ? ` ${inputId}-error` : ''}`}
        onChange={event => setDraft(event.target.value)} />
      <span id={`${inputId}-unit`} className={styles.customUnit}>min</span>
      <button type="button" className={styles.apply} disabled={disabled || parsed.seconds === null} onClick={apply}>Apply</button>
    </div>
    {parsed.error && <p className={styles.validation} id={`${inputId}-error`} role="status">{parsed.error}</p>}
  </div>
}
