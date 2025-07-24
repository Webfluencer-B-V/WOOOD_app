// TODO: Type env properly if needed

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

export async function upsertStoreLocator(env: any): Promise<any> {
  // Fetch external API credentials and Shopify tokens from env or KV as needed
  // (Assume env.EXTERNAL_API_URL, env.EXTERNAL_API_KEY, env.SHOPIFY_ADMIN_API_ACCESS_TOKEN, env.SHOPIFY_STORE_URL are available)
  const { EXTERNAL_API_URL, EXTERNAL_API_KEY, SHOPIFY_ADMIN_API_ACCESS_TOKEN, SHOPIFY_STORE_URL } = env;
  if (!EXTERNAL_API_URL || !EXTERNAL_API_KEY) throw new Error('Missing EXTERNAL_API_URL or EXTERNAL_API_KEY');
  if (!SHOPIFY_ADMIN_API_ACCESS_TOKEN || !SHOPIFY_STORE_URL) throw new Error('Missing Shopify credentials');

  // Fetch and transform dealer data
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${EXTERNAL_API_KEY}`,
  };
  const response = await fetch(EXTERNAL_API_URL, { headers });
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('External API did not return an array');
  const dealers = data
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

  // Upsert to Shopify shop metafield
  const shopQuery = `query { shop { id } }`;
  const shopResponse = await fetch(`${SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query: shopQuery }),
  });
  const shopResult = await shopResponse.json() as { data?: { shop?: { id?: string } } };
  const shopId = shopResult?.data?.shop?.id;
  if (!shopId) throw new Error('Could not fetch shop ID');
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
  const upsertResponse = await fetch(`${SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });
  const upsertResult = await upsertResponse.json();
  return {
    success: true,
    timestamp: new Date().toISOString(),
    count: dealers.length,
    upsertResult,
  };
} 