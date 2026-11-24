import type { SeatLinkClient } from '../../seat-data'
import { checkoutOperation } from '../checkout/checkout-service'

export const activateSeats = (client: SeatLinkClient, branch: string, seats: string[], request: string) =>
 checkoutOperation(client,'activate_seats',{p_branch_id:branch,p_seat_ids:seats,p_request_id:request})
export const releaseSeats = (client: SeatLinkClient, branch: string, sessions: string[], request: string) =>
 checkoutOperation(client,'release_active_seats',{p_branch_id:branch,p_session_ids:sessions,p_request_id:request})
