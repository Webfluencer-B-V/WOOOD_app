# Testing Strategy & Guidelines

> Comprehensive testing documentation for the WOOOD Delivery Date Picker system.

## 🧪 Testing Overview

The WOOOD Delivery Date Picker employs a multi-layered testing strategy ensuring reliability, performance, and security across all components. Our testing pyramid focuses on fast unit tests, critical integration tests, and essential end-to-end scenarios.

### Testing Pyramid

```mermaid
graph TB
    subgraph "Testing Layers"
        E2E[End-to-End Tests<br/>5-10% - Critical User Flows]
        INT[Integration Tests<br/>20-30% - Component Interactions]
        UNIT[Unit Tests<br/>60-70% - Individual Functions]
    end

    UNIT --> INT
    INT --> E2E

    style E2E fill:#ff6b6b
    style INT fill:#4ecdc4
    style UNIT fill:#45b7d1
```

### Testing Principles

- **Fast Feedback**: Tests run in under 2 minutes for CI/CD
- **Reliable**: Tests are deterministic and environment-independent
- **Maintainable**: Tests serve as living documentation
- **Comprehensive**: Critical paths have 95%+ coverage
- **Isolated**: Tests don't depend on external services when possible

## 🔬 Unit Testing

### Test Structure & Organization

```typescript
// Example test file structure
describe('DeliveryDatesService', () => {
  describe('getAvailableDates', () => {
    beforeEach(() => {
      // Setup test environment
      jest.clearAllMocks();
      mockEnv = createMockEnv();
    });

    it('should return available dates for valid postal code', async () => {
      // Arrange
      const postalCode = '1234AB';
      const mockDates = [
        { date: '2024-03-20', available: true },
        { date: '2024-03-21', available: true }
      ];

      mockDutchNedAPI.getDeliveryDates.mockResolvedValue(mockDates);

      // Act
      const result = await deliveryService.getAvailableDates(postalCode, 'NL', mockEnv);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2024-03-20');
      expect(mockDutchNedAPI.getDeliveryDates).toHaveBeenCalledWith(
        postalCode,
        expect.any(String),
        expect.any(String)
      );
    });

    it('should handle DutchNed API errors gracefully', async () => {
      // Arrange
      const postalCode = '1234AB';
      mockDutchNedAPI.getDeliveryDates.mockRejectedValue(
        new Error('External API unavailable')
      );

      // Act & Assert
      await expect(
        deliveryService.getAvailableDates(postalCode, 'NL', mockEnv)
      ).rejects.toThrow('External API unavailable');
    });
  });
});
```

### Testing Utilities

**Mock Environment**:
```typescript
export function createMockEnv(): MockEnv {
  return {
    WOOOD_KV: {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      list: jest.fn()
    },
    SHOPIFY_APP_CLIENT_ID: 'test_client_id',
    SHOPIFY_APP_CLIENT_SECRET: 'test_client_secret',
    DUTCHNED_API_CREDENTIALS: 'test_credentials',
    SESSION_SECRET: 'test_session_secret',
    WEBHOOK_SECRET: 'test_webhook_secret',
    API_ENCRYPTION_KEY: 'test_encryption_key'
  };
}
```

**Mock Data Factories**:
```typescript
export class TestDataFactory {
  static createShopifyOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
    return {
      id: 450789469,
      email: 'customer@example.com',
      total_price: '199.95',
      currency: 'EUR',
      financial_status: 'paid',
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main Street',
        city: 'Amsterdam',
        province: 'North Holland',
        country: 'Netherlands',
        zip: '1234AB'
      },
      line_items: [
        {
          id: 866550311766439020,
          title: 'WOOOD Dining Table',
          quantity: 1,
          price: '199.95',
          properties: [
            { name: 'Delivery Date', value: '2024-03-20' }
          ]
        }
      ],
      ...overrides
    };
  }

  static createDeliveryDate(overrides: Partial<DeliveryDate> = {}): DeliveryDate {
    return {
      date: '2024-03-20',
      available: true,
      capacity: 5,
      timeSlots: [
        { label: 'Morning (9:00-12:00)', value: 'morning', available: true },
        { label: 'Afternoon (13:00-17:00)', value: 'afternoon', available: true }
      ],
      priceModifier: 0.0,
      ...overrides
    };
  }
}
```

