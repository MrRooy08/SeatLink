# SeatLink checkout and seat operations

This change is local until the database migrations are applied and the frontend is redeployed. No hosted settings, data, payment provider, hardware or deployment were changed during implementation.

## Behaviour and files

- `features/checkout/QuantityControl` and `quantity.ts`: shared integer controls, temporary empty/invalid editing, zero removes a cart line, whole-line Remove, aggregate 50 across a base item and its variants. Variants are existing menu rows grouped by server-owned `menu_items.quantity_group_id`; their server-owned `options` are snapshotted into order items. This does not add a menu administration interface. Base and variant prices remain authoritative menu prices, not client-supplied modifiers.
- `features/seats/SeatMap`, `seat-labels.ts`: shared compact diagram, A/B/C tables and 1/2/3/4 chairs, native keyboard buttons, actual IDs/configurations/positions. Owner chairs show server-expiry countdowns; the customer map has no countdown or selection controls. A locally elapsed timer shows “Sync…” and leaves status occupied until the server confirms release.
- `features/seats/ActiveSeats`, `useSeatOperations`, `seat-operations-service`: owner-only unlimited-size activation batches and confirmed single/selected/group releases. Activation and release use persistent request IDs on retry. Releasing old session IDs cannot affect a newer session pointer.
- `SeatDurationSelector`, `SeatDurationEditor`, `useAnchoredPopover` and `activation-duration.ts`: standalone activation offers independent 5/10/15/20-minute presets and custom positive whole minutes, default ten minutes. Selecting a chair opens one floating duration editor; a small duration badge reopens it. The editor uses a body portal with fixed, collision-aware placement, scroll/resize tracking and keyboard focus restoration. Presets apply immediately; custom Apply or valid Enter saves locally and closes. Invalid Enter neither closes nor submits a surrounding form. Escape/outside clicks discard the draft and preserve the applied choice; reopening initializes from the applied value. Deselect/reselect and Cancel reset choices. Realtime unavailability closes the editor and removes the pending seat. Choices remain local until final activation confirmation. Paid-checkout seating and hardware extensions are unchanged.
- `GuidedCheckout` and backend `resubmit_order`: unpaid expired checkout creates one linked replacement. Items, options and quantities survive; old seats and QR do not. Unchanged menu returns to Seats, changed details return to Menu with an explanation. The new deadline remains null until proceeding to Payment. Successful payment on the original blocks resubmission.
- Payment labels are “Cash & Card” and “Confirm Payment”; the database payment method stays `CASH`. Manual received/change behaviour and unresolved-QR safeguards are unchanged. QR confirmation only generates/displays a QR. Diagnostics moved into customer display/payment settings. Test-payment indicators remain visible.
- Branch selection, paired station scoping, optional 0–4 checkout seats, fixed five-minute checkout, ten-minute paid seating and server-side gross daily sales remain in place. No refund records exist; gross sales exclude standalone activations, mock payments and canonical late payments requiring review, using the previously agreed reporting rules. Sandbox provider orders retain their test label.
- `/display` presents branch/counter, connection/welcome, order items/totals, payment content and a compact read-only **Your seats** summary near the total. `OrderSeatSummary.tsx` and its CSS Module group only `order.selected_seats` by table, using configured presentation labels when supplied and the existing label helpers otherwise. Empty selections, cancellation, expiry, menu reset and idle render no summary or placeholder. Pending and paid views retain the order's selection even after allocated sessions end. The customer display never renders the full map, global counts, legend, other orders' seats or seat-use timers. The owner map remains in place.

Draft selection already uses `update_selected_seats` (a 200ms owner-side debounce), writes only `draft_seat_ids` and triggers existing paired invalidations. `read_customer_display` projects the station's current order: draft IDs while preparing, confirmed IDs afterward. `useDisplay` reads the token-scoped snapshot after broadcasts (200ms coalescing), with existing reconnect/polling fallback and obsolete-response protection. No confirmation/payment is needed to show a selection; no additional reservation, allocation or timer mutation was added. Branch notifications may invalidate multiple stations, but each reader resolves only its own station/order. This summary needs frontend redeployment only, with no additional migration or backend deployment.

## Migrations

