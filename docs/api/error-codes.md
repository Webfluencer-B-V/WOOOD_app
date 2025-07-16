# Error Codes Reference

> Complete error handling documentation for the WOOOD Delivery Date Picker API.

## 🚨 Error Response Format

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
    "timestamp": "2024-03-15T10:30:00Z",
    "documentation_url": "https://docs.woood.com/api/error-codes#DELIVERY_DATES_UNAVAILABLE"
  }
}
```

## 📊 HTTP Status Codes

### 2xx Success
| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 204 | No Content | Request successful, no content returned |

### 4xx Client Errors
| Code | Status | Description |
|------|--------|-------------|
| 400 | Bad Request | Invalid request format or parameters |
| 401 | Unauthorized | Authentication required |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource conflict |
| 422 | Unprocessable Entity | Validation errors |
| 429 | Too Many Requests | Rate limit exceeded |

### 5xx Server Errors
| Code | Status | Description |
|------|--------|-------------|
| 500 | Internal Server Error | Unexpected server error |
| 502 | Bad Gateway | External service error |
| 503 | Service Unavailable | Service temporarily unavailable |
| 504 | Gateway Timeout | External service timeout |

## 🔍 Error Code Categories

### Authentication Errors (AUTH_*)

#### AUTH_REQUIRED
- **HTTP Status**: 401 Unauthorized
- **Description**: Authentication is required to access this resource
- **Common Causes**: Missing shop parameter or access token
- **Resolution**: Include shop parameter and ensure valid OAuth token

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

#### AUTH_NO_TOKEN
- **HTTP Status**: 401 Unauthorized
- **Description**: No access token found for the specified shop
- **Common Causes**: App not installed, token expired, shop not authenticated
- **Resolution**: Re-authenticate through OAuth flow

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

#### AUTH_MISSING_SHOP
- **HTTP Status**: 400 Bad Request
- **Description**: Missing shop parameter in request
- **Common Causes**: No shop parameter in query or headers
- **Resolution**: Include shop parameter in query or X-Shopify-Shop-Domain header

```json
{
  "error": {
    "code": "AUTH_MISSING_SHOP",
    "message": "Missing shop parameter",
    "details": {
      "required": "shop parameter or X-Shopify-Shop-Domain header"
    }
  }
}
```

#### AUTH_ADMIN_REQUIRED
- **HTTP Status**: 403 Forbidden
- **Description**: Admin access is required for this endpoint
- **Common Causes**: Regular token used for admin endpoint
- **Resolution**: Authenticate as shop admin

```json
{
  "error": {
    "code": "AUTH_ADMIN_REQUIRED",
    "message": "Admin access is required for this endpoint",
    "details": {
      "endpoint": "/api/admin/feature-flags",
      "required_role": "admin"
    }
  }
}
```

#### AUTH_WEBHOOK_INVALID
- **HTTP Status**: 401 Unauthorized
- **Description**: Webhook HMAC signature validation failed
- **Common Causes**: Invalid webhook secret, corrupted signature
- **Resolution**: Verify webhook secret configuration

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

### Validation Errors (VALIDATION_*)

#### VALIDATION_FAILED
- **HTTP Status**: 422 Unprocessable Entity
- **Description**: Request data validation failed
- **Common Causes**: Missing required fields, invalid formats
- **Resolution**: Fix validation errors and retry

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

#### VALIDATION_MISSING_FIELD
- **HTTP Status**: 400 Bad Request
- **Description**: Required field is missing from request
- **Common Causes**: Incomplete request data
- **Resolution**: Include all required fields

```json
{
  "error": {
    "code": "VALIDATION_MISSING_FIELD",
    "message": "Required field is missing from request",
    "details": {
      "missing_field": "postal_code",
      "field_type": "string",
      "required": true
    }
  }
}
```

#### VALIDATION_INVALID_FORMAT
- **HTTP Status**: 400 Bad Request
- **Description**: Field value has invalid format
- **Common Causes**: Wrong data type, invalid pattern
- **Resolution**: Correct field format according to API specification

```json
{
  "error": {
    "code": "VALIDATION_INVALID_FORMAT",
    "message": "Field value has invalid format",
    "details": {
      "field": "date",
      "received": "invalid-date",
      "expected_format": "YYYY-MM-DD"
    }
  }
}
```

### Delivery Date Errors (DELIVERY_*)

#### DELIVERY_DATES_UNAVAILABLE
- **HTTP Status**: 404 Not Found
- **Description**: No delivery dates available for specified criteria
- **Common Causes**: Outside delivery area, no capacity
- **Resolution**: Try different postal code or date range

```json
{
  "error": {
    "code": "DELIVERY_DATES_UNAVAILABLE",
    "message": "No delivery dates available for the specified postal code",
    "details": {
      "postal_code": "9999XX",
      "country": "NL",
      "reason": "outside_delivery_area"
    }
  }
}
```

#### DELIVERY_DATE_INVALID
- **HTTP Status**: 400 Bad Request
- **Description**: The selected delivery date is invalid
- **Common Causes**: Past date, non-delivery day, unavailable date
- **Resolution**: Select a valid future delivery date

```json
{
  "error": {
    "code": "DELIVERY_DATE_INVALID",
    "message": "The selected delivery date is invalid",
    "details": {
      "selected_date": "2024-03-10",
      "reason": "date_in_past",
      "earliest_available": "2024-03-16"
    }
  }
}
```

#### DELIVERY_POSTAL_CODE_INVALID
- **HTTP Status**: 400 Bad Request
- **Description**: Invalid postal code format or unsupported area
- **Common Causes**: Wrong format, unsupported country
- **Resolution**: Use valid Dutch postal code format (1234AB)

```json
{
  "error": {
    "code": "DELIVERY_POSTAL_CODE_INVALID",
    "message": "Invalid postal code format or unsupported area",
    "details": {
      "postal_code": "invalid",
      "country": "NL",
      "expected_format": "1234AB"
    }
  }
}
```

### External Service Errors (EXTERNAL_*)

#### EXTERNAL_DUTCHNED_ERROR
- **HTTP Status**: 502 Bad Gateway
- **Description**: Error communicating with DutchNed API
- **Common Causes**: DutchNed service down, API credentials invalid
- **Resolution**: Retry request or contact support

```json
{
  "error": {
    "code": "EXTERNAL_DUTCHNED_ERROR",
    "message": "Error communicating with DutchNed API",
    "details": {
      "service": "dutchned",
      "operation": "delivery_dates",
      "status_code": 500,
      "retry_after": 30
    }
  }
}
```

#### EXTERNAL_SHOPIFY_ERROR
- **HTTP Status**: 502 Bad Gateway
- **Description**: Error communicating with Shopify API
- **Common Causes**: Shopify service issues, rate limiting
- **Resolution**: Retry request with exponential backoff

```json
{
  "error": {
    "code": "EXTERNAL_SHOPIFY_ERROR",
    "message": "Error communicating with Shopify API",
    "details": {
      "service": "shopify",
      "operation": "order_metafields",
      "status_code": 429,
      "retry_after": 60
    }
  }
}
```

#### EXTERNAL_SERVICE_TIMEOUT
- **HTTP Status**: 504 Gateway Timeout
- **Description**: External service request timed out
- **Common Causes**: Network issues, service overload
- **Resolution**: Retry request with timeout handling

```json
{
  "error": {
    "code": "EXTERNAL_SERVICE_TIMEOUT",
    "message": "External service request timed out",
    "details": {
      "service": "dutchned",
      "timeout_seconds": 30,
      "suggestion": "retry_with_backoff"
    }
  }
}
```

### Rate Limiting Errors (RATE_*)

#### RATE_LIMIT_EXCEEDED
- **HTTP Status**: 429 Too Many Requests
- **Description**: Rate limit exceeded for this endpoint
- **Common Causes**: Too many requests in time window
- **Resolution**: Wait and retry with exponential backoff

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for this endpoint",
    "details": {
      "limit": 100,
      "window": "1h",
      "remaining": 0,
      "reset_time": "2024-03-15T11:30:00Z"
    }
  }
}
```

