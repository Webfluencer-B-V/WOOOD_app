# API Reference

> Complete API endpoint documentation for the WOOOD Delivery Date Picker system.

## Base URLs

- **Production**: `https://woood-delivery-api.workers.dev`
- **Development**: `https://woood-delivery-api-dev.workers.dev`
- **Local**: `https://localhost:8787`

## Authentication

All API endpoints (except `/health`) require authentication. See [Authentication Guide](authentication.md) for detailed information.

### Authentication Headers

```http
Authorization: Bearer <session_token>
X-Shopify-Shop-Domain: your-shop.myshopify.com
X-Request-ID: <uuid>
Content-Type: application/json
```

## 📅 Delivery Dates API

### Get Available Delivery Dates

Retrieve available delivery dates based on postal code and products.

```http
POST /api/delivery-dates/available
```

**Request Headers:**
```http
Content-Type: application/json
X-Shopify-Shop-Domain: your-shop.myshopify.com
Authorization: Bearer <session_token>
```

**Request Body:**
```json
{
  "postal_code": "1234AB",
  "country": "NL",
  "product_ids": [123456, 789012],
  "quantity": 2
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "available_dates": [
      {
        "date": "2024-07-15",
        "day_name": "Monday",
        "available": true,
        "time_slots": [
          {
            "start_time": "09:00",
            "end_time": "17:00",
            "available": true,
            "price_adjustment": 0.00
          }
        ]
      }
    ],
    "earliest_date": "2024-07-15",
    "latest_date": "2024-08-15",
    "postal_code": "1234AB",
    "delivery_area": "Amsterdam"
  },
  "cache_duration": 300,
  "request_id": "req_123456789"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Invalid postal code format",
  "error_code": "INVALID_POSTAL_CODE",
  "request_id": "req_123456789"
}
```

## 🚚 Shipping Methods API

### Get Product Shipping Methods

Retrieve available shipping methods for specific products.

```http
POST /api/products/shipping-methods
```

**Request Body:**
```json
{
  "product_id": 123456,
  "postal_code": "1234AB",
  "quantity": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "shipping_methods": [
      {
        "id": "standard_delivery",
        "name": "Standard Delivery",
        "description": "Delivered within 2-5 business days",
        "price": 9.95,
        "currency": "EUR",
        "delivery_time": "2-5 days",
        "available": true
      },
      {
        "id": "express_delivery",
        "name": "Express Delivery",
        "description": "Next day delivery",
        "price": 19.95,
        "currency": "EUR",
        "delivery_time": "1 day",
        "available": true
      }
    ],
    "product_id": 123456,
    "postal_code": "1234AB"
  },
  "request_id": "req_123456789"
}
```

### Get ERP Delivery Times

Retrieve delivery time information from ERP system.

```http
POST /api/products/erp-delivery-times
```

**Request Body:**
```json
{
  "product_ids": [123456, 789012],
  "shop_domain": "your-shop.myshopify.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "delivery_times": [
      {
        "product_id": 123456,
        "sku": "WOOOD-CHAIR-001",
        "delivery_time_days": 14,
        "in_stock": true,
        "stock_level": 25,
        "next_restock_date": "2024-07-20"
      }
    ]
  },
  "request_id": "req_123456789"
}
```

## 📦 Order Processing API

### Save Order Metafields

Save delivery information as order metafields (used by webhooks).

```http
POST /api/order-metafields/save
```

**Request Body:**
```json
{
  "order_id": 987654321,
  "delivery_date": "2024-07-15",
  "shipping_method": "standard_delivery",
  "time_slot": "09:00-17:00",
  "special_instructions": "Ring doorbell twice"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "metafields_created": [
      {
        "id": 123456789,
        "key": "delivery_date",
        "value": "2024-07-15",
        "namespace": "woood_delivery"
      },
      {
        "id": 123456790,
        "key": "shipping_method",
        "value": "standard_delivery",
        "namespace": "woood_delivery"
      }
    ],
    "order_id": 987654321
  },
  "request_id": "req_123456789"
}
```

## 🔔 Webhooks API

### Register Webhooks

Register required webhooks with Shopify (admin only).

```http
POST /api/webhooks/register
```

**Request Headers:**
```http
Authorization: Bearer <admin_session_token>
X-Shopify-Shop-Domain: your-shop.myshopify.com
```

**Request Body:**
```json
{
  "topics": ["orders/paid", "orders/updated"],
  "endpoint_base": "https://woood-delivery-api.workers.dev"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "webhooks_registered": [
      {
        "id": 123456789,
        "topic": "orders/paid",
        "endpoint": "https://woood-delivery-api.workers.dev/api/webhooks/orders/paid",
        "status": "active"
      }
    ],
    "total_registered": 1
  },
  "request_id": "req_123456789"
}
```

### Webhook Status

Check webhook registration status (admin only).

```http
GET /api/webhooks/status?shop=your-shop.myshopify.com
```

**Response:**
```json
{
  "success": true,
  "data": {
    "webhooks": [
      {
        "id": 123456789,
        "topic": "orders/paid",
        "endpoint": "https://woood-delivery-api.workers.dev/api/webhooks/orders/paid",
        "status": "active",
        "created_at": "2024-06-29T10:00:00Z",
        "last_triggered": "2024-06-29T12:30:00Z"
      }
    ],
    "total_webhooks": 1,
    "health_status": "healthy"
  },
  "request_id": "req_123456789"
}
```