### Authentication Testing

```typescript
describe('Authentication Middleware', () => {
  describe('validateOAuthCallback', () => {
    it('should validate correct HMAC signature', async () => {
      // Arrange
      const validParams = new URLSearchParams({
        code: 'test_code',
        state: 'test_state',
        shop: 'test-shop.myshopify.com',
        hmac: 'valid_hmac_signature',
        timestamp: Math.floor(Date.now() / 1000).toString()
      });

      const request = new Request(`https://test.com/auth/callback?${validParams}`);

      // Mock HMAC validation
      jest.spyOn(crypto, 'subtle').mockImplementation({
        sign: jest.fn().mockResolvedValue(new ArrayBuffer(32))
      } as any);

      // Act
      const result = await validateOAuthCallback(request, mockEnv);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should reject expired authorization codes', async () => {
      // Arrange - code older than 10 minutes
      const expiredTimestamp = Math.floor((Date.now() - 700000) / 1000).toString();
      const params = new URLSearchParams({
        code: 'test_code',
        state: 'test_state',
        shop: 'test-shop.myshopify.com',
        hmac: 'valid_hmac',
        timestamp: expiredTimestamp
      });

      const request = new Request(`https://test.com/auth/callback?${params}`);

      // Act
      const result = await validateOAuthCallback(request, mockEnv);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Authorization code expired');
    });
  });
});
```

## 🔗 Integration Testing

### Service Integration Tests

```typescript
describe('Delivery Service Integration', () => {
  let deliveryService: DeliveryDatesService;
  let mockKV: MockKVNamespace;
  let mockDutchNedClient: MockDutchNedClient;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockDutchNedClient = new MockDutchNedClient();
    deliveryService = new DeliveryDatesService(mockDutchNedClient);
  });

  it('should cache delivery dates after API call', async () => {
    // Arrange
    const postalCode = '1234AB';
    const mockApiResponse = [
      TestDataFactory.createDeliveryDate({ date: '2024-03-20' }),
      TestDataFactory.createDeliveryDate({ date: '2024-03-21' })
    ];

    mockDutchNedClient.getDeliveryDates.mockResolvedValue(mockApiResponse);

    // Act
    const result = await deliveryService.getAvailableDates(postalCode, 'NL', mockEnv);

    // Assert
    expect(result).toEqual(mockApiResponse);
    expect(mockKV.put).toHaveBeenCalledWith(
      `delivery:${postalCode}:${getCurrentDate()}`,
      JSON.stringify(mockApiResponse),
      { expirationTtl: 1800 }
    );
  });

  it('should return cached data on subsequent calls', async () => {
    // Arrange
    const postalCode = '1234AB';
    const cachedData = [TestDataFactory.createDeliveryDate()];

    mockKV.get.mockResolvedValue(JSON.stringify(cachedData));

    // Act
    const result = await deliveryService.getAvailableDates(postalCode, 'NL', mockEnv);

    // Assert
    expect(result).toEqual(cachedData);
    expect(mockDutchNedClient.getDeliveryDates).not.toHaveBeenCalled();
  });
});
```

### API Endpoint Integration Tests

```typescript
describe('API Endpoints Integration', () => {
  let worker: ExportedHandler<Env>;
  let mockEnv: MockEnv;

  beforeEach(() => {
    mockEnv = createMockEnv();
    worker = require('../src/index.ts').default;
  });

  describe('POST /api/delivery-dates/available', () => {
    it('should return delivery dates for valid request', async () => {
      // Arrange
      const requestBody = {
        postal_code: '1234AB',
        country: 'NL'
      };

      const request = new Request('https://test.com/api/delivery-dates/available', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid_session_token'
        },
        body: JSON.stringify(requestBody)
      });

      // Mock session validation
      mockEnv.WOOOD_KV.get.mockResolvedValue(JSON.stringify({
        shop: 'test-shop.myshopify.com',
        accessToken: 'test_token'
      }));

      // Act
      const response = await worker.fetch(request, mockEnv, createExecutionContext());
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(responseData.dates).toBeDefined();
      expect(Array.isArray(responseData.dates)).toBe(true);
    });

    it('should return 401 for invalid session', async () => {
      // Arrange
      const request = new Request('https://test.com/api/delivery-dates/available', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postal_code: '1234AB' })
      });

      // Mock invalid session
      mockEnv.WOOOD_KV.get.mockResolvedValue(null);

      // Act
      const response = await worker.fetch(request, mockEnv, createExecutionContext());

      // Assert
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/webhooks/orders/paid', () => {
    it('should process valid webhook with correct HMAC', async () => {
      // Arrange
      const webhookPayload = TestDataFactory.createShopifyOrder();
      const validHmac = await generateValidHmac(webhookPayload, mockEnv.WEBHOOK_SECRET);

      const request = new Request('https://test.com/api/webhooks/orders/paid', {
        method: 'POST',
        headers: {
          'X-Shopify-Topic': 'orders/paid',
          'X-Shopify-Hmac-Sha256': validHmac,
          'X-Shopify-Shop-Domain': 'test-shop.myshopify.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(webhookPayload)
      });

      // Act
      const response = await worker.fetch(request, mockEnv, createExecutionContext());
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
    });
  });
});
```

## 🎭 End-to-End Testing

### Playwright E2E Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('Delivery Date Picker E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Setup test shop with app installed
    await setupTestShop();
    await page.goto('/checkout');
  });

  test('customer can select delivery date in checkout', async ({ page }) => {
    // Add product to cart
    await page.goto('/products/woood-dining-table');
    await page.click('[data-testid="add-to-cart"]');
    await page.goto('/checkout');

    // Fill shipping information
    await page.fill('[data-testid="shipping-postal-code"]', '1234AB');
    await page.fill('[data-testid="shipping-city"]', 'Amsterdam');

    // Wait for delivery date picker to load
    await page.waitForSelector('[data-testid="delivery-date-picker"]');

    // Select a delivery date
    const firstAvailableDate = page.locator('[data-testid="delivery-date-option"]').first();
    await firstAvailableDate.click();

    // Verify selection
    await expect(firstAvailableDate).toHaveClass(/selected/);

    // Complete checkout
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.click('[data-testid="complete-order"]');

    // Verify order completion
    await expect(page.locator('[data-testid="order-confirmation"]')).toBeVisible();
  });

  test('delivery dates update when postal code changes', async ({ page }) => {
    await page.goto('/checkout');

    // Enter first postal code
    await page.fill('[data-testid="shipping-postal-code"]', '1234AB');
    await page.waitForSelector('[data-testid="delivery-date-picker"]');

    const initialDates = await page.locator('[data-testid="delivery-date-option"]').count();

    // Change postal code
    await page.fill('[data-testid="shipping-postal-code"]', '5678CD');
    await page.waitForTimeout(1000); // Wait for API call

    const updatedDates = await page.locator('[data-testid="delivery-date-option"]').count();

    // Verify dates changed (assuming different postal codes have different availability)
    expect(updatedDates).not.toBe(initialDates);
  });

  test('error handling for invalid postal codes', async ({ page }) => {
    await page.goto('/checkout');

    // Enter invalid postal code
    await page.fill('[data-testid="shipping-postal-code"]', 'INVALID');

    // Wait for error message
    await expect(page.locator('[data-testid="postal-code-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="postal-code-error"]')).toContainText('Invalid postal code');

    // Verify delivery date picker is not shown
    await expect(page.locator('[data-testid="delivery-date-picker"]')).not.toBeVisible();
  });
});
```