### Resource Errors (RESOURCE_*)

#### RESOURCE_NOT_FOUND
- **HTTP Status**: 404 Not Found
- **Description**: The requested resource was not found
- **Common Causes**: Invalid ID, deleted resource
- **Resolution**: Check resource ID and existence

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found",
    "details": {
      "resource_type": "feature_flag",
      "resource_id": "unknown_flag",
      "available_resources": ["delivery_enabled", "express_shipping"]
    }
  }
}
```

#### RESOURCE_CONFLICT
- **HTTP Status**: 409 Conflict
- **Description**: Resource operation conflicts with current state
- **Common Causes**: Concurrent modifications, state conflicts
- **Resolution**: Refresh and retry operation

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "Resource operation conflicts with current state",
    "details": {
      "resource_type": "feature_flag",
      "resource_id": "delivery_enabled",
      "conflict_reason": "concurrent_modification"
    }
  }
}
```

### System Errors (SYSTEM_*)

#### SYSTEM_MAINTENANCE
- **HTTP Status**: 503 Service Unavailable
- **Description**: System is currently under maintenance
- **Common Causes**: Scheduled maintenance
- **Resolution**: Wait for maintenance to complete

```json
{
  "error": {
    "code": "SYSTEM_MAINTENANCE",
    "message": "System is currently under maintenance",
    "details": {
      "maintenance_start": "2024-03-15T02:00:00Z",
      "estimated_end": "2024-03-15T04:00:00Z",
      "status_url": "https://status.woood.com"
    }
  }
}
```

