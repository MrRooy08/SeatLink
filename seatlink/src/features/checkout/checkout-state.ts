import type { CheckoutStep, SalesOrder } from '../../database.types'

export const checkoutSteps: { id: CheckoutStep; label: string }[] = [
  { id: 'MENU', label: 'Menu and cart' }, { id: 'SEATS', label: 'Seat selection' },
  { id: 'PAYMENT', label: 'Payment' }, { id: 'RESULT', label: 'Result' },
]

export function checkoutStep(order: SalesOrder | null): CheckoutStep {
  if (!order) return 'MENU'
  if (order.status === 'PENDING') return 'PAYMENT'
  if (order.status !== 'DRAFT') return 'RESULT'
  return order.checkout_step === 'SEATS' ? 'SEATS' : 'MENU'
}

export function countdown(deadline: string | null | undefined, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline ?? '') - now) / 1000) || 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
