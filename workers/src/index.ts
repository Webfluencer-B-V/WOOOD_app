/**
 * WOOOD Delivery Date Picker - Simplified Workers API
 * Extension-only architecture with basic security and functionality
 */

// Minimal environment interface - extension-only essentials
interface Env {
  // Core configuration
  ENVIRONMENT: string;
  DUTCHNED_API_URL: string;
  DUTCHNED_API_CREDENTIALS: string;

  // Shopify OAuth
  SHOPIFY_APP_CLIENT_ID: string;
  SHOPIFY_APP_CLIENT_SECRET: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_API_VERSION: string;

  // Feature flags
  ENABLE_MOCK_FALLBACK: string;

  // CORS
  CORS_ORIGINS: string;

  // Cloudflare bindings
  WOOOD_KV: any;
}

import { handleDeliveryDates, handleProductData } from './handlers/extension';
import { handleOrderPaid, handleAppUninstalled } from './handlers/simpleWebhooks';
import { handleOAuthStart, handleOAuthCallback, handleAppInstallation } from './handlers/simpleAuth';
import { handleHealth } from './handlers/health';

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
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {
      let response: Response;

      // Route handling
      switch (true) {
        // === APP INSTALLATION & OAUTH ===
        case path === '/' || path === '/install':
          response = await handleAppInstallation(request, env);
          break;

        case path === '/auth/start':
          response = await handleOAuthStart(request, env);
          break;

        case path === '/auth/callback':
          response = await handleOAuthCallback(request, env);
          break;

        // === EXTENSION API ENDPOINTS ===
        case path === '/api/delivery-dates/available' && (request.method === 'GET' || request.method === 'POST'):
          response = await handleDeliveryDates(request, env);
          break;

        case path === '/api/products/data' && request.method === 'POST':
          response = await handleProductData(request, env);
          break;

        // === LEGACY API ENDPOINTS (for extension compatibility) ===
        case path === '/api/products/erp-delivery-times' && request.method === 'POST':
          response = await handleProductData(request, env); // Use consolidated handler
          break;

        case path === '/api/products/shipping-methods' && request.method === 'POST':
          response = await handleProductData(request, env); // Use consolidated handler
          break;

        // === WEBHOOK ENDPOINTS ===
        case path === '/api/webhooks/orders/paid' && request.method === 'POST':
          response = await handleOrderPaid(request, env);
          break;

        case path === '/api/webhooks/orders/created' && request.method === 'POST':
          response = await handleOrderPaid(request, env);
          break;

        case path === '/api/webhooks/app/uninstalled' && request.method === 'POST':
          response = await handleAppUninstalled(request, env);
          break;

        // === SYSTEM ENDPOINTS ===
        case path === '/health':
          response = await handleHealth(request, env);
          break;

        // === 404 NOT FOUND ===
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

      // Add CORS headers to response
          return addCorsHeaders(response, corsHeaders);

        } catch (error) {
      console.error('Request processing error:', error);

      const errorResponse = new Response(JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });

      return addCorsHeaders(errorResponse, corsHeaders);
    }
  }
};

// Helper functions
function getAllowedOrigin(request: Request, allowedOrigins: string[]): string {
  const origin = request.headers.get('Origin');

  if (!origin) {
    return '*'; // No origin header (like direct API calls)
  }

  // Check if origin is in allowed list
  for (const allowed of allowedOrigins) {
    if (allowed === '*') {
      return '*';
    }

    // Support wildcard subdomains
    if (allowed.startsWith('https://*.')) {
      const domain = allowed.replace('https://*.', '');
      if (origin.endsWith(`.${domain}`) || origin === `https://${domain}`) {
        return origin;
      }
    } else if (origin === allowed) {
      return origin;
    }
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