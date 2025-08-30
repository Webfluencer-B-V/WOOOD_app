## Deployment Architecture (Single GitHub Strategy)

This repository uses a single GitHub-driven deployment strategy that manages two environments end-to-end:

- Staging (preview): deploy on branch pushes and pull requests
- Production (release): deploy on semver tags under `releases/*`

### Goals

- One source of truth: GitHub workflows own staging and production
- Zero local env switching: local pushes are minimal and not required for deploys
- Separate Shopify Apps and Cloudflare Workers for staging and production

### High-level

- Cloudflare (Workers):
  - Staging: job `preview` uploads and deploys a version tagged with the short SHA
  - Production: job `release` merges `build/server/wrangler.json` with `wrangler.prod.json`, uploads a version using the semver tag, then deploys that version

- Shopify (Apps):
  - Staging: jobs `build` + `deploy` build extensions and deploy to staging app (`shopify.app.toml`)
  - Production: job `release` switches to production config (`shopify.app.prod.toml`), then releases the built extensions versioned by the semver tag

### Triggers

- Branch pushes to `main`: staging deploys for both Shopify and Cloudflare
- Tags `releases/*`: production release for both Shopify and Cloudflare

### Versioning

- Tag format: `releases/<semver>` (e.g., `releases/1.2.3`)
- Cloudflare:
  - Preview: message includes branch and short SHA
  - Release: message `release-<semver>` and tag `<semver>`
- Shopify:
  - Deploy (staging): message is branch name, no release
  - Release (production): version `release-<semver>`

### Environment configs

- `wrangler.json`: staging worker config
- `wrangler.prod.json`: production worker config used in CI merge step
- `shopify.app.toml`: staging app config (committed)
- `shopify.app.prod.toml`: production app config (committed); copied over `shopify.app.toml` only in the production release job

### Secrets and Vars

- Use GitHub Environments or repo-level secrets/vars:
  - Shopify: `SHOPIFY_CLI_PARTNERS_TOKEN`, `vars.SHOPIFY_API_KEY`, `vars.SHOPIFY_APP_URL`
  - Cloudflare: `CLOUDFLARE_API_TOKEN`
  - Node version: `env.NODE_VERSION` (pinned to `'22'`)

### Local development

- Local pushes should be minimal; CI is the deploy mechanism
- Use `bin.sh triggerWorkflow <workflow> [event]` with `act` to rehearse flows
- Workflows skip Cloudflare deploy steps under `act` to avoid external calls

### Files touched by CI

- Cloudflare:
  - Merges: `build/server/wrangler.json` + `wrangler.prod.json` -> `build/server/wrangler.prod.json`
  - Uploads: `wrangler versions upload --json` -> captures version id
  - Deploys: `wrangler versions deploy --version-id <id>`

- Shopify:
  - Staging: `npx shopify app deploy` (no release)
  - Production: copy `shopify.app.prod.toml` over `shopify.app.toml`, then `npx shopify app release`

### Operational notes

- All messages and tags avoid colons; use hyphens (release-1.2.3)
- Wrangler metrics disabled via `WRANGLER_SEND_METRICS=false`
- Tests only run on pull_request with secret gating


