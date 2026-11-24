import type { MenuItem } from '../../database.types'
import type { Cart } from './useCheckout'

export function quantityMaximum(id: string, cart: Cart, menu: MenuItem[]) {
 const group = (item: MenuItem) => item.quantity_group_id ?? item.id
 const item = menu.find(item => item.id === id)
 if (!item) return 0
 const used = menu.filter(other => other.id !== id && group(other) === group(item)).reduce((sum, item) => sum + (cart[item.id] ?? 0), 0)
 return Math.max(0, 50 - used)
}
export const validQuantities = (cart: Cart, menu: MenuItem[]) => Object.entries(cart).every(([id, n]) =>
 Number.isInteger(n) && n > 0 && n <= quantityMaximum(id, cart, menu))
