# Delivery Date Picker - Complete API Reference

## Overview
The Delivery Date Picker API provides essential endpoints for Shopify checkout extensions and app management. This API is built on Cloudflare Workers for global performance with <50ms response times.

## Base URLs
- **Production**: `https://delivery-date-picker.workers.dev`
- **Staging**: `https://delivery-date-picker-staging.workers.dev`

---

## 🔐 Authentication

### OAuth 2.0 Flow

The system uses simplified OAuth 2.0 for Shopify app authentication:

```
Shop → Install App → OAuth Authorization → Token Exchange → KV Storage
```

#### Install App
**Endpoint**: `GET /` or `GET /install`
**Description**: Generic app installation page with OAuth initiation.

**Parameters**:
- `shop` (query, optional): Shopify shop domain

**Response**: HTML installation page or OAuth redirect

**Example**:
```
GET /?shop=example.myshopify.com
→ Redirects to Shopify OAuth
```

#### OAuth Callback
**Endpoint**: `GET /auth/callback`
**Description**: Handles OAuth callback and stores offline tokens.

**Parameters**:
- `code` (query, required): OAuth authorization code
- `state` (query, required): CSRF protection state
- `shop` (query, required): Shopify shop domain

**Response**: HTML success page with redirect to Shopify admin

### Token Storage

Tokens are stored in Cloudflare KV with automatic expiration:

```typescript
interface ShopToken {
  accessToken: string;    // Shopify access token
  createdAt: string;      // Token creation timestamp
  shop: string;           // Shop domain
}
```

### Authentication Headers

Include these headers in authenticated requests:

```http
X-Shopify-Shop-Domain: your-shop.myshopify.com
Content-Type: application/json
```

---

## 📅 Core API Endpoints

### Get Available Delivery Dates
**Endpoint**: `GET /api/delivery-dates`
**Description**: Returns available delivery dates from DutchNed API with caching.

**Authentication**: None required (public endpoint)

**Request Headers**:
```http
Accept: application/json
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "date": "2025-07-05",
      "displayName": "zaterdag 5 jul"
    },
    {
      "date": "2025-07-06",
      "displayName": "zondag 6 jul"
    }
  ],
  "metadata": {
    "mockDataEnabled": false,
    "cacheHit": true
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Internal server error"
}
```

**Features**:
- ✅ **Caching**: 30-minute cache for performance
- ✅ **Fallback**: Mock data when API unavailable
- ✅ **Localization**: Dutch date formatting
- ✅ **CORS**: Shopify checkout compatibility

### Health Check
**Endpoint**: `GET /health`
**Description**: System health and service status.

