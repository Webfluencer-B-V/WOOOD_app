Goal: Implement automated collection sorting system based on product metafields, enabling intelligent product ordering across all collections.

Feature Overview:

    Product Metafield Sorting: Sort collections based on custom.PLP_Sortering metafield containing numeric values (1491, 1421, 1091, 1991)
    Flexible Configuration: Support for product properties, metafields, or first variant properties
    Collection Targeting: Option to sort specific collections or all manually-sorted collections
    Sorting Options: Natural sorting, reverse sorting, and configurable sort order
    Automated Execution: Hourly or daily scheduled sorting with manual trigger capability

Detailed Technical Implementation Plan:

Phase 1: Core Sorting Engine (2 SP)

1.1 GraphQL Query Builder for Product Data

# Query to fetch products with sorting metafields
query getProductsWithSorting($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        title
        handle
        metafields(namespace: "custom", keys: ["PLP_Sortering"]) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    }
  }
}

1.2 Collection Discovery Query

# Query to fetch collections with manual sorting enabled
query getCollectionsForSorting($first: Int!, $after: String) {
  collections(first: $first, after: $after, query: "sort_by:manual") {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        title
        handle
        sortOrder
        productsCount
        products(first: 250) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
  }
}

1.3 Product Data Extraction & Sorting Algorithm

interface ProductSortData {
  productId: string;
  sortValue: number | null;
  productTitle: string;
  handle: string;
}

interface CollectionSortConfig {
  productMetafield: string;           // "custom.PLP_Sortering"
  firstVariantProperty?: string;      // Optional variant property
  onlySortCollections?: string[];     // Specific collection IDs/titles/handles
  reverseSort: boolean;               // High-to-low vs low-to-high
  sortNaturally: boolean;             // Natural number sorting
  runFrequency: 'hourly' | 'daily';   // Execution frequency
  batchSize: number;                  // Products per batch (max 250)
}

function extractSortValue(product: any, config: CollectionSortConfig): number | null {
  // Extract from product metafield
  if (config.productMetafield) {
    const metafield = product.metafields?.edges?.find(
      (edge: any) => edge.node.key === config.productMetafield.split('.')[1]
    );
    if (metafield?.node?.value) {
      const value = parseInt(metafield.node.value);
      return isNaN(value) ? null : value;
    }
  }

  // Extract from first variant property
  if (config.firstVariantProperty && product.variants?.edges?.[0]) {
    const variant = product.variants.edges[0].node;
    const metafield = variant.metafields?.edges?.find(
      (edge: any) => edge.node.key === config.firstVariantProperty
    );
    if (metafield?.node?.value) {
      const value = parseInt(metafield.node.value);
      return isNaN(value) ? null : value;
    }
  }

  return null;
}

function sortProducts(products: ProductSortData[], config: CollectionSortConfig): ProductSortData[] {
  return products.sort((a, b) => {
    const aValue = a.sortValue ?? Number.MAX_SAFE_INTEGER;
    const bValue = b.sortValue ?? Number.MAX_SAFE_INTEGER;

    if (config.sortNaturally) {
      // Natural sorting (1, 2, 10, 11 vs 1, 10, 11, 2)
      const comparison = aValue.toString().localeCompare(bValue.toString(), undefined, { numeric: true });
      return config.reverseSort ? -comparison : comparison;
    } else {
      // Standard numeric sorting
      const comparison = aValue - bValue;
      return config.reverseSort ? -comparison : comparison;
    }
  });
}

Phase 2: Shopify API Integration (2 SP)

2.1 Collection Reordering Mutation

# Mutation to reorder products in a collection
mutation reorderCollectionProducts($id: ID!, $moves: [MoveInput!]!) {
  collectionReorderProducts(id: $id, moves: $moves) {
    job {
      id
    }
    userErrors {
      field
      message
    }
  }
}

# Input type for product moves
input MoveInput {
  id: ID!
  newPosition: Int!
}

2.2 Batch Processing Implementation

interface ProductMove {
  id: string;
  newPosition: number;
}

