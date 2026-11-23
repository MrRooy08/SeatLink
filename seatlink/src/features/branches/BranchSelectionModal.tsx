import { useEffect, useId, useRef, useState } from 'react'
import type { Branch } from '../../seat-data'
import Icon from '../../components/Icon'
import styles from './BranchSelectionModal.module.css'

export default function BranchSelectionModal({ branches, currentId, message, onContinue, onClose }: {
  branches: Branch[]; currentId?: string; message: string; onContinue: (id: string) => boolean; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const [selected, setSelected] = useState(currentId ?? '')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('input:checked, input[type="search"], input[type="radio"]')?.focus()
    return () => { element.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  const filtered = branches.filter(branch => `${branch.name} ${branch.address ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby={headingId} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const element = event.currentTarget
    const selectedRadio = element.querySelector('input[type="radio"]:checked') ?? element.querySelector('input[type="radio"]')
    const targets = [...element.querySelectorAll<HTMLElement>('*')]
      .filter(target => ['BUTTON','INPUT'].includes(target.tagName) && !target.matches(':disabled'))
      .filter(target => !(target instanceof HTMLInputElement) || target.type !== 'radio' || target === selectedRadio)
    const first = targets[0], last = targets[targets.length-1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onCancel={event => {
    event.preventDefault(); if (currentId) onClose()
  }}>
    <header className={styles.header}><div><p>Owner workspace</p><h2 id={headingId}>{currentId ? 'Switch branch' : 'Choose a branch'}</h2></div>
      {currentId && <button type="button" onClick={onClose} aria-label="Close branch selection">×</button>}</header>
    <p className={styles.intro}>Choose where you’re working today.</p>
    {branches.length >= 6 && <label className={styles.search}>Search branches<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>}
    <fieldset className={styles.list}><legend className={styles.srOnly}>Accessible branches</legend>
      {filtered.map(branch => <label key={branch.id} className={`${styles.card} ${selected === branch.id ? styles.selected : ''}`}>
        <input type="radio" name="checkout-branch" aria-label={branch.name} value={branch.id} checked={selected === branch.id} onChange={() => setSelected(branch.id)} />
        <Icon name="store" /><span><strong>{branch.name}</strong>{branch.address && <small>{branch.address}</small>}</span>
        {selected === branch.id && <span className={styles.check} aria-hidden="true">✓</span>}
      </label>)}
      {!filtered.length && <p role="status">No branches match your search.</p>}
    </fieldset>
    {message && <p className={styles.message} role="alert">{message}</p>}
    <footer className={styles.footer}>{currentId && <button type="button" onClick={onClose}>Cancel</button>}
      <button type="button" className="primary" disabled={!branches.some(branch => branch.id === selected)} onClick={() => onContinue(selected)}>Continue</button></footer>
  </dialog>
}
