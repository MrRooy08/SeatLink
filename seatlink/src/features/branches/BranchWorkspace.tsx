import type { Dispatch, SetStateAction } from 'react'
import type { Branch, SeatLinkClient } from '../../seat-data'
import Sales from '../sales/Sales'
import type { NavigationBlock } from '../sales/Sales'
import { useDailySales } from '../daily-sales/useDailySales'
import DailySalesCard from '../daily-sales/DailySalesCard'
import Icon from '../../components/Icon'
import styles from './BranchWorkspace.module.css'

export default function BranchWorkspace({ client, branch, onSwitch, setNavigationBlock }: {
  client: SeatLinkClient; branch: Branch; onSwitch: () => void; setNavigationBlock: Dispatch<SetStateAction<NavigationBlock>>
}) {
  const dailySales = useDailySales(client, branch.id)
  return <>
    <header className={styles.header}><div><p className="organisation">{branch.organisation.name}</p><h1>{branch.name}</h1>
      <button type="button" className={styles.switchButton} onClick={onSwitch}><Icon name="store" />Switch branch</button></div>
      <DailySalesCard sales={dailySales} /></header>
    <Sales key={branch.id} client={client} branchId={branch.id} setNavigationBlock={setNavigationBlock} onPaymentCompleted={dailySales.retry} />
  </>
}
