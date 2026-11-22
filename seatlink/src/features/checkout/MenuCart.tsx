import { useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import { formatMoney } from '../../sales-data'
import type { useCheckout } from './useCheckout'
import FoodThumbnail from './FoodThumbnail'
import Icon from '../../components/Icon'

export default function MenuCart({ snapshot, checkout, disabled }: {
  snapshot: SalesSnapshot; checkout: ReturnType<typeof useCheckout>; disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const { cart, setCart, working } = checkout
  const busy = disabled || working
  const menu = snapshot.menu.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
  return <section className="menu-cart-step" aria-labelledby="menu-title">
    <h2 id="menu-title">Menu and cart</h2>
    <label>Search menu<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {!snapshot.menu.length && <p role="status">No menu items configured for this branch. Ask your administrator to add this branch’s menu.</p>}
    {snapshot.menu.length > 0 && !menu.length && <p>No items match your search.</p>}
    <ul className="menu-list">{menu.map((item) => <li key={item.id}>
      <div className="menu-item-content"><FoodThumbnail name={item.name} /><div><strong>{item.name}</strong><p>{formatMoney(item.price_minor, item.currency)}{item.is_demo ? ' · Sample item' : ''}</p>
        {!item.available && <span className="state-badge pending">Unavailable today</span>}</div></div>
      <button type="button" disabled={busy || !item.available || (cart[item.id] ?? 0) >= 2147483647}
        onClick={() => setCart((previous) => ({ ...previous, [item.id]: (previous[item.id] ?? 0) + 1 }))}>
        {item.available ? `Add ${item.name}` : 'Unavailable'}
      </button>
    </li>)}</ul>
    <h3 className="with-icon"><Icon name="cart" />Cart</h3>
    {!Object.keys(cart).length && <p>Add food or a drink to begin.</p>}
    <ul className="cart-list">{Object.entries(cart).map(([id, quantity]) => {
      const item = snapshot.menu.find((entry) => entry.id === id)
      const name = item?.name ?? 'Unavailable item'
      return <li key={id}><strong>{name}</strong><div className="quantity-controls">
        <label>Quantity for {name}<input type="number" min="1" max="2147483647" step="1"
          value={quantity || ''} disabled={busy} onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isInteger(value) && value >= 0 && value <= 2147483647) setCart((previous) => ({ ...previous, [id]: value }))
          }} /></label>
        <button type="button" disabled={busy} onClick={() => setCart((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([itemId]) => itemId !== id)))}>Remove {name}</button>
      </div></li>
    })}</ul>
    <p role="status">{working ? 'Validating cart…' : checkout.dirty ? 'Saving cart changes…' : 'Cart changes saved'}</p>
    <p className="form-help">Continue validates current availability and prices before you choose seats.</p>
    {checkout.changed && <p role="alert">This order changed in another screen. Reload it before continuing.</p>}
    {checkout.error && <button type="button" disabled={busy} onClick={checkout.reloadCart}>Reload saved cart</button>}
    <button type="button" className="primary" disabled={busy || !checkout.valid || checkout.changed}
      onClick={checkout.continueToSeats}>{working ? 'Continuing…' : 'Continue to seats'}</button>
  </section>
}
