# SeatLink checkout and seat operations

This change is local until the database migrations are applied and the frontend is redeployed. No hosted settings, data, payment provider, hardware or deployment were changed during implementation.

## Behaviour and files

- `features/checkout/QuantityControl` and `quantity.ts`: shared integer controls, temporary empty/invalid editing, zero removes a cart line, whole-line Remove, aggregate 50 across a base item and its variants. Variants are existing menu rows grouped by server-owned `menu_items.quantity_group_id`; their server-owned `options` are snapshotted into order items. This does not add a menu administration interface. Base and variant prices remain authoritative menu prices, not client-supplied modifiers.
- `features/seats/SeatMap`, `seat-labels.ts`: shared compact diagram, A/B/C tables and 1/2/3/4 chairs, native keyboard buttons, actual IDs/configurations/positions. Owner chairs show server-expiry countdowns; the customer map has no countdown or selection controls. A locally elapsed timer shows “Sync…” and leaves status occupied until the server confirms release.
- `features/seats/ActiveSeats`, `useSeatOperations`, `seat-operations-service`: owner-only unlimited-size activation batches and confirmed single/selected/group releases. Activation and release use persistent request IDs on retry. Releasing old session IDs cannot affect a newer session pointer.
- `GuidedCheckout` and backend `resubmit_order`: unpaid expired checkout creates one linked replacement. Items, options and quantities survive; old seats and QR do not. Unchanged menu returns to Seats, changed details return to Menu with an explanation. The new deadline remains null until proceeding to Payment. Successful payment on the original blocks resubmission.
- Payment labels are “Cash & Card” and “Confirm Payment”; the database payment method stays `CASH`. Manual received/change behaviour and unresolved-QR safeguards are unchanged. QR confirmation only generates/displays a QR. Diagnostics moved into customer display/payment settings. Test-payment indicators remain visible.
- Branch selection, paired station scoping, optional 0–4 checkout seats, fixed five-minute checkout, ten-minute paid seating and server-side gross daily sales remain in place. No refund records exist; gross sales exclude standalone activations, mock payments and canonical late payments requiring review, using the previously agreed reporting rules. Sandbox provider orders retain their test label.

## Migrations

Apply in order after all existing migrations:

1. `20261123000200_seat_operations.sql`: display metadata; session branch, source, actor and optional order linkage; idempotent activation/release requests; standalone-aware expiry, extensions and invalidation.
2. `20261123000300_quantities_and_resubmit.sql`: authoritative aggregate limits and option snapshots; linked, idempotent resubmission with revalidation.
3. `20261123000400_seat_presentation.sql`: owner expiry metadata and restricted customer display labels/positions.

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

## Optional development fixtures (never run as a production migration)

The script reads the existing `.env.local` only. It requires an explicit project reference matching `VITE_SUPABASE_URL`, a branch UUID, and an existing development owner's email. The branch must belong to that owner. The project must already have development simulation enabled, that owner allowlisted, and payment runtime mode `MOCK`; the script never enables these settings itself. Use a dedicated development/test project and branch, not a live counter. No Docker is required; authenticated Supabase CLI access is required.

```powershell
$DevProjectRef = 'YOUR_DEVELOPMENT_PROJECT_REF'
$DevBranchId = 'YOUR_DEVELOPMENT_BRANCH_UUID'
$DevOwnerEmail = 'YOUR_DEVELOPMENT_OWNER_EMAIL'
npm.cmd run seed:seats:dev -- --development-project $DevProjectRef --branch $DevBranchId --owner $DevOwnerEmail --dry-run
npm.cmd run seed:seats:dev -- --development-project $DevProjectRef --branch $DevBranchId --owner $DevOwnerEmail
```

The second command connects to the explicit development target. It reuses or inserts tables A/B/C and their four seats without replacing IDs/hardware links. It refuses occupied fixture tables or an unrelated active checkout. It creates a real linked mock-paid seat at A2, a current pending checkout lock at A1, standalone sessions at B1–B4 and C1, and leaves A3/A4/C2–C4 available. All deadlines come from normal server operations relative to execution time. Pair the selected owner's customer display to see the pending order and actual map. Mock fixture revenue is excluded from Today's sales.

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
