# SeatLink

SeatLink uses React + TypeScript + Vite and Supabase. Its guided checkout has four steps: Menu and cart → Seats → Payment → Result. Owners can accept cash, demonstrate development mock QR payments, manage paid seat use, and pair a read-only customer display. A server-side 2C2P sandbox adapter is implemented but requires external configuration and deployment before use.

## What changed

The visual system uses the warm ivory background, white workspaces, pale green summary, and dark green headings/navigation. Icons are original, consistent stroke SVGs with decorative icons hidden from assistive technology. Menu thumbnails are original matching food illustrations; attribution and licensing are recorded in `public/food/ATTRIBUTION.md`. Unknown food and failed images use a neutral cutlery fallback. The order summary has item amounts, individual seat badges, a payment status badge and reservation countdown. It stays sticky on desktop and becomes a collapsible summary above the workspace on small screens.

Contrast calculations against the actual colour tokens passed WCAG AA's 4.5:1 normal-text threshold: white on primary green 9.58:1, muted text on ivory 5.95:1, green on the summary 8.40:1, amber warning text 6.43:1, and red error text 6.48:1. Status text and icons accompany colour.

### QR issue diagnosed on 18 November 2026

Read-only hosted inspection found all migrations through `20261118000700` already applied. `payment_runtime.mode` is `MOCK`, `development_settings.enabled` is false, and `development_operators` has zero rows. There are no payment attempts. The server therefore reports the owner's payment mode as `UNCONFIGURED`: confirmation never reaches QR creation, so neither owner nor customer has QR data to render. The project also has no configured sandbox merchant and no deployed Edge Functions. Adding only Supabase frontend keys to `.env.local` does not configure provider payments.

The provider URL allowlist was a separate adapter defect: it accepted the sandbox S3 image example but rejected the `https://api.2c2p.com/pgw/qr/...` image returned in the official Do Payment example. The adapter and trusted persistence now accept both documented image locations. They display the returned image directly and never encode a URL/token as a payable QR. This path was not reached in the inspected hosted project.

The new `20261118000800_qr_confirmation_and_display.sql` migration adds actionable owner configuration codes, canonical attempt ordering shared by both readers, reusable confirmation RPCs, persisted generation issues, and separate provider QR expiry. Apply this migration to the intended project before using the updated QR confirmation flow. It does not enable mock or sandbox payments.

Owner errors distinguish disabled mock access, missing sandbox configuration, unreachable/undeployed endpoint, rejected reservation, failed provider requests, unverified signatures, invalid QR data and persistence failures. Customer messages remain limited to waiting, payment status, connectivity and seller assistance. A connection heartbeat does not prove QR synchronisation.

A read-only inspection of the linked hosted database found **zero menu records in both Riverside and Market Square** on 18 November 2026. The menu query does not filter unavailable items out, and failed reads show an error. The old menu seed was a separate manual step, so applying migrations alone left the menu empty.

Seat selection requires a server-validated purchase. **Continue to seats** saves and validates the cart before opening seat selection. Only the active checkout workspace is rendered; the order summary and stepper remain visible. Seat selection immediately updates its checkmark, highlight, pressed state and count.

The header shows the signed-in display name or email. The Food Court Owner role comes from an authorised owner_memberships row. The operator's organisation, branch and counter stay associated with server data.

## Local setup

Install Node.js 22 or newer, npm, Docker Desktop and Supabase CLI v3. Start Docker Desktop before starting local Supabase. The commands below use PowerShell.

```powershell
Set-Location "C:\Users\Admin\source\repos\SeatLink\seatlink"
npm.cmd ci
npx.cmd supabase@3 start
npx.cmd supabase@3 migration up
npx.cmd supabase@3 status
```

