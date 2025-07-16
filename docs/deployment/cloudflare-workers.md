# Cloudflare Workers Deployment Guide

## Overview

This guide covers deploying and managing the WOOOD Delivery API on Cloudflare Workers, including environment setup, KV storage management, and troubleshooting.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ installed
- [Yarn](https://yarnpkg.com/) package manager
- Cloudflare account with Workers plan
- Domain for custom endpoints (optional but recommended)

## Quick Start

```bash
# 1. Install dependencies
cd workers
yarn install

# 2. Authenticate with Cloudflare
wrangler auth login

# 3. Deploy to staging
wrangler deploy --env staging

# 4. Deploy to production
wrangler deploy --env production
```

## Environment Setup

### 1. Install Wrangler CLI

```bash
# Install globally
npm install -g wrangler

# Or use with npx
npx wrangler --version
```

### 2. Authentication

```bash
# Login to Cloudflare account
wrangler auth login

# Verify authentication
wrangler whoami
```

### 3. Configure Secrets

Set up required secrets for each environment:

```bash
# Production secrets
wrangler secret put DUTCHNED_API_CREDENTIALS --env production
wrangler secret put EXTERNAL_ERROR_REPORTING_TOKEN --env production
wrangler secret put WEBHOOK_SECRET --env production
wrangler secret put ANALYTICS_API_KEY --env production

# Staging secrets
wrangler secret put DUTCHNED_API_CREDENTIALS --env staging
wrangler secret put EXTERNAL_ERROR_REPORTING_TOKEN --env staging
wrangler secret put WEBHOOK_SECRET --env staging
wrangler secret put ANALYTICS_API_KEY --env staging
```

### 4. Create KV Namespaces

```bash
# Create production KV namespace
wrangler kv:namespace create "DELIVERY_CACHE" --env production
wrangler kv:namespace create "DELIVERY_CACHE" --env production --preview

# Create staging KV namespace
wrangler kv:namespace create "DELIVERY_CACHE" --env staging
wrangler kv:namespace create "DELIVERY_CACHE" --env staging --preview
```

Update `wrangler.toml` with the returned namespace IDs:

```toml
[[env.production.kv_namespaces]]
binding = "DELIVERY_CACHE"
id = "your-production-namespace-id"
preview_id = "your-production-preview-namespace-id"

[[env.staging.kv_namespaces]]
binding = "DELIVERY_CACHE"
id = "your-staging-namespace-id"
preview_id = "your-staging-preview-namespace-id"
```

## Deployment Environments

### Development (Local)

```bash
# Start local development server
wrangler dev

# With remote KV storage
wrangler dev --remote

# Custom port
wrangler dev --port 8788
```

### Staging

```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy with custom name
wrangler deploy --env staging --name woood-delivery-api-staging-v2

# Dry run (validate without deploying)
wrangler deploy --env staging --dry-run
```

### Production

```bash
# Deploy to production
wrangler deploy --env production

# Deploy with confirmation
wrangler deploy --env production --compatibility-date 2024-01-15

# Emergency rollback
wrangler deploy --env production --keep-vars
```

## Custom Domain Configuration

### 1. DNS Setup

Configure DNS records for your custom domain:

```
# Production
api.woood-delivery.com -> CNAME -> woood-delivery-api.workers.dev

# Staging
staging-api.woood-delivery.com -> CNAME -> woood-delivery-api-staging.workers.dev
```

### 2. SSL Configuration

Cloudflare automatically provisions SSL certificates for custom domains:

- **Universal SSL**: Free, covers apex and first-level subdomains
- **Advanced Certificate Manager**: Paid, custom certificates
- **Edge Certificates**: 15-year validity

### 3. Route Configuration

Routes are configured in `wrangler.toml`:

```toml
# Production routes
[[env.production.routes]]
pattern = "api.woood-delivery.com/*"
zone_name = "woood-delivery.com"

# Staging routes
[[env.staging.routes]]
pattern = "staging-api.woood-delivery.com/*"
zone_name = "woood-delivery.com"
```

Verify route configuration:

```bash
wrangler routes list --env production
wrangler routes list --env staging
```

## Environment Variables

### Core Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ENVIRONMENT` | Deployment environment | `development` | Yes |
| `DUTCHNED_API_URL` | DutchNed API endpoint | - | Yes |
| `API_TIMEOUT` | Request timeout (ms) | `10000` | No |
| `MAX_RETRIES` | Max retry attempts | `3` | No |
| `CACHE_DURATION` | Cache TTL (ms) | `300000` | No |

### Feature Flags

| Flag | Description | Production | Staging | Development |
|------|-------------|------------|---------|-------------|
| `ENABLE_CACHING` | KV cache for API responses | `true` | `true` | `true` |
| `ENABLE_RATE_LIMITING` | Request rate limiting | `true` | `true` | `true` |
| `ENABLE_MOCK_FALLBACK` | Mock data fallback | `true` | `true` | `true` |
| `ENABLE_DEBUG_LOGGING` | Verbose logging | `false` | `true` | `true` |
| `ENABLE_PERFORMANCE_MONITORING` | Performance tracking | `true` | `true` | `true` |

### Setting Variables

```bash
# Set environment variable
wrangler secret put VARIABLE_NAME --env production

# List all variables
wrangler secret list --env production

# Delete variable
wrangler secret delete VARIABLE_NAME --env production
```

## KV Storage Management

### Namespace Operations

```bash
# List namespaces
wrangler kv:namespace list

# Create namespace
wrangler kv:namespace create "NEW_NAMESPACE"

# Delete namespace
wrangler kv:namespace delete --namespace-id="namespace-id"
```

### Key Operations

```bash
# List keys
wrangler kv:key list --binding=DELIVERY_CACHE --env production

# Get value
wrangler kv:key get "cache_key" --binding=DELIVERY_CACHE --env production

# Put value
wrangler kv:key put "cache_key" "value" --binding=DELIVERY_CACHE --env production

# Delete key
wrangler kv:key delete "cache_key" --binding=DELIVERY_CACHE --env production
```

### Bulk Operations

```bash
# Bulk upload from JSON file
wrangler kv:bulk put data.json --binding=DELIVERY_CACHE --env production

# Bulk delete
wrangler kv:bulk delete keys.json --binding=DELIVERY_CACHE --env production
```

Example `data.json`:
```json
[
  {"key": "delivery_dates_cache", "value": "{\"data\": []}", "expiration_ttl": 300},
  {"key": "shipping_methods_cache", "value": "{\"methods\": []}", "expiration_ttl": 86400}
]
```

### Cache Management

```bash
# Clear all cache
yarn workers:kv:clear:production

# Backup cache data
yarn backup:kv:production

# Monitor cache hit rates
yarn workers:analytics:production
```

## Monitoring and Analytics

### Built-in Analytics

Access analytics in Cloudflare Dashboard:
- Navigate to Workers & Pages → woood-delivery-api → Analytics
- View request volume, response times, error rates
- Geographic distribution and cache hit rates

### Analytics Engine

Query custom metrics:

```bash
# Request volume by endpoint
wrangler analytics engine sql "
  SELECT
    blob3 as endpoint,
    COUNT(*) as requests,
    AVG(double1) as avg_response_time
  FROM woood_delivery_analytics_prod
  WHERE timestamp >= NOW() - INTERVAL '24 HOURS'
  GROUP BY endpoint
  ORDER BY requests DESC
"

# Error rate analysis
wrangler analytics engine sql "
  SELECT
    blob1 as environment,
    COUNT(*) as total_requests,
    SUM(CASE WHEN blob4 LIKE '4%' OR blob4 LIKE '5%' THEN 1 ELSE 0 END) as errors,
    (SUM(CASE WHEN blob4 LIKE '4%' OR blob4 LIKE '5%' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as error_rate
  FROM woood_delivery_analytics_prod
  WHERE timestamp >= NOW() - INTERVAL '1 HOUR'
  GROUP BY environment
"
```

### Log Streaming

```bash
# Tail logs (real-time)
wrangler tail --env production

# Filter by request method
wrangler tail --env production --format json | jq 'select(.request.method == "POST")'

# Save logs to file
wrangler tail --env production > logs.txt
```

## Troubleshooting

### Common Deployment Issues

#### 1. Authentication Errors

**Error**: `Error: Not authenticated`

**Solution**:
```bash
wrangler auth logout
wrangler auth login
```

#### 2. Namespace Not Found

**Error**: `Error: KV namespace with ID "xxx" not found`

**Solution**:
```bash
# List available namespaces
wrangler kv:namespace list

# Update wrangler.toml with correct ID
# Or create new namespace
wrangler kv:namespace create "DELIVERY_CACHE" --env production
```

#### 3. Route Conflicts

**Error**: `Error: Route pattern conflicts with existing route`

**Solution**:
```bash
# List existing routes
wrangler routes list

# Delete conflicting route
wrangler route delete "conflicting-pattern"

# Update pattern in wrangler.toml
```

#### 4. Build Failures

**Error**: `Error: Build failed`

**Solution**:
```bash
# Check TypeScript errors
yarn type-check

# Clean and rebuild
yarn clean && yarn build

# Check Wrangler version
wrangler --version
npm install -g wrangler@latest
```

### Runtime Issues

#### 1. High Response Times

**Symptoms**: API responses > 1000ms

**Investigation**:
```bash
# Check analytics
wrangler analytics

# Monitor real-time logs
wrangler tail --env production

# Check DutchNed API status
curl -w "@curl-format.txt" -o /dev/null -s "https://eekhoorn-connector.dutchned.com/api/health"
```

**Solutions**:
- Enable caching: `ENABLE_CACHING=true`
- Reduce API timeout: `API_TIMEOUT=5000`
- Check network connectivity to DutchNed API

#### 2. Rate Limiting Issues

**Symptoms**: 429 responses, legitimate traffic blocked

**Investigation**:
```bash
# Check rate limit metrics
yarn workers:analytics:production | grep rate_limit

# Monitor Durable Objects
wrangler tail --env production | grep RateLimiter
```

**Solutions**:
```bash
# Increase rate limits
wrangler secret put RATE_LIMIT_MAX_REQUESTS "200" --env production
wrangler secret put RATE_LIMIT_WINDOW_MS "600000" --env production

# Reset rate limiter state (emergency)
wrangler kv:key delete "rate_limiter_state" --binding=DELIVERY_CACHE --env production
```

#### 3. KV Storage Issues

**Symptoms**: Cache misses, slow responses

**Investigation**:
```bash
# Check KV namespace status
wrangler kv:namespace list

# Verify cache keys
wrangler kv:key list --binding=DELIVERY_CACHE --env production

# Check cache hit rates
yarn workers:analytics:production
```

**Solutions**:
```bash
# Clear corrupted cache
wrangler kv:key delete "delivery_dates_cache" --binding=DELIVERY_CACHE --env production

# Verify KV permissions
wrangler kv:key put "test" "value" --binding=DELIVERY_CACHE --env production
wrangler kv:key get "test" --binding=DELIVERY_CACHE --env production
```

#### 4. Memory/CPU Limits

**Symptoms**: Worker terminated, 1015 errors

**Investigation**:
```bash
# Check for CPU-intensive operations
wrangler tail --env production | grep "cpu time"

# Monitor memory usage patterns
wrangler analytics
```

**Solutions**:
- Optimize JSON parsing for large responses
- Reduce concurrent API calls
- Implement request queuing
- Split complex operations across multiple requests

### Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| 1015 | Worker hit CPU/memory limit | Optimize code, reduce complexity |
| 1018 | Worker took too long | Reduce processing time, check async operations |
| 1023 | Worker threw unhandled exception | Check error handling, add try-catch blocks |
| 1027 | Worker exceeded subrequest limit | Reduce external API calls |

### Performance Optimization

#### 1. Caching Strategy

```typescript
// Implement tiered caching
const cacheKey = `delivery_dates_${postalCode}_${country}`;
const shortTTL = 300; // 5 minutes for delivery dates
const longTTL = 86400; // 24 hours for static data

await env.DELIVERY_CACHE.put(cacheKey, JSON.stringify(data), {
  expirationTtl: shortTTL
});
```

#### 2. Request Batching

```typescript
// Batch multiple operations
const promises = [
  fetchDeliveryDates(),
  processShippingMethod(),
  saveMetafields()
];

const results = await Promise.all(promises);
```

#### 3. Response Optimization

```typescript
// Minimize response size
const response = new Response(JSON.stringify(data), {
  headers: {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip', // Automatic compression
    'Cache-Control': 'public, max-age=300'
  }
});
```

## Best Practices

### 1. Development Workflow

```bash
# 1. Make changes locally
wrangler dev

# 2. Test changes
yarn test:integration

# 3. Deploy to staging
wrangler deploy --env staging

# 4. Validate staging
yarn workers:test:endpoints:staging

# 5. Deploy to production
wrangler deploy --env production

# 6. Monitor production
yarn monitor:production
```

### 2. Security

- Never commit secrets to version control
- Use environment-specific secrets
- Implement proper CORS policies
- Monitor rate limiting effectiveness
- Regular security audits

### 3. Performance

- Use KV storage for caching
- Implement request batching
- Monitor response times
- Optimize JSON payloads
- Use appropriate cache TTLs

### 4. Monitoring

- Set up alerts for error rates
- Monitor response times
- Track cache hit rates
- Log important business events
- Regular performance reviews

## Support and Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
- [KV Storage Guide](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Durable Objects Documentation](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)

## Emergency Procedures

### Immediate Rollback

```bash
# 1. Deploy previous version
wrangler deploy --env production --keep-vars

# 2. Verify health
curl https://api.woood-delivery.com/health

# 3. Monitor logs
wrangler tail --env production
```

### Service Degradation

```bash
# 1. Enable mock mode
wrangler secret put USE_MOCK_DELIVERY_DATES "true" --env production

# 2. Increase cache duration
wrangler secret put CACHE_DURATION "600000" --env production

# 3. Disable non-essential features
wrangler secret put ENABLE_ANALYTICS_TRACKING "false" --env production
```

### Complete Outage

```bash
# 1. Check Cloudflare status
curl https://www.cloudflarestatus.com/api/v2/status.json

# 2. Implement circuit breaker
# Temporary fallback to mock data

# 3. Notify stakeholders
# Use configured notification channels
```