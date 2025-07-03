// Minimal environment interface - extension-only essentials
interface Env {
  ENVIRONMENT: string;
  DUTCHNED_API_URL: string;
  DUTCHNED_API_CREDENTIALS: string;
  SHOPIFY_APP_CLIENT_ID: string;
  SHOPIFY_APP_CLIENT_SECRET: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_API_VERSION: string;
  ENABLE_MOCK_FALLBACK: string;
  CORS_ORIGINS: string;
  WOOOD_KV: any;
}

import { DeliveryDate } from '../types/common';
import { WorkersLogger } from '../utils/logger';
import { generateMockDeliveryDates } from '../utils/mockDataGenerator';

/**
 * Consolidated extension API handler
 * Combines delivery dates and shipping methods for checkout extension
 */

interface ProductDataRequest {
  product_ids: string[];
  shop_domain: string;
  productIds?: string[];
  shopDomain?: string;
}

interface ProductMetafield {
  namespace: string;
  key: string;
  value: string;
}

interface ProductInfo {
  metafields: ProductMetafield[];
  inventory_quantity: number;
}

// Delivery dates endpoint
export async function handleDeliveryDates(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    let postalCode: string = url.searchParams.get('postal_code') ?? '1000 AA'; // Default Amsterdam postal code
    let country: string = url.searchParams.get('country') ?? 'NL';

    // Handle POST requests from extension
    if (request.method === 'POST') {
      try {
        const body = await request.json() as any;
        // Extension doesn't send postal code, so use default Dutch postal code
        postalCode = '1000 AA'; // Default Amsterdam postal code
        country = 'NL';
      } catch (e) {
        // If body parsing fails, use defaults
        postalCode = '1000 AA';
        country = 'NL';
      }
    }

    // Check cache first (postalCode is guaranteed to be string at this point)
    const cacheKey = `delivery:${postalCode}:${country}`;
    let dates: DeliveryDate[] = [];

    if (env.WOOOD_KV) {
      try {
        const cached = await env.WOOOD_KV.get(cacheKey, 'json');
        if (cached) {
          dates = cached as DeliveryDate[];
        }
      } catch (cacheError) {
        console.warn('Cache read failed:', cacheError);
      }
    }

    // Fetch from API if not cached
    if (dates.length === 0) {
      try {
        if (env.ENABLE_MOCK_FALLBACK === 'true') {
          dates = generateMockDeliveryDates();
        } else {
          // Direct API call to DutchNed
          const response = await fetch(env.DUTCHNED_API_URL, {
            method: 'GET',
            headers: {
              'Authorization': `Basic ${env.DUTCHNED_API_CREDENTIALS}`,
              'Accept': 'application/json',
              'User-Agent': 'WOOOD-Checkout-API/1.0'
            }
          });

          if (response.ok) {
            const apiData = await response.json();
            // Simple format conversion
            dates = Array.isArray(apiData) ? apiData.map((item: any) => ({
              date: item.date,
              displayName: item.displayName || formatDateInDutch(new Date(item.date))
            })) : [];
          } else {
            throw new Error(`API returned ${response.status}`);
          }
        }

        // Cache for 30 minutes
        if (env.WOOOD_KV && dates.length > 0) {
          await env.WOOOD_KV.put(cacheKey, JSON.stringify(dates), {
            expirationTtl: 1800
          });
        }
      } catch (apiError) {
        console.error('API fetch failed:', apiError);
        // Fallback to mock data
        dates = generateMockDeliveryDates();
      }
    }

    // Return format expected by extension: { success: true, data: DeliveryDate[] }
    return new Response(JSON.stringify({
      success: true,
      data: dates,
      metadata: {
        mockDataEnabled: env.ENABLE_MOCK_FALLBACK === 'true',
        cacheHit: dates.length > 0,
        responseTime: Date.now()
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delivery dates error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error',
      error_code: 'INTERNAL_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Consolidated product data endpoint
export async function handleProductData(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    const requestData = await request.json() as ProductDataRequest;
    const { product_ids, shop_domain, productIds, shopDomain } = requestData;

    // Support both new and legacy parameter names
    const productIdsList = product_ids || productIds;
    const shopDomainValue = shop_domain || shopDomain;

    if (!productIdsList || !Array.isArray(productIdsList)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Product IDs array required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!shopDomainValue) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Shop domain required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // TypeScript assertion after validation
    const validShopDomain = shopDomainValue as string;

    // Get shop token
    const tokenKey = `shop_token:${validShopDomain}`;
    let accessToken = '';

    if (env.WOOOD_KV) {
      try {
        const tokenData = await env.WOOOD_KV.get(tokenKey, 'json') as any;
        if (tokenData && tokenData.accessToken) {
          accessToken = tokenData.accessToken;
        }
      } catch (tokenError) {
        console.warn('Token fetch failed:', tokenError);
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Shop not authenticated'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch product data from Shopify
    const productData: Record<string, any> = {};

    for (const productId of productIdsList) {
      try {
        const productInfo = await fetchProductMetafields(productId, accessToken, validShopDomain);
        const shippingMethods = extractShippingMethods(productInfo);
        const deliveryTimes = extractDeliveryTimes(productInfo);

        productData[productId] = {
          shipping_methods: shippingMethods,
          delivery_times: deliveryTimes,
          in_stock: productInfo.inventory_quantity > 0,
          erp_delivery_time: extractErpDeliveryTime(productInfo)
        };
      } catch (productError) {
        console.warn(`Failed to fetch product ${productId}:`, productError);
        productData[productId] = {
          shipping_methods: ['woood_standard'],
          delivery_times: 14,
          in_stock: true,
          shipping_method: 'woood_standard',
          erp_delivery_time: null
        };
      }
    }

    // Return different formats based on endpoint
    if (path.includes('/erp-delivery-times')) {
      // Legacy ERP delivery times format - extension expects { success: true, data: { productId: string | null } }
      const erpData: Record<string, string | null> = {};
      for (const [productId, data] of Object.entries(productData)) {
        erpData[productId] = (data as any).erp_delivery_time;
      }
      return new Response(JSON.stringify({
        success: true,
        data: erpData
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path.includes('/shipping-methods')) {
      // Legacy shipping methods format - extension expects { success: true, data: { productId: { value: string, number: number } } }
      const shippingData: Record<string, any> = {};
      for (const [productId, data] of Object.entries(productData)) {
        const methods = (data as any).shipping_methods;
        const methodValue = methods[0] || 'woood_standard';
        shippingData[productId] = {
          value: methodValue,
          number: extractMethodNumber(methodValue)
        };
      }
      return new Response(JSON.stringify({
        success: true,
        data: shippingData
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // New consolidated format
    return new Response(JSON.stringify({
      success: true,
      products: productData
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Product data error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper functions
function validateDutchPostalCode(postalCode: string): boolean {
  const dutchPostalRegex = /^[1-9][0-9]{3}\s?[A-Z]{2}$/i;
  return dutchPostalRegex.test(postalCode.trim());
}

async function fetchProductMetafields(productId: string, accessToken: string, shop: string): Promise<ProductInfo> {
  const response = await fetch(`https://${shop}/admin/api/2024-10/products/${productId}/metafields.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Product API error: ${response.status}`);
  }

  const data = await response.json() as { metafields: ProductMetafield[] };
  return {
    metafields: data.metafields || [],
    inventory_quantity: 10 // Mock inventory
  };
}

function extractShippingMethods(productInfo: ProductInfo): string[] {
  const shippingMetafield = productInfo.metafields.find(
    (m: ProductMetafield) => m.namespace === 'custom' && m.key === 'ShippingMethod2'
  );

  if (shippingMetafield && shippingMetafield.value) {
    return [shippingMetafield.value];
  }

  return ['woood_standard'];
}

function extractDeliveryTimes(productInfo: ProductInfo): number {
  const deliveryMetafield = productInfo.metafields.find(
    (m: ProductMetafield) => m.namespace === 'custom' && m.key === 'delivery_time'
  );

  if (deliveryMetafield && deliveryMetafield.value) {
    return parseInt(deliveryMetafield.value, 10);
  }

  return 14; // Default 2 weeks
}

function extractErpDeliveryTime(productInfo: ProductInfo): string | null {
  const erpMetafield = productInfo.metafields.find(
    (m: ProductMetafield) => m.namespace === 'erp' && m.key === 'levertijd'
  );

  if (erpMetafield && erpMetafield.value) {
    return erpMetafield.value;
  }

  return null;
}

// Helper function to extract method number from shipping method string
function extractMethodNumber(shippingMethod: string): number {
  // Extract number from shipping method like "11 - PAKKET POST"
  const match = shippingMethod.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

// Format date in Dutch locale for display
function formatDateInDutch(date: Date): string {
  try {
    return new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    // Fallback formatting
    const weekdays = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

    const weekday = weekdays[date.getDay()] || 'onbekend';
    const day = date.getDate();
    const month = months[date.getMonth()] || 'onbekend';

    return `${weekday} ${day} ${month}`;
  }
}