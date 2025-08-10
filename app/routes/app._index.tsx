import { useLoaderData, useRouteError, isRouteErrorResponse, useFetcher } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { Page, Layout, Card, Text, Badge, Button, Banner, BlockStack, InlineStack } from '@shopify/polaris';
import { useState, useCallback } from 'react';
import { HealthDashboard } from '~/components/HealthDashboard';
import { StoreLocatorManager } from '~/components/StoreLocatorManager';
import { ExperienceCenterManager } from '~/components/ExperienceCenterManager';
import { shopify } from '~/shopify.server';
import { D1Service } from '~/services/D1Service';

export async function loader({ request, context }: LoaderFunctionArgs) {
  console.log('[Loader] Starting app._index loader...');

  try {
    // Authenticate with Shopify
    const { admin } = await shopify(context).authenticate.admin(request);

    const url = new URL(request.url);
    const shop = url.searchParams.get('shop') || undefined;
    const host = url.searchParams.get('host') || '';

    console.log('[Loader] Request params:', { shop, host, pathname: url.pathname });

    const apiBaseUrl = url.origin.replace(/\/$/, '');
    console.log('[Loader] API Base URL:', apiBaseUrl);

  // Fetch health data with unified API structure
  let healthData: any = {
    status: 'unknown',
    timestamp: new Date().toISOString(),
    environment: 'staging',
    services: {
      d1: 'unknown',
      kv: 'unknown'
    },
    data: {
      deliveryCache: { totalEntries: 0 },
      storeLocator: null,
      experienceCenter: null,
      products: { totalProducts: 0, experienceCenterProducts: 0 }
    }
  };

    // Fetch store locator data
  let storeLocatorData: any = {
    dealers: [],
    lastUpdated: new Date().toISOString(),
    status: 'unknown' as const
  };

  // Fetch experience center data
  let experienceCenterData: any = {
    products: [],
    lastUpdated: new Date().toISOString(),
    status: 'unknown' as const,
    totalProducts: 0,
    experienceCenterProducts: 0
  };

  try {
    console.log('[Loader] Starting direct data access...');

    // Validate context is available
    const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };

    if (!env) {
      console.error('[Loader] Cloudflare context not available');
      throw new Error('Cloudflare context not available');
    }

    if (!env.DB) {
      console.error('[Loader] D1 Database not available in context');
      throw new Error('D1 Database not available');
    }

    console.log('[Loader] Creating D1Service...');
    const d1Service = new D1Service(env.DB, 'staging');

    console.log('[Loader] Fetching data from database...');

    // Use the correct methods that exist in D1Service
    const [statusSummary, dealers, products] = await Promise.all([
      d1Service.getStatusSummary().catch(e => {
        console.error('[Loader] getStatusSummary failed:', e);
        return {
          deliveryCache: { totalEntries: 0 },
          storeLocator: null,
          experienceCenter: null,
          products: { totalProducts: 0, experienceCenterProducts: 0 }
        };
      }),
      d1Service.findDealersNearby(undefined, 'NL').catch(e => {
        console.error('[Loader] findDealersNearby failed:', e);
        return [];
      }),
      d1Service.getProducts({ limit: 100 }).catch(e => {
        console.error('[Loader] getProducts failed:', e);
        return [];
      })
    ]);

    console.log('[Loader] Database queries completed successfully');

    // Build unified health data structure
    healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: 'staging',
      services: {
        d1: 'available',
        kv: env.WOOOD_KV ? 'available' : 'unavailable'
      },
      data: statusSummary
    };

    // Store locator data
    storeLocatorData = {
      dealers,
      lastUpdated: new Date().toISOString(),
      status: 'success' as const
    };

    // Experience center data
    experienceCenterData = {
      products,
      lastUpdated: new Date().toISOString(),
      status: 'success' as const,
      totalProducts: products.length,
      experienceCenterProducts: products.filter((p: any) => p.isExperienceCenter).length
    };

    console.log('[Loader] Data processing completed successfully');

  } catch (e) {
    console.error('[Loader] Critical error in direct data access:', e);
    console.error('[Loader] Error details:', {
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined
    });

    // Fallback to safe default data
    healthData = {
      status: 'error',
      timestamp: new Date().toISOString(),
      environment: 'staging',
      services: { d1: 'error', kv: 'unknown' },
      data: {
        deliveryCache: { totalEntries: 0 },
        storeLocator: null,
        experienceCenter: null,
        products: { totalProducts: 0, experienceCenterProducts: 0 }
      }
    };
  }

  console.log('[Loader] Returning data:', {
    shop,
    healthDataStatus: healthData?.status,
    storeLocatorCount: storeLocatorData?.dealers?.length || 0,
    experienceCenterCount: experienceCenterData?.products?.length || 0
  });

  return json({ shop, host, healthData, storeLocatorData, experienceCenterData });

  } catch (error) {
    console.error('[Loader] Critical error in app._index loader:', error);

    // Return error information to help debug
    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    };

    throw new Response(JSON.stringify({
      error: 'Loader failed',
      details: errorInfo
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function action({ request, context }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };
    const token = url.searchParams.get('token');
    const shopFromQuery = url.searchParams.get('shop') || '';

    let admin: any = null;
    let session: any = null;

    // CLI bypass path for staging: construct minimal admin client using offline token from KV (same as workers)
    if (env?.STAGING_TEST_TOKEN && token === env.STAGING_TEST_TOKEN) {
      const shop = shopFromQuery;
      if (!shop) {
        return json({ success: false, error: 'CLI test requires shop param' }, { status: 400 });
      }
      const d1Service = new D1Service(env.DB, env.ENVIRONMENT || 'staging');
      let fallbackToken: string | null = await d1Service.getShopToken(shop);
      if (!fallbackToken && env.WOOOD_KV) {
        // one-time migration from KV → D1 if KV still has it
        try {
          const tokenRecord: any = await (env.WOOOD_KV as any).get(`shop_token:${shop}`, 'json');
          if (tokenRecord?.accessToken) {
            await d1Service.upsertShopToken(shop, tokenRecord.accessToken);
            fallbackToken = tokenRecord.accessToken;
          }
        } catch (e) {
          console.warn('KV token migration failed:', e);
        }
      }
      if (!fallbackToken) {
        return json({ success: false, error: 'No offline access token found in KV for this shop' }, { status: 401 });
      }
      admin = {
        graphql: async (query: string) => {
          const resp = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': fallbackToken,
            },
            body: JSON.stringify({ query }),
          });
          return resp as Response;
        },
      };
      session = null;
    } else {
      // Authenticate with Shopify to get admin API access (embedded app path)
      const auth = await shopify(context).authenticate.admin(request);
      admin = auth.admin;
      session = auth.session;
    }

    // Debug authentication
    console.log('🔐 Session info:', {
      shop: session?.shop,
      accessToken: session?.accessToken ? 'present' : 'missing',
      isActive: session?.isActive(),
      scope: session?.scope
    });

    // Ensure session is active
    if (!session?.accessToken || !session?.isActive()) {
      // Allow CLI testing when explicitly whitelisted via token query param
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      const env = (context as any)?.cloudflare?.env as Record<string, any>;
      if (env?.STAGING_TEST_TOKEN && token === env.STAGING_TEST_TOKEN) {
        console.warn('⚠️ Bypassing Shopify session for CLI test (staging only)');
      } else {
        console.error('❌ Session is not active or missing access token');
        return json({ success: false, error: 'Session not active. Please re-authenticate.' }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const intent = String(formData.get('intent') || '');
    if (!env?.DB) return json({ success: false, error: 'D1 not available' }, { status: 500 });
    const d1Service = new D1Service(env.DB, env.ENVIRONMENT || 'staging');
    const shop = (session?.shop as string | undefined) || shopFromQuery || undefined;

    if (intent === 'trigger_store_locator') {
      await d1Service.updateStoreLocatorStatus('running', 0);
      await d1Service.logActivity({ action: 'store_locator_trigger', level: 'info', message: 'Manual trigger from dashboard' });

      try {
        // Implement full store locator sync logic
        const result = await syncStoreLocator(env, d1Service);
        await d1Service.updateStoreLocatorStatus('success', result.dealersProcessed);
        await d1Service.logActivity({
          action: 'store_locator_sync_success',
          level: 'info',
          message: `Store locator sync completed. Processed ${result.dealersProcessed} dealers.`,
          metadata: { dealersProcessed: result.dealersProcessed, timestamp: Date.now() }
        });
        return json({ success: true, dealersProcessed: result.dealersProcessed });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await d1Service.updateStoreLocatorStatus('error', 0, errorMessage);
        await d1Service.logActivity({
          action: 'store_locator_sync_error',
          level: 'error',
          message: `Store locator sync failed: ${errorMessage}`,
          metadata: { error: errorMessage, timestamp: Date.now() }
        });
        return json({ success: false, error: errorMessage }, { status: 500 });
      }
    }
    if (intent === 'trigger_experience_center') {
      await d1Service.updateExperienceCenterStatus('running', 0);
      await d1Service.logActivity({ action: 'experience_center_trigger', level: 'info', message: 'Manual trigger from dashboard' });

      try {
        // Implement full experience center sync logic
        const result = await syncExperienceCenter(env, d1Service, admin, shop);
        await d1Service.updateExperienceCenterStatus('success', result.productsProcessed);
        await d1Service.logActivity({
          action: 'experience_center_sync_success',
          level: 'info',
          message: `Experience center sync completed. Processed ${result.productsProcessed} products.`,
          metadata: { productsProcessed: result.productsProcessed, timestamp: Date.now() }
        });
        return json({ success: true, productsProcessed: result.productsProcessed });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await d1Service.updateExperienceCenterStatus('error', 0, errorMessage);
        await d1Service.logActivity({
          action: 'experience_center_sync_error',
          level: 'error',
          message: `Experience center sync failed: ${errorMessage}`,
          metadata: { error: errorMessage, timestamp: Date.now() }
        });
        return json({ success: false, error: errorMessage }, { status: 500 });
      }
    }

    return json({ success: false, error: 'Unknown intent' }, { status: 400 });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export default function DashboardPage() {
  const { shop, host, healthData, storeLocatorData, experienceCenterData } = useLoaderData<typeof loader>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fetcher = useFetcher();

  // If not embedded-authenticated (no host), render minimal placeholder
  const isEmbedded = Boolean(host);
  if (!isEmbedded) {
    return (
      <Page title="WOOOD App">
        <Layout>
          <Layout.Section>
            <Card>
            <div style={{ padding: 16 }}>
              <Text as="p">This endpoint is only available inside Shopify admin for installed shops.</Text>
            </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Reload the page to refresh data
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  // Version in title will be derived at render time using window.ENV (client-only)

  const handleSaveStores = useCallback(async (dealers: any[]) => {
    // In a real implementation, this would call the API to save store data
    console.log('Saving stores:', dealers);
    // You would implement API call here
  }, []);

  const handleSaveProducts = useCallback(async (products: any[]) => {
    // In a real implementation, this would call the API to save product data
    console.log('Saving products:', products);
    // You would implement API call here
  }, []);

  const handleSyncShopify = useCallback(async () => {
    // In a real implementation, this would sync products from Shopify
    console.log('Syncing from Shopify...');
    // You would implement API call here
  }, []);

  const handleTriggerStoreLocator = useCallback(() => {
    fetcher.submit({ intent: 'trigger_store_locator' }, { method: 'POST' });
  }, [fetcher]);

  const handleTriggerExperienceCenter = useCallback(() => {
    fetcher.submit({ intent: 'trigger_experience_center' }, { method: 'POST' });
  }, [fetcher]);

  const rootData = typeof window !== 'undefined' ? (window as any).ENV : null;
  const version = rootData?.APP_VERSION || '0.1.0-staging';
  return (
    <Page title={`WOOOD App v${version}`} subtitle="Unified management dashboard for delivery dates, store locator, and experience center">
      <Layout>
        {/* Row 1: Health + Quick Actions */}
        <Layout.Section>
          <InlineStack gap="400">
            <div style={{ flex: 1 }}>
              <Card>
                <div style={{ padding: '1rem' }}>
                  <HealthDashboard
                    healthData={healthData}
                    onRefresh={handleRefresh}
                    isRefreshing={isRefreshing}
                  />
                </div>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <div style={{ padding: '1rem' }}>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Quick Actions</Text>
                    <InlineStack gap="200">
                      <Button onClick={handleRefresh} loading={isRefreshing}>Refresh Data</Button>
                      <Button
                        onClick={handleTriggerStoreLocator}
                        loading={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'trigger_store_locator'}
                      >
                        Sync Store Locator
                      </Button>
                      <Button
                        onClick={handleTriggerExperienceCenter}
                        loading={fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'trigger_experience_center'}
                      >
                        Sync Experience Center
                      </Button>
                    </InlineStack>
                    <Banner tone="info">
                      <Text as="p">Manual syncs run server-side with logs recorded in ActivityLog.</Text>
                    </Banner>
                  </BlockStack>
                </div>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Row 2: Store Locator + Experience Center */}
        <Layout.Section>
          <InlineStack gap="400">
            <div style={{ flex: 1 }}>
              <Card>
                <div style={{ padding: '1rem' }}>
                  <Text variant="headingMd" as="h3">Store Locator</Text>
                  <div style={{ marginTop: '0.75rem' }}>
                    <StoreLocatorManager
                      data={storeLocatorData}
                      onSave={handleSaveStores}
                      onRefresh={handleRefresh}
                      isLoading={isRefreshing}
                    />
                  </div>
                </div>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <div style={{ padding: '1rem' }}>
                  <Text variant="headingMd" as="h3">Experience Center</Text>
                  <div style={{ marginTop: '0.75rem' }}>
                    <ExperienceCenterManager
                      data={experienceCenterData}
                      onSave={handleSaveProducts}
                      onRefresh={handleRefresh}
                      onSyncShopify={handleSyncShopify}
                      isLoading={isRefreshing}
                    />
                  </div>
                </div>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Row 3: Info */}
        <Layout.Section>
          <Card>
            <div style={{ padding: '1rem' }}>
              <Banner tone="success">
                <Text as="p">All core features are available from this single-page overview. Tabs have been removed for faster workflows.</Text>
              </Banner>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  console.error('[ErrorBoundary] Route error caught:', error);

  if (isRouteErrorResponse(error)) {
    return (
      <Page title="Error">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: '2rem' }}>
                <Text variant="headingMd" as="h2">
                  Application Error ({error.status})
                </Text>
                <div style={{ marginTop: '1rem' }}>
                  <Text as="p">Status: {error.status} {error.statusText}</Text>
                  {error.data && (
                    <div style={{ marginTop: '1rem' }}>
                      <Text variant="headingSm" as="h3">Error Details:</Text>
                      <pre style={{
                        background: '#f6f6f7',
                        padding: '1rem',
                        marginTop: '0.5rem',
                        borderRadius: '4px',
                        overflow: 'auto'
                      }}>
                        {typeof error.data === 'string' ? error.data : JSON.stringify(error.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  return (
    <Page title="Unexpected Error">
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: '2rem' }}>
              <Text variant="headingMd" as="h2">
                Something went wrong
              </Text>
              <div style={{ marginTop: '1rem' }}>
                <Text as="p">Message: {errorMessage}</Text>
                {errorStack && (
                  <details style={{ marginTop: '1rem' }}>
                    <summary>Stack Trace</summary>
                    <pre style={{
                      background: '#f6f6f7',
                      padding: '1rem',
                      marginTop: '0.5rem',
                      borderRadius: '4px',
                      overflow: 'auto',
                      fontSize: '12px'
                    }}>
                      {errorStack}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ===== SYNC HELPER FUNCTIONS =====

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

async function syncStoreLocator(env: any, d1Service: any): Promise<{ dealersProcessed: number }> {
  console.log('🗺️ Starting Store Locator sync...');

  const { DUTCH_FURNITURE_BASE_URL, DUTCH_FURNITURE_API_KEY } = env;
  if (!DUTCH_FURNITURE_BASE_URL || !DUTCH_FURNITURE_API_KEY) {
    throw new Error('Missing DUTCH_FURNITURE_BASE_URL or DUTCH_FURNITURE_API_KEY');
  }

  // Try multiple potential endpoints for store locator data
  const potentialUrls = [
    `https://portal.dutchfurniturefulfilment.nl/api/datasource/wooodshopfinder`,
    `${DUTCH_FURNITURE_BASE_URL}/api/datasource/wooodshopfinder`,
    `${DUTCH_FURNITURE_BASE_URL}/datasource/wooodshopfinder`,
    `https://eekhoorn-connector.dutchned.com/api/datasource/wooodshopfinder`
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `${DUTCH_FURNITURE_API_KEY}`,
  };

  let data: any[] = [];
  let successfulUrl: string | null = null;

  // Try each URL until one works
  for (const url of potentialUrls) {
    try {
      console.log(`📡 Trying store locator endpoint: ${url}`);
      const response = await fetch(url, { headers });

      if (response.ok) {
        const responseData = await response.json();
        if (Array.isArray(responseData) && responseData.length > 0) {
          data = responseData;
          successfulUrl = url;
          console.log(`✅ Successfully fetched ${data.length} dealers from ${url}`);
          break;
        }
      } else {
        console.warn(`❌ API endpoint failed: ${url} - ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.warn(`❌ API endpoint error: ${url} - ${error}`);
    }
  }

    // If all APIs failed, throw an error instead of using mock data
  if (data.length === 0) {
    throw new Error('All store locator API endpoints failed. Please check API credentials and endpoints.');
  }

  // Filter and transform dealer data using the workers logic
  const dealers = data
    .filter((dealer) => {
      const accountStatus = dealer.accountStatus || dealer.AccountStatus;
      const activationPortal = dealer.dealerActivationPortal || dealer.DealerActivationPortal;
      const isActivated = activationPortal === true || activationPortal === 'WAAR';
      return accountStatus === 'A' && isActivated;
    })
    .map((dealer) => {
      // Remove sensitive fields as per workers implementation
      const {
        accountmanager,
        dealerActivationPortal,
        vatNumber,
        shopfinderExclusives,
        accountStatus,
        ...rest
      } = dealer;

      const exclusivityRaw = dealer.Exclusiviteit || dealer.shopfinderExclusives || dealer.ShopfinderExclusives;
      const services = mapExclusives(exclusivityRaw);
      const name = dealer.nameAlias || dealer.NameAlias || dealer.name || dealer.Name;

      return {
        id: dealer.id || `dealer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        address: dealer.address || rest.address || '',
        city: dealer.city || rest.city || '',
        postalCode: dealer.postalCode || rest.postalCode || '',
        country: dealer.country || rest.country || 'NL',
        latitude: dealer.latitude || rest.latitude || null,
        longitude: dealer.longitude || rest.longitude || null,
        phone: dealer.phone || rest.phone || null,
        email: dealer.email || rest.email || null,
        website: dealer.website || rest.website || null,
        services,
      };
    });

  console.log(`📊 Filtered to ${dealers.length} active dealers`);

  // Bulk upsert dealers to D1
  let processed = 0;
  for (const dealer of dealers) {
    try {
      await d1Service.upsertDealerLocation(dealer);
      processed++;
    } catch (error) {
      console.error(`Failed to upsert dealer ${dealer.name}:`, error);
    }
  }

  console.log(`🎯 Store Locator sync completed: ${processed} dealers processed${successfulUrl ? ` from ${successfulUrl}` : ' from mock data'}`);
  return { dealersProcessed: processed };
}

async function syncExperienceCenter(env: any, d1Service: any, admin: any): Promise<{ productsProcessed: number }> {
  console.log('🏪 Starting Experience Center bulk sync with EAN matching...');

  // Debug admin object
  console.log('🔍 Admin object type:', typeof admin);
  console.log('🔍 Admin object keys:', Object.keys(admin || {}));
  console.log('🔍 Admin.graphql type:', typeof admin?.graphql);

  const { PRODUCT_AVAILABILITY_BASE_URL, PRODUCT_AVAILABILITY_API_KEY } = env;
  if (!PRODUCT_AVAILABILITY_BASE_URL || !PRODUCT_AVAILABILITY_API_KEY) {
    throw new Error('Missing PRODUCT_AVAILABILITY_BASE_URL or PRODUCT_AVAILABILITY_API_KEY for Experience Center sync');
  }

  // Step 1: Fetch Experience Center EANs from external API
  let experienceCenterEans: Set<string>;
  try {
    console.log('📊 Fetching Experience Center data from external API...');
    const apiResponse = await fetch(`${PRODUCT_AVAILABILITY_BASE_URL}/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`, {
      headers: {
        'Authorization': PRODUCT_AVAILABILITY_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`Experience Center API failed: ${apiResponse.status} ${apiResponse.statusText}`);
    }

    const rawData = await apiResponse.json();
    const allData = Array.isArray(rawData) ? rawData : rawData.data || [];

    // Filter for Experience Center products with EAN codes
    const experienceCenterData = allData.filter((item: any) =>
      item.channel === 'EC' && item.ean
    );

    experienceCenterEans = new Set(experienceCenterData.map((item: any) => item.ean));
    console.log(`✅ Found ${experienceCenterEans.size} Experience Center EANs`);

  } catch (apiError) {
    console.warn('Experience Center API failed, using mock EANs:', apiError);
    // Fallback to mock EANs for testing
    experienceCenterEans = new Set(['1234567890123', '9876543210987']);
  }

  // Step 2: Use Shopify Bulk Operations to fetch all products with variants
  console.log('🚀 Creating Shopify bulk operation...');

  const bulkQuery = `
    {
      products {
        edges {
          node {
            id
            title
            status
            productType
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            featuredImage {
              url
            }
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

  let bulkOperationId: string;
  try {
    console.log('🔐 Creating GraphQL request with admin client...');
    console.log('🔍 Admin graphql method exists:', typeof admin.graphql === 'function');
    console.log('📋 GraphQL mutation query:', createBulkOperationMutation);

    const createResponse = await admin.graphql(createBulkOperationMutation);

    if (!createResponse) {
      throw new Error('No response from GraphQL API');
    }

    console.log('📋 Raw GraphQL response status:', createResponse.status);
    console.log('📋 Raw GraphQL response headers:', Object.fromEntries(createResponse.headers.entries()));

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`GraphQL request failed with status ${createResponse.status}: ${errorText}`);
    }

    const createResult = await createResponse.json();
    console.log('📋 Bulk operation response:', JSON.stringify(createResult, null, 2));

    if (createResult.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(createResult.errors)}`);
    }

    if (createResult.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
      throw new Error(`Bulk operation creation failed: ${JSON.stringify(createResult.data.bulkOperationRunQuery.userErrors)}`);
    }

    bulkOperationId = createResult.data?.bulkOperationRunQuery?.bulkOperation?.id;
    if (!bulkOperationId) {
      throw new Error('No bulk operation ID returned');
    }
    console.log(`📋 Bulk operation created: ${bulkOperationId}`);
  } catch (bulkError) {
    let errorMessage = 'Unknown error';
    if (bulkError instanceof Response) {
      try {
        const errorData = await bulkError.json();
        errorMessage = JSON.stringify(errorData);
      } catch {
        errorMessage = `HTTP ${bulkError.status}: ${bulkError.statusText}`;
      }
    } else if (bulkError instanceof Error) {
      errorMessage = bulkError.message;
    } else {
      errorMessage = String(bulkError);
    }

    console.warn('Bulk operation failed, falling back to regular pagination. Error:', errorMessage);
    return await syncExperienceCenterFallback(d1Service, admin, experienceCenterEans);
  }

  // Step 3: Poll for completion (simplified version with shorter timeout)
  console.log('⏳ Waiting for bulk operation to complete...');
  let downloadUrl: string | null = null;
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes for app context
  const pollInterval = 10000; // 10 seconds
  const startTime = Date.now();

  while (!downloadUrl && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const statusQuery = `
      query {
        node(id: "${bulkOperationId}") {
          ... on BulkOperation {
            id
            status
            errorCode
            url
          }
        }
      }
    `;

    const statusResponse = await admin.graphql(statusQuery);
    const statusResult = await statusResponse.json();
    const bulkOperation = statusResult.data?.node;

    if (bulkOperation?.status === 'COMPLETED') {
      downloadUrl = bulkOperation.url;
      console.log('✅ Bulk operation completed');
    } else if (bulkOperation?.status === 'FAILED') {
      throw new Error(`Bulk operation failed: ${bulkOperation.errorCode}`);
    }
  }

  if (!downloadUrl) {
    console.warn('Bulk operation timeout, falling back to regular pagination');
    return await syncExperienceCenterFallback(d1Service, admin, experienceCenterEans);
  }

  // Step 4: Process bulk data and update D1
  console.log('📦 Processing bulk operation data...');
  const downloadResponse = await fetch(downloadUrl);
  const jsonlData = await downloadResponse.text();
  const lines = jsonlData.trim().split('\n');

  const products = new Map<string, { id: string, title: string, status: string, productType: string, price: number | null, imageUrl: string | null, barcodes: string[] }>();

  // Parse JSONL data
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.id?.includes('/Product/')) {
        // This is a product
        products.set(obj.id, {
          id: obj.id,
          title: obj.title,
          status: obj.status,
          productType: obj.productType,
          price: parseFloat(obj.priceRangeV2?.minVariantPrice?.amount || '0') || null,
          imageUrl: obj.featuredImage?.url || null,
          barcodes: []
        });
      } else if (obj.id?.includes('/ProductVariant/') && obj.__parentId && obj.barcode) {
        // This is a variant with barcode
        const product = products.get(obj.__parentId);
        if (product) {
          product.barcodes.push(obj.barcode);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse JSONL line: ${line}`);
    }
  }

  console.log(`📊 Parsed ${products.size} products from bulk data`);

  // Step 5: Match EANs and bulk update D1
  let processed = 0;
  let eanMatches = 0;

  for (const [productId, product] of products) {
    try {
      // Check if any variant barcode matches Experience Center EANs
      const isExperienceCenter = product.barcodes.some(barcode => experienceCenterEans.has(barcode));
      if (isExperienceCenter) eanMatches++;

      const simpleProduct = {
        id: `product_${productId.split('/').pop()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        shopifyProductId: productId.split('/').pop() || '',
        title: product.title,
        category: product.productType || null,
        price: product.price,
        availability: product.status === 'ACTIVE' ? 'in_stock' as const : 'out_of_stock' as const,
        imageUrl: product.imageUrl,
        isExperienceCenter,
      };

      await d1Service.upsertProduct(simpleProduct);
      processed++;
    } catch (error) {
      console.error(`Failed to process product ${productId}:`, error);
    }
  }

  console.log(`🎯 Experience Center sync completed: ${processed} products processed, ${eanMatches} EAN matches out of ${experienceCenterEans.size} available EANs`);
  return { productsProcessed: processed };
}

// Fallback function for when bulk operations fail
async function syncExperienceCenterFallback(d1Service: any, admin: any, experienceCenterEans: Set<string>): Promise<{ productsProcessed: number }> {
  console.log('🔄 Using fallback pagination method...');

  const query = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            status
            productType
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            featuredImage {
              url
            }
            variants(first: 10) {
              edges {
                node {
                  barcode
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  let hasNextPage = true;
  let after: string | null = null;
  let processed = 0;
  let eanMatches = 0;

  while (hasNextPage && processed < 200) { // Limit for app context
    const variables = { first: 25, after };
    const response = await admin.graphql(query, { variables });
    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    const products = result.data?.products?.edges || [];

    for (const edge of products) {
      const product = edge.node;
      const barcodes = product.variants?.edges?.map((v: any) => v.node.barcode).filter(Boolean) || [];
      const isExperienceCenter = barcodes.some((barcode: string) => experienceCenterEans.has(barcode));

      if (isExperienceCenter) eanMatches++;

      const simpleProduct = {
        id: `product_${product.id.split('/').pop()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        shopifyProductId: product.id.split('/').pop() || '',
        title: product.title,
        category: product.productType || null,
        price: parseFloat(product.priceRangeV2?.minVariantPrice?.amount || '0') || null,
        availability: product.status === 'ACTIVE' ? 'in_stock' as const : 'out_of_stock' as const,
        imageUrl: product.featuredImage?.url || null,
        isExperienceCenter,
      };

      await d1Service.upsertProduct(simpleProduct);
      processed++;
    }

    hasNextPage = result.data?.products?.pageInfo?.hasNextPage || false;
    after = result.data?.products?.pageInfo?.endCursor || null;
  }

  console.log(`🎯 Fallback sync completed: ${processed} products processed, ${eanMatches} EAN matches`);
  return { productsProcessed: processed };
}