Apply in order after all existing migrations:

1. `20261123000200_seat_operations.sql`: display metadata; session branch, source, actor and optional order linkage; idempotent activation/release requests; standalone-aware expiry, extensions and invalidation.
2. `20261123000300_quantities_and_resubmit.sql`: authoritative aggregate limits and option snapshots; linked, idempotent resubmission with revalidation.
3. `20261123000400_seat_presentation.sql`: owner expiry metadata and restricted customer display labels/positions.
4. `20261125000000_activation_durations.sql`: per-seat preset validation and canonical activation payloads for retry safety. Adds `seat_operation_requests.activation_seats`; existing activation requests are backfilled with their original 600-second default. Session expiry still uses the existing `started_at` and `expires_at` fields. No existing active timer is changed.
5. `20261125000100_custom_activation_durations.sql`: replaces only standalone JSONB activation RPC validation with positive whole-minute validation and a supported-expiry guard. No storage change, data rewrite, active-session edit or Edge Function deployment is required.

Existing table numbers, A–D database seat labels, IDs, hardware-device table links, order/payment/session history and checkout functions remain. New display metadata changes presentation without recreating entities. Existing seat status plus reservation/session pointers remain the availability source. Private helper RPCs are revoked from anonymous/authenticated callers; public mutations authorize and serialize by branch. Standalone sessions have no order or payment row and cannot enter the order-based daily aggregate.

## Apply to the intended Supabase project (PowerShell, no Docker)

Use the project intended for deployment; review the project name and pending migration list before pushing. These commands do not seed data or enable simulated payments.

```powershell
Set-Location 'C:\Users\Admin\source\repos\SeatLink\seatlink'
$ProjectRef = 'YOUR_INTENDED_PROJECT_REF'
npx.cmd supabase@3 link --project-ref $ProjectRef
npx.cmd supabase@3 migration list --remote
npx.cmd supabase@3 db push --dry-run --remote
npx.cmd supabase@3 db push --remote
npx.cmd supabase@3 migration list --remote
```

Each pending version must appear in both Local and Remote after the real push. A dry run does not apply anything. Verify the existing `seatlink-expire-orders` Cron job remains active (30-second schedule); reads/mutations also recover expired sessions. Existing hardware and QR Edge Functions do not need code changes for these migrations.

Deploy the compatible backend first: apply `20261125000000` if pending, then `20261125000100`, and verify both appear remotely before deploying this frontend. Existing preset clients remain compatible. The named RPC payload stays `activate_seats({p_branch_id, p_request_id, p_seats: [{seat_id, duration_seconds}]})`; seconds must be numeric, positive, integral, divisible by 60 and at most 2,147,483,640. The server sorts and stores this payload with the request and starts all batch sessions at one server timestamp. Retrying the same request cannot restart sessions, including after release or hardware extension; reusing its ID with changed durations is rejected. Existing clients using `p_seat_ids` continue to receive ten minutes. Direct SQL callers should explicitly type the second argument as `jsonb` or `uuid[]` when using parameters, because the function supports both signatures.

The exact initial-activation maximum is **35,791,394 minutes**, calculated as `floor(2,147,483,647 / 60)` from the existing signed 32-bit seconds conversion in `jsonb_to_recordset`. Multiplication yields 2,147,483,640 seconds, below INT4_MAX and exactly representable in JavaScript. Interval microseconds also remain exact and within PostgreSQL interval storage. From the current server time this is approximately 68 years, comfortably within PostgreSQL timestamps and JavaScript Date's ±8.64e15 millisecond range. The RPC additionally checks each calculated expiry against that finite Date range and catches timestamp/interval overflow before mutation. The frontend uses the same constants; neither side rounds, truncates or clamps durations. This technical bound is not a 20-minute product limit and does not change hardware extension rules.

The input uses a text field with numeric input mode so invalid lexical forms (decimals, signs, exponent notation, whitespace and partial numbers) remain visible and can be rejected rather than silently sanitized by a native number field. Empty input disables Apply. The RPC independently rejects string/boolean/null duration types, fractional/non-minute seconds and overflow. JSONB normalizes numeric notation before the RPC receives it: numeric `6e2` is indistinguishable from `600`; exponent strings are rejected. This does not permit an invalid duration, because the numeric value still must satisfy the complete seconds contract.