#### SYSTEM_OVERLOADED
- **HTTP Status**: 503 Service Unavailable
- **Description**: System is experiencing high load
- **Common Causes**: Traffic spikes, resource constraints
- **Resolution**: Retry with exponential backoff

```json
{
  "error": {
    "code": "SYSTEM_OVERLOADED",
    "message": "System is experiencing high load",
    "details": {
      "retry_after": 30,
      "load_factor": 0.95,
      "suggestion": "retry_with_backoff"
    }
  }
}
```

#### SYSTEM_ERROR
- **HTTP Status**: 500 Internal Server Error
- **Description**: An unexpected system error occurred
- **Common Causes**: Software bugs, infrastructure issues
- **Resolution**: Contact support with request ID

```json
{
  "error": {
    "code": "SYSTEM_ERROR",
    "message": "An unexpected system error occurred",
    "details": {
      "request_id": "req_123456789",
      "error_id": "err_987654321",
      "support_contact": "support@woood.com"
    }
  }
}
```

## 🛠️ Error Handling Best Practices

### Client Implementation

```typescript
interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
  request_id?: string;
  timestamp?: string;
  documentation_url?: string;
}

export async function handleAPIError(response: Response): Promise<APIError> {
  const errorData = await response.json();

  // Log error for debugging
  console.error('API Error:', {
    status: response.status,
    error: errorData.error
  });

  return errorData.error;
}

export async function makeAPIRequest(
  url: string,
  options: RequestInit = {}
): Promise<any> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await handleAPIError(response);
    throw new APIError(error);
  }

  return response.json();
}
```

### Retry Logic

```typescript
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        const retryAfter = error.details?.retry_after * 1000 || baseDelay * Math.pow(2, attempt);
        await sleep(retryAfter);
        continue;
      }

      if (attempt === maxRetries - 1) {
        throw error;
      }

      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }

  throw new Error('Max retries exceeded');
}
```

### Error Recovery

```typescript
export function isRetryableError(error: APIError): boolean {
  const retryableCodes = [
    'EXTERNAL_DUTCHNED_ERROR',
    'EXTERNAL_SHOPIFY_ERROR',
    'EXTERNAL_SERVICE_TIMEOUT',
    'RATE_LIMIT_EXCEEDED',
    'SYSTEM_OVERLOADED'
  ];

  return retryableCodes.includes(error.code);
}

export function getRetryDelay(error: APIError): number {
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    return error.details?.retry_after * 1000 || 60000;
  }

  if (error.code === 'SYSTEM_OVERLOADED') {
    return error.details?.retry_after * 1000 || 30000;
  }

  return 1000; // Default 1 second
}
```

## 📞 Support and Debugging

### Error Investigation

When encountering errors:

1. **Check Request ID**: Include request_id when contacting support
2. **Review Documentation**: Check documentation_url if provided
3. **Verify Authentication**: Ensure valid session tokens
4. **Check API Status**: Visit status page for service updates

### Common Debugging Steps

```bash
# Test API connectivity
curl -I https://woood-delivery-api.workers.dev/health

# Test authentication
curl -H "Authorization: Bearer your_token" \
  https://woood-delivery-api.workers.dev/api/delivery-dates/available

# Check rate limits
curl -i -H "Authorization: Bearer your_token" \
  https://woood-delivery-api.workers.dev/api/admin/feature-flags
```

### Support Information

- **Documentation**: [API Reference](endpoints.md)
- **Authentication**: [Authentication Guide](authentication.md)
- **Status Page**: https://status.woood.com
- **Support Email**: support@woood.com

---

**🔧 Development Tip**: Enable detailed error logging in development environments to capture full error context and stack traces.
