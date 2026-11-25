import { useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import { formatMoney } from '../../sales-data'
import type { useCheckout } from './useCheckout'
import FoodThumbnail from './FoodThumbnail'
import QuantityControl from './QuantityControl'
import { quantityMaximum } from './quantity'

export default function MenuCart({ snapshot, checkout, disabled }: {
  snapshot: SalesSnapshot; checkout: ReturnType<typeof useCheckout>; disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const { cart, setCart, working } = checkout
  const busy = disabled || working
  const menu = snapshot.menu.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
  const change = (id: string, quantity: number) => setCart(previous => {
    const next = {...previous}
    if (quantity === 0) delete next[id]
    else next[id] = quantity
    return next
  })
  return <section className="menu-cart-step" aria-labelledby="menu-title">
    <h2 id="menu-title">Menu and cart</h2>
    <label>Search menu<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {!snapshot.menu.length && <p role="status">No menu items configured for this branch. Ask your administrator to add this branch’s menu.</p>}
    {snapshot.menu.length > 0 && !menu.length && <p>No items match your search.</p>}
    <ul className="menu-list">{menu.map((item) => <li key={item.id}>
      <div className="menu-item-content"><FoodThumbnail name={item.name} /><div><strong>{item.name}</strong><p>{formatMoney(item.price_minor, item.currency)}</p>
        {item.options && Object.keys(item.options).length > 0 && <small>{Object.entries(item.options).map(([key,value]) => `${key}: ${value}`).join(', ')}</small>}
        {!item.available && <span className="state-badge pending">Unavailable today</span>}</div></div>
      <QuantityControl name={`Menu quantity for ${item.name}`} value={cart[item.id] ?? 0}
        maximum={item.available ? quantityMaximum(item.id,cart,snapshot.menu) : cart[item.id] ?? 0}
        disabled={busy || !item.available && !cart[item.id]} onChange={quantity => change(item.id,quantity)} onValidity={checkout.setQuantityValidity} />
    </li>)}</ul>
    {snapshot.order?.resubmission_note && <div role="alert"><p>{snapshot.order.resubmission_note}</p><ul>
      {snapshot.order.items.flatMap(previous => {
        const current = snapshot.menu.find(item => item.id === previous.menu_item_id)
        if (!current || !current.available) return <li key={previous.menu_item_id}>{previous.name} is unavailable. Remove it or choose another item.
          {!!cart[previous.menu_item_id] && <button type="button" disabled={busy} onClick={() => change(previous.menu_item_id,0)}>Remove {previous.name}</button>}</li>
        const changes = [
          previous.name !== current.name ? `Now named ${current.name}` : '',
          previous.unit_price_minor !== current.price_minor || snapshot.order!.currency !== current.currency ?
            `Price changed from ${formatMoney(previous.unit_price_minor,snapshot.order!.currency)} to ${formatMoney(current.price_minor,current.currency)}` : '',
          JSON.stringify(previous.options ?? {}) !== JSON.stringify(current.options ?? {}) ? 'Options changed; review the menu details' : '',
        ].filter(Boolean)
        return changes.length ? <li key={previous.menu_item_id}>{previous.name}: {changes.join('. ')}.</li> : []
      })}
    </ul></div>}
    {checkout.changed && <p role="alert">This order changed in another screen. Reload it before continuing.</p>}
    {checkout.error && <button type="button" disabled={busy} onClick={checkout.reloadCart}>Reload saved cart</button>}
    <button type="button" className="primary" disabled={busy || !checkout.valid || checkout.changed}
      onClick={checkout.continueToSeats}>{working ? 'Continuing…' : 'Next'}</button>
  </section>
}