**Authentication**: None required

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-07-03T19:00:00.000Z",
  "environment": "production",
  "services": {
    "kv": "available",
    "dutchNedApi": "unknown"
  }
}
```

### Admin Interface
**Endpoint**: `GET /admin`
**Description**: Simple Polaris-based admin interface for system monitoring.

**Authentication**: OAuth token required

**Response**: HTML admin dashboard with:
- System status indicators
- Configuration overview
- Basic documentation

---

## 🔔 Webhook Endpoints

### HMAC Signature Validation

All webhooks use HMAC-SHA256 signature validation:

```typescript
const signature = request.headers.get('X-Shopify-Hmac-Sha256');
const body = await request.text();
const isValid = await validateWebhookSignature(body, signature, secret);
```

### Required Webhook Headers

Shopify includes these headers with webhook requests:

```http
X-Shopify-Topic: orders/paid
X-Shopify-Hmac-Sha256: <signature>
X-Shopify-Shop-Domain: your-shop.myshopify.com
X-Shopify-API-Version: 2025-04
X-Shopify-Webhook-Id: <unique-id>
Content-Type: application/json
User-Agent: Shopify-Captain-Hook
```

### Order Processing Webhook
**Endpoint**: `POST /api/webhooks/orders`
**Description**: Processes order webhooks and creates metafields from note_attributes.

**Authentication**: HMAC signature validation

**Supported Topics**:
- `orders/created` - New order processing
- `orders/paid` - Paid order processing
- `orders/updated` - Order modification handling
- `orders/cancelled` - Order cancellation cleanup
- `app/uninstalled` - App cleanup

**Request Body Example**:
```json
{
  "id": 12345,
  "name": "#1001",
  "financial_status": "paid",
  "note_attributes": [
    {
      "name": "selected_delivery_date",
      "value": "2025-07-05"
    },
    {
      "name": "cart_shipping_method",
      "value": "standard"
    }
  ],
  "shipping_address": {
    "first_name": "John",
    "last_name": "Doe",
    "address1": "123 Main Street",
    "city": "Amsterdam",
    "zip": "1234AB",
    "country": "Netherlands"
  }
}
```

**Response**:
```json
{
  "success": true,
  "metafieldsCreated": 2,
  "orderId": 12345,
  "processedAt": "2025-07-03T19:00:00.000Z"
}
```

**Metafield Transformation**:
- `delivery_date` → `custom.dutchned_delivery_date` (type: date)
- `shipping_method` → `custom.ShippingMethod2` (type: single_line_text_field)

**Processing Steps**:
1. Validate HMAC signature
2. Extract delivery information from note_attributes
3. Transform data to structured metafields
4. Create metafields via Shopify Admin API
5. Log processing results

---

## 🏪 Experience Center Integration

### Trigger Experience Center Update

**Endpoint**: `POST /api/experience-center/trigger`

**Description**: Manually triggers the experience center metafield update for all shops and all products. This is the same function that runs automatically via cron job.

**Authentication**: None required (internal endpoint)

**Request Body**: None required

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "results": [
    {
      "shop": "your-shop.myshopify.com",
      "success": true,
      "summary": {
        "total": 150,
        "successful": 145,
        "failed": 5
      }
    }
  ],
  "summary": {
    "totalShops": 1,
    "successfulShops": 1,
    "failedShops": 0
  }
}
```

**Scheduled Execution**:
- **Cron Schedule**: Daily at 04:00 UTC (`0 4 * * *`)
- **Automatic Processing**: All shops and all products
- **Batch Processing**: Products processed in batches of 50
- **Error Handling**: Individual shop failures don't affect other shops
- **Logging**: Comprehensive logging for monitoring and debugging

**Process Flow**:
1. Retrieves all shop tokens from KV storage
2. For each shop, queries external API for product availability data
3. Fetches all products from the shop (with pagination)
4. Maps product EAN codes to external API availability
5. Sets `woood.experiencecenter` metafield for all products in batches
6. Returns detailed results for each shop processed

### Experience Center Status

**Endpoint**: `GET /api/experience-center/status`

**Description**: Returns the status of the last experience center update operation.

**Authentication**: None required

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "results": [
    {
      "shop": "your-shop.myshopify.com",
      "success": true,
      "summary": {
        "total": 150,
        "successful": 145,
        "failed": 5
      }
    }
  ],
  "summary": {
    "totalShops": 1,
    "successfulShops": 1,
    "failedShops": 0
  },
  "cron": true
}
```

**External API Data Structure**:
```json
{
  "data": [
    {
      "ean": "8714713200481",
      "channel": "EC",
      "itemcode": "374076-G"
    },
    {
      "ean": "8714713221950",
      "channel": "EC",
      "itemcode": "377529-OP"
    }
  ]
}
```

**Process Flow**:
1. Validates shop authentication and access token
2. Queries external API: `https://portal.dutchfurniturefulfilment.nl/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`
3. Retrieves product metafields to find EAN codes
4. Maps EAN codes to external API availability data
5. Sets `woood.experiencecenter` metafield to `true` if product exists in external API, `false` otherwise
6. Returns detailed results for each product processed

**Error Handling**:
- `400 Bad Request`: Invalid request body (missing shop or productIds)
- `401 Unauthorized`: Shop not authenticated or missing access token
- `500 Internal Server Error`: External API error or Shopify API error

---

## 🗺️ Store Locator Integration

