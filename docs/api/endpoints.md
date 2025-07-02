# API Reference

> Complete API endpoint documentation for the WOOOD Delivery Date Picker extension system.

## Base URLs

- **Production**: `https://woood-production.leander-4e0.workers.dev`
- **Development**: `https://woood-staging.leander-4e0.workers.dev`
- **Local**: `http://localhost:8787`

## Authentication

Extension endpoints use simple token-based authentication. Webhook endpoints use HMAC signature validation.

### Extension API Authentication

```http
Authorization: Bearer <shop_token>
X-Shopify-Shop-Domain: your-shop.myshopify.com
Content-Type: application/json
```

### Webhook Authentication

```http
X-Shopify-Hmac-Sha256: <webhook_signature>
X-Shopify-Topic: <webhook_topic>
X-Shopify-Shop-Domain: your-shop.myshopify.com
Content-Type: application/json
```

## 📅 Extension API Endpoints

### Get Available Delivery Dates

Retrieve available delivery dates for checkout extension.

```http
GET /api/delivery-dates/available?postal_code=1234AB&country=NL
```

**Query Parameters:**
- `postal_code` (required): Dutch postal code
- `country` (optional): Country code, defaults to "NL"

**Response:**
```json
{
  "success": true,
  "dates": [
    {
      "date": "2025-01-15",
      "available": true,
      "displayName": "Woensdag 15 januari"
    },
    {
      "date": "2025-01-16", 
      "available": true,
      "displayName": "Donderdag 16 januari"
    }
  ],
  "cached": true,
  "postal_code": "1234AB"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Valid postal code required",
  "error_code": "INVALID_POSTAL_CODE"
}
```

### Get Product Shipping Methods

Retrieve shipping methods based on product metafields.

```http
POST /api/products/shipping-methods
```

**Request Body:**
```json
{
  "product_id": 123456,
  "shop_domain": "your-shop.myshopify.com"
}
```

**Response:**
```json
{
  "success": true,
  "shipping_methods": [
    {
      "id": "woood_standard",
      "name": "WOOOD Standard Delivery",
      "description": "Delivered within 2-5 business days",
      "estimated_days": 3,
      "priority": 1
    }
  ],
  "product_id": 123456
}
```

## 🔔 Webhook Endpoints

### Order Paid Webhook

Processes orders after payment to create metafields from note_attributes.

```http
POST /api/webhooks/orders/paid
```

**Request Headers:**
```http
X-Shopify-Hmac-Sha256: <webhook_signature>
X-Shopify-Topic: orders/paid
X-Shopify-Shop-Domain: your-shop.myshopify.com
Content-Type: application/json
```

**Request Body (Shopify Order):**
```json
{
  "id": 987654321,
  "name": "#1001",
  "email": "customer@example.com",
  "note_attributes": [
    {
      "name": "delivery_date",
      "value": "2025-01-15"
    },
    {
      "name": "shipping_method", 
      "value": "woood_standard"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "metafieldsCreated": 2,
  "processingTime": 1250,
  "orderId": 987654321
}
```

### Order Created Webhook

Alternative processing for order creation events.

```http
POST /api/webhooks/orders/created
```

**Headers and Body:** Same as Order Paid webhook

**Response:**
```json
{
  "success": true,
  "metafieldsCreated": 2,
  "processingTime": 890,
  "orderId": 987654321
}
```

### App Uninstalled Webhook

Handles cleanup when app is uninstalled.

```http
POST /api/webhooks/app/uninstalled
```

**Request Body (Shopify App Uninstall):**
```json
{
  "id": 123456,
  "name": "WOOOD Delivery Date Picker",
  "shop": {
    "id": 789012,
    "domain": "your-shop.myshopify.com"
  }
}
```

**Response:**
```json
{
  "success": true,
  "tokensRemoved": 1,
  "cacheCleared": true,
  "shop": "your-shop.myshopify.com"
}
```

## 🔐 OAuth Endpoints

### Start OAuth Flow

Initiate OAuth installation process.

```http
GET /auth/start?shop=your-shop.myshopify.com
```

**Response:**
```http
302 Redirect to Shopify OAuth URL
Location: https://your-shop.myshopify.com/admin/oauth/authorize?...
```

### OAuth Callback

Handle OAuth callback from Shopify.

```http
GET /auth/callback?code=<auth_code>&shop=your-shop.myshopify.com&state=<state>
```

**Response:**
```json
{
  "success": true,
  "shop": "your-shop.myshopify.com",
  "tokenStored": true,
  "webhooksRegistered": ["orders/paid", "app/uninstalled"]
}
```

