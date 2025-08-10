import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { D1Service } from '~/services/D1Service';

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

// Validate Shopify webhook signature
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

// Transform checkout note attributes to order metafields
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

// Create metafields using Shopify Admin API
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

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };
    const d1Service = new D1Service(env.DB, env.ENVIRONMENT || 'staging');

    const signature = request.headers.get('X-Shopify-Hmac-Sha256');
    const shop = request.headers.get('X-Shopify-Shop-Domain');

    if (!signature || !shop) {
      return json({ success: false, error: 'Missing required headers' }, { status: 401 });
    }

    const bodyText = await request.text();
    const isValid = await validateWebhookSignature(bodyText, signature, env.SHOPIFY_APP_CLIENT_SECRET);

    if (!isValid) {
      return json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }

    const orderData: ShopifyOrder = JSON.parse(bodyText);
    const metafields = transformNoteAttributesToMetafields(orderData.note_attributes || []);

    console.log(`Processing order webhook for order #${orderData.id}`, {
      shop: shop,
      noteAttributes: orderData.note_attributes,
      transformedMetafields: metafields
    });

    // Log webhook activity
    await d1Service.logActivity({
      action: 'webhook_order_received',
      level: 'info',
      message: `Order webhook processed for order #${orderData.id}`,
      metadata: { shop, orderId: orderData.id, metafieldsCount: metafields.length }
    });

    if (metafields.length === 0) {
      console.log(`No delivery metafields to create for order #${orderData.id}`);
      return json({ success: true, metafieldsCreated: 0 });
    }

    // Get shop token from D1 (migrated from KV)
    const accessToken = await d1Service.getShopToken(shop);

    if (!accessToken) {
      await d1Service.logActivity({
        action: 'webhook_auth_error',
        level: 'error',
        message: `Shop not authenticated for webhook: ${shop}`,
        metadata: { shop, orderId: orderData.id }
      });

      return json({ success: false, error: 'Shop not authenticated' }, { status: 401 });
    }

    // Create metafields
    await createOrderMetafields(orderData.id, metafields, accessToken, shop);

    await d1Service.logActivity({
      action: 'webhook_metafields_created',
      level: 'info',
      message: `Created ${metafields.length} metafields for order #${orderData.id}`,
      metadata: { shop, orderId: orderData.id, metafieldsCount: metafields.length }
    });

    return json({
      success: true,
      metafieldsCreated: metafields.length,
      orderId: orderData.id
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}