### Trigger Store Locator Update

**Endpoint**: `POST /api/store-locator/trigger`

**Description**: Manually triggers the store locator data sync for all shops. This is the same function that runs automatically via cron job.

**Authentication**: None required (internal endpoint)

**Request Body**: None required

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "results": [
    {
      "shop": "your-shop.myshopify.com",
      "success": true,
      "summary": {
        "total": 150,
        "successful": 145,
        "failed": 5
      }
    }
  ],
  "summary": {
    "totalShops": 1,
    "successfulShops": 1,
    "failedShops": 0
  }
}
```

**Scheduled Execution**:
- **Cron Schedule**: Daily at 04:00 UTC (`0 4 * * *`)
- **Automatic Processing**: Fetches and upserts all dealer data
- **Error Handling**: Comprehensive error logging and status tracking
- **Logging**: Detailed logging for monitoring and debugging

**Process Flow**:
1. Fetches dealer data from external API: `https://portal.dutchfurniturefulfilment.nl/api/datasource/wooodshopfinder`
2. Filters dealers by account status (`A`) and activation portal (`true` or `'WAAR'`)
3. Transforms dealer data (removes sensitive fields, maps exclusives)
4. Upserts transformed data to `woood.store_locator` shop metafield
5. Returns operation status and dealer count

### Store Locator Status

**Endpoint**: `GET /api/store-locator/status`

**Description**: Returns the status of the last store locator update operation.

**Authentication**: None required

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "results": [
    {
      "shop": "your-shop.myshopify.com",
      "success": true,
      "summary": {
        "total": 150,
        "successful": 145,
        "failed": 5
      }
    }
  ],
  "summary": {
    "totalShops": 1,
    "successfulShops": 1,
    "failedShops": 0
  },
  "cron": true
}
```

**External API Data Structure**:
```json
{
  "data": [
    {
      "Id": "6574C945-2C13-4FF9-9C58-5F6FDE4E4F09",
      "accountStatus": "A",
      "address": "ACHTHOEVENWEG 6",
      "addresses": [
        {
          "address": "ACHTHOEVENWEG 6",
          "city": "STAPHORST",
          "postcode": "7951 SK",
          "type": "Visit",
          "country": "Netherlands"
        }
      ],
      "city": "STAPHORST",
      "code": "165201",
      "dealerActivationPortal": true,
      "name": "BOER STAPHORST B.V.",
      "nameAlias": "Boer Staphorst ",
      "phone": "(0522) 46 68 00",
      "physicalshop": true,
      "postcode": "7951 SK",
      "shopfinderExclusives": [
        {
          "Code": "150",
          "Description": "WOOOD TABLO"
        },
        {
          "Code": "17",
          "Description": "ESSENTIALS"
        }
      ],
      "website": "www.boer-staphorst.nl",
      "webshop": true,
      "country": "NL"
    }
  ]
}
```

**Data Transformation Rules**:
- **Filtering**: Only includes dealers where `accountStatus === 'A'` and `dealerActivationPortal === true` or `'WAAR'`
- **Field Mapping**: Maps `nameAlias` to `name` (fallback to `name` if missing)
- **Exclusivity Mapping**: Maps exclusivity descriptions using predefined mapping rules
- **Field Removal**: Removes sensitive fields (`accountmanager`, `dealerActivationPortal`, `vatNumber`, `shopfinderExclusives`, `accountStatus`)
- **Output**: Flat array of dealer objects with all fields on root level

**Exclusivity Mapping**:
```javascript
const EXCLUSIVITY_MAP = {
  'woood essentials': 'WOOOD ESSENTIALS',
  'essentials': 'WOOOD ESSENTIALS',
  'woood premium': 'WOOOD PREMIUM',
  'woood exclusive': 'WOOOD PREMIUM',
  'woood outdoor': 'WOOOD OUTDOOR',
  'woood tablo': 'WOOOD TABLO',
  'vtwonen': 'VT WONEN',
  'vt wonen dealers only': 'VT WONEN',
};
```

---

## 🚫 Removed Endpoints (Sprint 18)

The following endpoints were removed as extensions now use native `useAppMetafields`:

- ❌ `POST /api/products/data` - Replaced by native metafield access
- ❌ `POST /api/products/erp-delivery-times` - Replaced by native metafield access
- ❌ `POST /api/products/shipping-methods` - Replaced by native metafield access

**Migration Guide**: Extensions should use `useAppMetafields` hook instead:

```typescript
// OLD: External API call
const response = await fetch('/api/products/data', { ... });

