/**
 * Delivery Date Picker - Cloudflare Workers API
 * Simplified architecture with essential functionality only
 */

import { upsertStoreLocator } from './storeLocatorUpserter';

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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain',
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
    // ... existing cron logic ...
    try {
      await upsertStoreLocator(env);
    } catch (error) {
      console.error('Store locator upsert cron error:', error);
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
  const scopes = 'read_products,write_checkouts,write_delivery_customizations,write_orders';
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
      return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: env.ENVIRONMENT,
    services: {
      kv: env.WOOOD_KV ? 'available' : 'unavailable',
      dutchNedApi: 'unknown'
    }
  }), { headers: { 'Content-Type': 'application/json' } });
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