import { useSettings } from '@shopify/ui-extensions-react/checkout';

export interface DeliveryDate {
  date: string;
  displayName: string;
}

export interface ApiResponse {
  success: boolean;
  data?: DeliveryDate[];
  error?: string;
  message?: string;
}

export interface FetchConfig {
  timeout?: number;
  retries?: number;
  apiBaseUrl?: string;
  enableMockMode?: boolean;
}

import { config } from '../config/environment';

// Get API base URL from centralized configuration
const getApiBaseUrl = (): string => {
  return config.apiBaseUrl;
};

const getEnableMockMode = (): boolean => {
  return config.enableMockMode;
};

const DEFAULT_CONFIG: FetchConfig = {
  timeout: 15000, // 15 seconds
  retries: 2,
  apiBaseUrl: getApiBaseUrl(),
  enableMockMode: getEnableMockMode()
};

/**
 * Get authentication headers for API requests
 * In a Shopify extension, we extract shop domain from checkout session
 */
function getAuthenticationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  try {
    // Note: All custom headers removed due to CORS restrictions in Shopify checkout iframe
    // Shop domain will be sent in request body instead of headers when needed
    console.log('Using minimal headers for CORS compliance in Shopify checkout');

  } catch (error) {
    console.error('Error getting authentication headers:', error);
  }

  return headers;
}

export async function fetchDeliveryDates(config: FetchConfig = DEFAULT_CONFIG): Promise<DeliveryDate[]> {
  // Use configured API base URL or fallback to default
  const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
  const enableMockMode = config.enableMockMode || DEFAULT_CONFIG.enableMockMode;

  // If mock mode is enabled, return mock data immediately
  if (enableMockMode) {
    console.log('Mock mode enabled, returning mock delivery dates');
    return generateMockDeliveryDates();
  }

  const url = `${apiBaseUrl}/api/delivery-dates/available`;

  for (let attempt = 1; attempt <= (config.retries || DEFAULT_CONFIG.retries!); attempt++) {
    try {
      console.log(`🌐 Fetching delivery dates (attempt ${attempt}): ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, config.timeout || DEFAULT_CONFIG.timeout!);

      // Get authentication headers for session-based authentication
      const authHeaders = getAuthenticationHeaders();

      // Get shop domain from checkout context
      const shopDomain = window.location.hostname;

      const response = await fetch(url, {
        method: 'POST', // Changed to POST to send shop domain in body
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          shopDomain,
          timestamp: new Date().toISOString(),
          source: 'checkout_extension'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();

      // Handle both direct array response and wrapped response
      let data: DeliveryDate[];
      if (responseData.success && Array.isArray(responseData.data)) {
        data = responseData.data;
      } else if (Array.isArray(responseData)) {
        data = responseData;
      } else {
        throw new Error('Invalid response format: expected array of delivery dates');
      }

      console.log(`✅ Successfully fetched ${data.length} delivery dates`);
      return data;

    } catch (error: any) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);

      if (error.name === 'AbortError') {
        console.error('Request timed out');
      }

      // If this is the last attempt, throw error (Workers will handle fallback)
      if (attempt === (config.retries || DEFAULT_CONFIG.retries!)) {
        console.error('All attempts failed, throwing error');
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const waitTime = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // This should never be reached, but throw error if it does
  throw new Error('Unexpected execution path in fetchDeliveryDates');
}

export async function saveOrderMetafields(
  deliveryDate: string,
  shippingMethod: string | null,
  config: FetchConfig = DEFAULT_CONFIG
): Promise<boolean> {
  const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
  const url = `${apiBaseUrl}/api/order-metafields/save`;

  try {
    console.log('💾 Saving order metafields:', { deliveryDate, shippingMethod });

    // Get authentication headers for session-based authentication
    const authHeaders = getAuthenticationHeaders();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        deliveryDate,
        shippingMethod,
        timestamp: new Date().toISOString(),
        source: 'checkout_extension'
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Successfully saved order metafields:', result);
    return true;

  } catch (error: any) {
    console.error('❌ Failed to save order metafields:', error.message);
    return false;
  }
}

function generateMockDeliveryDates(): DeliveryDate[] {
  const dates: DeliveryDate[] = [];
  const today = new Date();

  // Generate mock dates for the next 14 weekdays, excluding weekends
  for (let i = 1; i <= 20; i++) {
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + i);

    // Skip weekends (Saturday = 6, Sunday = 0)
    const dayOfWeek = futureDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const dateString = futureDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    const displayName = futureDate.toLocaleDateString('nl-NL', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    dates.push({
      date: dateString,
      displayName
    });

    // Stop when we have 14 weekdays
    if (dates.length >= 14) {
      break;
    }
  }

  return dates;
}