import { IRequest } from 'itty-router';
import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { createErrorResponse, createSuccessResponse } from './health';
import { SimpleTokenService } from '../services/simpleTokenService';

export interface WebhookRegistrationRequest {
  shop: string;
  accessToken: string;
  webhookUrl?: string;
}

export interface ShopifyOrder {
  id: number;
  email: string;
  created_at: string;
  updated_at: string;
  name: string;
  note: string;
  order_number: number;
  financial_status: string;
  fulfillment_status: string;
  tags: string;
  gateway: string;
  test: boolean;
  total_price: string;
  note_attributes: Array<{
    name: string;
    value: string;
  }>;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  line_items: Array<{
    id: number;
    product_id: number;
    variant_id: number;
    title: string;
    quantity: number;
    price: string;
  }>;
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    address2: string;
    city: string;
    province: string;
    country: string;
    zip: string;
    phone: string;
  };
}

export interface OrderWebhookPayload {
  order: ShopifyOrder;
}

interface ParsedOrderData {
  deliveryDate?: string;
  shippingMethod?: string;
  timestamp?: string;
  source?: string;
}

// Enhanced webhook topics for order processing
export const ORDER_WEBHOOKS = [
  { topic: 'orders/create', endpoint: '/api/webhooks/orders/created' },
  { topic: 'orders/paid', endpoint: '/api/webhooks/orders/paid' },
  { topic: 'orders/updated', endpoint: '/api/webhooks/orders/updated' }
] as const;

/**
 * Webhook configuration stored in KV
 */
interface WebhookConfig {
  shop: string;
  webhookId: string;
  webhookUrl: string;
  accessToken: string;
  registeredAt: string;
  status: 'active' | 'inactive' | 'failed';
  topic: string;
  retryCount?: number;
  lastSuccess?: string;
  lastFailure?: string;
}

/**
 * Note attributes mapping for order processing
 */
interface NoteAttributeMapping {
  delivery_date: 'custom.dutchned_delivery_date';
  shipping_method: 'custom.ShippingMethod';
}

const NOTE_ATTRIBUTE_MAPPING: NoteAttributeMapping = {
  delivery_date: 'custom.dutchned_delivery_date',
  shipping_method: 'custom.ShippingMethod'
};

/**
 * Register enhanced webhook with Shopify for order processing
 */