## Optional development fixtures (never run as a production migration)

The script reads the existing `.env.local` only. It requires an explicit project reference matching `VITE_SUPABASE_URL`, a branch UUID, and an existing development owner's email. The branch must belong to that owner. The project must already have development simulation enabled, that owner allowlisted, and payment runtime mode `MOCK`; the script never enables these settings itself. Use a dedicated development/test project and branch, not a live counter. No Docker is required; authenticated Supabase CLI access is required.

```powershell
$DevProjectRef = 'YOUR_DEVELOPMENT_PROJECT_REF'
$DevBranchId = 'YOUR_DEVELOPMENT_BRANCH_UUID'
$DevOwnerEmail = 'YOUR_DEVELOPMENT_OWNER_EMAIL'
npm.cmd run seed:seats:dev -- --development-project $DevProjectRef --branch $DevBranchId --owner $DevOwnerEmail --dry-run
npm.cmd run seed:seats:dev -- --development-project $DevProjectRef --branch $DevBranchId --owner $DevOwnerEmail
```

The second command connects to the explicit development target. It reuses or inserts tables A/B/C and their four seats without replacing IDs/hardware links. It refuses occupied fixture tables or an unrelated active checkout. It creates a real linked mock-paid seat at A2, a current pending checkout lock at A1, standalone sessions at B1–B4 and C1, and leaves A3/A4/C2–C4 available. All deadlines come from normal server operations relative to execution time. Pair the selected owner's customer display to see the pending order and payment; inspect the actual map on the owner screen. Mock fixture revenue is excluded from Today's sales.

Repeating while any fixture is still active preserves IDs and timers. To end only this run's recorded sessions and pending order:

```powershell
npm.cmd run seed:seats:dev -- --development-project $DevProjectRef --branch $DevBranchId --owner $DevOwnerEmail --cleanup
```

Cleanup preserves paid orders, payment/audit/session history, fixture menu and table/seat IDs. It does not clear an unrelated current checkout. Run the seed again after cleanup to create fresh future deadlines; reused table/seat IDs remain stable. Fixtures are never bundled into the application or applied during normal deployment.

## Verify and redeploy

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run test:postgres
npm.cmd run build
```

The PostgreSQL tests use an isolated temporary database, stop it afterward, and need no Docker. Browser visual fixtures are development-only at `http://localhost:5173/tests/seat-map-review.html`; they make no database requests. Reuse the existing port 5173. If a frontend server is not already running, use `npm.cmd run dev -- --port 5173 --strictPort` so Vite cannot silently open another port.

After migrations: deploy the changed repository through your existing Vercel workflow (push to its connected deployment branch or choose **Redeploy** for the updated commit). Preserve project Root Directory `seatlink` when the connected repository root is its parent, Build Command `npm run build`, Output Directory `dist`, existing Vite Supabase environment variables and `vercel.json`. If Vercel is connected directly to this app folder, use that folder as root. Redeploying an old commit does not include local edits.

On the deployed app verify direct `/display#PAIR_TOKEN` navigation and refresh, pairing to the intended station/branch, cash/manual and sandbox verified QR zero-seat orders, 1–4 seats, six-seat standalone activation, early release, hardware extension and expiry. Do not expose pairing tokens in screenshots or logs. The preserved Vercel route fallback still leaves assets/API paths untouched.

Local automated checks cover quantities/options, optional seats, separate QR/checkout deadlines, resubmit corrections/retries/payment-received rejection, standalone batches/conflicts/extensions/expiry, stale release, branch authorization, restricted paired projections, daily aggregate exclusions and payment callback races. Browser review checks desktop/mobile seat layout and keyboard activation. Actual hosted Realtime delivery, Cron runs, live/sandbox provider communication, hardware and Vercel deployment require the deployment checks above and were not claimed as verified.