## 🔄 Webhook Endpoints

### Order Paid Webhook

Processes orders after payment (Shopify webhook).

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

**Request Body:**
Shopify order payload (automatically sent by Shopify).

**Response:**
```json
{
  "success": true,
  "data": {
    "order_id": 987654321,
    "processed": true,
    "metafields_created": 3,
    "delivery_date_processed": true
  },
  "request_id": "req_123456789"
}
```

### Order Updated Webhook

Processes order updates (Shopify webhook).

```http
POST /api/webhooks/orders/updated
```

**Request Headers:**
```http
X-Shopify-Hmac-Sha256: <webhook_signature>
X-Shopify-Topic: orders/updated
X-Shopify-Shop-Domain: your-shop.myshopify.com
Content-Type: application/json
```

## 🏢 Admin API

### Feature Flags

#### Get Feature Flags

```http
GET /api/admin/feature-flags
```

**Response:**
```json
{
  "success": true,
  "data": {
    "feature_flags": {
      "enable_delivery_date_picker": true,
      "enable_time_slot_selection": true,
      "enable_dutchned_api": true,
      "enable_mock_fallback": false
    },
    "shop_domain": "your-shop.myshopify.com"
  },
  "request_id": "req_123456789"
}
```

#### Update Feature Flag

```http
POST /api/admin/feature-flags
```

**Request Body:**
```json
{
  "flag": "enable_delivery_date_picker",
  "value": true,
  "reason": "Enable for testing"
}
```

#### Bulk Update Feature Flags

```http
POST /api/admin/feature-flags/bulk
```

**Request Body:**
```json
{
  "flags": {
    "enable_delivery_date_picker": true,
    "enable_time_slot_selection": false,
    "enable_mock_fallback": true
  },
  "reason": "Configuration update for testing"
}
```

### System Health

#### Get System Health

```http
GET /api/admin/system-health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overall_status": "healthy",
    "services": {
      "dutchned_api": {
        "status": "healthy",
        "response_time": 45,
        "last_check": "2024-06-29T12:00:00Z"
      },
      "shopify_api": {
        "status": "healthy",
        "response_time": 120,
        "last_check": "2024-06-29T12:00:00Z"
      },
      "kv_storage": {
        "status": "healthy",
        "response_time": 5,
        "last_check": "2024-06-29T12:00:00Z"
      }
    },
    "performance_metrics": {
      "avg_response_time": 89,
      "request_count_24h": 15234,
      "error_rate_24h": 0.02
    }
  },
  "request_id": "req_123456789"
}
```

#### Get Activity Log

```http
GET /api/admin/activity-log?limit=50&offset=0
```

**Response:**
```json
{
  "success": true,
  "data": {
    "activities": [
      {
        "id": "activity_123456",
        "timestamp": "2024-06-29T12:00:00Z",
        "type": "api_request",
        "endpoint": "/api/delivery-dates/available",
        "shop_domain": "your-shop.myshopify.com",
        "status": "success",
        "response_time": 45,
        "user_agent": "Shopify Mobile App"
      }
    ],
    "total_count": 15234,
    "pagination": {
      "limit": 50,
      "offset": 0,
      "has_more": true
    }
  },
  "request_id": "req_123456789"
}
```

## 🏥 Health & Monitoring

### Health Check

Public endpoint for system health verification.

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-06-29T12:00:00Z",
  "version": "1.15.0",
  "environment": "production",
  "features": {
    "oauth_integration": true,
    "dutchned_api": true,
    "webhook_processing": true,
    "shipping_method_processing": true,
    "caching": true,
    "logging": true
  },
  "uptime": 1656504000000,
  "performance": {
    "avg_response_time": 45,
    "request_count": 15234,
    "error_rate": 0.02
  }
}
```

## 📊 Rate Limits

- **Public APIs**: 100 requests/minute per IP
- **Authenticated APIs**: 1000 requests/minute per shop
- **Admin APIs**: 100 requests/minute per admin session
- **Webhook APIs**: No limit (Shopify-signed only)

## 🔒 Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `AUTHENTICATION_REQUIRED` | Missing or invalid authentication | Include valid session token |
| `INVALID_SHOP_DOMAIN` | Shop domain validation failed | Verify shop domain format |
| `RATE_LIMIT_EXCEEDED` | Too many requests | Wait before retrying |
| `INVALID_POSTAL_CODE` | Postal code format invalid | Use valid Dutch postal code (1234AB) |
| `DUTCHNED_API_ERROR` | DutchNed API unavailable | Check service status |
| `SHOPIFY_API_ERROR` | Shopify API error | Verify OAuth permissions |
| `WEBHOOK_SIGNATURE_INVALID` | Invalid webhook signature | Check webhook secret |
| `INTERNAL_SERVER_ERROR` | Unexpected server error | Check system status |

## 📞 Support

For API support:

- **Authentication Issues**: See [Authentication Guide](authentication.md)
- **Webhook Problems**: Check [Webhooks Guide](webhooks.md)
- **Error Troubleshooting**: Review [Error Codes Guide](error-codes.md)
- **Rate Limiting**: Contact support for increases

---

**📝 Note**: All timestamps are in ISO 8601 UTC format. All monetary values are in EUR unless specified otherwise.
