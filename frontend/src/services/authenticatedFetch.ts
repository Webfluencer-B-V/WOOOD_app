/**
 * Authenticated fetch utilities for WOOOD frontend
 * Handles API calls with proper authentication headers
 */

export interface AuthenticatedFetchConfig {
  baseUrl?: string;
  shop?: string;
  sessionId?: string;
  timeout?: number;
}

const DEFAULT_CONFIG: AuthenticatedFetchConfig = {
  baseUrl: 'https://woood-production.leander-4e0.workers.dev',
  timeout: 15000
};

/**
 * Create authenticated fetch function with configuration
 */
export function createAuthenticatedFetch(config: AuthenticatedFetchConfig = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async function authenticatedFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = endpoint.startsWith('http') ? endpoint : `${finalConfig.baseUrl}${endpoint}`;

    // Get authentication headers
    const authHeaders = getAuthenticationHeaders(finalConfig);

    // Create request with authentication
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
    };

    // Add timeout support
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, finalConfig.timeout!);

    try {
      requestOptions.signal = controller.signal;
      const response = await fetch(url, requestOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };
}

/**
 * Get authentication headers for API requests
 */
function getAuthenticationHeaders(config: AuthenticatedFetchConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  // Add shop domain if available
  if (config.shop) {
    headers['X-Shopify-Shop-Domain'] = config.shop;
  } else {
    // Try to extract from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const shop = urlParams.get('shop');
    if (shop) {
      headers['X-Shopify-Shop-Domain'] = shop;
    }
  }

  // Add session ID if available
  if (config.sessionId) {
    headers['X-Session-ID'] = config.sessionId;
  }

  // Add request source
  headers['X-Request-Source'] = 'woood-frontend';

  // Add request ID for tracking
  headers['X-Request-ID'] = `frontend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return headers;
}

/**
 * Default authenticated fetch instance
 */
export const authenticatedFetch = createAuthenticatedFetch();

/**
 * API client with common endpoints
 */
export class WOOODAPIClient {
  private fetch: ReturnType<typeof createAuthenticatedFetch>;

  constructor(config: AuthenticatedFetchConfig = {}) {
    this.fetch = createAuthenticatedFetch(config);
  }

  async healthCheck(): Promise<any> {
    const response = await this.fetch('/health');
    return await response.json();
  }

  async getDeliveryDates(): Promise<any> {
    const response = await this.fetch('/api/delivery-dates/available');
    return await response.json();
  }

  async getWebhookStatus(shop?: string): Promise<any> {
    const endpoint = shop ? `/api/webhooks/status?shop=${encodeURIComponent(shop)}` : '/api/webhooks/status';
    const response = await this.fetch(endpoint);
    return await response.json();
  }

  async registerWebhooks(shop: string, accessToken: string): Promise<any> {
    const response = await this.fetch('/api/webhooks/register', {
      method: 'POST',
      body: JSON.stringify({
        shop,
        accessToken
      })
    });
    return await response.json();
  }

  async getShippingMethods(productIds: string[] = ['8542690115751']): Promise<any> {
    const response = await this.fetch('/api/products/shipping-methods', {
      method: 'POST',
      body: JSON.stringify({ productIds })
    });
    return await response.json();
  }

  async saveOrderMetafields(data: {
    deliveryDate: string;
    shippingMethod?: string;
  }): Promise<any> {
    const response = await this.fetch('/api/order-metafields/save', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return await response.json();
  }
}

/**
 * React hook for authenticated API calls
 */
export function useWOOODAPI(config: AuthenticatedFetchConfig = {}) {
  // Get shop from URL params if not provided
  if (!config.shop) {
    const urlParams = new URLSearchParams(window.location.search);
    config.shop = urlParams.get('shop') || undefined;
  }

  const apiClient = new WOOODAPIClient(config);
  const fetch = createAuthenticatedFetch(config);

  return {
    fetch,
    apiClient,
    config
  };
}