// NEW: Native metafield access
const erpMetafields = useAppMetafields({
  type: "product",
  namespace: "erp",
  key: "levertijd"
});

const shippingMetafields = useAppMetafields({
  type: "product",
  namespace: "shipping",
  key: "method"
});
```

---

## 🚨 Error Handling

### Error Response Format

All API errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "DELIVERY_DATES_UNAVAILABLE",
    "message": "No delivery dates available for the specified postal code",
    "details": {
      "postal_code": "1234AB",
      "country": "NL",
      "reason": "outside_delivery_area"
    },
    "request_id": "req_123456789",
    "timestamp": "2025-07-03T19:00:00Z"
  }
}
```

### HTTP Status Codes

#### 2xx Success
| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 204 | No Content | Request successful, no content returned |

#### 4xx Client Errors
| Code | Status | Description |
|------|--------|-------------|
| 400 | Bad Request | Invalid request format or parameters |
| 401 | Unauthorized | Authentication required |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource conflict |
| 422 | Unprocessable Entity | Validation errors |
| 429 | Too Many Requests | Rate limit exceeded |

#### 5xx Server Errors
| Code | Status | Description |
|------|--------|-------------|
| 500 | Internal Server Error | Unexpected server error |
| 502 | Bad Gateway | External service error |
| 503 | Service Unavailable | Service temporarily unavailable |
| 504 | Gateway Timeout | External service timeout |

### Common Error Codes

#### Authentication Errors

**AUTH_REQUIRED** (401)
```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication is required to access this resource",
    "details": {
      "endpoint": "/api/delivery-dates/available",
      "auth_type": "token"
    }
  }
}
```

**AUTH_NO_TOKEN** (401)
```json
{
  "error": {
    "code": "AUTH_NO_TOKEN",
    "message": "No access token found for shop",
    "details": {
      "shop": "demo-shop.myshopify.com",
      "authUrl": "/auth/start?shop=demo-shop.myshopify.com"
    }
  }
}
```

**AUTH_WEBHOOK_INVALID** (401)
```json
{
  "error": {
    "code": "AUTH_WEBHOOK_INVALID",
    "message": "Webhook HMAC signature validation failed",
    "details": {
      "webhook_topic": "orders/paid",
      "signature_provided": true
    }
  }
}
```

#### Validation Errors

