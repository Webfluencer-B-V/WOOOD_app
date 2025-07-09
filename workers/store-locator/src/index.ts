import { Router } from 'itty-router';

// Types for environment variables
interface Env {
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: string;
  SHOPIFY_STORE_URL: string;
  EXTERNAL_API_URL: string;
  EXTERNAL_API_KEY: string;
  STORE_LOCATOR_STATUS?: KVNamespace;
}

const router = Router();

// Utility: Map exclusives
const EXCLUSIVITY_MAP: Record<string, string> = {
  'woood essentials': 'WOOOD ESSENTIALS',
  'essentials': 'WOOOD ESSENTIALS',
  'woood premium': 'WOOOD PREMIUM',
  'woood exclusive': 'WOOOD PREMIUM',
  'woood outdoor': 'WOOOD OUTDOOR',
  'woood tablo': 'WOOOD TABLO',
  'vtwonen': 'VT WONEN',
  'vt wonen dealers only': 'VT WONEN',
};

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
async function fetchAndTransform(env: Env): Promise<any[]> {
  const { EXTERNAL_API_URL, EXTERNAL_API_KEY } = env;
  let data: any[] = [];
  if (!EXTERNAL_API_URL || !EXTERNAL_API_KEY) throw new Error('Missing EXTERNAL_API_URL or EXTERNAL_API_KEY');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${EXTERNAL_API_KEY}`,
  };
  const response = await fetch(EXTERNAL_API_URL, { headers });
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
async function upsertShopMetafield(env: Env, dealers: any[]): Promise<any> {
  // 1. Get shop ID
  const shopQuery = `query { shop { id } }`;
  const shopResponse = await fetch(`${env.SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
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
  const response = await fetch(`${env.SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });
  return response.json();
}

// Status KV key
const STATUS_KEY = 'last_upsert_status';

// POST /upsert endpoint
router.post('/upsert', async (request, env: Env) => {
  try {
    const dealers = await fetchAndTransform(env);
    const upsertResult = await upsertShopMetafield(env, dealers);
    const status = {
      success: true,
      timestamp: new Date().toISOString(),
      count: dealers.length,
      upsertResult,
    };
    if (env.STORE_LOCATOR_STATUS) {
      await env.STORE_LOCATOR_STATUS.put(STATUS_KEY, JSON.stringify(status));
    }
    return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    const status = {
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
    };
    if (env.STORE_LOCATOR_STATUS) {
      await env.STORE_LOCATOR_STATUS.put(STATUS_KEY, JSON.stringify(status));
    }
    return new Response(JSON.stringify(status), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

// GET /status endpoint
router.get('/status', async (request, env: Env) => {
  if (env.STORE_LOCATOR_STATUS) {
    const status = await env.STORE_LOCATOR_STATUS.get(STATUS_KEY);
    if (status) {
      return new Response(status, { headers: { 'Content-Type': 'application/json' } });
    }
  }
  return new Response(JSON.stringify({ success: false, message: 'No status available' }), { headers: { 'Content-Type': 'application/json' } });
});

// 404 handler
router.all('*', () => new Response('Not Found.', { status: 404 }));

// Main fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return router.handle(request, env, ctx);
  },
  // Cron handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    try {
      const dealers = await fetchAndTransform(env);
      const upsertResult = await upsertShopMetafield(env, dealers);
      const status = {
        success: true,
        timestamp: new Date().toISOString(),
        count: dealers.length,
        upsertResult,
        cron: true,
      };
      if (env.STORE_LOCATOR_STATUS) {
        await env.STORE_LOCATOR_STATUS.put(STATUS_KEY, JSON.stringify(status));
      }
    } catch (error: any) {
      const status = {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        cron: true,
      };
      if (env.STORE_LOCATOR_STATUS) {
        await env.STORE_LOCATOR_STATUS.put(STATUS_KEY, JSON.stringify(status));
      }
    }
  },
};