### Admin Interface E2E Tests

```typescript
test.describe('Admin Dashboard E2E', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAsAdmin(page);
  });

  test('admin can view and update feature flags', async ({ page }) => {
    await page.goto('/admin');

    // Navigate to feature flags
    await page.click('[data-testid="feature-flags-nav"]');
    await expect(page.locator('[data-testid="feature-flags-page"]')).toBeVisible();

    // Toggle a feature flag
    const deliveryPickerFlag = page.locator('[data-testid="flag-delivery_date_picker_enabled"]');
    const initialState = await deliveryPickerFlag.locator('input').isChecked();

    await deliveryPickerFlag.locator('input').click();

    // Wait for save confirmation
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible();

    // Verify state changed
    const newState = await deliveryPickerFlag.locator('input').isChecked();
    expect(newState).toBe(!initialState);
  });

  test('admin can view system health metrics', async ({ page }) => {
    await page.goto('/admin/system-health');

    // Verify health cards are present
    await expect(page.locator('[data-testid="health-cloudflare-workers"]')).toBeVisible();
    await expect(page.locator('[data-testid="health-dutchned-api"]')).toBeVisible();
    await expect(page.locator('[data-testid="health-shopify-api"]')).toBeVisible();

    // Check for status indicators
    const healthStatuses = page.locator('[data-testid^="health-status-"]');
    await expect(healthStatuses.first()).toBeVisible();
  });
});
```