Verification on 23 November 2026: `npm test` passed 89 tests; `npm run test:postgres` passed 12 tests; lint and production build passed. The build retains its existing bundle-size warning (main JavaScript above 500 kB). The development seed and cleanup were exercised against an isolated SQL database; its hosted command was dry-run only. Browser review at 1280px and 390px widths found no horizontal overflow, preserved 52×52px chair targets, and verified Space/Tab keyboard interaction. Pairing/payment integration tests use synthetic provider events and mocked UI service responses, rather than actual provider payments or production browser pairing.

Per-seat duration verification on 25 November 2026: 101 standard tests and 14 native PostgreSQL tests passed; lint and build passed. Coverage includes all four presets in one atomic batch, a shared server start timestamp, malformed/duplicate/cross-branch requests, retry after hardware extension or release, concurrent identical requests, default ten minutes, cancel and deselect/reselect. Browser review verified four simultaneous selectors on one table at desktop and 390px mobile width, no overlap with chairs/other selectors/table labels/action bar, independent choices, keyboard focus and reset behaviour. These checks used isolated databases and development-only local fixtures. The hosted migration and frontend deployment were not applied as part of this feature.

Popover refinement: 105 standard tests passed, including one-open-editor behaviour, local duration choices, outside/Escape dismissal, focus restoration, keyboard segment navigation through timer rerenders and realtime removal/availability reconciliation. Browser checks at desktop, 390px and 320px widths verified placement, flipping/shifting at viewport edges, scroll tracking and dismissal when the anchor leaves view, unchanged table geometry and 44px option heights. This refinement requires frontend redeployment only; it introduces no additional migration or backend change.

Custom input verification on 25 November 2026: 130 standard tests and 14 native PostgreSQL tests passed; lint and production build passed (existing >500 kB bundle warning remains). Checks cover 12/25 minutes, all invalid input categories, exact maximum and maximum plus one, Apply/Enter, parent-form prevention, draft dismissal/reopening/switching, presets, independent mixed 5/12/25 payloads, no activation before final confirmation, atomic invalid batches, authorization, retry after release/extension, concurrent custom-duration retries and legacy ten-minute defaults. SQL checks also activate the exact maximum and verify finite supported expiry. Existing paid-checkout and active-session scenarios pass unchanged. Browser review on the local fixture checked desktop and 320px/390px layouts, keyboard Tab/Enter/Escape, inline errors, maximum input, preset highlighting and cancellation. These are local tests with isolated databases and a fake browser service; actual hosted RPC, Realtime, hardware/provider traffic and production deployment were not tested or changed. Apply the compatible backend migration before frontend redeployment using the commands above.

Files changed for custom input specifically: `src/features/seats/SeatDurationEditor.tsx` (new), `SeatDurationSelector.tsx`, `SeatDurationSelector.module.css`, `useAnchoredPopover.ts`, `activation-duration.ts`, `ActiveSeats.tsx`, `src/database.types.ts`, `supabase/migrations/20261125000100_custom_activation_durations.sql` (new), `supabase/tests/activation-durations-body.sql`, `tests/activation-duration.test.ts` (new), `tests/operations-ui.test.tsx`, `tests/database.test.ts`, `tests/postgres.integration.ts`, this document and `README.md`. Other existing working-tree changes belong to earlier work.

Customer summary verification on 25 November 2026: 143 standard tests and 15 isolated native PostgreSQL tests passed; lint and production build passed with the existing bundle-size warning. Coverage includes owner selection/deselection before confirmation, grouping, clearing all, pending/completed order retention after release, cancellation/reset/new order, reconnect, pairing-token switch, configured labels, same-branch counter isolation and standalone activation exclusion. SQL assertions verify draft selections leave seat availability, locks and session deadlines untouched. Browser review of the shared summary on the development comparison page verified desktop and 390px/320px wrapping without horizontal overflow; the customer section has no map or seat controls. Hosted Realtime/provider traffic and production deployment were not tested or changed. Files for this refinement: `CustomerDisplay.tsx`, new `OrderSeatSummary.tsx`/`OrderSeatSummary.module.css`, optional display metadata typing in `src/database.types.ts`, `tests/customer-display.test.tsx`, `tests/sales.test.tsx`, `tests/database.test.ts`, `tests/postgres.integration.ts`, new rollback-only `supabase/tests/display-selection-body.sql`, `tests/seat-map-review.tsx`, and this document.