export async function handleWebhookRegistration(request: Request, env: Env, logger: WorkersLogger): Promise<Response> {
  try {
    const data = await request.json() as WebhookRegistrationRequest;

    if (!data.shop || !data.accessToken) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: shop and accessToken'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const baseUrl = data.webhookUrl || `https://${new URL(request.url).host}`;
    const registrationResults = [];

    // Register all order webhooks
    for (const webhook of ORDER_WEBHOOKS) {
      try {
        const webhookUrl = `${baseUrl}${webhook.endpoint}`;

        logger.info('Registering webhook', {
          shop: data.shop,
          topic: webhook.topic,
          webhookUrl
        });

        const webhookResponse = await registerShopifyWebhook(
          data.shop,
          data.accessToken,
          webhook.topic,
          webhookUrl,
          env.SHOPIFY_WEBHOOK_SECRET || 'webhook-secret'
        );

        if (!webhookResponse.success) {
          throw new Error(webhookResponse.error || 'Failed to register webhook');
        }

        // Store webhook configuration in KV
        const webhookConfig: WebhookConfig = {
          shop: data.shop,
          webhookId: webhookResponse.webhookId || '',
          webhookUrl,
          accessToken: data.accessToken,
          registeredAt: new Date().toISOString(),
          status: 'active',
          topic: webhook.topic
        };

        await env.DELIVERY_CACHE.put(
          `webhook:${data.shop}:${webhook.topic}`,
          JSON.stringify(webhookConfig),
          { expirationTtl: 365 * 24 * 60 * 60 } // 1 year
        );

        registrationResults.push({
          topic: webhook.topic,
          webhookId: webhookResponse.webhookId,
          status: 'registered'
        });

        logger.info('Webhook registered successfully', {
          shop: data.shop,
          topic: webhook.topic,
          webhookId: webhookResponse.webhookId
        });

      } catch (error: any) {
        logger.error('Failed to register webhook', {
          shop: data.shop,
          topic: webhook.topic,
          error: error.message
        });

        registrationResults.push({
          topic: webhook.topic,
          status: 'failed',
          error: error.message
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook registration completed',
      shop: data.shop,
      results: registrationResults
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    logger.error('Webhook registration failed', {
      error: error.message,
      stack: error.stack
    });

    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Webhook registration failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle order created webhook
 */
export async function handleOrderCreated(request: Request, env: Env, logger: WorkersLogger): Promise<Response> {
  return handleOrderWebhook(request, env, logger, 'orders/create');
}

/**
 * Handle order paid webhook
 */
export async function handleOrderPaid(request: Request, env: Env, logger: WorkersLogger): Promise<Response> {
  return handleOrderWebhook(request, env, logger, 'orders/paid');
}

/**
 * Handle order updated webhook
 */
export async function handleOrderUpdated(request: Request, env: Env, logger: WorkersLogger): Promise<Response> {
  return handleOrderWebhook(request, env, logger, 'orders/updated');
}

/**
 * Common order webhook handler with enhanced processing
 */
async function handleOrderWebhook(request: Request, env: Env, logger: WorkersLogger, topic: string): Promise<Response> {
  try {
    // Verify webhook signature
    const signature = request.headers.get('X-Shopify-Hmac-Sha256');
    const shop = request.headers.get('X-Shopify-Shop-Domain');

    if (!signature || !shop) {
      logger.warn('Missing webhook headers', { signature: !!signature, shop: shop ?? undefined });
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required webhook headers'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get webhook configuration
    const webhookConfigData = await env.DELIVERY_CACHE.get(`webhook:${shop}:${topic}`);
    let accessToken: string | null = null;
    let webhookConfig: WebhookConfig | null = null;

    if (webhookConfigData) {
      webhookConfig = JSON.parse(webhookConfigData);
      accessToken = webhookConfig?.accessToken || null;
    }

    // Fallback to SimpleTokenService if webhook config doesn't have token
    if (!accessToken) {
      logger.info('Webhook config missing access token, using SimpleTokenService fallback', { shop, topic });
      const tokenService = new SimpleTokenService(env);
      accessToken = await tokenService.getToken(shop);
    }

    if (!accessToken) {
      logger.warn('No access token found for webhook processing', { shop, topic });
      return new Response(JSON.stringify({
        success: false,
        error: 'No access token found for shop'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify webhook signature
    const body = await request.text();
    const isValidSignature = await verifyWebhookSignature(
      body,
      signature,
      env.SHOPIFY_WEBHOOK_SECRET || 'webhook-secret'
    );

    if (!isValidSignature) {
      logger.warn('Invalid webhook signature', { shop, topic, signature });
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid webhook signature'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const order: ShopifyOrder = JSON.parse(body);

    logger.info('Processing order webhook', {
      shop,
      topic,
      orderId: order.id,
      orderNumber: order.order_number
    });

    // Extract and process note attributes
    const noteAttributes = extractNoteAttributes(order.note_attributes);

    if (!noteAttributes.delivery_date && !noteAttributes.shipping_method) {
      logger.info('No relevant note attributes found', {
        orderId: order.id,
        availableAttributes: order.note_attributes?.map(attr => attr.name) || []
      });
      return new Response(JSON.stringify({
        success: true,
        message: 'No relevant note attributes to process'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create order metafields from note attributes
    const metafieldResults = await createOrderMetafieldsFromAttributes(
      shop,
      accessToken,
      order.id,
      noteAttributes,
      env,
      logger
    );

    // Update webhook status if config exists
    if (webhookConfig) {
      webhookConfig.lastSuccess = new Date().toISOString();
      await env.DELIVERY_CACHE.put(
        `webhook:${shop}:${topic}`,
        JSON.stringify(webhookConfig),
        { expirationTtl: 365 * 24 * 60 * 60 }
      );
    }

    // Store processing status
    await env.DELIVERY_CACHE.put(
      `order_processing:${shop}:${order.id}`,
      JSON.stringify({
        orderId: order.id,
        shop,
        topic,
        processedAt: new Date().toISOString(),
        metafieldResults,
        noteAttributes
      }),
      { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
    );

    logger.info('Order webhook processed successfully', {
      shop,
      topic,
      orderId: order.id,
      metafieldsCreated: metafieldResults.length
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Order processed successfully',
      orderId: order.id,
      metafieldsCreated: metafieldResults.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    logger.error('Order webhook processing failed', {
      topic,
      error: error.message,
      stack: error.stack
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Order processing failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get webhook status and health information
 */
export async function handleWebhookStatus(request: Request, env: Env, logger: WorkersLogger): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    if (!shop) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Shop parameter is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const webhookStatuses = [];

    // Check status of all registered webhooks
    for (const webhook of ORDER_WEBHOOKS) {
      const webhookConfigData = await env.DELIVERY_CACHE.get(`webhook:${shop}:${webhook.topic}`);

      if (webhookConfigData) {
        const config: WebhookConfig = JSON.parse(webhookConfigData);
        webhookStatuses.push({
          topic: webhook.topic,
          status: config.status,
          webhookId: config.webhookId,
          registeredAt: config.registeredAt,
          lastSuccess: config.lastSuccess,
          lastFailure: config.lastFailure,
          retryCount: config.retryCount || 0
        });
      } else {
        webhookStatuses.push({
          topic: webhook.topic,
          status: 'not_registered'
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      shop,
      webhooks: webhookStatuses,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    logger.error('Failed to get webhook status', {
      error: error.message
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to get webhook status'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Register a webhook with Shopify Admin API
 */
async function registerShopifyWebhook(
  shop: string,
  accessToken: string,
  topic: string,
  address: string,
  secret?: string
): Promise<{ success: boolean; webhookId?: string; error?: string }> {
  try {
    const webhookData = {
      webhook: {
        topic,
        address,
        format: 'json'
      }
    };

    const response = await fetch(`https://${shop}/admin/api/2025-04/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookData)
    });

    const result = await response.json() as any;

    if (!response.ok) {
      return {
        success: false,
        error: result.errors ? JSON.stringify(result.errors) : `HTTP ${response.status}`
      };
    }

    return {
      success: true,
      webhookId: result.webhook?.id?.toString()
    };

  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify webhook signature using HMAC-SHA256
 */
async function verifyWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(body);
    const key = encoder.encode(secret);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data);
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    return signature === expectedSignature;
  } catch (error) {
    return false;
  }
}

/**
 * Extract relevant note attributes from order
 */
function extractNoteAttributes(noteAttributes: Array<{ name: string; value: string }>): {
  delivery_date?: string;
  shipping_method?: string;
} {
  const extracted: { delivery_date?: string; shipping_method?: string } = {};

  if (!noteAttributes || !Array.isArray(noteAttributes)) {
    return extracted;
  }

  for (const attr of noteAttributes) {
    if (attr.name === 'delivery_date' && attr.value) {
      extracted.delivery_date = attr.value;
    }
    if (attr.name === 'shipping_method' && attr.value) {
      extracted.shipping_method = attr.value;
    }
  }

  return extracted;
}

/**
 * Create order metafields from extracted note attributes
 */
async function createOrderMetafieldsFromAttributes(
  shop: string,
  accessToken: string,
  orderId: number,
  noteAttributes: { delivery_date?: string; shipping_method?: string },
  env: Env,
  logger: WorkersLogger
): Promise<Array<{ key: string; success: boolean; error?: string }>> {
  const results = [];

  // Create delivery date metafield
  if (noteAttributes.delivery_date) {
    const result = await createOrderMetafield(
      shop,
      accessToken,
      orderId,
      NOTE_ATTRIBUTE_MAPPING.delivery_date,
      noteAttributes.delivery_date,
      'single_line_text_field'
    );
    results.push({
      key: NOTE_ATTRIBUTE_MAPPING.delivery_date,
      success: result.success,
      ...(result.error && { error: result.error })
    });
  }

  // Create shipping method metafield
  if (noteAttributes.shipping_method) {
    const result = await createOrderMetafield(
      shop,
      accessToken,
      orderId,
      NOTE_ATTRIBUTE_MAPPING.shipping_method,
      noteAttributes.shipping_method,
      'single_line_text_field'
    );
    results.push({
      key: NOTE_ATTRIBUTE_MAPPING.shipping_method,
      success: result.success,
      ...(result.error && { error: result.error })
    });
  }

  return results;
}

/**
 * Create a single order metafield
 */
async function createOrderMetafield(
  shop: string,
  accessToken: string,
  orderId: number,
  key: string,
  value: string,
  type: string = 'single_line_text_field'
): Promise<{ success: boolean; error?: string }> {
  try {
    const [namespace, metafieldKey] = key.split('.');

    const metafieldData = {
      metafield: {
        namespace,
        key: metafieldKey,
        value,
        type
      }
    };

    const response = await fetch(`https://${shop}/admin/api/2025-04/orders/${orderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metafieldData)
    });

    if (!response.ok) {
      const errorData = await response.json() as any;
      return {
        success: false,
        error: errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${response.status}`
      };
    }

    return { success: true };

  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}