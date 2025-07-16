import { Env, WorkerConfig } from '../types/env';

/**
 * Handle fetching ERP delivery times for products
 * This endpoint fetches product metafields via Shopify Admin API since
 * checkout extensions have limited access to metafield data
 */
export async function handleProductErpDeliveryTimes(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are allowed',
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const requestData = await request.json() as {
      productIds?: string[];
      source?: string;
      timestamp?: string;
    };
    const { productIds, source } = requestData;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'productIds must be a non-empty array',
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (logger && config.features.enableRequestLogging) {
      logger.info('Fetching ERP delivery times for products', {
        requestId,
        productCount: productIds.length,
        productIds: productIds.slice(0, 5), // Log first 5 for debugging
        source
      });
    }

    // Fetch real metafields from Shopify Admin API
    const erpDeliveryTimes = await fetchProductErpMetafields(productIds, env, config, logger, requestId);

    const responseData = {
      success: true,
      data: erpDeliveryTimes,
      requestId,
      timestamp: new Date().toISOString(),
      ...(config.features.enableVerboseResponses && {
        metadata: {
          productCount: productIds.length,
          executionTime: Date.now() - startTime,
          source,
          apiMethod: config.shopifyApi.accessToken ? 'shopify_admin' : 'mock_fallback'
        }
      })
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(config.features.enablePerformanceMonitoring && {
          'X-Response-Time': `${Date.now() - startTime}ms`
        })
      }
    });

  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    if (logger) {
      logger.error('Failed to fetch product ERP delivery times', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        executionTime
      });
    }

    const errorResponse = {
      success: false,
      error: 'API_ERROR',
      message: config.features.enableDetailedErrors
        ? error.message
        : 'Failed to fetch product ERP delivery times',
      requestId,
      timestamp: new Date().toISOString(),
      ...(config.features.enableVerboseResponses && {
        metadata: {
          executionTime
        }
      })
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...(config.features.enablePerformanceMonitoring && {
          'X-Response-Time': `${Date.now() - startTime}ms`
        })
      }
    });
  }
}

/**
 * Fetch ERP delivery time metafields for products
 * First tries Shopify Admin API, falls back to mock data if API is not configured
 */
async function fetchProductErpMetafields(
  productIds: string[],
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Record<string, string | null>> {
  // Check if Shopify API is configured
  if (!config.shopifyApi.shopDomain || !config.shopifyApi.accessToken) {
    if (logger && config.features.enableDebugLogging) {
      logger.warn('Shopify API not configured, using mock data', {
        requestId,
        hasShopDomain: !!config.shopifyApi.shopDomain,
        hasAccessToken: !!config.shopifyApi.accessToken
      });
    }
  }

  try {
    // Try to fetch real data from Shopify Admin API
    const realData = await fetchProductMetafieldsFromShopify(productIds, env, config, logger, requestId);

    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully fetched real ERP delivery times from Shopify', {
        requestId,
        productCount: productIds.length,
        erpDataCount: Object.keys(realData).length
      });
    }

    return realData;
  } catch (error: any) {
    if (logger) {
      logger.error('Failed to fetch from Shopify API, falling back to mock data', {
        requestId,
        error: error.message,
        errorStack: error.stack
      });
    }

    throw error;
  }
}

/**
 * Fetch product metafields from Shopify Admin API using GraphQL
 */
async function fetchProductMetafieldsFromShopify(
  productIds: string[],
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Record<string, string | null>> {
  const graphqlUrl = `https://${config.shopifyApi.shopDomain}/admin/api/${config.shopifyApi.apiVersion}/graphql.json`;

  // Convert product IDs to Shopify GIDs
  const productGids = productIds.map(id => `gid://shopify/Product/${id}`);

  const query = `
    query GetProductMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          handle
          metafield(namespace: "erp", key: "levertijd") {
            value
          }
        }
      }
    }
  `;

  const variables = {
    ids: productGids
  };

  if (logger && config.features.enableDebugLogging) {
    logger.debug('Making Shopify GraphQL request', {
      requestId,
      url: graphqlUrl,
      productCount: productIds.length,
      query: query.replace(/\s+/g, ' ').trim()
    });
  }

  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopifyApi.accessToken,
      'User-Agent': 'WOOOD-DeliveryAPI/1.0'
    },
    body: JSON.stringify({
      query,
      variables
    }),
    // Add timeout
    signal: AbortSignal.timeout(config.shopifyApi.timeout)
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as {
    data?: {
      nodes: Array<{
        id: string;
        handle?: string;
        metafield?: {
          value: string;
        } | null;
      }>;
    };
    errors?: Array<{
      message: string;
      locations?: Array<{ line: number; column: number }>;
      path?: string[];
    }>;
  };

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors.map(err => err.message).join(', ');
    throw new Error(`Shopify GraphQL errors: ${errorMessages}`);
  }

  if (!result.data || !result.data.nodes) {
    throw new Error('Invalid response from Shopify API: missing data.nodes');
  }

  // Process the response and build the result map
  const erpDeliveryTimes: Record<string, string | null> = {};

  result.data.nodes.forEach(node => {
    if (node.id) {
      // Extract numeric product ID from GID
      const productId = node.id.replace('gid://shopify/Product/', '');
      const erpValue = node.metafield?.value || null;

      erpDeliveryTimes[productId] = erpValue;

      if (logger && config.features.enableDebugLogging) {
        logger.debug('Real ERP delivery time fetched', {
          requestId,
          productId,
          productHandle: node.handle,
          erpValue: erpValue || 'null',
          hasMetafield: !!node.metafield
        });
      }
    }
  });

  // Ensure all requested product IDs are in the response (with null if not found)
  productIds.forEach(productId => {
    if (!(productId in erpDeliveryTimes)) {
      erpDeliveryTimes[productId] = null;
    }
  });

  if (logger && config.features.enableRequestLogging) {
    logger.info('Processed Shopify API response', {
      requestId,
      requestedCount: productIds.length,
      responseCount: result.data.nodes.length,
      withMetafieldCount: Object.values(erpDeliveryTimes).filter(v => v !== null).length
    });
  }

  return erpDeliveryTimes;
}