async function reorderCollectionProducts(
  env: Env,
  shop: string,
  collectionId: string,
  moves: ProductMove[]
): Promise<{success: boolean, errors: string[]}> {
  const accessToken = await getShopAccessToken(env, shop);
  if (!accessToken) {
    throw new Error(`No access token found for shop: ${shop}`);
  }

  // Shopify limit: maximum 250 products per reorder operation
  const batchSize = 250;
  const errors: string[] = [];

  for (let i = 0; i < moves.length; i += batchSize) {
    const batch = moves.slice(i, i + batchSize);

    const mutation = `
      mutation reorderCollectionProducts($id: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $id, moves: $moves) {
          job {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: collectionId,
      moves: batch.map(move => ({
        id: move.id,
        newPosition: move.newPosition
      }))
    };

    try {
      const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as any;
      const userErrors = result.data?.collectionReorderProducts?.userErrors || [];

      if (userErrors.length > 0) {
        errors.push(...userErrors.map((error: any) => `${error.field}: ${error.message}`));
      }

      // Small delay between batches to respect rate limits
      if (i + batchSize < moves.length) {
        await delay(1000);
      }
    } catch (error: any) {
      errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
    }
  }

  return {
    success: errors.length === 0,
    errors
  };
}

2.3 Position Calculation Algorithm

function calculateProductPositions(
  sortedProducts: ProductSortData[],
  existingProductIds: string[]
): ProductMove[] {
  const moves: ProductMove[] = [];
  const sortedProductIds = sortedProducts.map(p => p.productId);

  // Create a map of current positions
  const currentPositions = new Map<string, number>();
  existingProductIds.forEach((productId, index) => {
    currentPositions.set(productId, index);
  });

  // Calculate new positions for sorted products
  sortedProductIds.forEach((productId, newPosition) => {
    const currentPosition = currentPositions.get(productId);
    if (currentPosition !== undefined && currentPosition !== newPosition) {
      moves.push({
        id: productId,
        newPosition: newPosition
      });
    }
  });

  return moves;
}

Phase 3: Scheduling & Automation (1 SP)

3.1 Cron Integration

// Add to existing scheduled function
async function handleCollectionSorting(env: Env): Promise<any> {
  console.log('🔄 Starting collection sorting...');

  const config: CollectionSortConfig = {
    productMetafield: 'custom.PLP_Sortering',
    reverseSort: false,
    sortNaturally: true,
    runFrequency: 'daily',
    batchSize: 250,
    // Optional: onlySortCollections: ['featured', 'new-arrivals']
  };

  const result = await processCollectionSorting(env, config);

  // Store status in KV
  if (env.EXPERIENCE_CENTER_STATUS) {
    await env.EXPERIENCE_CENTER_STATUS.put('collection_sorting_status', JSON.stringify(result));
  }

  return result;
}

// Add to scheduled function
if (event.cron === '0 */6 * * *') { // Every 6 hours
  await handleCollectionSorting(env);
}

3.2 Manual Trigger Endpoints

// Manual collection sorting trigger
async function handleCollectionSortingTrigger(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as any;
    const config: CollectionSortConfig = {
      productMetafield: body.productMetafield || 'custom.PLP_Sortering',
      firstVariantProperty: body.firstVariantProperty,
      onlySortCollections: body.onlySortCollections,
      reverseSort: body.reverseSort || false,
      sortNaturally: body.sortNaturally || true,
      runFrequency: body.runFrequency || 'manual',
      batchSize: body.batchSize || 250,
    };

    const result = await processCollectionSorting(env, config);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Sort specific collection
async function handleCollectionSortingSpecific(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const collectionHandle = url.pathname.split('/').pop();

    if (!collectionHandle) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Collection handle required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json().catch(() => ({})) as any;
    const config: CollectionSortConfig = {
      productMetafield: body.productMetafield || 'custom.PLP_Sortering',
      onlySortCollections: [collectionHandle],
      reverseSort: body.reverseSort || false,
      sortNaturally: body.sortNaturally || true,
      batchSize: body.batchSize || 250,
    };

    const result = await processCollectionSorting(env, config);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

Phase 4: Configuration & Monitoring (1 SP)

4.1 Environment Configuration

// Add to Env interface
interface Env {
  // ... existing properties
  COLLECTION_SORTING_CONFIG?: string; // JSON string with default config
}

// Default configuration
const DEFAULT_COLLECTION_SORTING_CONFIG: CollectionSortConfig = {
  productMetafield: 'custom.PLP_Sortering',
  reverseSort: false,
  sortNaturally: true,
  runFrequency: 'daily',
  batchSize: 250,
};

4.2 Health Endpoints Enhancement

// Enhanced health check with collection sorting metrics
async function handleHealth(request: Request, env: Env): Promise<Response> {
  // ... existing health check logic

  // Add collection sorting status
  const collectionSortingStatus = await env.EXPERIENCE_CENTER_STATUS?.get('collection_sorting_status');
  const sortingMetrics = collectionSortingStatus ? JSON.parse(collectionSortingStatus) : null;

  const healthData = {
    // ... existing health data
    collectionSorting: {
      lastRun: sortingMetrics?.timestamp || null,
      status: sortingMetrics?.success ? 'healthy' : 'error',
      collectionsProcessed: sortingMetrics?.summary?.collectionsProcessed || 0,
      productsReordered: sortingMetrics?.summary?.productsReordered || 0,
    }
  };

  return new Response(JSON.stringify(healthData), {
    headers: { 'Content-Type': 'application/json' }
  });
}

4.3 Comprehensive Logging & Analytics

interface CollectionSortingResult {
  success: boolean;
  timestamp: string;
  config: CollectionSortConfig;
  summary: {
    collectionsProcessed: number;
    collectionsSuccessful: number;
    collectionsFailed: number;
    productsReordered: number;
    totalProducts: number;
    errors: string[];
  };
  details: Array<{
    collectionId: string;
    collectionTitle: string;
    success: boolean;
    productsReordered: number;
    totalProducts: number;
    errors: string[];
  }>;
}

async function processCollectionSorting(env: Env, config: CollectionSortConfig): Promise<CollectionSortingResult> {
  const startTime = Date.now();
  const result: CollectionSortingResult = {
    success: false,
    timestamp: new Date().toISOString(),
    config,
    summary: {
      collectionsProcessed: 0,
      collectionsSuccessful: 0,
      collectionsFailed: 0,
      productsReordered: 0,
      totalProducts: 0,
      errors: [],
    },
    details: [],
  };

  try {
    // Implementation details...
    console.log(`🔄 Starting collection sorting with config:`, config);

    // Fetch collections, process products, reorder collections
    // ... detailed implementation

    result.success = result.summary.collectionsSuccessful > 0;
    const duration = Date.now() - startTime;
    console.log(`✅ Collection sorting completed in ${duration}ms: ${result.summary.collectionsSuccessful}/${result.summary.collectionsProcessed} successful`);

  } catch (error: any) {
    console.error('❌ Collection sorting failed:', error);
    result.summary.errors.push(error.message);
  }

  return result;
}

API Endpoints to Add:

    POST /api/collection-sort/trigger - Manual collection sorting trigger
    POST /api/collection-sort/collections/{handle} - Sort specific collection
    GET /api/collection-sort/status - Current sorting status and statistics
    Enhanced GET /api/health - Includes collection sorting metrics

Configuration Options:

interface CollectionSortConfig {
  productMetafield: string;           // "custom.PLP_Sortering"
  firstVariantProperty?: string;      // Optional variant property
  onlySortCollections?: string[];     // Specific collection IDs/titles/handles
  reverseSort: boolean;               // High-to-low vs low-to-high
  sortNaturally: boolean;             // Natural number sorting
  runFrequency: 'hourly' | 'daily';   // Execution frequency
  batchSize: number;                  // Products per batch (max 250)
}

Expected Outcome: Automated collection sorting system that maintains optimal product order based on metafield values, improving customer experience and conversion rates.