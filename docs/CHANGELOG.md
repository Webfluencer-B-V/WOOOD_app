# WOOOD App – Changelog

## Plan: Run features inside the app using app auth/context and `shopify.webhooks.tsx`

Goal: Move feature execution from Worker-only endpoints to app routes that use the existing `createShopify(context)` auth and app structure. Trigger actions from Polaris UI elements/buttons and keep webhook intake on the app route.

Scope

- Replace Worker-facing APIs with app routes/actions wherever feasible
- Reuse the current util modules as pure helpers (no direct env token access)
- Persist shop state via KV (existing `SESSION_STORAGE` / `WOOOD_KV`) and enqueue long work via Queues when needed

What stays on the app

- Webhook intake: `app/routes/shopify.webhooks.tsx` (already implemented). It validates HMAC, normalizes headers, mutates session on uninstall/scope change, and enqueues the payload. This is persistent (KV + Queues) and does not require user sessions.
- Admin API access: Always obtain via `createShopify(context).admin(request)` or an offline token stored in KV for background work. Do not use raw env tokens directly in helpers.

Migration by module

1) `src/utils/webhooks.ts`

- Keep HMAC validation helper, but consume it only from the app
- Move topic handling into `shopify.webhooks.tsx` (e.g., `orders/create`, `orders/paid`, `app/uninstalled`).
- Uninstall cleanup: call `shopify.session.delete(shop)` instead of a Worker-only function.
- Registration: expose an app Action (e.g., `routes/app.tsx` action `registerWebhooks`) that calls the Admin API using `createShopify(context).admin(request)`; remove hard-coded `env.SHOPIFY_APP_URL` dependency.

1) `src/utils/experienceCenter.ts`

- Convert helpers to be pure (no direct `env.WOOOD_KV` reads for tokens). Accept a `getAccessToken(shop)` callback or a `shopify` client instance.
- App Action: add a Polaris “Sync Experience Center” button to the app dashboard (`/app`). The button sends a POST to an action that:
  - Fetches EC data via `fetchExperienceCenterData(context.cloudflare.env)`
  - Gets the current shop (from session/context)
  - Gets an Admin client for that shop via `createShopify(context).admin(request)` or uses the offline token from KV
  - Runs `setProductExperienceCenterMetafieldsBulk` for that shop
  - Writes a compact status summary for that shop to `EXPERIENCE_CENTER_STATUS`
- Optional: For very large syncs, enqueue a job for that shop and return “sync started” to the UI; consume from Queue in app environment (or Worker if we prefer), updating KV status for that shop as chunks complete.

1) `src/utils/storeLocator.ts`

- Convert helpers to pure utilities. Accept injected token/client rather than reading from env directly.
- App Action: add a Polaris “Update Store Locator” button. The action:
  - Calls `fetchAndTransformDealers(env)` (Dutch Furniture API)
  - In the app, trigger the update for the current shop instance. Get the Admin client for the current shop and write the dealers JSON to the shop metafield via GraphQL.
  - Stores a brief status in `STORE_LOCATOR_STATUS`
- Provide a small status loader on the page to show last sync time and counts.

1) `src/utils/consolidation.ts`

- Keep `Env` and feature flags here as source of truth; prefer `context.cloudflare.env` inside app routes.
- Reduce direct token/environment usage in helpers. Tokens are resolved by the app (`createShopify().admin` or KV offline tokens) and passed in.

Endpoints/Routes changes

- Deprecate Worker routes:
  - `/api/experience-center` → replace with app action under `/app` (POST) for “Sync EC”, plus a `/app` loader for status.
  - `/api/store-locator` → replace with app action under `/app` (POST) for “Update Store Locator”, plus a `/app` loader for status.
- Keep `shopify.webhooks.tsx` as the single webhook intake path. Topic handling occurs here; heavy work is enqueued.

UI

- Add Polaris actions to `/app` (or a dedicated settings page):
  - Button “Sync Experience Center” (POST to action)
  - Button “Update Store Locator” (POST to action)
  - Button “Register Webhooks” (POST to action)
- Show compact status widgets using loaders that read KV summaries.

Per‑shop execution and cron model

