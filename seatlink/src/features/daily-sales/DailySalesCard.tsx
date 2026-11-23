import type { useDailySales } from './useDailySales'
import { formatDailyMoney } from './daily-sales-service'
import Icon from '../../components/Icon'
import styles from './DailySalesCard.module.css'

export default function DailySalesCard({ sales }: { sales: ReturnType<typeof useDailySales> }) {
  return <section className={styles.card} aria-label="Today's sales">
    <h2><Icon name="cash" />Today’s sales</h2>
    {!sales.result ? <p role="status" className={styles.loading}>Loading sales…</p> : 'error' in sales.result ?
      <><p role="alert">Couldn’t load today’s sales. Check the connection and branch sales setup.</p><button type="button" onClick={sales.retry}>Retry sales</button></> :
      <><strong className={styles.amount}>{formatDailyMoney(sales.result.data.total_minor, sales.result.data.currency)}</strong>
        <p>{sales.result.data.paid_orders} paid {sales.result.data.paid_orders === 1 ? 'order' : 'orders'}</p>
        <small title={`Gross order sales in ${sales.result.data.timezone}. Cash and verified provider QR; mock QR is excluded. Refund records are not supported.`}>
          Gross · {sales.result.data.sandbox_orders ? 'includes sandbox QR' : 'excludes mock QR'}</small></>}
  </section>
}