## 🏥 System Endpoints

### Health Check

Public endpoint for system health verification.

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-03T12:00:00Z",
  "version": "2.0.0",
  "environment": "production",
  "services": {
    "dutchned_api": "healthy",
    "shopify_api": "healthy", 
    "kv_storage": "healthy"
  },
  "performance": {
    "response_time_ms": 45,
    "cpu_usage_percent": 8,
    "memory_usage_mb": 32
  }
}
```

### Service Status

Detailed service health information.

```http
GET /status
```

**Response:**
```json
{
  "success": true,
  "services": {
    "workers": {
      "status": "operational",
      "response_time": 25,
      "uptime_percent": 99.99
    },
    "dutchned_api": {
      "status": "operational", 
      "response_time": 150,
      "last_success": "2025-01-03T11:59:30Z"
    },
    "kv_storage": {
      "status": "operational",
      "response_time": 8,
      "cache_hit_rate": 0.85
    }
  },
  "metrics": {
    "requests_24h": 15234,
    "errors_24h": 12,
    "error_rate": 0.0008
  }
}
```

## 📊 Data Structures

### DeliveryDate

```typescript
interface DeliveryDate {
  date: string;           // ISO date format: "2025-01-15"
  available: boolean;     // Whether date is available
  displayName: string;    // Localized display name: "Woensdag 15 januari"
}
```

### ShippingMethod

```typescript
interface ShippingMethod {
  id: string;            // Method identifier: "woood_standard"
  name: string;          // Display name: "WOOOD Standard Delivery"
  description: string;   // Method description
  estimated_days: number;// Estimated delivery days
  priority: number;      // Priority for selection (higher = preferred)
}
```

### OrderMetafield

```typescript
interface OrderMetafield {
  namespace: string;     // "woood_delivery"
  key: string;          // "selected_date" | "shipping_method"
  value: string;        // The metafield value
  type: string;         // "date" | "single_line_text_field"
}
```

### ProcessingResult

```typescript
interface ProcessingResult {
  success: boolean;
  metafieldsCreated: number;
  processingTime: number;  // milliseconds
  orderId?: number;
  error?: string;
}
```

## 🔄 Order Processing Flow

1. **Checkout Extension**: Customer selects delivery date
2. **Note Attributes**: Extension saves as `note_attributes` on order
3. **Order Creation**: Shopify creates order with note_attributes
4. **Webhook Trigger**: Shopify sends webhook to `/api/webhooks/orders/paid`
5. **Processing**: Workers transforms note_attributes → metafields
6. **Metafield Creation**: Structured delivery data stored as metafields
7. **Fulfillment Ready**: Order ready with delivery information

## ⚡ Performance Targets

| Endpoint | Target Response Time | SLA |
|----------|---------------------|-----|
| GET /api/delivery-dates/available | <50ms | <100ms |
| POST /api/products/shipping-methods | <100ms | <200ms |
| POST /api/webhooks/orders/paid | <2000ms | <5000ms |
| GET /health | <25ms | <50ms |

## 🛡️ Security

### Webhook Signature Validation

All webhooks validate HMAC-SHA256 signatures using `APP_CLIENT_SECRET`:

```typescript
const signature = request.headers.get('X-Shopify-Hmac-Sha256');
const body = await request.text();
const expectedSignature = await createHmac('sha256', APP_CLIENT_SECRET, body);

if (signature !== expectedSignature) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Token Storage Security

- OAuth tokens encrypted in Cloudflare KV
- Automatic token expiration
- Per-shop isolation
- Secure token rotation on refresh

## 🐛 Error Codes

| Code | Description | HTTP Status |
|------|------------|-------------|
| `INVALID_POSTAL_CODE` | Invalid or missing postal code | 400 |
| `EXTERNAL_API_ERROR` | DutchNed API unavailable | 503 |
| `INVALID_SIGNATURE` | Invalid webhook signature | 401 |
| `PROCESSING_FAILED` | Order processing failed | 500 |
| `TOKEN_EXPIRED` | OAuth token expired | 401 |
| `SHOP_NOT_FOUND` | Shop not registered | 404 |

## 📝 Rate Limiting

- **Extension APIs**: 1000 requests/minute per shop
- **Webhook Processing**: 100 webhooks/minute per shop  
- **Health Endpoints**: Unlimited

Rate limits return HTTP 429 with retry headers:

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1641024000
Retry-After: 60
```

---

**API Version**: 2.0 (Extension + Workers)
**Last Updated**: January 2025
**Status**: 🚀 Production Ready - Streamlined API
