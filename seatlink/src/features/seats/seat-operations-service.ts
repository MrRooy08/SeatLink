import type { SeatLinkClient } from '../../seat-data'
import { checkoutOperation } from '../checkout/checkout-service'
import type { SeatActivation } from './activation-duration'

export const activateSeats = (client: SeatLinkClient, branch: string, seats: SeatActivation[], request: string) =>
 checkoutOperation(client,'activate_seats',{p_branch_id:branch,p_seats:seats,p_request_id:request})
export const releaseSeats = (client: SeatLinkClient, branch: string, sessions: string[], request: string) =>
 checkoutOperation(client,'release_active_seats',{p_branch_id:branch,p_session_ids:sessions,p_request_id:request})