## 📊 Performance Testing

### Load Testing with Artillery

```yaml
# load-test.yml
config:
  target: 'https://your-workers-domain.com'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Load test"
    - duration: 60
      arrivalRate: 100
      name: "Stress test"
  variables:
    postalCodes:
      - "1234AB"
      - "5678CD"
      - "9012EF"

scenarios:
  - name: "Delivery Dates API"
    weight: 70
    flow:
      - post:
          url: "/api/delivery-dates/available"
          headers:
            Content-Type: "application/json"
            Authorization: "Bearer {{ $randomString() }}"
          json:
            postal_code: "{{ $randomString() }}"
            country: "NL"
          capture:
            - json: "$.dates.length"
              as: "dateCount"
          expect:
            - statusCode: 200
            - hasProperty: "dates"

  - name: "Admin Health Check"
    weight: 20
    flow:
      - get:
          url: "/api/admin/system-health"
          headers:
            Authorization: "Bearer admin_token"
          expect:
            - statusCode: 200
            - hasProperty: "status"

  - name: "Webhook Processing"
    weight: 10
    flow:
      - post:
          url: "/api/webhooks/orders/paid"
          headers:
            X-Shopify-Topic: "orders/paid"
            X-Shopify-Hmac-Sha256: "valid_hmac"
            Content-Type: "application/json"
          json:
            id: "{{ $randomInt(1000000, 9999999) }}"
            email: "test@example.com"
            total_price: "99.99"
          expect:
            - statusCode: 200
```

### Performance Benchmarks

```typescript
describe('Performance Tests', () => {
  test('delivery dates API responds under 500ms', async () => {
    const startTime = Date.now();

    const response = await fetch('/api/delivery-dates/available', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      },
      body: JSON.stringify({
        postal_code: '1234AB',
        country: 'NL'
      })
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    expect(response.status).toBe(200);
    expect(responseTime).toBeLessThan(500);
  });

  test('webhook processing handles 100 concurrent requests', async () => {
    const requests = Array.from({ length: 100 }, (_, i) =>
      fetch('/api/webhooks/orders/paid', {
        method: 'POST',
        headers: {
          'X-Shopify-Topic': 'orders/paid',
          'X-Shopify-Hmac-Sha256': 'valid_hmac',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 1000000 + i,
          email: `test${i}@example.com`
        })
      })
    );

    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const endTime = Date.now();

    // All requests should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });

    // Total time should be reasonable
    expect(endTime - startTime).toBeLessThan(5000); // 5 seconds
  });
});
```

## 🔒 Security Testing

### Authentication Security Tests

