import { useEffect, useId, useState } from 'react'
import styles from './QuantityControl.module.css'

export default function QuantityControl({ name, value, maximum, disabled, onChange, onValidity }: {
 name: string; value: number; maximum: number; disabled: boolean; onChange: (n: number) => void; onValidity: (id: string, valid: boolean) => void
}) {
 const id = useId()
 const [editing, setEditing] = useState<string | null>(null)
 const text = editing ?? String(value)
 const valid = /^\d+$/.test(text) && Number(text) <= maximum
 useEffect(() => { onValidity(id, valid); return () => onValidity(id, true) }, [id, onValidity, valid])
 function change(n: number) { setEditing(null); onChange(n) }
 return <div className={styles.control}>
  <button type="button" aria-label={`Decrease ${name}`} disabled={disabled || value === 0} onClick={() => change(Math.max(0,value-1))}>−</button>
  <label><span className={styles.label}>Quantity for {name}</span><input aria-label={name} type="text" inputMode="numeric" pattern="[0-9]*"
   value={text} disabled={disabled} aria-invalid={!valid} aria-describedby={!valid ? `${id}-error` : undefined}
   onChange={event => { const raw=event.target.value; const valid=/^\d+$/.test(raw) && Number(raw)<=maximum; setEditing(valid ? null : raw); if (valid) onChange(Number(raw)) }}
   onBlur={() => { if(valid) setEditing(null) }} /></label>
  <button type="button" aria-label={name.startsWith('Menu quantity for ') ? `Add ${name.slice(18)}` : `Increase ${name}`} disabled={disabled || !valid || value >= maximum} onClick={() => change(value+1)}>+</button>
  {!valid && <small id={`${id}-error`} role="alert">Enter 0–{maximum} whole items.</small>}
 </div>
}
