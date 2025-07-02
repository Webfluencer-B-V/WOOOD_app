# WOOOD Delivery Date Picker - Architecture Overview

## Project Overview

The WOOOD Delivery Date Picker is a streamlined Shopify Checkout Extension powered by Cloudflare Workers, providing global edge performance for delivery date selection and automated order processing.

## Extension + Workers Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Shopify Checkout                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   Date Picker   │    │     Shipping Method         │ │
│  │   Extension     │    │     Function                │ │
│  │                 │    │                             │ │
│  │ • Date Picker   │    │ • Product Metafield Logic   │ │
│  │ • NL Targeting  │    │ • Rate Customization        │ │
│  │ • Note Attrs    │    │ • Method Filtering          │ │
│  └─────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
             │                           │
             ▼                           ▼
             note_attributes → Shopify Order → Webhook
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────┐
│                Cloudflare Workers API                   │
├─────────────────────────────────────────────────────────┤
│  🌍 300+ Global Edge Locations • <50ms Response Times   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Extension   │  │   Webhook    │  │  Services    │  │
│  │  Endpoints   │  │  Processing  │  │              │  │
│  │              │  │              │  │ • Delivery   │  │
│  │ • Delivery   │  │ • Order Paid │  │   Dates      │  │
│  │   Dates      │  │ • Order      │  │ • Shipping   │  │
│  │ • Shipping   │  │   Created    │  │   Methods    │  │
│  │   Methods    │  │ • Metafields │  │ • Token      │  │
│  │ • Health     │  │   Creation   │  │   Storage    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ KV Storage   │  │ OAuth Token  │  │ Monitoring   │  │
│  │              │  │ Storage      │  │              │  │
│  │ • Cache      │  │              │  │ • Health     │  │
│  │ • TTL Mgmt   │  │ • Simple     │  │ • Analytics  │  │
│  │ • Global     │  │   Tokens     │  │ • Logs       │  │
│  │   Sync       │  │ • Per Shop   │  │ • Metrics    │  │
│  │              │  │ • Secure     │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     DutchNed API                        │
├─────────────────────────────────────────────────────────┤
│  • Real-time Delivery Date Availability                │
│  • Netherlands-specific Logistics                      │
│  • Shipping Method Calculations                        │
└─────────────────────────────────────────────────────────┘
```

## Streamlined Project Structure

```
WOOOD_dutchned/
├── workers/                           # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts                   # Main worker with extension endpoints
│   │   ├── handlers/
│   │   │   ├── deliveryDates.ts       # Extension API endpoints
│   │   │   ├── orderWebhooks.ts       # Order processing webhooks
│   │   │   ├── auth.ts                # Simple OAuth flow
│   │   │   └── health.ts              # System health monitoring
│   │   ├── services/
│   │   │   ├── deliveryDatesService.ts # Business logic
│   │   │   ├── orderProcessingPipeline.ts # note_attributes → metafields
│   │   │   ├── simpleTokenService.ts   # Lightweight token storage
│   │   │   └── attributeTransformService.ts # Data transformation
│   │   ├── api/
│   │   │   └── dutchNedClient.ts      # External API integration
│   │   └── types/
│   │       ├── common.ts              # Shared types
│   │       └── env.ts                 # Environment configuration
│   ├── wrangler.toml                  # Single configuration file
│   └── package.json                   # Worker dependencies
│
├── extensions/                        # Shopify Extensions
│   ├── date-picker/                   # Checkout UI Extension
│   │   ├── src/
│   │   │   ├── index.tsx              # Main extension component
│   │   │   ├── hooks/
│   │   │   │   └── useDeliveryDates.ts # React Query integration
│   │   │   └── services/
│   │   │       └── apiClient.ts       # Workers API client
│   │   ├── locales/                   # Dutch/English translations
│   │   └── shopify.extension.toml     # Extension configuration
│   │
│   └── shipping-method/               # Shipping Function
│       ├── src/
│       │   ├── index.ts               # Product metafield logic
│       │   └── shipping_method_filter.graphql
│       └── shopify.extension.toml     # Function configuration
│
├── docs/                              # Documentation
│   ├── SETUP.md                       # Complete setup & testing guide
│   ├── CHANGELOG.md                   # Project changelog
│   └── [architecture, api, deployment]/
│
├── shopify.app.toml                   # Shopify app configuration
└── package.json                      # Root workspace configuration
```

## Technology Stack

### Cloudflare Workers API
- **Runtime**: V8 isolates with itty-router
- **Language**: TypeScript with strict mode
- **Performance**: <50ms global response times
- **Scaling**: Auto-scaling, 100M+ requests/day capacity
- **Storage**: KV for caching and simple token storage
- **Configuration**: Single `wrangler.toml` file

### Shopify Extensions
- **Date Picker**: React with React Query for data fetching
- **Shipping Function**: TypeScript with GraphQL for product filtering
- **Deployment**: Native Shopify CLI deployment
- **Configuration**: Native Shopify extension configurations

### Data Flow
1. **Checkout**: Customer selects delivery date in extension
2. **Note Attributes**: Extension saves data as note_attributes
3. **Order Creation**: Shopify creates order with note_attributes
4. **Webhook**: Order webhook triggers Workers processing
5. **Metafields**: Workers transforms note_attributes → metafields
6. **Fulfillment**: Order ready with structured delivery data

## Performance Characteristics

### Global Response Times
- **Primary Markets**: 15-25ms (Netherlands/EU)
- **Secondary Markets**: 30-50ms (Global)
- **P95 Target**: <50ms worldwide
- **P99 Target**: <100ms worldwide

### System Efficiency
- **CPU Usage**: <10% normal operation (post-optimization)
- **Memory Usage**: <64MB per request
- **Webhook Processing**: <2 seconds average
- **Cache Hit Rate**: >80% for delivery dates

### Availability & Reliability
- **Uptime**: 99.99% SLA via Cloudflare
- **Failover**: Automatic edge location failover
- **Error Recovery**: Automatic retry with exponential backoff
- **Rate Limiting**: Built-in DDoS protection

## Security Architecture

### Simple Authentication
- **OAuth Flow**: Lightweight token-based authentication
- **Token Storage**: Encrypted storage in Cloudflare KV
- **Per-Shop Isolation**: Isolated tokens per Shopify store
- **Automatic Expiration**: Token lifecycle management

### Webhook Security
- **HMAC Validation**: SHA-256 signature verification
- **Single Secret**: Simplified secret management
- **Replay Protection**: Timestamp validation
- **Source Validation**: Shop domain verification

### Data Protection
- **In Transit**: TLS 1.3 encryption
- **At Rest**: Cloudflare KV encryption
- **Minimal Data**: Postal codes only, no PII
- **GDPR Compliance**: EU data residency options

## Extension Integration

### Checkout Extension Features
- **Real-time API**: Direct connection to Workers API
- **Caching**: React Query for optimized data fetching
- **Localization**: Dutch and English language support
- **Error Handling**: Graceful fallbacks and error boundaries

### Order Processing Pipeline
- **Note Attributes**: Extension → `delivery_date`, `shipping_method`
- **Webhook Trigger**: Order creation/payment triggers processing
- **Data Transformation**: Structured conversion to metafields
- **Fulfillment Ready**: Orders have structured delivery data

## Monitoring & Operations

### Health Monitoring
- **System Health**: `/health` endpoint with comprehensive checks
- **Real-time Metrics**: Request volume, response times, error rates
- **Webhook Status**: Order processing success rates
- **Business Metrics**: Delivery date usage patterns

### Simple Configuration
- **Single Config**: `wrangler.toml` for all environment variables
- **Secret Management**: Cloudflare CLI for sensitive data
- **Environment Isolation**: Separate dev/production configurations
- **Native Patterns**: Following platform best practices

## Development & Deployment

### Local Development
```bash
# Start integrated development
yarn dev:integrated

# Workers only
cd workers && wrangler dev

# Extensions only
yarn extensions:dev
```

### Deployment Pipeline
```bash
# Deploy Workers
cd workers && wrangler deploy --env production

# Deploy Extensions
shopify app deploy

# Verify deployment
curl https://woood-production.leander-4e0.workers.dev/health
```

### Testing Strategy
- **Unit Tests**: Jest for business logic (95%+ coverage)
- **Integration Tests**: API endpoint validation
- **E2E Tests**: Playwright for checkout flow
- **Performance Tests**: Artillery for load testing

## Cost Optimization

### Cloudflare Workers Benefits
- **Request-based Pricing**: Pay only for actual usage
- **No Idle Costs**: Workers only run when needed
- **Included Features**: SSL, CORS, analytics, global distribution
- **Linear Scaling**: Predictable costs with growth

### Simplified Architecture Benefits
- **Reduced Complexity**: Fewer moving parts to maintain
- **Lower CPU Usage**: <10% vs 100%+ with complex session system
- **Faster Deployment**: Single configuration file
- **Easier Debugging**: Streamlined data flow

---

**Architecture Version**: 2.0 (Extension + Workers)
**Last Updated**: January 2025
**Status**: 🚀 Production Ready - Streamlined Architecture