- App dashboard actions operate on the current shop only (derived from session/context). No cross‑shop loops from the UI.
- Scheduled work (cron) must be scoped so only the designated shop(s) run it (e.g., production store + staging). Implementation:
  - Add a KV flag (e.g., `scheduler:leaderShop = <shop-domain>`) and guard scheduled handlers to no‑op unless `currentShop === leaderShop`.
  - Alternatively, maintain an allow‑list KV key (e.g., `scheduler:enabledShops = [..]`) and gate per feature.
  - Status KV keys should be namespaced per shop (e.g., `EXPERIENCE_CENTER_STATUS:ec_last_sync:<shop>`), so dashboards show the current shop’s status only.

Testing

- Unit: move Admin API dependent logic behind injected clients; stub `createShopify().admin` in tests.
- E2E: keep “public index” and “proxy” tests; add app action tests that submit forms and validate success toasts/status changes. Webhook E2E remains non-deterministic vs Shopify Admin; validate app route acceptance and queue enqueue.

Rollout steps

1. Introduce app actions + Polaris buttons; wire loaders for status (no removal yet)
2. Switch UI to call app actions; verify in staging
3. Update Playwright to hit the new actions (with mocks if needed)
4. Remove Worker endpoints `/api/experience-center` and `/api/store-locator`
5. Keep `shopify.webhooks.tsx` as the canonical intake; ensure queue consumer reads offline tokens from KV
6. Document new flows in `docs/API.md` and update CHANGELOG with “Completed”

Notes

- Offline tokens: persist per shop in KV at OAuth; both app actions and queue consumers should look them up via KV (or via `shopify.session`).
- Background sync: prefer Queue + consumer for long operations; app action returns immediately and the page shows status via KV.

Post‑validation TODO (after E2E passes on Polaris v12)

- Add scheduler gating for cron enqueues:
  - `scheduler:leaderShop = <shop-domain>` to gate which shop (or all via `*`) initiates scheduled work
  - Optional `scheduler:enabledShops = [..]` allow‑list to filter target shops
  - No‑op if current shop is not leader or not enabled

## Completed (App actions + Queues + Deprecations)

- **routes/app.index.tsx**: Implemented loader to read per‑shop KV status (`ec_last_sync:<shop>`, `sl_last_sync:<shop>`) and actions for `sync-experience-center`, `sync-store-locator`, and `register-webhooks`. Uses `createShopify(context).admin(request)` and pure utils. Writes success/error status back to KV. Added Polaris UI (Cards, Buttons, Banners, Badges) with loading states.
- **routes/shopify.webhooks.tsx**: Centralized webhook intake using app auth. Handles uninstall/scope updates via session APIs; logs order webhooks and enqueues to `WEBHOOK_QUEUE`.
- **src/utils/experienceCenter.ts**: Refactored to pure functions: `fetchExperienceCenterData`, `processExperienceCenterWithBulkOperations`, and `setProductExperienceCenterMetafieldsBulk`. No direct `Env` access; accepts injected `ExperienceCenterApiConfig` and `ShopifyAdminClient`.
- **src/utils/storeLocator.ts**: Refactored to pure functions: `fetchAndTransformDealers` and `upsertShopMetafield` with injected `DealerApiConfig` and `ShopifyAdminClient`.
- **src/utils/webhooks.ts**: Kept `validateWebhookSignature`, `handleAppUninstalled` helpers; `registerWebhooks` implemented via Admin GraphQL. All accept injected dependencies.
- **app/types/app.ts**: Added `ScheduledJobMessage`, `ScheduledJobType`, and `QueueMessage` unions for queue processing.
- **worker.ts**: Implemented queue‑based automation. Cron enqueues per‑shop jobs to `SCHEDULED_QUEUE`; consumer processes jobs and updates per‑shop KV status. Deprecated legacy Worker endpoints to return 410. Removed legacy `cleanupOldTokens` (token‑cleanup messages are a no‑op).
- **tests**: Updated API E2E to require 404/410 for deprecated Worker endpoints. Added server tests for `app.index` loader/actions. Fixed linter issues across tests.

## Remaining work (validation, typing, scheduler gating)

### routes/

- **Polaris unit/integration tests (no E2E)** for `app.index` UI:
  - Assert loader status rendering (badges, timestamps, counts) using mocked loader data.
  - Assert form submit loading states using mocked navigation state.
  - Assert success/error banners via `actionData`.
- Optional: extract small presentational components for status widgets to simplify tests.

### types/

