# WOOOD Delivery API - Architecture Documentation

## Project Overview

The WOOOD Delivery Date Picker is a Shopify Checkout Extension powered by Cloudflare Workers, providing global edge performance for delivery date selection and shipping method customization.

## Current Architecture (Workers-based)

```
┌─────────────────────────────────────────────────────────┐
│                    Shopify Ecosystem                    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   Checkout UI   │    │     Shopify Function        │ │
│  │   Extension     │    │   (Shipping Method Filter)  │ │
│  │                 │    │                             │ │
│  │ • Date Picker   │    │ • Product Metafield Logic   │ │
│  │ • NL Targeting  │    │ • Rate Customization        │ │
│  │ • Cart Attrs    │    │ • Priority Processing       │ │
│  └─────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
             │                           │
             ▼                           ▼
┌─────────────────────────────────────────────────────────┐
│                Cloudflare Workers API                   │
├─────────────────────────────────────────────────────────┤
│  🌍 300+ Global Edge Locations • <50ms Response Times   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    Router    │  │   Services   │  │  Middleware  │  │
│  │              │  │              │  │              │  │
│  │ • CORS       │  │ • Delivery   │  │ • Rate Limit │  │
│  │ • Routing    │  │   Dates      │  │ • Analytics  │  │
│  │ • Health     │  │ • Shipping   │  │ • Logging    │  │
│  │ • Error      │  │   Methods    │  │ • Auth       │  │
│  │   Handling   │  │ • Error      │  │ • Security   │  │
│  │              │  │   Tracking   │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ KV Storage   │  │ Durable Objs │  │  Analytics   │  │
│  │              │  │              │  │   Engine     │  │
│  │ • Cache      │  │ • Rate Limiter│  │              │  │
│  │ • TTL Mgmt   │  │ • Session    │  │ • Metrics    │  │
│  │ • Global     │  │   State      │  │ • Real-time  │  │
│  │   Sync       │  │ • Cleanup    │  │ • Custom     │  │
│  │              │  │              │  │   Queries    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     DutchNed API                        │
├─────────────────────────────────────────────────────────┤
│  • Delivery Date Availability                          │
│  • Netherlands-specific Logic                          │
│  • Real-time Shipping Calculations                     │
└─────────────────────────────────────────────────────────┘
```

## Project File Structure

```
WOOOD_dutchned/
├── 🆕 workers/                         # Cloudflare Workers API (Primary)
│   ├── src/
│   │   ├── index.ts                   # Main worker entry point
│   │   ├── handlers/                  # Request handlers
│   │   │   ├── deliveryDates.ts       # Delivery dates endpoint
│   │   │   ├── shippingMethods.ts     # Shipping methods endpoint
│   │   │   ├── orderMetafields.ts     # Order metafields endpoint
│   │   │   ├── errorTracking.ts       # Error tracking endpoint
│   │   │   └── health.ts              # Health check endpoint
│   │   ├── services/                  # Business logic services
│   │   │   ├── deliveryDatesService.ts
│   │   │   ├── shippingMethodService.ts
│   │   │   ├── featureFlagsService.ts
│   │   │   └── rateLimitingService.ts
│   │   ├── api/                       # External API clients
│   │   │   └── dutchNedClient.ts      # DutchNed API integration
│   │   ├── utils/                     # Utilities and helpers
│   │   │   ├── mockDataGenerator.ts   # Mock data for fallback
│   │   │   ├── logger.ts              # Structured logging
│   │   │   └── cors.ts                # CORS configuration
│   │   └── types/                     # TypeScript definitions
│   │       ├── common.ts              # Shared types
│   │       └── env.ts                 # Environment types
│   ├── wrangler.toml                  # Workers configuration
│   ├── package.json                   # Workers dependencies
│   ├── tsconfig.json                  # TypeScript config
│   ├── DEPLOYMENT.md                  # Workers deployment guide
│   └── yarn.lock
│
├── 📱 extensions/                      # Shopify Extensions (Unchanged)
│   ├── date-picker/                   # Checkout UI Extension
│   │   ├── src/
│   │   │   ├── index.tsx              # Main extension component
│   │   │   ├── components/
│   │   │   │   └── ErrorBoundary.tsx  # Error handling
│   │   │   └── services/
│   │   │       └── apiClient.ts       # API client (points to Workers)
│   │   ├── locales/                   # i18n translations
│   │   │   ├── en.json
│   │   │   └── nl.default.json
│   │   ├── shopify.extension.toml     # Extension configuration
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── yarn.lock
│   │
│   └── shipping-method/               # Shopify Function
│       ├── src/
│       │   ├── index.ts               # Function entry point
│       │   └── shipping_method_filter.graphql
│       ├── schema.graphql             # Function schema
│       ├── shopify.extension.toml     # Function configuration
│       ├── package.json
│       ├── vite.config.js
│       └── yarn.lock
│


├── 📜 scripts/                        # Development and deployment scripts
│   ├── test-workers-endpoints.js      # API endpoint testing
│   ├── monitor-workers.js             # Continuous monitoring
│   ├── backup-kv-data.js              # KV storage backup
│   ├── performance-test.ts            # Performance benchmarking
│   └── integration-test.js            # End-to-end testing
│
├── 📚 Documentation
│   ├── README.md                      # Main project documentation
│   ├── ARCHITECTURE.md                # This file - architecture overview
│   ├── DOMAIN_SETUP.md                # Custom domain configuration
│   └── MONITORING.md                  # Monitoring and alerting setup
│
├── ⚙️ Configuration
│   ├── package.json                   # Root package.json (workspace)
│   ├── tsconfig.json                  # Root TypeScript config
│   ├── shopify.app.toml               # Shopify app configuration
│   └── yarn.lock                      # Root lockfile
│
└── 🔧 Development
    └── .gitignore                     # Git ignore patterns
```