**VALIDATION_FAILED** (422)
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request data validation failed",
    "details": {
      "errors": [
        {
          "field": "postal_code",
          "message": "Invalid postal code format",
          "received": "invalid",
          "expected": "Dutch postal code (1234AB)"
        }
      ]
    }
  }
}
```

#### Service Errors

**DELIVERY_DATES_UNAVAILABLE** (503)
```json
{
  "error": {
    "code": "DELIVERY_DATES_UNAVAILABLE",
    "message": "No delivery dates available for the specified postal code",
    "details": {
      "postal_code": "1234AB",
      "country": "NL",
      "reason": "outside_delivery_area"
    }
  }
}
```

**DUTCHNED_API_ERROR** (502)
```json
{
  "error": {
    "code": "DUTCHNED_API_ERROR",
    "message": "External delivery service is temporarily unavailable",
    "details": {
      "service": "DutchNed API",
      "fallback_enabled": true,
      "retry_after": 300
    }
  }
}
```

---

## 📊 Performance & Optimization

### Response Times
- **Primary Markets**: 15-25ms (Netherlands/EU)
- **Secondary Markets**: 30-50ms (Global)
- **P95 Target**: <50ms worldwide
- **P99 Target**: <100ms worldwide

### Optimization Features
- **Bundle Size**: 17KB (77% reduction from original)
- **Caching**: 30-minute TTL for delivery dates
- **CDN**: 300+ global edge locations
- **Dependencies**: Minimal runtime dependencies (3 packages)

### Rate Limiting
- **Default**: 100 requests per minute per IP
- **Burst**: 20 requests per 10 seconds
- **Webhook**: 1000 requests per minute (higher limit)

---

## 🔒 Security Features

### CORS Configuration
```http
Access-Control-Allow-Origin: https://*.myshopify.com, https://checkout.shopify.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Shopify-Shop-Domain
```

### Security Headers
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Data Protection
- **In Transit**: TLS 1.3 encryption
- **At Rest**: Cloudflare KV encryption
- **Minimal Data**: Only delivery dates and shipping methods stored
- **GDPR**: EU data residency options

---

## 📈 Monitoring & Analytics

### Health Monitoring
- **System Health**: `/health` endpoint with comprehensive checks
- **Real-time Metrics**: Request volume, response times, error rates
- **Webhook Status**: Order processing success rates
- **Cache Performance**: Hit/miss ratios

### Business Metrics
- **Date Selection Patterns**: Popular delivery dates
- **Geographic Distribution**: Usage by region
- **Conversion Impact**: Checkout completion rates
- **Performance Impact**: Page load time effects

### Error Recovery
- **Graceful Degradation**: Fallback to mock data
- **Retry Logic**: Exponential backoff for external APIs
- **Circuit Breaker**: Automatic failover for DutchNed API
- **Webhook Retry**: Automatic retry for failed webhooks

---

## 🚀 Usage Examples

### Extension Integration

```typescript
// React Query hook for delivery dates
const { data: deliveryDates, isLoading } = useQuery({
  queryKey: ['delivery-dates'],
  queryFn: async () => {
    const response = await fetch('/api/delivery-dates');
    return response.json();
  },
  staleTime: 30 * 60 * 1000, // 30 minutes
});

// Native metafield access
const erpMetafields = useAppMetafields({
  type: "product",
  namespace: "erp",
  key: "levertijd"
});
```

---

## 🔗 Live API Endpoints

### Core Extension Endpoints
- `GET /api/delivery-dates` - Real-time delivery date availability
- `POST /api/webhooks/orders` - Automated order processing
- `GET /health` - System health and status monitoring
- `GET /admin` - Simple admin interface

### External API Integration Endpoints
- `POST /api/store-locator/trigger` - Trigger store locator data sync for all shops
- `GET /api/store-locator/status` - Get status of last store locator sync operation
- `POST /api/experience-center/trigger` - Trigger experience center data sync for all shops
- `GET /api/experience-center/status` - Get status of last experience center sync operation

### Production URLs
- **Production**: `https://woood-production.workers.dev`
- **Staging**: `https://woood-staging.workers.dev`

### External API Endpoints
- **Store Locator**: `https://portal.dutchfurniturefulfilment.nl/api/datasource/wooodshopfinder`
- **Experience Center**: `https://portal.dutchfurniturefulfilment.nl/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`
```

### Webhook Processing

```typescript
// Order webhook handler
export async function handleOrderWebhook(request: Request) {
  // Validate HMAC signature
  const isValid = await validateWebhookSignature(request);
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Process order
  const order = await request.json();
  const result = await processOrderDeliveryData(order);

  return Response.json(result);
}
```

### Error Handling

```typescript
// API client with error handling
async function fetchDeliveryDates() {
  try {
    const response = await fetch('/api/delivery-dates');

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error.code, error.error.message);
    }

    return await response.json();
  } catch (error) {
    // Fallback to cached data or mock data
    return getFallbackDeliveryDates();
  }
}
```

---

**API Version**: 2.0 (Extension + Workers)
**Last Updated**: January 2025
**Bundle Size**: 17KB
**Global Performance**: <50ms P95