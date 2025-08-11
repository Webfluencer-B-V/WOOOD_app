# Cloudflare Worker

This document tracks the progress of consolidating functionality from the legacy `workers/` directory into the main `worker.ts` file.

## Overview

The goal is to consolidate all Cloudflare Worker functionality into a single `worker.ts` file while maintaining the same API endpoints and functionality. This consolidation will:

- Reduce code duplication
- Simplify deployment and maintenance
- Provide a single source of truth for worker functionality
- Enable better feature flag management

## Status

**Current Phase:** In Progress

### Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Delivery Dates API | ✅ Consolidated | DutchNed API integration with mock fallback |
| Store Locator | ✅ Consolidated | Dealer fetch, transform, shop metafield upsert, cron |
| Experience Center | ✅ Consolidated | Bulk Operations flow migrated (JSONL parsing, 25-item metafield batches, EAN match tracking) |
| Webhooks | ✅ Consolidated | Order webhook handler and registration endpoints migrated |

## What Has Been Consolidated

### Store Locator Functionality

- **Dealer Data Fetching**: `fetchAndTransformDealers()` function migrated from `workers/src/index.ts`
- **Exclusivity Mapping**: `mapExclusives()` function and `EXCLUSIVITY_MAP` constant migrated
- **Shop Metafield Updates**: `upsertShopMetafield()` function migrated
- **Shop Token Management**: `getShopAccessToken()`, `getInstalledShops()`, `cleanupOldTokens()` functions migrated
- **API Endpoints**: `/api/store-locator?action=upsert` and `/api/store-locator?action=status` fully functional
- **Scheduled Tasks**: Store locator sync runs every 6 hours via cron job

### Delivery Dates API

- **Mock Date Generation**: `generateMockDates()` and `formatDateInDutch()` functions migrated
- **DutchNed API Integration**: Maintained fallback to mock dates when API unavailable
- **API Endpoint**: `/api/delivery-dates?shop={shop}` fully functional

### Experience Center (Bulk Operations)

- **External Data**: `fetchExperienceCenterData()` migrated (EC-only filtering, totals)
- **Bulk Operations**: `processExperienceCenterWithBulkOperations()` migrated
- **JSONL Parsing**: Download/poll, JSONL parse, map products/variants/barcodes
- **Metafield Updates**: `setProductExperienceCenterMetafieldsBulk()` (25 per request)
- **Multi-shop Runner**: `processExperienceCenterUpdateAllShops()` with time management and KV status
- **API Endpoints**: `/api/experience-center?action=trigger` and `/api/experience-center?action=status`

### Webhooks

- **Order Webhook**: `handleOrderWebhook()` migrated with signature validation
- **Registration**: `registerWebhooks()` migrated; test endpoint maintained
- **API Endpoints**: `/api/webhooks?action=order` and `/api/webhooks?action=test`

## Not In Scope / Already Handled

- **OAuth & Installation Flow**: `handleInstall()` and `handleCallback()` are not part of this consolidation plan
- **Utility Functions**: CORS helpers (`getAllowedOrigin()`, `addCorsHeaders()`), domain validation (`isValidShopDomain()`), and note attribute transformation (`transformNoteAttributesToMetafields()`) are not required here

## Remaining Work

- **Offline Admin Token**: Ensure a valid offline Admin API access token per shop (KV-backed) for EC metafield processing and webhook registration reliability

## Migration Strategy

### Phase 1: ✅ Complete
- Store locator functionality
- Delivery dates API
- Basic infrastructure

### Phase 2: ✅ Complete
- Experience center bulk operations flow
- Webhook processing & registration

### Phase 3: Final
- Provision offline token(s) and validate end-to-end
- Remove legacy workers directory
- Update deployment scripts
- Final testing and validation

## Environment Variables

The consolidated worker requires these environment variables:

```bash
# Core
ENVIRONMENT=production|staging|development

# Shopify App
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET_KEY=your_secret_key
SHOPIFY_APP_URL=your_app_url

# Delivery Dates API
DUTCHNED_API_URL=your_dutchned_api_url
DUTCHNED_API_CREDENTIALS=your_credentials

# Store Locator
SHOPIFY_ADMIN_API_ACCESS_TOKEN=your_token
SHOPIFY_STORE_URL=your_store_url
DUTCH_FURNITURE_BASE_URL=your_api_url
DUTCH_FURNITURE_API_KEY=your_api_key

# KV Namespaces
WOOOD_KV=your_kv_namespace
STORE_LOCATOR_STATUS=your_status_kv
EXPERIENCE_CENTER_STATUS=your_status_kv
```

## Testing

### Local Development

```bash
# Test the consolidated worker
npm run dev

# Test specific endpoints
curl "http://localhost:8787/api/store-locator?action=status"
curl "http://localhost:8787/api/delivery-dates?shop=test.myshopify.com"
curl "http://localhost:8787/api/experience-center?action=status"
curl "http://localhost:8787/health"
```

### Staging Deployment

```bash
# Deploy to staging
cd workers
npx wrangler deploy --env staging

# Tail logs
npx wrangler tail woood-staging --env staging --format pretty
```

## Next Steps

1. Provision and store an offline Admin API token per shop for EC metafield processing
2. Validate EC bulk operations and webhook flows in staging with offline token(s)
3. Remove legacy code in `workers/` after validation
4. Update any remaining tests and documentation

## Notes

- The consolidation maintains backward compatibility with existing API endpoints
- Feature flags allow easy enabling/disabling of functionality
- Scheduled tasks are consolidated and run from a single worker
- KV storage integration provides status tracking and monitoring