- Add first‑class types for KV status payloads shared between Worker and App:
  - `ExperienceCenterStatus = { timestamp: string; success: boolean; summary?: { successful: number; failed: number }; shop: string; error?: string }`.
  - `StoreLocatorStatus = { timestamp: string; success: boolean; count?: number; shop: string; error?: string }`.
- Export these in `app/types/app.ts` and use in `app.routes/app.index.tsx` and Worker.

### src/hooks/useDeliveryDates.ts

- Add unit tests for `fetchDeliveryDates` happy/edge paths (4xx no‑retry, 5xx retry, timeout handling).
- Add a lightweight test harness for the hook that stubs `useQuery` and `useQueryClient` to validate query config and keying.
- Ensure the consuming app passes `apiBaseUrl` from `CLOUDFLARE_URL` env consistently in loaders/providers (doc note only; no code change needed here).

### src/utils/experienceCenter.ts

- Improve typing for EC API response (replace pervasive `any` with interfaces; narrow JSONL parsing types).
- Extract shared constants (e.g., batch size, poll interval, max wait) at top‑level for configurability.
- Add unit tests:
  - bulk operation happy path with JSONL parse producing correct `eanMatches`/counts.
  - error propagation on userErrors, timeout, and download failures.

### src/utils/storeLocator.ts

- Define `Dealer` interface and shape transformations; remove remaining `any` where feasible.
- Unit tests for `mapExclusives` and dealer filtering/normalization.
- Consider chunking very large dealer payloads (if needed) before metafield write; document size limits.

### src/utils/webhooks.ts

- Add idempotent webhook registration check (query existing subscriptions to avoid duplicates) and surface userErrors in results for logging.
- Unit tests for `validateWebhookSignature` and `registerWebhooks` (mock Admin client and error paths).

- Add scheduler gating keys to `Env` and document usage:
  - `SCHEDULER_LEADER_SHOP?: string` (maps to KV `scheduler:leaderShop`).
  - `SCHEDULER_ENABLED_SHOPS?: string` (JSON list; maps to KV `scheduler:enabledShops`).
- In Worker, read these keys from KV and no‑op cron enqueue if not leader/not enabled. Documented here; implementation pending post‑validation.

## Upcoming: API Endpoints (Consolidated Worker)

- Standardize endpoints (feature‑flagged):
  - `GET /api/delivery-dates?shop=<shop-domain>`
  - `POST /api/store-locator?action=upsert`
  - `POST /api/experience-center?action=trigger`
  - `GET /api/experience-center?action=status`
  - `GET /health`
- Deprecations (return 410 with guidance):
  - Any legacy `/api/*` not listed above
  - `/api/webhooks/*` on Worker (webhooks live at `app/routes/shopify.webhooks.tsx`)
- App routes remain UI + webhook intake; Worker handles automation/cron/queues.

### Feature Flags (no‑break rollout)

- `ENABLE_DELIVERY_DATES_API` gates `/api/delivery-dates`
- `ENABLE_STORE_LOCATOR` gates `/api/store-locator`
- `ENABLE_EXPERIENCE_CENTER` gates `/api/experience-center`
- `ENABLE_WEBHOOKS` reserved (intake handled by app)

## Deprecation Plan

- Environment files for Worker: deprecate `.env*` reads. Source of truth:
  - Cloudflare `wrangler.json` `vars` and `wrangler secret`
  - Shopify CLI config for app build/dev
- `src/utils/consolidation.ts`: removed; flags moved to `src/config/flags.ts`, types moved to `app/types/app.ts`.
  - Move `Env` to `app/types/app.ts` and extend via `worker-configuration.d.ts`
  - Move flags to `src/config/flags.ts` with typed defaults
  - Move shared domain types to `src/types/*`

### One Deployment Source

- Single workflow `.github/workflows/deploy.yml`:
  - Install deps, `npm run build:web`, then `npm run build`
  - Deploy Worker via `cloudflare/wrangler-action@v3` using root `wrangler.json`
  - Deploy Shopify extensions via `npm run deploy:shopify` (optional)
- Remove `workers/` package as deployable unit post‑validation.

### Timeline

1. Document standardized endpoints and enable flags on staging
2. Migrate secrets/env to Cloudflare vars/secrets; stop Worker `.env*` reads
3. Move `Env`/flags/types; delete `src/utils/consolidation.ts` and `/docs/CONSOLIDATION.md`
4. Remove legacy `workers/` folder; verify CI green
5. Do not keep 410 deprecated endpoints for two releases
