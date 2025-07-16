import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';

/**
 * Order metafield interface
 */
export interface OrderMetafield {
  id?: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Metafield result interface
 */
export interface MetafieldResult {
  success: boolean;
  metafield?: OrderMetafield;
  error?: string;
  operation: 'create' | 'update' | 'skip';
  retryable: boolean;
}

/**
 * Metafield update interface
 */
export interface MetafieldUpdate {
  id?: string;
  namespace: string;
  key: string;
  value: string;
  type?: string;
}

/**
 * Bulk operation result interface
 */
export interface BulkMetafieldResult {
  success: boolean;
  results: MetafieldResult[];
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  processingTimeMs: number;
}

/**
 * Session interface for Shopify API calls
 */
export interface Session {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}

/**
 * GraphQL response interface
 */
interface GraphQLResponse {
  data?: any;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
  extensions?: any;
}

/**
 * Comprehensive metafield service for order processing
 */
export class MetafieldService {
  private env: Env;
  private logger: WorkersLogger;
  private maxRetries: number = 3;
  private retryDelayMs: number = 1000;

  constructor(env: Env, logger: WorkersLogger) {
    this.env = env;
    this.logger = logger;
    this.maxRetries = parseInt(env.MAX_RETRIES || '3', 10);
  }

  /**
   * Create order metafields with automatic conflict resolution
   */
  public async createOrderMetafields(
    orderId: string,
    metafields: OrderMetafield[],
    session: Session
  ): Promise<MetafieldResult[]> {
    this.logger.info('Creating order metafields', {
      orderId,
      shop: session.shop,
      metafieldCount: metafields.length
    });

    const results: MetafieldResult[] = [];

    for (const metafield of metafields) {
      try {
        // Check if metafield already exists
        const existingMetafield = await this.getOrderMetafieldByKey(
          orderId,
          metafield.namespace,
          metafield.key,
          session
        );

        let result: MetafieldResult;

        if (existingMetafield) {
          // Resolve conflict by updating existing metafield
          this.logger.info('Metafield already exists, updating', {
            orderId,
            namespace: metafield.namespace,
            key: metafield.key,
            existingId: existingMetafield.id
          });

          result = await this.updateOrderMetafield(
            orderId,
            {
              id: existingMetafield.id,
              namespace: metafield.namespace,
              key: metafield.key,
              value: metafield.value,
              type: metafield.type
            },
            session
          );
        } else {
          // Create new metafield
          result = await this.createSingleOrderMetafield(orderId, metafield, session);
        }

        results.push(result);

      } catch (error: any) {
        this.logger.error('Error processing metafield', {
          orderId,
          metafield: { namespace: metafield.namespace, key: metafield.key },
          error: error.message
        });

        results.push({
          success: false,
          error: error.message,
          operation: 'create',
          retryable: this.isRetryableError(error)
        });
      }
    }

    return results;
  }

  /**
   * Update order metafields
   */
  public async updateOrderMetafields(
    orderId: string,
    updates: MetafieldUpdate[],
    session: Session
  ): Promise<MetafieldResult[]> {
    this.logger.info('Updating order metafields', {
      orderId,
      shop: session.shop,
      updateCount: updates.length
    });

    const results: MetafieldResult[] = [];

    for (const update of updates) {
      try {
        const result = await this.updateOrderMetafield(orderId, update, session);
        results.push(result);
      } catch (error: any) {
        this.logger.error('Error updating metafield', {
          orderId,
          update: { namespace: update.namespace, key: update.key },
          error: error.message
        });

        results.push({
          success: false,
          error: error.message,
          operation: 'update',
          retryable: this.isRetryableError(error)
        });
      }
    }

    return results;
  }

