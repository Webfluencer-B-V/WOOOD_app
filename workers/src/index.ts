/**
 * Delivery Date Picker - Cloudflare Workers API
 * Simplified architecture with essential functionality only
 */

import { upsertStoreLocator } from './storeLocatorUpserter';

// Store locator utility functions
const EXCLUSIVITY_MAP: Record<string, string> = {
  'woood essentials': 'WOOOD Essentials',
  'essentials': 'WOOOD Essentials',
  'woood premium': 'WOOOD Premium',
  'woood exclusive': 'WOOOD Premium',
  'woood outdoor': 'WOOOD Outdoor',
  'woood tablo': 'WOOOD Tablo',
  'vtwonen': 'vtwonen',
  'vt wonen dealers only': 'vtwonen',
};

// Status keys for KV storage
const STORE_LOCATOR_STATUS_KEY = 'store_locator_last_sync';
const EXPERIENCE_CENTER_STATUS_KEY = 'experience_center_last_sync';

// Helper function to get access token for a shop
async function getShopAccessToken(env: Env, shop: string): Promise<string | null> {
  if (!env.WOOOD_KV) return null;

  const tokenRecord = await env.WOOOD_KV.get(`shop_token:${shop}`, 'json') as any;
  return tokenRecord?.accessToken || null;
}

// Helper function to get all installed shops
async function getInstalledShops(env: Env): Promise<string[]> {
  if (!env.WOOOD_KV) return [];

  // List all keys that start with 'shop_token:'
  const keys = await env.WOOOD_KV.list({ prefix: 'shop_token:' });
  return keys.keys.map((key: any) => key.name.replace('shop_token:', ''));
}

// Helper function to clean up old shop tokens
async function cleanupOldTokens(env: Env): Promise<void> {
  if (!env.WOOOD_KV) return;

  const keys = await env.WOOOD_KV.list({ prefix: 'shop_token:' });
  for (const key of keys.keys) {
    const shop = key.name.replace('shop_token:', '');
    try {
      // Test if the token is still valid by trying to fetch shop info
      const tokenRecord = await env.WOOOD_KV.get(key.name, 'json') as any;
      if (tokenRecord?.accessToken) {
        const response = await fetch(`https://${shop}/admin/api/2023-10/shop.json`, {
          headers: {
            'X-Shopify-Access-Token': tokenRecord.accessToken,
          },
        });
        if (!response.ok) {
          console.log(`🗑️ Removing invalid token for ${shop}`);
          await env.WOOOD_KV.delete(key.name);
        }
      }
    } catch (error) {
      console.log(`🗑️ Removing invalid token for ${shop}: ${error}`);
      await env.WOOOD_KV.delete(key.name);
    }
  }
}

function mapExclusives(exclusivityData: any): string[] {
  if (!exclusivityData) return [];
  let descriptions: string[] = [];
  if (Array.isArray(exclusivityData)) {
    descriptions = exclusivityData
      .map((item) => {
        const desc = item.Description || item.description;
        return typeof desc === 'string' ? desc.trim().toLowerCase() : null;
      })
      .filter((d): d is string => d !== null);
  } else if (typeof exclusivityData === 'string') {
    descriptions = exclusivityData.split(',').map((val) => val.trim().toLowerCase());
  }
  const mapped = descriptions
    .map((desc) => EXCLUSIVITY_MAP[desc])
    .filter((val): val is string => Boolean(val));
  return [...new Set(mapped)];
}

