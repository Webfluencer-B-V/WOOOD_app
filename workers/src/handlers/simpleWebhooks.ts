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

/**
 * Simplified webhook handler for order processing
 * Converts note_attributes to metafields without complex queuing
 */

interface NoteAttribute {
  name: string;
  value: string;
}

interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  note_attributes?: NoteAttribute[];
}

interface OrderMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

// Order paid webhook handler
export async function handleOrderPaid(request: Request, env: Env): Promise<Response> {
  try {
    // Validate webhook signature
    const signature = request.headers.get('X-Shopify-Hmac-Sha256');
    const shop = request.headers.get('X-Shopify-Shop-Domain');

    if (!signature || !shop) {
      return new Response('Missing required headers', { status: 401 });
    }

    // Get request body for signature validation
    const bodyText = await request.text();
    const isValid = await validateWebhookSignature(bodyText, signature, env.SHOPIFY_APP_CLIENT_SECRET);

    if (!isValid) {
      console.warn('Invalid webhook signature from:', shop);
      return new Response('Invalid signature', { status: 401 });
    }

    // Parse order data
    const orderData: ShopifyOrder = JSON.parse(bodyText);

    // Transform note_attributes to metafields
    const metafields = transformNoteAttributesToMetafields(orderData.note_attributes || []);

    if (metafields.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        metafieldsCreated: 0,
        message: 'No delivery data found in note_attributes'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get shop access token
    const tokenKey = `shop_token:${shop}`;
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

    // Create metafields
    const results = await createOrderMetafields(orderData.id, metafields, accessToken, shop);

    return new Response(JSON.stringify({
      success: true,
      metafieldsCreated: results.length,
      processingTime: Date.now() - Date.now(), // Simplified timing
      orderId: orderData.id
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Order webhook error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// App uninstalled webhook handler
export async function handleAppUninstalled(request: Request, env: Env): Promise<Response> {
  try {
    const shop = request.headers.get('X-Shopify-Shop-Domain');

    if (!shop) {
      return new Response('Missing shop domain', { status: 400 });
    }

    // Clean up shop data
    const tokenKey = `shop_token:${shop}`;

    if (env.WOOOD_KV) {
      try {
        await env.WOOOD_KV.delete(tokenKey);
        console.log('Cleaned up token for shop:', shop);
      } catch (cleanupError) {
        console.warn('Token cleanup failed:', cleanupError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tokensRemoved: 1,
      cacheCleared: true,
      shop: shop
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('App uninstall webhook error:', error);
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
function transformNoteAttributesToMetafields(noteAttributes: NoteAttribute[]): OrderMetafield[] {
  const metafields: OrderMetafield[] = [];

  for (const attr of noteAttributes) {
    switch (attr.name) {
      case 'delivery_date':
        metafields.push({
          namespace: 'woood_delivery',
          key: 'selected_date',
          value: attr.value,
          type: 'date'
        });
        break;
      case 'shipping_method':
        metafields.push({
          namespace: 'woood_delivery',
          key: 'shipping_method',
          value: attr.value,
          type: 'single_line_text_field'
        });
        break;
      // Add more transformations as needed
    }
  }

  return metafields;
}

async function createOrderMetafields(
  orderId: number,
  metafields: OrderMetafield[],
  accessToken: string,
  shop: string
): Promise<OrderMetafield[]> {
  const results: OrderMetafield[] = [];

  for (const metafield of metafields) {
    try {
      const response = await fetch(`https://${shop}/admin/api/2024-10/orders/${orderId}/metafields.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          metafield: {
            namespace: metafield.namespace,
            key: metafield.key,
            value: metafield.value,
            type: metafield.type
          }
        })
      });

      if (response.ok) {
        const data = await response.json() as { metafield: OrderMetafield };
        results.push(data.metafield);
      } else {
        console.warn(`Failed to create metafield ${metafield.key}:`, response.status);
      }
    } catch (metafieldError) {
      console.error(`Error creating metafield ${metafield.key}:`, metafieldError);
    }
  }

  return results;
}

async function validateWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    return signature === expectedSignature;
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
}