  /**
   * Get all order metafields
   */
  public async getOrderMetafields(orderId: string, session: Session): Promise<OrderMetafield[]> {
    try {
      this.logger.info('Fetching order metafields', {
        orderId,
        shop: session.shop
      });

      const response = await this.makeShopifyRequest(
        `https://${session.shop}/admin/api/${session.apiVersion || '2025-04'}/orders/${orderId}/metafields.json`,
        {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.metafields || [];

    } catch (error: any) {
      this.logger.error('Error fetching order metafields', {
        orderId,
        shop: session.shop,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Bulk metafield operations for efficiency
   */
  public async bulkCreateOrUpdateMetafields(
    orderId: string,
    metafields: OrderMetafield[],
    session: Session,
    batchSize: number = 10
  ): Promise<BulkMetafieldResult> {
    const startTime = Date.now();
    
    this.logger.info('Starting bulk metafield operations', {
      orderId,
      shop: session.shop,
      totalMetafields: metafields.length,
      batchSize
    });

    const allResults: MetafieldResult[] = [];
    
    // Process in batches to avoid rate limits
    for (let i = 0; i < metafields.length; i += batchSize) {
      const batch = metafields.slice(i, i + batchSize);
      
      this.logger.info('Processing metafield batch', {
        orderId,
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length
      });

      // Use GraphQL for bulk operations when possible
      if (batch.length >= 5) {
        const graphqlResults = await this.bulkCreateMetafieldsGraphQL(orderId, batch, session);
        allResults.push(...graphqlResults);
      } else {
        // Use REST API for smaller batches
        const restResults = await this.createOrderMetafields(orderId, batch, session);
        allResults.push(...restResults);
      }

      // Add delay between batches to respect rate limits
      if (i + batchSize < metafields.length) {
        await this.delay(500); // 500ms delay between batches
      }
    }

    const successfulOperations = allResults.filter(r => r.success).length;
    const failedOperations = allResults.length - successfulOperations;
    const processingTimeMs = Date.now() - startTime;

    this.logger.info('Bulk metafield operations completed', {
      orderId,
      shop: session.shop,
      totalOperations: allResults.length,
      successfulOperations,
      failedOperations,
      processingTimeMs
    });

    return {
      success: failedOperations === 0,
      results: allResults,
      totalOperations: allResults.length,
      successfulOperations,
      failedOperations,
      processingTimeMs
    };
  }

  /**
   * Create a single order metafield with retry logic
   */
  private async createSingleOrderMetafield(
    orderId: string,
    metafield: OrderMetafield,
    session: Session
  ): Promise<MetafieldResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug('Creating order metafield', {
          orderId,
          namespace: metafield.namespace,
          key: metafield.key,
          attempt
        });

        const metafieldData = {
          metafield: {
            namespace: metafield.namespace,
            key: metafield.key,
            value: metafield.value,
            type: metafield.type
          }
        };

        const response = await this.makeShopifyRequest(
          `https://${session.shop}/admin/api/${session.apiVersion || '2025-04'}/orders/${orderId}/metafields.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': session.accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(metafieldData)
          }
        );

        if (!response.ok) {
          const errorData = await response.json() as any;
          throw new Error(
            errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${response.status}`
          );
        }

        const data = await response.json() as any;
        
        return {
          success: true,
          metafield: data.metafield,
          operation: 'create',
          retryable: false
        };

      } catch (error: any) {
        lastError = error;
        
        if (!this.isRetryableError(error) || attempt === this.maxRetries) {
          break;
        }

        this.logger.warn('Retrying metafield creation', {
          orderId,
          namespace: metafield.namespace,
          key: metafield.key,
          attempt,
          error: error.message
        });

        await this.delay(this.retryDelayMs * attempt);
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      operation: 'create',
      retryable: this.isRetryableError(lastError)
    };
  }

  /**
   * Update a single order metafield
   */
  private async updateOrderMetafield(
    orderId: string,
    update: MetafieldUpdate,
    session: Session
  ): Promise<MetafieldResult> {
    try {
      let metafieldId = update.id;

      // If no ID provided, find the metafield by namespace and key
      if (!metafieldId) {
        const existingMetafield = await this.getOrderMetafieldByKey(
          orderId,
          update.namespace,
          update.key,
          session
        );

        if (!existingMetafield) {
          // Create new metafield if it doesn't exist
          return await this.createSingleOrderMetafield(
            orderId,
            {
              namespace: update.namespace,
              key: update.key,
              value: update.value,
              type: update.type || 'single_line_text_field'
            },
            session
          );
        }

        metafieldId = existingMetafield.id;
      }

      const updateData = {
        metafield: {
          id: metafieldId,
          value: update.value,
          ...(update.type && { type: update.type })
        }
      };

      const response = await this.makeShopifyRequest(
        `https://${session.shop}/admin/api/${session.apiVersion || '2025-04'}/orders/${orderId}/metafields/${metafieldId}.json`,
        {
          method: 'PUT',
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updateData)
        }
      );

      if (!response.ok) {
        const errorData = await response.json() as any;
        throw new Error(
          errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${response.status}`
        );
      }

      const data = await response.json() as any;

      return {
        success: true,
        metafield: data.metafield,
        operation: 'update',
        retryable: false
      };

    } catch (error: any) {
      this.logger.error('Error updating metafield', {
        orderId,
        update,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        operation: 'update',
        retryable: this.isRetryableError(error)
      };
    }
  }

  /**
   * Get order metafield by namespace and key
   */
  private async getOrderMetafieldByKey(
    orderId: string,
    namespace: string,
    key: string,
    session: Session
  ): Promise<OrderMetafield | null> {
    try {
      const response = await this.makeShopifyRequest(
        `https://${session.shop}/admin/api/${session.apiVersion || '2025-04'}/orders/${orderId}/metafields.json?namespace=${namespace}&key=${key}`,
        {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as any;
      return data.metafields && data.metafields.length > 0 ? data.metafields[0] : null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Bulk create metafields using GraphQL for better performance
   */
  private async bulkCreateMetafieldsGraphQL(
    orderId: string,
    metafields: OrderMetafield[],
    session: Session
  ): Promise<MetafieldResult[]> {
    try {
      const metafieldInputs = metafields.map(mf => ({
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type
      }));

      const query = `
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
              type
              createdAt
              updatedAt
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const variables = {
        metafields: metafieldInputs.map(input => ({
          ...input,
          ownerId: `gid://shopify/Order/${orderId}`
        }))
      };

      const response = await this.makeGraphQLRequest(query, variables, session);

      if (response.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.errors)}`);
      }

      const result = response.data?.metafieldsSet;
      if (!result) {
        throw new Error('No metafieldsSet result in GraphQL response');
      }

      // Map results back to MetafieldResult format
      const results: MetafieldResult[] = [];
      
      if (result.userErrors && result.userErrors.length > 0) {
        // Handle user errors
        for (let i = 0; i < metafields.length; i++) {
          const error = result.userErrors.find((err: any) => err.field?.includes(`metafields[${i}]`));
          
          if (error) {
            results.push({
              success: false,
              error: error.message,
              operation: 'create',
              retryable: false
            });
          } else {
            const createdMetafield = result.metafields?.[i];
            results.push({
              success: !!createdMetafield,
              metafield: createdMetafield,
              operation: 'create',
              retryable: false
            });
          }
        }
      } else {
        // All successful
        for (let i = 0; i < metafields.length; i++) {
          const createdMetafield = result.metafields?.[i];
          results.push({
            success: !!createdMetafield,
            metafield: createdMetafield,
            operation: 'create',
            retryable: false
          });
        }
      }

      return results;

    } catch (error: any) {
      this.logger.error('GraphQL bulk create failed', {
        orderId,
        error: error.message
      });

      // Return individual failures
      return metafields.map(() => ({
        success: false,
        error: error.message,
        operation: 'create' as const,
        retryable: this.isRetryableError(error)
      }));
    }
  }

  /**
   * Make GraphQL request to Shopify Admin API
   */
  private async makeGraphQLRequest(
    query: string,
    variables: Record<string, any>,
    session: Session
  ): Promise<GraphQLResponse> {
    const response = await this.makeShopifyRequest(
      `https://${session.shop}/admin/api/${session.apiVersion || '2025-04'}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
      }
    );

    if (!response.ok) {
      throw new Error(`GraphQL request failed: HTTP ${response.status}`);
    }

    return await response.json() as GraphQLResponse;
  }

  /**
   * Make HTTP request with retry logic and rate limiting
   */
  private async makeShopifyRequest(url: string, options: RequestInit): Promise<Response> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Check for rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
          this.logger.warn('Rate limited, retrying after delay', {
            attempt,
            retryAfter,
            url: url.split('/').slice(0, 5).join('/')
          });
          
          await this.delay(retryAfter * 1000);
          continue;
        }

        return response;

      } catch (error: any) {
        if (attempt === this.maxRetries || !this.isRetryableError(error)) {
          throw error;
        }

        this.logger.warn('Request failed, retrying', {
          attempt,
          error: error.message,
          url: url.split('/').slice(0, 5).join('/')
        });

        await this.delay(this.retryDelayMs * attempt);
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    const message = error.message?.toLowerCase() || '';
    
    // Network and temporary errors are retryable
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500') ||
      message.includes('connection')
    );
  }

  /**
   * Utility function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 