```typescript
describe('Security Tests', () => {
  test('should reject requests with invalid HMAC signatures', async () => {
    const response = await fetch('/api/webhooks/orders/paid', {
      method: 'POST',
      headers: {
        'X-Shopify-Topic': 'orders/paid',
        'X-Shopify-Hmac-Sha256': 'invalid_hmac',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id: 123, email: 'test@example.com' })
    });

    expect(response.status).toBe(401);
  });

  test('should sanitize XSS attempts in input', async () => {
    const maliciousInput = '<script>alert("xss")</script>';

    const response = await fetch('/api/delivery-dates/available', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid_token'
      },
      body: JSON.stringify({
        postal_code: maliciousInput,
        country: 'NL'
      })
    });

    expect(response.status).toBe(400);

    const responseData = await response.json();
    expect(responseData.error).toContain('Invalid input');
  });

  test('should enforce rate limiting', async () => {
    const requests = Array.from({ length: 110 }, () =>
      fetch('/api/delivery-dates/available', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid_token'
        },
        body: JSON.stringify({ postal_code: '1234AB' })
      })
    );

    const responses = await Promise.all(requests);

    // Some requests should be rate limited (429 status)
    const rateLimitedCount = responses.filter(r => r.status === 429).length;
    expect(rateLimitedCount).toBeGreaterThan(0);
  });
});
```

## 🚀 Continuous Integration

### GitHub Actions Test Pipeline

```yaml
# .github/workflows/test.yml
name: Test Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Run unit tests
        run: yarn test:unit --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Start test environment
        run: yarn test:env:start

      - name: Run integration tests
        run: yarn test:integration
        env:
          TEST_SHOPIFY_CLIENT_ID: ${{ secrets.TEST_SHOPIFY_CLIENT_ID }}
          TEST_SHOPIFY_CLIENT_SECRET: ${{ secrets.TEST_SHOPIFY_CLIENT_SECRET }}

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Install Playwright
        run: npx playwright install

      - name: Run E2E tests
        run: yarn test:e2e
        env:
          E2E_BASE_URL: ${{ secrets.E2E_BASE_URL }}

  performance-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'

      - name: Install Artillery
        run: npm install -g artillery

      - name: Run load tests
        run: artillery run load-test.yml
```

### Test Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "playwright test",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:load": "artillery run load-test.yml",
    "test:security": "jest --testPathPattern=security",
    "test:env:start": "docker-compose up -d",
    "test:env:stop": "docker-compose down"
  }
}
```

## 📋 Test Data Management

### Test Database Setup

```typescript
// test-setup.ts
export async function setupTestDatabase() {
  // Create test KV namespace
  const testKV = new MockKVNamespace();

  // Seed with test data
  await testKV.put('test_session:123', JSON.stringify({
    shop: 'test-shop.myshopify.com',
    accessToken: 'test_token',
    expiresAt: Date.now() + 86400000
  }));

  await testKV.put('feature_flags:test-shop.myshopify.com', JSON.stringify({
    delivery_date_picker_enabled: true,
    express_shipping_enabled: false
  }));

  return testKV;
}

export async function cleanupTestDatabase(testKV: MockKVNamespace) {
  // Clear all test data
  const keys = await testKV.list();
  for (const key of keys.keys) {
    await testKV.delete(key.name);
  }
}
```

### Test Fixtures

```typescript
// fixtures/orders.ts
export const testOrders = {
  validOrder: {
    id: 450789469,
    email: 'customer@example.com',
    total_price: '199.95',
    shipping_address: {
      zip: '1234AB',
      country: 'Netherlands'
    },
    line_items: [{
      properties: [{ name: 'Delivery Date', value: '2024-03-20' }]
    }]
  },

  orderWithoutDeliveryDate: {
    id: 450789470,
    email: 'customer2@example.com',
    total_price: '99.95',
    line_items: [{
      properties: []
    }]
  }
};
```

---

**🧪 Testing Note**: This comprehensive testing strategy ensures system reliability, performance, and security while maintaining fast feedback loops for developers.