SeatLink uses the existing `.env.local`. Keep its configured URL and publishable key when using hosted Supabase. If you choose the local Supabase setup above, update that same file with the local Project URL and publishable key. The frontend reads these two variables, documented in [.env.example](.env.example).

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_LOCAL_PUBLISHABLE_KEY
```

In local Studio, open **Authentication → Users → Add user → Create new user**. Deliberately create a test owner with an email/password and confirm the account. Copy its User UID. Load development data and allowlist that test owner.

```powershell
$env:SEATLINK_DEMO_OWNER_UID = "PASTE_LOCAL_TEST_OWNER_UID"
npm.cmd run seed:dev
```

The seed command connects only to a literal loopback host. It defaults to the local Supabase database at port 54322. For a different local port/password, set the non-Vite `SEATLINK_DEV_DATABASE_URL` variable. You can also set `SEATLINK_DEMO_BRANCH_ID` to an existing local branch UUID to seed its menu. These settings are for the Node seed command.

The command creates a sample organisation, two branches, seven four-seat tables, and five labelled sample menu items per demo branch. Demo prices use SGD cents. One menu item per branch is unavailable. New seats start AVAILABLE. Existing rows, prices, availability and seat states are preserved on rerun. Older sample seats already marked LOCKED or UNAVAILABLE without an order remain untouched.

In local Studio's SQL Editor, associate the test owner with the demo organisation.

```sql
insert into public.owner_memberships (user_id, organisation_id)
values ('PASTE_LOCAL_TEST_OWNER_UID'::uuid, '9ab8e80c-7bf4-4cf0-a437-133318c32a01')
on conflict (user_id, organisation_id) do nothing;
```

Start the frontend on the existing SeatLink port. Stop an existing dev server before starting another.

```powershell
npm.cmd run dev -- --port 5173 --strictPort
```

Open [the owner screen](http://127.0.0.1:5173/). Local and hosted Supabase have separate accounts, data and keys.

## Owner workflow

### Hosted menu seed without Docker

The hosted seed reads the existing `.env.local` and uses your Supabase CLI login for privileged SQL. Use an intended demo/development project. Confirm its reference matches the Project URL in `.env.local`, then preview and run:

```powershell
npx.cmd supabase@3 login
npm.cmd run seed:hosted:dev -- --development-project YOUR_DEVELOPMENT_PROJECT_REF --dry-run
npm.cmd run seed:hosted:dev -- --development-project YOUR_DEVELOPMENT_PROJECT_REF
```

The preview makes no network request. The execution runs SQL against that explicit project and lets the CLI request confirmation. Apply all SeatLink migrations first. This command fills the two existing demo branches with labelled sample menu items and preserves existing records. It does not enable payment simulators or seed organisations, users or memberships.

### Prepare an order

1. Sign in and select a branch. A single authorised branch opens automatically.
2. Add any available food or drink. Change quantities and remove items as needed.
3. Choose **Continue to seats**. PostgreSQL validates menu availability, snapshots names and prices, and calculates the authoritative total. Failed requests retain the cart. Manual draft saving is no longer required.
4. Select one to four AVAILABLE seats. One purchase qualifies for up to four seats, regardless of item type or quantity. Selecting is local until confirmation.
5. Choose **Confirm seats**. The database acquires the entire selection atomically, starts the fixed five-minute reservation, and opens Payment. Conflicts identify seats to replace. **Back to menu** is available before reservation.
6. Select the **Cash** or **QR payment** card. These are native radio controls with keyboard support and a visible selected state. Selecting or switching never marks paid or changes the reservation deadline. For Cash, enter a sufficient amount and choose **Confirm** only after receiving it. For QR, **Confirm** creates or reuses the payment QR. **Processing...** prevents repeated submissions while the request runs. QR generation never marks the order paid.
7. After verified payment, the server marks seats UNAVAILABLE and starts ten minutes of use. The Result step shows the order reference, method, total, seats and expiry. **Active seats** contains the separate release controls.
8. Choose **Start new order** after the result. Earlier paid seats keep their original deadlines. To change a reserved purchase, explicitly choose **Cancel and start again** and confirm that its seats will be released. The cancelled order and payment records remain stored.

Cart previews save after 600 ms of inactivity and seat previews after 200 ms. Refresh restores acknowledged previews, the active step, chosen payment method and server deadlines. An edit interrupted before acknowledgement may be lost. Wait for cart changes to save and clear seat selections before changing branches. A pending checkout must be cancelled or expire first. Closing the browser leaves server timers running.

The header shows the actual membership role, owner identity, branch, station and recent customer-display heartbeat (within 75 seconds). **Checkout**, **Active seats**, **Order history** and **Customer display settings** are separate views. Server-allowlisted development operators also see **Development tools** in Vite development mode.

## Mock payment scenarios

Development controls are denied by default in PostgreSQL. `npm run seed:dev` enables them only when `SEATLINK_DEMO_OWNER_UID` identifies an existing local test user. The browser cannot enable development mode or add itself to the allowlist. Production builds hide simulator controls as an additional UI restriction.

- **Success** — select QR and choose **Confirm**, open **Development tools**, then select **Simulate payment success**. A single ten-minute allocation is created for each reserved seat.
- **Failure and retry** — select **Simulate payment failure** in Development tools, return to Checkout, then **Confirm** again. The original five-minute deadline stays fixed.
- **QR expiry** — wait for the 60-second attempt deadline, then renew while the reservation is still valid. Old attempts stay in history.
- **Reservation expiry** — leave a pending order for five minutes. Scheduled processing or the next sales read releases its locks.
- **Late success** — generate a payment attempt, cancel or let its order expire, then choose that older attempt in the development simulator and simulate success. The successful payment is recorded and flagged for owner assistance. Old seats are never reclaimed.
- **Additional success** — fail and replace an attempt, pay the replacement, then simulate success on the older attempt. The extra successful payment is flagged and produces no new allocations.
- **Duplicate result** — simulate success again for the same successful attempt. Allocation count and deadlines stay fixed.

The demo QR contains a SeatLink development reference. It makes no real charge. Mock events exercise the same database allocation, expiry and exception logic used by the guarded simulator.

To demonstrate against an intended **development project**, enable its development settings and allowlist the test owner as administrator. Do not run this against the linked production-labelled project merely to remove a configuration warning. The existing local `seed:dev` script handles these settings when given an existing test owner's UID. For a separate hosted development project, an administrator can explicitly configure:

```sql
update public.payment_runtime set mode='MOCK', merchant_id=null where singleton;
update public.development_settings set enabled=true where singleton;
insert into public.development_operators(user_id)
select id from auth.users where email='YOUR_DEVELOPMENT_OWNER_EMAIL'
on conflict do nothing;
```

Start Vite development mode to access the separate simulator view. Cash can be used without enabling the QR mock. The application never falls back automatically from sandbox to mock.

Payment exceptions stay visible with an owner follow-up note and an audit trail. Recording a follow-up performs no financial operation. Replacement-seat duration and refund execution remain product decisions.

Cash is blocked while any earlier QR attempt remains unresolved, including hidden, failed or locally expired QR codes. Development tools can **Resolve demo QR before cash** for each outstanding mock attempt. This development operation does not cancel a real provider payment. A delayed extra success records both payments, flags owner review, and leaves allocations and timers unchanged. No automatic refund is performed.

## 2C2P sandbox setup

The adapter is `supabase/functions/_shared/two-c2p.ts`; the trusted HTTP endpoint is `supabase/functions/qr-payment/index.ts`. Only SANDBOX is supported. LIVE configuration is rejected and the provider host is fixed to the sandbox. Synthetic contract fixtures verify request shapes and signatures; no actual 2C2P payment was attempted.

For an explicitly chosen development project, apply migrations through `20261118000800`, then configure the following **Edge Function secrets** in Supabase Dashboard. Provider secrets never belong in `VITE_*` variables or the browser. Keep using the existing `.env.local` for frontend configuration; no additional env file is needed.

| Secret | Value |
| --- | --- |
| `PAYMENT_MODE` | `SANDBOX` |
| `TWO_C2P_MERCHANT_ID` | Issued sandbox merchant ID |
| `TWO_C2P_SECRET` | Issued sandbox HMAC secret |
| `TWO_C2P_CHANNEL_CODE` | Merchant-enabled direct QR channel |
| `TWO_C2P_CALLBACK_URL` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/qr-payment?callback=1` |