## Technology Stack

### Cloudflare Workers API
- **Runtime**: V8 isolates (not containers)
- **Language**: TypeScript
- **Performance**: <50ms global response times
- **Scaling**: Automatic, handles 100M+ requests/day
- **Storage**: KV (caching) + Durable Objects (state)
- **Analytics**: Built-in metrics + Analytics Engine

### Shopify Extensions
- **UI Extension**: React with Shopify UI Extensions API
- **Function**: TypeScript/JavaScript with GraphQL
- **Deployment**: Shopify CLI to Shopify's infrastructure
- **Configuration**: TOML-based configuration files

### External Integrations
- **DutchNed API**: RESTful API for delivery calculations
- **Shopify Admin API**: Order and metafield management
- **Analytics Engine**: Custom metrics and business intelligence

## Performance Characteristics

### Response Times (Global)
- **Amsterdam** (Primary): 15-25ms
- **London**: 20-30ms
- **New York**: 35-45ms
- **Singapore**: 40-50ms
- **Sydney**: 45-55ms

### Availability & Reliability
- **Uptime**: 99.99% SLA (Cloudflare)
- **Failover**: Automatic across edge locations
- **DDoS Protection**: Built-in enterprise-level
- **Rate Limiting**: Durable Objects-based

### Caching Strategy
- **Delivery Dates**: 5-minute TTL (high freshness)
- **Shipping Methods**: 24-hour TTL (stable data)
- **Static Data**: 7-day TTL (rarely changes)
- **Error Responses**: No caching (immediate retry)

## Security Architecture

### Authentication & Authorization
- **DutchNed API**: Basic auth via encrypted credentials
- **Shopify**: Extension permissions and API scopes
- **Workers**: Environment-based secret management

### Data Protection
- **In Transit**: TLS 1.3 encryption
- **At Rest**: Cloudflare KV encryption
- **PII Handling**: Minimal postal code processing only
- **GDPR Compliance**: EU data residency options

### Security Headers
```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

## Monitoring & Observability

### Metrics Collection
- **Request Volume**: Requests per minute/hour/day
- **Response Times**: P50, P95, P99 percentiles
- **Error Rates**: By endpoint and error type
- **Cache Performance**: Hit/miss ratios and TTL effectiveness
- **Business Metrics**: Delivery date usage patterns

### Alerting Thresholds
- **Critical**: Error rate >5%, Response time >1000ms
- **Warning**: Cache hit rate <70%, Rate limiting >10%
- **Info**: High traffic volume, Regional performance variations

### Log Aggregation
- **Structured Logging**: JSON format with consistent fields
- **Real-time Streaming**: Wrangler tail for live debugging
- **Analytics Engine**: SQL queries for business intelligence
- **External Services**: Optional integration with DataDog, LogFlare

## Development Workflow

### Local Development
```bash
# Start Workers development server
cd workers && wrangler dev

# Start extension development
cd extensions/date-picker && yarn dev

# Run tests
yarn test:integration
yarn test:performance
```

### Deployment Pipeline
```bash
# 1. Deploy to staging
wrangler deploy --env staging

# 2. Run integration tests
yarn workers:test:endpoints:staging

# 3. Deploy to production
wrangler deploy --env production

# 4. Monitor deployment
yarn monitor:production
```

### Quality Assurance
- **TypeScript**: Strict mode compilation
- **Testing**: Integration and performance tests
- **Monitoring**: Real-time health checks
- **Rollback**: < 2-minute emergency procedures

## Cost Optimization

### Cloudflare Workers Pricing
- **Base Cost**: $5/month Workers Paid plan
- **Requests**: 100k included, $0.50/million after
- **Bandwidth**: Unlimited (included)
- **KV Storage**: 1GB included, $0.50/GB after
- **Durable Objects**: 1M requests included, $0.15/million after
- **Analytics**: Full analytics included

### Cost Benefits
- **Request-based Pricing**: Pay only for actual usage
- **No Idle Costs**: Workers only run when needed
- **Included Features**: CORS, rate limiting, SSL, analytics
- **Global Distribution**: No additional charges for edge locations
- **Predictable Scaling**: Linear cost scaling with usage



---

**Architecture Version**: 1.0 (Cloudflare Workers)
**Last Updated**: January 2024
**Status**: 🚀 Production Ready