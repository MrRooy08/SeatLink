import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

export function useAnchoredPopover({ open, panelRef, badgeRef, chairId, from, fallbackFocus, onClose }: {
  open: boolean; panelRef: RefObject<HTMLDivElement | null>; badgeRef: RefObject<HTMLButtonElement | null>
  chairId: string; from: 'chair' | 'badge'; fallbackFocus: () => HTMLElement | null; onClose: () => void
}) {
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const chair = document.getElementById(chairId)
    const badge = badgeRef.current
    const anchor = chair ?? badge
    if (!panel || !anchor) return
    const trigger = from === 'chair' ? chair : badge
    const usable = (element: HTMLElement | null): element is HTMLElement =>
      !!element?.isConnected && !(element instanceof HTMLButtonElement && element.disabled)
    const restoreFocus = () => {
      const target = [trigger, badgeRef.current, document.getElementById(chairId), fallbackFocus()].find(usable)
      target?.focus({ preventScroll: true })
    }
    const place = () => {
      const viewport = window.visualViewport
      const width = viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth)
      const height = viewport?.height ?? (document.documentElement.clientHeight || window.innerHeight)
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8
      const topEdge = (viewport?.offsetTop ?? 0) + 8
      const rightEdge = leftEdge + width - 16
      const bottomEdge = topEdge + height - 16
      panel.style.maxWidth = `${Math.max(0, width - 16)}px`
      panel.style.maxHeight = `${Math.max(0, height - 16)}px`
      const rect = anchor.getBoundingClientRect()
      if (!anchor.isConnected || rect.width > 0 && rect.height > 0 &&
        (rect.bottom < topEdge || rect.top > bottomEdge || rect.right < leftEdge || rect.left > rightEdge)) {
        onClose()
        return
      }
      const size = panel.getBoundingClientRect()
      let x = rect.right + 10
      let y = rect.top + (rect.height - size.height) / 2
      if (x + size.width > rightEdge) {
        if (rect.left - size.width - 10 >= leftEdge) x = rect.left - size.width - 10
        else {
          x = rect.left + (rect.width - size.width) / 2
          y = rect.bottom + 10
          if (y + size.height > bottomEdge) y = rect.top - size.height - 10
        }
      }
      panel.style.left = `${Math.max(leftEdge, Math.min(x, rightEdge - size.width))}px`
      panel.style.top = `${Math.max(topEdge, Math.min(y, bottomEdge - size.height))}px`
      panel.style.visibility = 'visible'
    }
    const inside = (target: EventTarget | null) => target instanceof Node &&
      (panel.contains(target) || badge?.contains(target) || chair?.contains(target))
    const dismiss = (event: Event) => { if (!inside(event.target)) onClose() }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    place()
    const initialFocus = panel.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel.querySelector<HTMLInputElement>('input')
    initialFocus?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(anchor)
    observer?.observe(panel)
    const table = anchor.closest('article')
    if (table) observer?.observe(table)
    observer?.observe(document.body)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('keydown', keydown, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
      observer?.disconnect()
      if (panel.contains(document.activeElement) || document.activeElement === document.body) {
        restoreFocus()
        // A realtime update can remove the badge or disable the chair in this same commit.
        queueMicrotask(() => { if (document.activeElement === document.body) restoreFocus() })
      }
    }
  }, [open, panelRef, badgeRef, chairId, from, fallbackFocus, onClose])
}