Supabase supplies the endpoint's `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server variables. Do not copy the service role key into frontend configuration. On the same development database, run as administrator:

```sql
update public.payment_runtime
set mode = 'SANDBOX', merchant_id = 'YOUR_SANDBOX_MERCHANT_ID'
where singleton;
```

Deploy the endpoint to that intended development project:

```powershell
npx.cmd supabase@3 functions deploy qr-payment --project-ref YOUR_DEVELOPMENT_PROJECT_REF
```

`verify_jwt = false` permits provider callbacks; owner actions explicitly authenticate a Supabase user and pass owner-scoped RLS checks, while callbacks require HS256 authentication and exact merchant, invoice, amount and currency matching. Browser redirects never prove payment. The endpoint creates a signed payment token, requests the configured channel's QR, and stores provider tokens in a browser-inaccessible table. QR images are restricted to the documented sandbox S3 image path and API QR image path. Channel-specific customer fields or another response format require adapter changes and merchant testing; unknown responses fail closed. The provider HTTP host remains sandbox-only.

Concurrent confirmation requests reuse the active attempt under the branch transaction lock. Once-only dispatch prevents repeated provider requests across retries and reopened owner views. Generation failure preserves an unresolved provider attempt and records a safe diagnostic code rather than assuming cancellation. The provider's optional `expiryTimer` is interpreted in milliseconds; its deadline is persisted separately, and QR visibility ends at the earlier of provider expiry or reservation expiry. When no provider timer is available, the UI labels its local cutoff **QR display ends**, not a verified provider expiry. Both screens use the same deterministic current attempt, discard superseded/expired QR data, and recover the active attempt on refresh.