// Fetch and transform dealer data
async function fetchAndTransformDealers(env: Env): Promise<any[]> {
  const { DUTCH_FURNITURE_BASE_URL, DUTCH_FURNITURE_API_KEY } = env;
  let data: any[] = [];
  if (!DUTCH_FURNITURE_BASE_URL || !DUTCH_FURNITURE_API_KEY) throw new Error('Missing DUTCH_FURNITURE_BASE_URL or DUTCH_FURNITURE_API_KEY');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${DUTCH_FURNITURE_API_KEY}`,
  };
  const storeLocatorUrl = `${DUTCH_FURNITURE_BASE_URL}/api/datasource/wooodshopfinder`;
  const response = await fetch(storeLocatorUrl, { headers });
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
  data = await response.json();
  if (!Array.isArray(data)) throw new Error('External API did not return an array');
  // Filter and map
  return data
    .filter((dealer) => {
      const accountStatus = dealer.accountStatus || dealer.AccountStatus;
      const activationPortal = dealer.dealerActivationPortal || dealer.DealerActivationPortal;
      const isActivated = activationPortal === true || activationPortal === 'WAAR';
      return accountStatus === 'A' && isActivated;
    })
    .map((dealer) => {
      const {
        accountmanager,
        dealerActivationPortal,
        vatNumber,
        shopfinderExclusives,
        accountStatus,
        ...rest
      } = dealer;
      const exclusivityRaw = dealer.Exclusiviteit || dealer.shopfinderExclusives || dealer.ShopfinderExclusives;
      const exclusives = mapExclusives(exclusivityRaw);
      const name = dealer.nameAlias || dealer.NameAlias || dealer.name || dealer.Name;
      return {
        ...rest,
        name,
        exclusives,
      };
    });
}

// Upsert to Shopify shop metafield
async function upsertShopMetafield(env: Env, dealers: any[], shop: string): Promise<any> {
  // 1. Get access token for the shop
  const accessToken = await getShopAccessToken(env, shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  // 2. Get shop ID
  const shopQuery = `query { shop { id } }`;
  const shopResponse = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: shopQuery }),
  });
  const shopResult = await shopResponse.json() as { data?: { shop?: { id?: string } } };
  const shopId = shopResult?.data?.shop?.id;
  if (!shopId) throw new Error('Could not fetch shop ID');
  // 2. Upsert metafield
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value type ownerType }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    metafields: [
      {
        ownerId: shopId,
        namespace: 'woood',
        key: 'store_locator',
        value: JSON.stringify(dealers),
        type: 'json',
      },
    ],
  };
  const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });
  return response.json();
}

// Essential environment interface
interface Env {
  ENVIRONMENT: string;
  DUTCHNED_API_URL: string;
  DUTCHNED_API_CREDENTIALS: string;
  SHOPIFY_APP_CLIENT_ID: string;
  SHOPIFY_APP_CLIENT_SECRET: string;
  SHOPIFY_APP_URL: string;
  ENABLE_MOCK_FALLBACK: string;
  CORS_ORIGINS: string;
  WOOOD_KV: any;
  // External API integration environment variables
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: string;
  SHOPIFY_STORE_URL: string;
  DUTCH_FURNITURE_BASE_URL: string;
  DUTCH_FURNITURE_API_KEY: string;
  STORE_LOCATOR_STATUS?: KVNamespace;
  EXPERIENCE_CENTER_STATUS?: KVNamespace;
}

// Essential types
interface DeliveryDate {
  date: string;
  displayName: string;
}

interface OAuthTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

interface NoteAttribute {
  name: string;
  value: string;
}

interface ShopifyOrder {
  id: number;
  name: string;
  note_attributes?: NoteAttribute[];
}

interface OrderMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Basic CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env.CORS_ORIGINS?.split(',') || []),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain, x-api-key',
      'Access-Control-Allow-Credentials': 'true',
      'X-Content-Type-Options': 'nosniff'
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response: Response;

      // Simplified routing
      switch (true) {
        case path === '/' || path === '/install':
          response = await handleInstall(request, env);
          break;

        case path === '/auth/callback':
          response = await handleCallback(request, env);
          break;

        case path === '/api/delivery-dates':
          response = await handleDeliveryDates(request, env);
          break;

        case path === '/api/webhooks/orders' && request.method === 'POST':
          response = await handleOrderWebhook(request, env);
          break;

        case path === '/admin':
          response = await handleAdmin(request, env);
          break;

        case path === '/health':
          response = await handleHealth(request, env);
          break;

        case path === '/test-webhooks' && request.method === 'POST':
          response = await handleTestWebhooks(request, env);
          break;

        case path === '/api/upsert-store-locator' && request.method === 'POST':
          try {
            const result = await upsertStoreLocator(env);
            response = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
          } catch (error: any) {
            response = new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
          break;

        case path === '/api/inventory' && request.method === 'POST':
          response = await handleInventoryCheck(request, env);
          break;

        case path === '/api/store-locator/trigger' && request.method === 'POST':
          response = await handleStoreLocatorUpsert(request, env);
          break;

        case path === '/api/store-locator/status' && request.method === 'GET':
          response = await handleStoreLocatorStatus(request, env);
          break;

        case path === '/api/experience-center/trigger' && request.method === 'POST':
          response = await handleExperienceCenterTrigger(request, env);
          break;

        case path === '/api/experience-center/status' && request.method === 'GET':
          response = await handleExperienceCenterStatus(request, env);
          break;

        case path === '/api/experience-center/bulk-test' && request.method === 'POST':
          response = await handleExperienceCenterBulkTest(request, env);
          break;

        case path === '/api/debug/env' && request.method === 'GET':
          response = new Response(JSON.stringify({
            hasShopifyToken: !!env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
            hasStoreUrl: !!env.SHOPIFY_STORE_URL,
            hasDutchFurnitureUrl: !!env.DUTCH_FURNITURE_BASE_URL,
            hasDutchFurnitureKey: !!env.DUTCH_FURNITURE_API_KEY,
            storeUrl: env.SHOPIFY_STORE_URL,
            dutchFurnitureUrl: env.DUTCH_FURNITURE_BASE_URL,
            tokenLength: env.SHOPIFY_ADMIN_API_ACCESS_TOKEN?.length || 0,
            keyLength: env.DUTCH_FURNITURE_API_KEY?.length || 0,
          }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });
          break;

        case path === '/api/cleanup-tokens' && request.method === 'POST':
          await cleanupOldTokens(env);
          response = new Response(JSON.stringify({
            success: true,
            message: 'Token cleanup completed',
            timestamp: new Date().toISOString(),
          }), { headers: { 'Content-Type': 'application/json' } });
          break;

        default:
          response = new Response(JSON.stringify({
              success: false,
            error: 'Endpoint not found'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
          break;
      }

        return addCorsHeaders(response, corsHeaders);

    } catch (error) {
      console.error('Request processing error:', error);
      const errorResponse = new Response(JSON.stringify({
            success: false,
        error: 'Internal server error'
          }), {
            status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
      return addCorsHeaders(errorResponse, corsHeaders);
    }
  },
  // Add cron integration for store locator upserter
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('🕐 Starting scheduled tasks...');

    // Clean up old tokens first
    try {
      console.log('🧹 Cleaning up old tokens...');
      await cleanupOldTokens(env);
    } catch (error: any) {
      console.error('❌ Token cleanup error:', error);
    }

    // Store locator cron job
    try {
      console.log('🗺️ Starting store locator update...');
      const dealers = await fetchAndTransformDealers(env);
      const installedShops = await getInstalledShops(env);

      if (installedShops.length === 0) {
        console.log('⚠️ No installed shops found');
        return;
      }

      const results = [];
      for (const shop of installedShops) {
        try {
          const upsertResult = await upsertShopMetafield(env, dealers, shop);
          results.push({ shop, success: true, result: upsertResult });
        } catch (error: any) {
          console.error(`❌ Failed to update shop ${shop}:`, error.message);
          results.push({ shop, success: false, error: error.message });
        }
      }

      const successfulShops = results.filter(r => r.success).length;
      const status = {
        success: successfulShops > 0,
        timestamp: new Date().toISOString(),
        count: dealers.length,
        results,
        summary: {
          totalShops: installedShops.length,
          successfulShops,
          failedShops: installedShops.length - successfulShops,
        },
        cron: true,
      };
      if (env.STORE_LOCATOR_STATUS) {
        await env.STORE_LOCATOR_STATUS.put(STORE_LOCATOR_STATUS_KEY, JSON.stringify(status));
      }
      console.log(`✅ Store locator update completed: ${dealers.length} dealers processed for ${successfulShops}/${installedShops.length} shops`);
    } catch (error: any) {
      console.error('❌ Store locator cron error:', error);
      const status = {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        cron: true,
      };
      if (env.STORE_LOCATOR_STATUS) {
        await env.STORE_LOCATOR_STATUS.put(STORE_LOCATOR_STATUS_KEY, JSON.stringify(status));
      }
    }

    // Experience center cron job - process all shops with resume capability
    try {
      console.log('🏪 Starting experience center update for all shops...');

      // Start fresh processing with bulk operations - the main and only flow
      const result = await processExperienceCenterUpdateAllShops(env);
      if (env.EXPERIENCE_CENTER_STATUS) {
        await env.EXPERIENCE_CENTER_STATUS.put(EXPERIENCE_CENTER_STATUS_KEY, JSON.stringify(result));
      }
      console.log(`✅ Experience center update completed: ${result.summary?.successfulProducts || 0} successful, ${result.summary?.failedProducts || 0} failed`);
    } catch (error: any) {
      console.error('❌ Experience center cron error:', error);
      const errorResult = {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        cron: true,
      };
      if (env.EXPERIENCE_CENTER_STATUS) {
        await env.EXPERIENCE_CENTER_STATUS.put(EXPERIENCE_CENTER_STATUS_KEY, JSON.stringify(errorResult));
      }
    }
  }
};

// App installation handler
async function handleInstall(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');

  if (!shop) {
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Delivery Date Picker</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                   max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            .header { font-size: 32px; margin-bottom: 20px; }
            .description { font-size: 18px; color: #666; margin-bottom: 30px; }
            .form { background: #f8f9fa; padding: 30px; border-radius: 8px; }
            .input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
            .button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="header">📅 Delivery Date Picker</div>
          <div class="description">Enable customers to select delivery dates during checkout</div>
          <div class="form">
            <form action="/install" method="get">
              <input type="text" name="shop" placeholder="your-shop.myshopify.com" class="input" required>
              <button type="submit" class="button">Install App</button>
            </form>
          </div>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (!isValidShopDomain(shop)) {
    return new Response('Invalid shop domain', { status: 400 });
  }

  // Generate OAuth URL
  const state = crypto.randomUUID();
  const scopes = 'read_products,write_products,write_checkouts,write_delivery_customizations,write_orders';
  const redirectUri = `${env.SHOPIFY_APP_URL}/auth/callback`;

  // Store state temporarily
  if (env.WOOOD_KV) {
    await env.WOOOD_KV.put(`oauth_state:${state}`, shop, { expirationTtl: 600 });
  }

  const oauthUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${env.SHOPIFY_APP_CLIENT_ID}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;

  return Response.redirect(oauthUrl, 302);
}

// OAuth callback handler
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const shop = url.searchParams.get('shop');

  if (!code || !state || !shop) {
    return new Response('Missing required parameters', { status: 400 });
  }

  // Validate state
  let storedShop = null;
  if (env.WOOOD_KV) {
    storedShop = await env.WOOOD_KV.get(`oauth_state:${state}`);
    if (storedShop !== shop) {
      return new Response('Invalid state parameter', { status: 400 });
    }
    await env.WOOOD_KV.delete(`oauth_state:${state}`);
  }

  // Exchange code for token
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_APP_CLIENT_ID,
      client_secret: env.SHOPIFY_APP_CLIENT_SECRET,
      code: code
    })
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token exchange failed:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      error: errorText,
      shop: shop,
      client_id: env.SHOPIFY_APP_CLIENT_ID ? 'SET' : 'MISSING',
      client_secret: env.SHOPIFY_APP_CLIENT_SECRET ? 'SET' : 'MISSING'
    });
    return new Response(`Token exchange failed: ${errorText}`, { status: 500 });
  }

  const tokenData: OAuthTokenResponse = await tokenResponse.json();

  // Store offline token
  const tokenRecord = {
    accessToken: tokenData.access_token,
    scope: tokenData.scope,
    shop: shop,
    createdAt: Date.now()
  };

  if (env.WOOOD_KV) {
    await env.WOOOD_KV.put(`shop_token:${shop}`, JSON.stringify(tokenRecord));
  }

  // Register webhooks
  await registerWebhooks(shop, tokenData.access_token, env);

  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Installation Complete</title>
        <meta http-equiv="refresh" content="3;url=https://${shop}/admin/apps">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                 max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
          .button { background: #007bff; color: white; padding: 12px 24px;
                   text-decoration: none; border-radius: 4px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="success">Delivery Date Picker Installed Successfully!</div>
        <p><em>Redirecting to Shopify admin...</em></p>
        <a href="https://${shop}/admin/apps" class="button">Go to Admin</a>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

// Delivery dates API handler
async function handleDeliveryDates(request: Request, env: Env): Promise<Response> {
  try {
    let dates: DeliveryDate[] = [];

    // Check cache first
    const cacheKey = 'delivery_dates';
    if (env.WOOOD_KV) {
      const cached = await env.WOOOD_KV.get(cacheKey, 'json');
      if (cached) {
        dates = cached as DeliveryDate[];
      }
    }

    // Fetch from API if not cached
    if (dates.length === 0) {
      if (env.ENABLE_MOCK_FALLBACK === 'true') {
        dates = generateMockDates();
      } else {
        const response = await fetch(env.DUTCHNED_API_URL, {
          method: 'GET',
            headers: {
            'Authorization': `Basic ${env.DUTCHNED_API_CREDENTIALS}`,
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const apiData = await response.json();
          dates = Array.isArray(apiData) ? apiData.map((item: any) => ({
            date: item.date,
            displayName: item.displayName || formatDateInDutch(new Date(item.date))
          })) : [];
        } else {
          dates = generateMockDates();
        }
      }

      // Cache for 30 minutes
      if (env.WOOOD_KV && dates.length > 0) {
        await env.WOOOD_KV.put(cacheKey, JSON.stringify(dates), { expirationTtl: 1800 });
            }
          }

            return new Response(JSON.stringify({
      success: true,
      data: dates,
      metadata: {
        mockDataEnabled: env.ENABLE_MOCK_FALLBACK === 'true',
        cacheHit: dates.length > 0
      }
    }), { headers: { 'Content-Type': 'application/json' } });

        } catch (error) {
          return new Response(JSON.stringify({
        success: false,
      error: 'Internal server error'
          }), {
            status: 500,
        headers: { 'Content-Type': 'application/json' }
          });
        }
      }

// Order webhook handler
async function handleOrderWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const signature = request.headers.get('X-Shopify-Hmac-Sha256');
    const shop = request.headers.get('X-Shopify-Shop-Domain');

    if (!signature || !shop) {
      return new Response('Missing required headers', { status: 401 });
    }

    const bodyText = await request.text();
    const isValid = await validateWebhookSignature(bodyText, signature, env.SHOPIFY_APP_CLIENT_SECRET);

    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }

    const orderData: ShopifyOrder = JSON.parse(bodyText);
    const metafields = transformNoteAttributesToMetafields(orderData.note_attributes || []);

    console.log(`Processing order webhook for order #${orderData.id}`, {
      shop: shop,
      noteAttributes: orderData.note_attributes,
      transformedMetafields: metafields
    });

    if (metafields.length === 0) {
      console.log(`No delivery metafields to create for order #${orderData.id}`);
      return new Response(JSON.stringify({ success: true, metafieldsCreated: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get shop token
    const tokenKey = `shop_token:${shop}`;
    let accessToken = '';

    if (env.WOOOD_KV) {
      const tokenData = await env.WOOOD_KV.get(tokenKey, 'json') as any;
      if (tokenData && tokenData.accessToken) {
        accessToken = tokenData.accessToken;
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, error: 'Shop not authenticated' }), {
          status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create metafields
    await createOrderMetafields(orderData.id, metafields, accessToken, shop);

      return new Response(JSON.stringify({
        success: true,
      metafieldsCreated: metafields.length,
      orderId: orderData.id
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
}

/**
 * POST /api/inventory
 * Body: { shop: string, variantIds: string[] }
 * Returns: { [variantId: string]: number | null }
 * Checks inventory for given variant IDs using Shopify Admin API.
 */
async function handleInventoryCheck(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { shop: string; variantIds: string[] };
    const shop = body.shop;
    const variantIds = body.variantIds;
    if (!shop || !Array.isArray(variantIds) || variantIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing shop or variantIds' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!isValidShopDomain(shop)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid shop domain' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // Get access token from KV
    let accessToken = '';
    if (env.WOOOD_KV) {
      const tokenData = await env.WOOOD_KV.get(`shop_token:${shop}`, 'json');
      if (tokenData && tokenData.accessToken) {
        accessToken = tokenData.accessToken;
      }
    }
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, error: 'Shop not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // Build GraphQL query for Admin API
    const query = `query($ids: [ID!]!) {\n  nodes(ids: $ids) {\n    ... on ProductVariant {\n      id\n      inventoryQuantity: quantityAvailable\n    }\n  }\n}`;
    const variables = { ids: variantIds };
    const apiRes = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ query, variables })
    });
    if (!apiRes.ok) {
      const err = await apiRes.text();
      return new Response(JSON.stringify({ success: false, error: 'Shopify API error', details: err }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await apiRes.json() as { data?: { nodes?: Array<{ id: string; inventoryQuantity?: number }> } };
    const result: Record<string, number | null> = {};
    if (data && data.data && Array.isArray(data.data.nodes)) {
      for (const node of data.data.nodes) {
        if (node && node.id) {
          result[node.id] = typeof node.inventoryQuantity === 'number' ? node.inventoryQuantity : null;
        }
      }
    }
    return new Response(JSON.stringify({ success: true, inventory: result }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Simple admin interface
async function handleAdmin(request: Request, env: Env): Promise<Response> {
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Delivery Date Picker - Admin</title>
        <link rel="stylesheet" href="https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css">
        <style>
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .card { background: white; border: 1px solid #e1e3e5; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
          .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📅 Delivery Date Picker</h1>

          <div class="card">
            <h2>System Status</h2>
            <div class="status success">✅ Application is running normally</div>
            <div class="status info">ℹ️ Environment: ${env.ENVIRONMENT}</div>
          </div>

          <div class="card">
            <h2>Configuration</h2>
            <p><strong>API Endpoint:</strong> /api/delivery-dates</p>
            <p><strong>Webhook Endpoint:</strong> /api/webhooks/orders</p>
            <p><strong>Mock Data:</strong> ${env.ENABLE_MOCK_FALLBACK === 'true' ? 'Enabled' : 'Disabled'}</p>
          </div>

          <div class="card">
            <h2>Documentation</h2>
            <p>This app provides delivery date selection functionality for Shopify checkout extensions.</p>
            <ul>
              <li>Customers can select delivery dates during checkout</li>
              <li>Selected dates are automatically saved to order metafields</li>
              <li>Integration with external delivery date API</li>
            </ul>
          </div>
        </div>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

// Health check handler
async function handleHealth(request: Request, env: Env): Promise<Response> {
  try {
    // Try to fetch WOOOD API data to show totals
    let woodApiStatus = 'unknown';
    let woodApiTotals = null;

    try {
      const experienceCenterData = await fetchExperienceCenterData(env);
      woodApiStatus = 'available';
      woodApiTotals = {
        total: experienceCenterData.total
      };
    } catch (error) {
      woodApiStatus = 'unavailable';
      console.error('Failed to fetch WOOOD API data for health check:', error);
    }

    return new Response(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: env.ENVIRONMENT,
      services: {
        kv: env.WOOOD_KV ? 'available' : 'unavailable',
        dutchNedApi: woodApiStatus
      },
      woodApi: woodApiTotals ? {
        status: woodApiStatus,
        totals: woodApiTotals
      } : {
        status: woodApiStatus
      }
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Health check failed:', error);
    return new Response(JSON.stringify({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      environment: env.ENVIRONMENT,
      error: 'Health check failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Test webhook registration handler
async function handleTestWebhooks(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { shop: string; accessToken: string };

  if (!body.shop || !body.accessToken) {
      return new Response(JSON.stringify({
        success: false,
      error: 'Missing shop or accessToken'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  console.log(`Manual webhook registration test for shop: ${body.shop}`);

  try {
    await registerWebhooks(body.shop, body.accessToken, env);
    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook registration attempted - check logs for details'
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Test webhook registration failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Webhook registration failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Store locator upsert handler
async function handleStoreLocatorUpsert(request: Request, env: Env): Promise<Response> {
  try {
    const dealers = await fetchAndTransformDealers(env);
    const installedShops = await getInstalledShops(env);

    if (installedShops.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        timestamp: new Date().toISOString(),
        error: 'No installed shops found',
        results: [],
        summary: {
          totalShops: 0,
          successfulShops: 0,
          failedShops: 0,
        },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const results = [];
    for (const shop of installedShops) {
      try {
        const upsertResult = await upsertShopMetafield(env, dealers, shop);
        results.push({
          shop,
          success: true,
          summary: {
            total: dealers.length,
            successful: dealers.length,
            failed: 0,
          },
          result: upsertResult,
        });
      } catch (error: any) {
        console.error(`❌ Failed to update shop ${shop}:`, error.message);
        results.push({
          shop,
          success: false,
          error: error.message,
        });
      }
    }

    const successfulShops = results.filter(r => r.success).length;
    const status = {
      success: successfulShops > 0,
      timestamp: new Date().toISOString(),
      count: dealers.length,
      results,
      summary: {
        totalShops: installedShops.length,
        successfulShops,
        failedShops: installedShops.length - successfulShops,
      },
    };
    if (env.STORE_LOCATOR_STATUS) {
      await env.STORE_LOCATOR_STATUS.put(STORE_LOCATOR_STATUS_KEY, JSON.stringify(status));
    }

    return new Response(JSON.stringify({
      success: successfulShops > 0,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalShops: installedShops.length,
        successfulShops,
        failedShops: installedShops.length - successfulShops,
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    const status = {
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
    };
    if (env.STORE_LOCATOR_STATUS) {
      await env.STORE_LOCATOR_STATUS.put(STORE_LOCATOR_STATUS_KEY, JSON.stringify(status));
    }
    return new Response(JSON.stringify({
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      results: [],
      summary: {
        totalShops: 0,
        successfulShops: 0,
        failedShops: 0,
      },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Store locator status handler
async function handleStoreLocatorStatus(request: Request, env: Env): Promise<Response> {
  if (env.STORE_LOCATOR_STATUS) {
    const status = await env.STORE_LOCATOR_STATUS.get(STORE_LOCATOR_STATUS_KEY);
    if (status) {
      const statusData = JSON.parse(status);
      return new Response(JSON.stringify(statusData), { headers: { 'Content-Type': 'application/json' } });
    }
  }
  return new Response(JSON.stringify({ success: false, message: 'No status available' }), { headers: { 'Content-Type': 'application/json' } });
}

// Experience center functions - OPTIMIZED WITH BULK OPERATIONS
async function fetchExperienceCenterData(env: Env): Promise<{data: any[], total: number}> {
  const { DUTCH_FURNITURE_BASE_URL, DUTCH_FURNITURE_API_KEY } = env;
  if (!DUTCH_FURNITURE_BASE_URL || !DUTCH_FURNITURE_API_KEY) {
    throw new Error('Missing DUTCH_FURNITURE_BASE_URL or DUTCH_FURNITURE_API_KEY');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${DUTCH_FURNITURE_API_KEY}`,
  };

  const experienceCenterUrl = `${DUTCH_FURNITURE_BASE_URL}/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`;
  const response = await fetch(experienceCenterUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch experience center data: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.json() as any;
  const allData = Array.isArray(rawData) ? rawData : rawData.data || [];
  
  // Filter for only Experience Center products with EAN codes
  const experienceCenterData = allData.filter((item: any) => 
    item.channel === 'EC' && item.ean
  );
  
  return {
    data: experienceCenterData,
    total: experienceCenterData.length // Only count EC products as total
  };
}

// NEW: Bulk Operations implementation for Experience Center
async function processExperienceCenterWithBulkOperations(env: Env, shop: string, availableEans: Set<string>): Promise<{successful: number, failed: number, errors: string[], eanMatches: number, totalProducts: number}> {
  const accessToken = await getShopAccessToken(env, shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  console.log(`🚀 Starting bulk operations for ${shop} with ${availableEans.size} available EANs`);

  // Step 1: Create bulk operation to fetch all products and variants
  const bulkQuery = `
    {
      products {
          edges {
            node {
              id
            variants {
                edges {
                  node {
                    id
                    barcode
                  }
                }
              }
            }
          }
        }
      }
    `;

  const createBulkOperationMutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
        ${bulkQuery}
        """
      ) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  console.log(`📤 Creating bulk operation for ${shop}...`);
  const createResponse = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
    body: JSON.stringify({ query: createBulkOperationMutation }),
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create bulk operation: ${createResponse.status} ${createResponse.statusText}`);
  }

  const createResult = await createResponse.json() as any;
  const userErrors = createResult.data?.bulkOperationRunQuery?.userErrors || [];

  if (userErrors.length > 0) {
    throw new Error(`Bulk operation creation failed: ${JSON.stringify(userErrors)}`);
  }

  const bulkOperationId = createResult.data?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!bulkOperationId) {
    throw new Error('No bulk operation ID returned');
  }

  console.log(`✅ Bulk operation created: ${bulkOperationId}`);

  // Step 2: Poll for completion
  const maxWaitTime = 10 * 60 * 1000; // 10 minutes max wait
  const pollInterval = 5000; // 5 seconds
  const startTime = Date.now();
  let operationStatus = 'CREATED';
  let downloadUrl: string | null = null;

  while (operationStatus !== 'COMPLETED' && operationStatus !== 'FAILED' && operationStatus !== 'CANCELED') {
    if (Date.now() - startTime > maxWaitTime) {
      throw new Error('Bulk operation timeout - exceeded 10 minutes');
    }

    await delay(pollInterval);

    const statusQuery = `
      query {
        node(id: "${bulkOperationId}") {
          ... on BulkOperation {
            id
            status
            errorCode
            objectCount
            fileSize
            url
            partialDataUrl
          }
        }
      }
    `;

    const statusResponse = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: statusQuery }),
    });

    if (!statusResponse.ok) {
      throw new Error(`Failed to check bulk operation status: ${statusResponse.status} ${statusResponse.statusText}`);
    }

    const statusResult = await statusResponse.json() as any;
    const bulkOperation = statusResult.data?.node;

    if (!bulkOperation) {
      throw new Error('Could not retrieve bulk operation status');
    }

    operationStatus = bulkOperation.status;
    downloadUrl = bulkOperation.url;

    console.log(`📊 Bulk operation status: ${operationStatus}, objects: ${bulkOperation.objectCount || 0}`);

    if (operationStatus === 'FAILED') {
      throw new Error(`Bulk operation failed: ${bulkOperation.errorCode || 'Unknown error'}`);
    }

    if (operationStatus === 'CANCELED') {
      throw new Error('Bulk operation was canceled');
    }
  }

  if (!downloadUrl) {
    throw new Error('No download URL available for completed bulk operation');
  }

  console.log(`✅ Bulk operation completed, downloading data from: ${downloadUrl}`);

  // Step 3: Download and parse JSONL data
  const downloadResponse = await fetch(downloadUrl);
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download bulk operation data: ${downloadResponse.status} ${downloadResponse.statusText}`);
  }

  const jsonlData = await downloadResponse.text();
  const lines = jsonlData.trim().split('\n');

  console.log(`📦 Downloaded ${lines.length} lines of JSONL data`);

  // Step 4: Parse JSONL and build product map
  const products = new Map<string, { id: string, variants: Array<{ id: string, barcode: string | null }> }>();
  const variants = new Map<string, { id: string, barcode: string | null, productId: string }>();

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);

      if (obj.id?.includes('/Product/')) {
        // This is a product
        products.set(obj.id, {
          id: obj.id,
          variants: []
        });
      } else if (obj.id?.includes('/ProductVariant/') && obj.__parentId) {
        // This is a variant
        const variant = {
          id: obj.id,
          barcode: obj.barcode || null,
          productId: obj.__parentId
        };
        variants.set(obj.id, variant);

        // Add to product's variants array
        const product = products.get(obj.__parentId);
        if (product) {
          product.variants.push(variant);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to parse JSONL line: ${line}`);
    }
  }

  console.log(`📊 Parsed ${products.size} products and ${variants.size} variants`);

  // Step 5: Process products and prepare metafield updates
  const metafieldsToUpdate: Array<{productId: string, experienceCenter: boolean}> = [];
  let processedProducts = 0;
  let skippedProducts = 0;
  let eanMatches = 0;

  for (const [productId, product] of products) {
    try {
      // Find barcode from variants
      let barcode: string | null = null;
      for (const variant of product.variants) {
        if (variant.barcode) {
          barcode = variant.barcode;
          break;
        }
      }

      if (!barcode) {
        skippedProducts++;
        continue;
      }

      const experienceCenter = availableEans.has(barcode);
      if (experienceCenter) {
        eanMatches++;
      }

      metafieldsToUpdate.push({
        productId,
        experienceCenter,
      });

      processedProducts++;
    } catch (error: any) {
      console.error(`❌ Error processing product ${productId}:`, error.message);
    }
  }

  console.log(`📊 Prepared ${metafieldsToUpdate.length} metafield updates (${processedProducts} processed, ${skippedProducts} skipped, ${eanMatches} EAN matches)`);

  // Step 6: Update metafields in efficient batches
  const batchSize = 25; // Shopify limit: maximum 25 metafields per request
  let totalSuccessful = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < metafieldsToUpdate.length; i += batchSize) {
    const batch = metafieldsToUpdate.slice(i, i + batchSize);

    try {
      console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(metafieldsToUpdate.length / batchSize)} (${batch.length} products)`);

      const result = await setProductExperienceCenterMetafieldsBulk(env, shop, batch);
      totalSuccessful += result.successful;
      totalFailed += result.failed;
      allErrors.push(...result.errors);

      // Small delay between batches
      if (i + batchSize < metafieldsToUpdate.length) {
        await delay(1000); // 1 second delay between batches
      }
    } catch (error: any) {
      console.error(`❌ Error processing batch:`, error.message);
      totalFailed += batch.length;
      allErrors.push(`Batch error: ${error.message}`);
    }
  }

  console.log(`🎯 Bulk operations completed for ${shop}: ${totalSuccessful} successful, ${totalFailed} failed, ${eanMatches} EAN matches out of ${availableEans.size} available`);

  return {
    successful: totalSuccessful,
    failed: totalFailed,
    errors: allErrors.slice(0, 20),
    eanMatches,
    totalProducts: processedProducts,
  };
}



async function setProductExperienceCenterMetafieldsBulk(env: Env, shop: string, metafields: Array<{productId: string, experienceCenter: boolean}>): Promise<{successful: number, failed: number, errors: string[]}> {
  // Shopify limit: maximum 25 metafields per request
  if (metafields.length > 25) {
    throw new Error(`Batch size too large: ${metafields.length}. Maximum allowed: 25 for Shopify metafields API`);
  }
  const accessToken = await getShopAccessToken(env, shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value type ownerType }
        userErrors { field message }
      }
    }
  `;

  const metafieldsInput = metafields.map(({productId, experienceCenter}) => ({
    key: 'experiencecenter',
    namespace: 'woood',
    value: experienceCenter.toString(),
    type: 'boolean',
    ownerId: productId,
  }));

  const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables: { metafields: metafieldsInput } }),
  });

  if (!response.ok) {
    throw new Error(`Failed to set experience center metafields: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as any;
  const userErrors = result.data?.metafieldsSet?.userErrors || [];
  const successfulMetafields = result.data?.metafieldsSet?.metafields || [];

  // Only count as successful if the metafield was actually created/updated
  const successful = successfulMetafields.length;
  const failed = metafields.length - successful;

  const errors = userErrors.map((error: any) => `${error.field}: ${error.message}`);

  return {
    successful,
    failed,
    errors,
  };
}

// Helper function to add delay between requests
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processExperienceCenterUpdateAllShops(env: Env): Promise<any> {
  console.log('🏪 Starting experience center update for all shops...');

  // Fetch experience center data from external API
  const experienceCenterData = await fetchExperienceCenterData(env);
  console.log(`📊 Fetched ${experienceCenterData.total} Experience Center products from WOOOD API`);

  // Create a set of EAN codes that are available in experience centers
  const availableEans = new Set(experienceCenterData.data.map((item: any) => item.ean));

  // Get all installed shops
  const installedShops = await getInstalledShops(env);
  if (installedShops.length === 0) {
    console.log('⚠️ No installed shops found');
    return {
      success: false,
      timestamp: new Date().toISOString(),
      error: 'No installed shops found',
      results: [],
      summary: {
        totalShops: 0,
        successfulShops: 0,
        failedShops: 0,
        totalProducts: 0,
        successfulProducts: 0,
        failedProducts: 0,
      },
    };
  }

  const results = [];
  let totalSuccessful = 0;
  let totalFailed = 0;
  const startTime = Date.now();
  const maxExecutionTime = 25 * 60 * 1000; // 25 minutes (leaving 5 min buffer for 30 min limit)

  console.log(`🏪 Processing ${installedShops.length} shops with ${availableEans.size} available EANs`);

  // Process shops sequentially with time management
  for (let i = 0; i < installedShops.length; i++) {
    const shop = installedShops[i]!;
    const elapsedTime = Date.now() - startTime;

    // Check if we're approaching the time limit
    if (elapsedTime > maxExecutionTime) {
      console.log(`⏰ Time limit approaching (${Math.round(elapsedTime/1000)}s elapsed), stopping processing`);

      // Save partial progress to KV for next execution
      const partialState = {
        availableEans: Array.from(availableEans),
        shops: installedShops,
        currentShopIndex: i,
        results,
        totalSuccessful,
        totalFailed,
        startTime: new Date(startTime).toISOString(),
        partial: true,
      };
      await env.EXPERIENCE_CENTER_STATUS?.put('processing_state', JSON.stringify(partialState));

      return {
        success: true,
        timestamp: new Date().toISOString(),
        message: `Partial completion due to time limit. Processed ${i}/${installedShops.length} shops.`,
        partial: true,
        progress: {
          current: i,
          total: installedShops.length,
          percentage: Math.round((i / installedShops.length) * 100),
        },
        summary: {
          totalShops: installedShops.length,
          successfulShops: results.filter((r: any) => r.success).length,
          failedShops: results.filter((r: any) => !r.success).length,
          totalProducts: totalSuccessful + totalFailed,
          successfulProducts: totalSuccessful,
          failedProducts: totalFailed,
        },
        cron: true,
      };
    }

    try {
      console.log(`🏪 Processing shop ${i + 1}/${installedShops.length}: ${shop} (${Math.round(elapsedTime/1000)}s elapsed)`);

      // Process products using bulk operations for maximum efficiency
      const result = await processExperienceCenterWithBulkOperations(env, shop, availableEans);

      const successful = result.successful;
      const failed = result.failed;
      const errors = result.errors;
      const eanMatches = result.eanMatches;
      const totalProducts = result.totalProducts;

      results.push({
        shop,
        success: true,
        summary: {
          total: successful + failed,
          successful,
          failed,
          errors: errors.slice(0, 10), // Limit error messages
          eanMatches,
          totalProducts,
          availableEans: availableEans.size,
        },
      });

      totalSuccessful += successful;
      totalFailed += failed;
      console.log(`✅ Experience center update completed for ${shop}: ${successful} successful, ${failed} failed, ${eanMatches} EAN matches`);

      // Add longer delay between shops for truly sequential processing
      if (i < installedShops.length - 1) {
        console.log(`⏳ Waiting 5 seconds before processing next shop...`);
        await delay(5000);
      }

    } catch (error: any) {
      console.error(`❌ Failed to process shop ${shop}:`, error.message);
      results.push({
        shop,
        success: false,
        error: error.message,
      });
    }
  }

  // Clean up any partial state since we completed all shops
  await env.EXPERIENCE_CENTER_STATUS?.delete('processing_state');

  const successfulShops = results.filter((r: any) => r.success).length;
  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log(`🎯 All shops processed in ${totalTime}s: ${successfulShops}/${installedShops.length} successful`);

  return {
    success: successfulShops > 0,
    timestamp: new Date().toISOString(),
    message: `Completed all ${installedShops.length} shops in ${totalTime}s`,
    results,
    summary: {
      totalShops: installedShops.length,
      successfulShops,
      failedShops: installedShops.length - successfulShops,
      totalProducts: totalSuccessful + totalFailed,
      successfulProducts: totalSuccessful,
      failedProducts: totalFailed,
    },
    cron: true,
  };
}







// Experience center trigger handler - Bulk Operations Only
async function handleExperienceCenterTrigger(request: Request, env: Env): Promise<Response> {
  try {
    console.log('🚀 Starting Experience Center bulk operations for all shops');

    // Always use bulk operations - the main and only flow
    const result = await processExperienceCenterUpdateAllShops(env);

    // Store status in KV
    if (env.EXPERIENCE_CENTER_STATUS) {
      await env.EXPERIENCE_CENTER_STATUS.put(EXPERIENCE_CENTER_STATUS_KEY, JSON.stringify(result));
    }

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    const errorResult = {
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
    };

    if (env.EXPERIENCE_CENTER_STATUS) {
      await env.EXPERIENCE_CENTER_STATUS.put(EXPERIENCE_CENTER_STATUS_KEY, JSON.stringify(errorResult));
    }

    return new Response(JSON.stringify({
      success: false,
      timestamp: new Date().toISOString(),
      results: [{
        shop: env.SHOPIFY_STORE_URL?.replace('https://', '').replace('http://', ''),
        success: false,
        error: error.message,
      }],
      summary: {
        totalShops: 1,
        successfulShops: 0,
        failedShops: 1,
      },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Experience center status handler
async function handleExperienceCenterStatus(request: Request, env: Env): Promise<Response> {
  try {
    // Get stored status
    let statusData = null;
    if (env.EXPERIENCE_CENTER_STATUS) {
      const status = await env.EXPERIENCE_CENTER_STATUS.get(EXPERIENCE_CENTER_STATUS_KEY);
      if (status) {
        statusData = JSON.parse(status);
      }
    }

    // Try to fetch current WOOOD API data
    let woodApiTotals = null;
    try {
      const experienceCenterData = await fetchExperienceCenterData(env);
      woodApiTotals = {
        total: experienceCenterData.total
      };
    } catch (error) {
      console.error('Failed to fetch WOOOD API data for status check:', error);
    }

    // Combine status data with WOOOD API totals
    const response = {
      ...statusData,
      woodApi: woodApiTotals ? {
        status: 'available',
        totals: woodApiTotals
      } : {
        status: 'unavailable'
      }
    };

    if (!statusData) {
      return new Response(JSON.stringify({
        success: false,
        message: 'No status available',
        woodApi: response.woodApi
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Experience center status check failed:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Status check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// NEW: Bulk operations test handler
async function handleExperienceCenterBulkTest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as any;
    const shop = body.shop || env.SHOPIFY_STORE_URL?.replace('https://', '').replace('http://', '');

    if (!shop) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No shop specified',
        timestamp: new Date().toISOString(),
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`🧪 Testing bulk operations for shop: ${shop}`);

    // Fetch experience center data
    const experienceCenterData = await fetchExperienceCenterData(env);
    const availableEans = new Set(experienceCenterData.data.map((item: any) => item.ean));

    console.log(`📊 Testing with ${availableEans.size} available EANs`);

    // Test bulk operations on single shop
    const result = await processExperienceCenterWithBulkOperations(env, shop, availableEans);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      shop,
      testType: 'bulk_operations',
      result,
      summary: {
        availableEans: availableEans.size,
        successfulProducts: result.successful,
        failedProducts: result.failed,
        eanMatches: result.eanMatches,
        totalProducts: result.totalProducts,
        errors: result.errors.slice(0, 5), // Limit error messages for test
      },
    };

    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('❌ Bulk operations test failed:', error);

    return new Response(JSON.stringify({
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      testType: 'bulk_operations',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Utility functions
function getAllowedOrigin(request: Request, allowedOrigins: string[]): string {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';

  for (const allowed of allowedOrigins) {
    if (allowed === '*' || origin === allowed) return origin;
    if (allowed.startsWith('https://*.') && origin.endsWith(allowed.replace('https://*.', ''))) return origin;
  }
  return '*';
}

function addCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
    headers: newHeaders
  });
}

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

async function registerWebhooks(shop: string, accessToken: string, env: Env): Promise<void> {
  const webhooks = [
    { topic: 'orders/paid', address: `${env.SHOPIFY_APP_URL}/api/webhooks/orders` },
    { topic: 'orders/create', address: `${env.SHOPIFY_APP_URL}/api/webhooks/orders` }
  ];

  console.log(`Starting webhook registration for shop: ${shop}`);
  console.log(`Webhook endpoint: ${env.SHOPIFY_APP_URL}/api/webhooks/orders`);

  for (const webhook of webhooks) {
    try {
      console.log(`Registering webhook: ${webhook.topic} -> ${webhook.address}`);

      const response = await fetch(`https://${shop}/admin/api/2024-10/webhooks.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ webhook })
      });

      if (response.ok) {
        const result = await response.json() as any;
        console.log(`✅ Successfully registered webhook: ${webhook.topic}`, {
          id: result.webhook?.id,
          topic: result.webhook?.topic,
          address: result.webhook?.address,
          created_at: result.webhook?.created_at
        });
        } else {
        const errorText = await response.text();
        console.error(`❌ Failed to register webhook: ${webhook.topic}`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          shop: shop,
          webhook: webhook
        });
      }
  } catch (error) {
      console.error(`❌ Exception registering webhook: ${webhook.topic}`, {
        error: (error as Error).message,
        shop: shop,
        webhook: webhook
    });
  }
}

  console.log(`Completed webhook registration for shop: ${shop}`);
}

function transformNoteAttributesToMetafields(noteAttributes: NoteAttribute[]): OrderMetafield[] {
  const metafields: OrderMetafield[] = [];

  for (const attr of noteAttributes) {
    switch (attr.name) {
      case 'delivery_date':
      case 'selected_delivery_date':
        metafields.push({
          namespace: 'custom',
          key: 'dutchned_delivery_date',
          value: attr.value,
          type: 'date'
        });
        break;
      case 'shipping_method':
        metafields.push({
          namespace: 'custom',
          key: 'ShippingMethod2',
          value: attr.value,
          type: 'single_line_text_field'
        });
        break;
    }
  }

  return metafields;
}

async function createOrderMetafields(orderId: number, metafields: OrderMetafield[], accessToken: string, shop: string): Promise<void> {
  console.log(`Creating ${metafields.length} metafields for order #${orderId}`);

  for (const metafield of metafields) {
    try {
      console.log(`Creating metafield: ${metafield.namespace}.${metafield.key} = ${metafield.value}`);

      const response = await fetch(`https://${shop}/admin/api/2024-10/orders/${orderId}/metafields.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metafield })
      });

        if (response.ok) {
        const result = await response.json() as any;
        console.log(`✅ Successfully created metafield: ${metafield.namespace}.${metafield.key}`, {
          id: result.metafield?.id,
          value: result.metafield?.value
        });
            } else {
        const errorText = await response.text();
        console.error(`❌ Failed to create metafield: ${metafield.namespace}.${metafield.key}`, {
            status: response.status,
          error: errorText,
          metafield: metafield
        });
      }
  } catch (error) {
      console.error(`❌ Exception creating metafield: ${metafield.namespace}.${metafield.key}`, {
        error: (error as Error).message,
        metafield: metafield
    });
  }
}

  console.log(`Completed metafield creation for order #${orderId}`);
}

async function validateWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
    encoder.encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return expected === signature;
}

function generateMockDates(): DeliveryDate[] {
  const dates: DeliveryDate[] = [];
  const today = new Date();

  for (let i = 1; i <= 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push({
      date: date.toISOString().split('T')[0]!,
      displayName: formatDateInDutch(date)
    });
  }

  return dates;
}

function formatDateInDutch(date: Date): string {
  try {
    return new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch {
    const weekdays = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }
}