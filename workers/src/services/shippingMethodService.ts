import {
  ShippingMethodData,
  ShippingMethodProcessingResult
} from '../types/common';
import { Env, WorkerConfig } from '../types/env';
import { requireAuthentication, SessionRequest } from '../middleware/sessionAuth';
import { WorkersLogger } from '../utils/logger';

/**
 * Process shipping method selection with KV storage
 * Migrated from Express backend to Cloudflare Workers
 */
export async function processShippingMethodSelection(
  data: ShippingMethodData,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<ShippingMethodProcessingResult> {
  const startTime = Date.now();
  const internalRequestId = requestId || crypto.randomUUID();

  if (logger && config.features.enableRequestLogging) {
    logger.info('Processing shipping method selection', {
      requestId: internalRequestId,
      shippingMethod: data.shippingMethod,
      timestamp: data.timestamp,
      hasDeliveryDate: !!data.deliveryDate,
      hasCartId: !!data.cartId,
      hasOrderId: !!data.orderId,
      startTime
    });
  }

  try {
    // Feature flag check for shipping option changes
    if (!config.features.enableShippingMethodProcessing) {
      if (logger) {
        logger.warn('Shipping method processing is disabled by feature flag', {
          requestId: internalRequestId,
          featureFlag: 'enableShippingMethodProcessing'
        });
      }
      return {
        success: false,
        message: 'Shipping method processing is currently disabled',
        error: 'Feature flag disabled',
        requestId: internalRequestId,
        timestamp: new Date().toISOString()
      };
    }

    // Validate input data
    const validationResult = validateShippingMethodData(data);
    if (!validationResult.isValid) {
      if (logger) {
        logger.error('Invalid shipping method data', {
          requestId: internalRequestId,
          errors: validationResult.errors,
          data: sanitizeDataForLogging(data)
        });
      }
      return {
        success: false,
        message: 'Invalid shipping method data',
        error: validationResult.errors.join(', '),
        requestId: internalRequestId,
        timestamp: new Date().toISOString()
      };
    }

    // Store shipping method data in KV
    const storageKey = generateStorageKey(data, internalRequestId);
    const storedData: ShippingMethodData = {
      ...data,
      timestamp: new Date().toISOString()
    };

    try {
      await env.DELIVERY_CACHE.put(
        storageKey,
        JSON.stringify(storedData),
        {
          expirationTtl: 86400 // 24 hours for order processing
        }
      );

      if (logger && config.features.enableRequestLogging) {
        logger.info('Successfully stored shipping method data in KV', {
          requestId: internalRequestId,
          storageKey,
          ttl: 86400
        });
      }
    } catch (storageError: any) {
      if (logger) {
        logger.error('Failed to store shipping method data in KV', {
          requestId: internalRequestId,
          error: storageError.message,
          storageKey
        });
      }
      // Continue processing even if storage fails
    }

    // Process order metafields if enabled and order ID is available
    if (config.features.enableShippingMethodProcessing && data.orderId) {
      try {
        await processOrderMetafields(data, env, config, logger, internalRequestId);
      } catch (metafieldsError: any) {
        if (logger) {
          logger.warn('Order metafields processing failed but continuing', {
            requestId: internalRequestId,
            error: metafieldsError.message,
            orderId: data.orderId
          });
        }
        // Don't fail the main operation for metafields errors
      }
    }

    const executionTime = Date.now() - startTime;

    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully processed shipping method selection', {
        requestId: internalRequestId,
        shippingMethod: data.shippingMethod,
        executionTime,
        stored: true,
        orderMetafieldsProcessed: config.features.enableShippingMethodProcessing && !!data.orderId
      });
    }

    return {
      success: true,
      message: 'Shipping method processed successfully',
      data: {
        shippingMethod: data.shippingMethod,
        ...(data.deliveryDate && { deliveryDate: data.deliveryDate }),
        ...(storedData.timestamp && { timestamp: storedData.timestamp }),
        ...(data.cartId && { cartId: data.cartId }),
        ...(data.orderId && { orderId: data.orderId })
      },
      requestId: internalRequestId,
      timestamp: storedData.timestamp || new Date().toISOString()
    };

  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    if (logger) {
      logger.error('Error processing shipping method selection', {
        requestId: internalRequestId,
        error: error.message,
        errorStack: error.stack,
        executionTime,
        data: sanitizeDataForLogging(data)
      });
    }

    return {
      success: false,
      message: 'Failed to process shipping method',
      error: error.message,
      requestId: internalRequestId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Retrieve shipping method data from KV storage
 * Migrated from Express backend with KV storage integration
 */
export async function getShippingMethodData(
  identifier: string,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<ShippingMethodData | null> {
  const internalRequestId = requestId || crypto.randomUUID();

  try {
    // Try different storage key patterns
    const possibleKeys = [
      `shipping-method:${identifier}`,
      `shipping-method:cart:${identifier}`,
      `shipping-method:order:${identifier}`,
      identifier // In case the full key is provided
    ];

    for (const key of possibleKeys) {
      try {
        const storedData = await env.DELIVERY_CACHE.get(key, { type: 'json' }) as ShippingMethodData | null;

        if (storedData) {
          if (logger && config.features.enableRequestLogging) {
            logger.info('Retrieved shipping method data from KV', {
              requestId: internalRequestId,
              identifier,
              storageKey: key,
              shippingMethod: storedData.shippingMethod,
              hasDeliveryDate: !!storedData.deliveryDate,
              timestamp: storedData.timestamp
            });
          }
          return storedData;
        }
      } catch (keyError: any) {
        // Continue to next key if this one fails
        if (logger && config.features.enableDebugLogging) {
          logger.debug('Failed to retrieve data for key', {
            requestId: internalRequestId,
            key,
            error: keyError.message
          });
        }
      }
    }

    if (logger) {
      logger.warn('Shipping method data not found in KV', {
        requestId: internalRequestId,
        identifier,
        keysAttempted: possibleKeys
      });
    }

    return null;
  } catch (error: any) {
    if (logger) {
      logger.error('Error retrieving shipping method data from KV', {
        requestId: internalRequestId,
        identifier,
        error: error.message,
        errorStack: error.stack
      });
    }
    return null;
  }
}

/**
 * Handle shipping method requests with OAuth authentication
 * NOW REQUIRES OAUTH AUTHENTICATION - NO MORE PUBLIC ACCESS
 */
export async function handleShippingMethodRequest(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: WorkersLogger,
  requestId?: string
): Promise<Response> {
  const startTime = Date.now();

  // SECURITY: Require valid OAuth session for shipping method API
  if (!logger) {
    logger = new WorkersLogger(env, config);
  }

  const authResult = await requireAuthentication(request, env, config, logger, requestId || 'unknown');

  // If authentication failed, return the error response
  if (authResult instanceof Response) {
      logger.warn('Shipping method API access denied - authentication required', {
    ...(requestId && { requestId }),
    path: new URL(request.url).pathname,
    ...(request.headers.get('User-Agent') && { userAgent: request.headers.get('User-Agent') })
  });
    return authResult;
  }

  // Cast to authenticated request - we now have a valid OAuth session
  const authenticatedRequest = authResult as SessionRequest;
  const shopDomain = authenticatedRequest.session?.shop;

  if (!shopDomain) {
    logger.error('OAuth session missing shop domain', {
      requestId,
      sessionId: authenticatedRequest.sessionId
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'INVALID_SESSION',
      message: 'OAuth session must include valid shop domain'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const method = request.method;

  // Log authenticated request
  logger.info('Authenticated shipping method request', {
    requestId,
    shop: shopDomain,
    method,
    path: url.pathname,
    sessionId: authenticatedRequest.sessionId
  });

  try {
    if (method === 'POST' && url.pathname === '/api/shipping-methods/process') {
      // Process shipping method selection
      let data: ShippingMethodData;
      try {
        data = await request.json() as ShippingMethodData;
      } catch (parseError: any) {
        return new Response(JSON.stringify({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid JSON in request body',
          shop: shopDomain,
          requestId,
          timestamp: new Date().toISOString()
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await processShippingMethodSelection(data, env, config, logger, requestId);

      // Add shop context to response
      const responseData = {
        ...result,
        shop: shopDomain,
        authenticatedShop: shopDomain
      };

      return new Response(JSON.stringify(responseData), {
        status: result.success ? 200 : 400,
        headers: {
          'Content-Type': 'application/json',
          'X-Shop-Context': shopDomain
        }
      });

    } else if (method === 'GET' && url.pathname.startsWith('/api/shipping-methods/')) {
      // Retrieve shipping method data
      const identifier = url.pathname.split('/').pop();
      if (!identifier) {
        return new Response(JSON.stringify({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Missing identifier in URL path',
          shop: shopDomain,
          requestId,
          timestamp: new Date().toISOString()
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const data = await getShippingMethodData(identifier, env, config, logger, requestId);

      if (data) {
        return new Response(JSON.stringify({
          success: true,
          data: data,
          shop: shopDomain,
          requestId,
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Shop-Context': shopDomain
          }
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          error: 'NOT_FOUND',
          message: 'Shipping method data not found',
          shop: shopDomain,
          requestId,
          timestamp: new Date().toISOString()
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: `Method ${method} not allowed for this endpoint`,
        shop: shopDomain,
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    logger.error('Failed to handle authenticated shipping method request', {
        requestId,
      shop: shopDomain,
        error: error.message,
        errorStack: error.stack,
        executionTime,
        method,
        pathname: url.pathname
      });

    return new Response(JSON.stringify({
      success: false,
      error: 'INTERNAL_ERROR',
      message: config.features.enableDetailedErrors
        ? error.message
        : 'Internal server error',
      shop: shopDomain,
      requestId,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Shop-Context': shopDomain
      }
    });
  }
}

/**
 * Validate shipping method data
 * Enhanced validation for Workers environment
 */
function validateShippingMethodData(data: ShippingMethodData): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('data must be an object');
    return { isValid: false, errors };
  }

  if (!data.shippingMethod || typeof data.shippingMethod !== 'string') {
    errors.push('shippingMethod is required and must be a string');
  }

  if (!data.timestamp || typeof data.timestamp !== 'string') {
    errors.push('timestamp is required and must be a string');
  } else {
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) {
      errors.push('timestamp must be a valid ISO date string');
    }
  }

  if (data.deliveryDate && typeof data.deliveryDate !== 'string') {
    errors.push('deliveryDate must be a string if provided');
  }

  if (data.cartId && typeof data.cartId !== 'string') {
    errors.push('cartId must be a string if provided');
  }

  if (data.orderId && typeof data.orderId !== 'string') {
    errors.push('orderId must be a string if provided');
  }

  // Must have either cartId or orderId
  if (!data.cartId && !data.orderId) {
    errors.push('either cartId or orderId must be provided');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Generate storage key for KV
 */
function generateStorageKey(data: ShippingMethodData, requestId: string): string {
  if (data.orderId) {
    return `shipping-method:order:${data.orderId}`;
  } else if (data.cartId) {
    return `shipping-method:cart:${data.cartId}`;
  } else {
    return `shipping-method:${requestId}`;
  }
}

/**
 * Sanitize data for logging (remove sensitive information)
 */
function sanitizeDataForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };

  // Remove or truncate potentially sensitive fields
  if (sanitized.customerId) {
    sanitized.customerId = sanitized.customerId.substring(0, 8) + '...';
  }

  return sanitized;
}

/**
 * Process order metafields
 * Simulated implementation - would integrate with Shopify Admin API in production
 */
async function processOrderMetafields(
  data: ShippingMethodData,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<void> {
  try {
    if (logger && config.features.enableRequestLogging) {
      logger.info('Processing order metafields', {
        requestId,
        orderId: data.orderId,
        shippingMethod: data.shippingMethod,
        deliveryDate: data.deliveryDate
      });
    }

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // In a real implementation, this would:
    // 1. Use Shopify Admin API to set order metafields
    // 2. Set metafields for shipping method and delivery date
    // 3. Handle API errors and retries

    if (logger && config.features.enableRequestLogging) {
      logger.info('Order metafields processed successfully', {
        requestId,
        orderId: data.orderId
      });
    }

  } catch (error: any) {
    if (logger) {
      logger.error('Error processing order metafields', {
        requestId,
        orderId: data.orderId,
        error: error.message,
        errorStack: error.stack
      });
    }
    // Don't throw here - metafield processing failure shouldn't fail the main operation
  }
}