Callbacks reconcile verified results transactionally. **Check payment status**, or the individual **Check QR payment status** controls after switching to Cash, provide inquiry recovery for missed callbacks and uncertain creation responses. Inquiry must return signed, matching cancellation code `0003` before cash can follow that attempt. Other failure, expiry, pending and not-found responses retain the cash block. There is no provider cancellation request or scheduled provider-inquiry worker in this iteration. A failed creation request is claimed once to avoid duplicate dispatch and remains unresolved until inquiry or owner/provider assistance establishes its outcome. Renewal never extends the local reservation; late success goes to review without reclaiming seats.

The provider's `paymentExpiry` is deliberately omitted because its merchant timezone has not been configured. Its QR may remain payable after SeatLink's local deadline, and is treated accordingly. Configure and exercise callbacks, inquiries and the merchant's enabled channel in sandbox before any operational use.

Official contracts used: [Payment Token](https://developer.2c2p.com/docs/api-payment-token), [QR method](https://developer.2c2p.com/docs/direct-api-method-qr-payment), [Backend response](https://developer.2c2p.com/docs/api-payment-response-backend), [Payment Inquiry](https://developer.2c2p.com/docs/api-payment-inquiry), and [response codes](https://developer.2c2p.com/docs/response-code-payment).

Response mapping additionally follows [Do Payment's QR image example](https://developer.2c2p.com/docs/api-do-payment) and its [expiryTimer parameter](https://developer.2c2p.com/docs/api-do-payment-response-parameter).

## Pair the customer display

### Vercel deployment and direct display links

The confirmed failing request on 23 November 2026 was `https://seat-link.vercel.app/display` (the `#` pairing token stays in the browser). HTTP inspection returned Vercel `404 NOT_FOUND` with `text/plain`, while `/`, the deployed JavaScript/CSS bundles and `/favicon.svg` returned 200. The supplied pairing token separately returned 200 from Supabase's restricted `read_customer_display` RPC. This was a page-routing failure before React or Supabase ran, rather than a failed asset or Edge Function request.

Vite's development server serves the SPA shell for direct routes locally. Vercel needs the corresponding rewrite. The app-root `vercel.json` now rewrites only `/display`, `/display/`, `/owner` and `/owner/` internally to `/index.html`. This preserves the visible URL, query parameters and pairing fragment; asset paths, `/api/*`, unknown paths and external Supabase requests are not caught by a broad fallback. Pairing already generates `/display#TOKEN` from `window.location.origin`, with no hardcoded localhost destination. The display client keeps Supabase auth URL detection disabled so it does not consume the pairing fragment.

For this repository, use these Vercel Project → Settings → Build and Deployment values:

| Setting | Value |
| --- | --- |
| Root Directory | `seatlink` (the directory with this README, `index.html`, `vercel.json` and the Vite `package.json`) |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist`, relative to Root Directory |
| Install Command | Default / `npm ci` |

The repository's parent `package.json` contains only a Supabase dependency and is not the frontend build root. `vercel.json` pins the framework/build/output inside the application root. Dashboard overrides and the deployment's actual Root Directory could not be inspected because the local Vercel CLI has no valid authentication token; successful existing root/asset responses show that the current deployment already serves a Vite build.

Commit and push the routing configuration with the application changes, then redeploy the same Vercel project. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured in that deployment's Vercel environment; `.env.local` remains the local configuration file. No Supabase migration or Edge Function deployment is needed for this routing fix.

After redeployment, check:

1. Open `/display` directly: it should load SeatLink's **Pair this display** screen with HTTP 200.
2. Open the generated pairing link directly, then refresh it. The same station should load, without owner sign-in, and the token/query string should remain in the address bar. Reuse a valid existing link, or deliberately pair again if it expired; pairing again replaces the prior link.
3. Check `/display/?source=pairing#TOKEN`, `/owner?branch=BRANCH_ID` and their refreshes.
4. Confirm the built JS/CSS and `/food/iced-tea.svg` load with their correct content types. `/api/nonexistent` and `/assets/nonexistent.js` should still return 404 rather than application HTML.
5. Pair from **Customer display settings**, open the generated link on the deployed origin, and verify cart/payment updates reach that display.

The local production build/type checking, lint and mocked owner/display tests validate link generation, direct display mounting, refresh/remount, query/fragment preservation and subscription recovery. The added Vercel configuration has not been deployed by this task, so post-fix production navigation, refresh and the complete production pairing flow remain unverified. Vercel documents the SPA deep-link requirement in [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and internal URL-preserving behavior in [Rewrites](https://vercel.com/docs/routing/rewrites).

Open **Customer display settings**, choose **Pair customer display**, then open the generated link in another window.

Each counter is a checkout_stations row with its own current-order pointer. This implementation creates one counter per owner per branch. Two different owners in the same branch therefore use separate counters. Multiple windows signed in as the same owner in the same branch share that counter.

Pairing links last 24 hours and contain an unguessable token in the URL fragment. Pairing again replaces earlier links for that counter. Only a hash is stored in the database.

The `/display#PAIRING_TOKEN` route uses a separate Supabase client with session persistence, automatic owner-session refresh and URL auth detection disabled. It reads only `read_customer_display` using its pairing token. It never loads the owner's session.

The display shows its branch/counter, current order items, total, selected seats, availability, demo QR and payment result. It has an idle screen. Expired or obsolete QR content is cleared. Switching pairing tokens clears the previous counter immediately and cleans up its subscription.

Realtime messages on public counter topics contain only an invalidation flag. Checkout data is fetched again through the token-authorised RPC. A public broadcast cannot mark a payment successful. [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

## Paid seat use and extensions

Paid sessions store independent server deadlines. Individual and grouped release requests carry seat-use session IDs. A stale release cannot affect a seat reassigned to another session.

Allowlisted development operators can enter positive whole minutes in **Development tools** and choose an **Extend Table / Seat** action. Time is added to the current expiry. The database deduplicates request IDs. There is no product limit on extension count or duration. Safe-number and database timestamp bounds still apply.

The hardware HTTP boundary is implemented in `supabase/functions/seat-extension/index.ts`. Its request body is:

```json
{
  "requestId": "UUID",
  "seatId": "UUID",
  "seatUseSessionId": "UUID",
  "additionalSeconds": 180
}
```

A provisioned device sends its opaque token in `Authorization: Bearer DEVICE_TOKEN`. The endpoint validates the contract and calls the table-scoped database operation. Devices cannot extend seats on another physical table. Raw device tokens are never stored.

An administrator can provision a deliberately chosen local device with this SQL. The result is the one-time device token, so store it securely.

```sql
with device as (
  select replace(gen_random_uuid()::text, '-', '') ||
         replace(gen_random_uuid()::text, '-', '') as token
), inserted as (
  insert into public.hardware_devices (table_id, token_hash)
  select 'PASTE_LOCAL_TABLE_UUID'::uuid,
         encode(sha256(convert_to(token, 'UTF8')), 'hex')
  from device
  returning id
)
select device.token from device cross join inserted;
```

Serve the endpoint locally after starting Supabase.

```powershell
npx.cmd supabase@3 functions serve seat-extension
```

The function uses `verify_jwt = false` because device tokens use its own authentication contract. The endpoint and RPC verify device authority. Built-in Supabase URL/anon-key environment variables configure its database client. [Function configuration](https://supabase.com/docs/guides/functions/function-configuration)

## Migrations, scheduled processing and Realtime

The new migrations are additive and preserve application data.

- `20261118000200_demo_checkout_schema.sql` adds development access configuration, membership role data, checkout stations, attempts, paid-use sessions, device identity, idempotency and audit tables.
- `20261118000300_payments_and_seat_use.sql` adds guarded payment simulation, allocation, release, extensions and owner follow-up operations.
- `20261118000400_customer_display.sql` adds restricted pairing/projections and display invalidation triggers.
- `20261118000500_guided_checkout.sql` adds explicit checkout steps, cart/seat previews and persisted method selection.
- `20261118000600_cash_and_sandbox_payments.sql` adds transactional cash receipts and trusted sandbox reconciliation.
- `20261118000700_guided_display.sql` adds guided display projections, heartbeat and once-only sandbox creation dispatch.
- `20261118000800_qr_confirmation_and_display.sql` adds confirmation reuse, canonical owner/display attempts, QR diagnostics and provider expiry mapping.

The existing Cron job calls `public.expire_order_sessions()` every 30 seconds. The upgraded function also expires paid seat-use sessions and payment attempts. It rechecks the current session ID and deadline and skips busy branches for retry on the next pass. Owner and display reads also recover expired records before returning data. A periodic pass can be delayed by load, so stored status changes occur on the next successful pass or relevant operation.

After applying migrations, verify **Integrations → Cron** contains an active `seatlink-expire-orders` job and inspect its run history. If pg_cron was unavailable during setup, enable it in **Database → Extensions** and schedule:

```sql
select cron.schedule(
  'seatlink-expire-orders', '30 seconds',
  'select public.expire_order_sessions()'
);
```

Verify **Database → Publications → supabase_realtime** includes menu_items, orders, seats, payment_attempts, seat_use_sessions and payment_exceptions. The owner batches events and uses a 30-second visible-screen safety refresh while connected, with five-second fallback polling while disconnected. The display uses safe broadcast invalidations with equivalent polling recovery. Both clean up subscriptions and refetch after reconnect.

For an authorised hosted **development** project, review the migration preview before applying it.

```powershell
npx.cmd supabase@3 link --project-ref YOUR_DEVELOPMENT_PROJECT_REF
npx.cmd supabase@3 db push --dry-run --remote
npx.cmd supabase@3 db push --remote
```

No remote migration, sample seed, mock enablement or Edge Function deployment was performed for the linked production-labelled project. Use real menu records for production. The local seed command rejects remote hosts.

## Validation

The feature boundary remains `src/features/checkout`: `GuidedCheckout` selects one workspace using the explicit persisted step; `MenuCart`, `SeatSelection`, `PaymentStep`, `ResultStep` and `OrderSummary` own their presentations. `useCheckout` coordinates previews; `usePayment` coordinates method selection, guarded confirmation and inquiry. `checkout-service` owns typed RPC/Edge calls and owner-safe error mapping. `PaymentQr` is shared by owner and customer screens; `FoodThumbnail` owns curated image matching/fallbacks. `components/Icon` provides the shared stroke style. `OwnerTools` holds separate management views. `Sales` coordinates branch snapshots and workspace navigation. `features/display` retains its isolated token-authorised reader and subscription lifecycle, and discards snapshots invalidated while in flight. Shared global CSS contains base styles/tokens; component styles remain colocated. Backend RPCs validate ownership, prices, timers and allocation independently of the displayed step.

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
npm.cmd run test:postgres
```

The native PostgreSQL suite creates an isolated temporary loopback database, runs assertions as representative authenticated/anonymous identities, and observes competing transactions waiting on seat and payment locks. It stops that database afterward. The standard tests use PGlite for SQL scenarios and React Testing Library for UI behaviour.

Verification on 18 November 2026 passed `npm.cmd run build` (including TypeScript), `npm.cmd run lint`, `npm.cmd test` (60 tests), and `npm.cmd run test:postgres` (7 tests). Deno checking passed for the updated qr-payment endpoint; seat-extension also passed in the preceding milestone. UI tests cover guided cash completion, mock failure/retry/success, all four restored steps, cancellation, cart error retention, conflicts, radio keyboard navigation, image fallback and restricted display rendering/reconnect. An owner/customer test renders both screens together, restores their identical current mock attempt on display remount, then verifies both remove QR after backend mock success. These UI tests use mocked service responses. SQL tests exercise actual transitions and permissions, including two concurrent QR confirmations producing one attempt, a cash/late-QR race, canonical display projections, expiry and old-order isolation. Provider tests use synthetic signed fixtures and stub HTTP responses; they do not contact 2C2P.

Coverage includes authentication, authorised branch reads, authoritative prices, idempotent draft saves, zero/duplicate/fifth/cross-branch seat rejection, atomic conflicts, fixed deadlines, failed/retried payments, QR expiry, successful allocations, duplicate and late success, release scopes, extension retries/device scope, expiry after extension/reassignment, restricted counter projections, QR removal and subscription cleanup.

This turn's hosted inspection was read-only: migrations through `00700`, runtime flags, allowlist count, attempt counts and deployed function list. No hosted settings or data were changed. Migration `00800` and the payment endpoint still need application/deployment to the intended project. Computer-use visual verification was stopped by its URL-verification safety guard, so no visual browser pass is claimed; the temporary visual fixture files were removed. No additional frontend server was started: port 5173 was already in use and strict-port startup exited. Hosted Realtime delivery, scheduled job execution and actual provider/hardware endpoints remain unverified. Sandbox credentials and channel testing are still required; live charging remains disabled. The build has the existing bundle-size warning above 500 kB.

The production dependency audit previously reported zero vulnerabilities. The existing development tooling has picomatch-related audit findings, described by [the advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
