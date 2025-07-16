import { Env, WorkerConfig } from '../types/env';
import { OrderMetafieldsData, OrderMetafieldsSaveResult } from '../types/common';

/**
 * Handle order metafields requests
 * Main handler for /api/order-metafields/save endpoint
 */
export async function handleOrderMetafields(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed for this endpoint',
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let data: OrderMetafieldsData;
    try {
      data = await request.json() as OrderMetafieldsData;
    } catch (parseError: any) {
      return new Response(JSON.stringify({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid JSON in request body',
        requestId,
        timestamp: new Date().toISOString()
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await saveOrderMetafields(data, env, config, logger, requestId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
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
      logger.error('Failed to handle order metafields request', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        executionTime
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: 'INTERNAL_ERROR',
      message: config.features.enableDetailedErrors 
        ? error.message 
        : 'Internal server error',
      requestId,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Save order metafields to KV storage
 * Combined endpoint for delivery date and shipping method data
 */
async function saveOrderMetafields(
  data: OrderMetafieldsData,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<OrderMetafieldsSaveResult> {
  const startTime = Date.now();
  const internalRequestId = requestId || crypto.randomUUID();

  if (logger && config.features.enableRequestLogging) {
    logger.info('Saving order metafields', {
      requestId: internalRequestId,
      hasDeliveryDate: !!data.deliveryDate,
      hasShippingMethod: !!data.shippingMethod,
      hasOrderId: !!data.orderId,
      hasCartId: !!data.cartId,
      startTime
    });
  }

  try {
    // Validate input data
    const validationResult = validateOrderMetafieldsData(data);
    if (!validationResult.isValid) {
      if (logger) {
        logger.error('Invalid order metafields data', {
          requestId: internalRequestId,
          errors: validationResult.errors,
          data: sanitizeDataForLogging(data)
        });
      }
      return {
        success: false,
        message: 'Invalid order metafields data',
        error: validationResult.errors.join(', '),
        requestId: internalRequestId,
        timestamp: new Date().toISOString()
      };
    }

    // Generate storage key
    const storageKey = generateMetafieldsStorageKey(data, internalRequestId);
    
    // Prepare data for storage
    const metafieldsData: OrderMetafieldsData = {
      ...data,
      additionalData: {
        ...data.additionalData,
        savedAt: new Date().toISOString(),
        requestId: internalRequestId
      }
    };

    // Store in KV with appropriate TTL
    try {
      await env.DELIVERY_CACHE.put(
        storageKey,
        JSON.stringify(metafieldsData),
        {
          expirationTtl: 7 * 24 * 60 * 60 // 7 days for order data
        }
      );

      if (logger && config.features.enableRequestLogging) {
        logger.info('Successfully stored order metafields in KV', {
          requestId: internalRequestId,
          storageKey,
          ttl: 7 * 24 * 60 * 60
        });
      }
    } catch (storageError: any) {
      if (logger) {
        logger.error('Failed to store order metafields in KV', {
          requestId: internalRequestId,
          error: storageError.message,
          storageKey
        });
      }
      return {
        success: false,
        message: 'Failed to store order metafields',
        error: storageError.message,
        requestId: internalRequestId,
        timestamp: new Date().toISOString()
      };
    }

    const executionTime = Date.now() - startTime;
    
    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully saved order metafields', {
        requestId: internalRequestId,
        executionTime,
        storageKey
      });
    }

    return {
      success: true,
      message: 'Order metafields saved successfully',
      data: metafieldsData,
      requestId: internalRequestId,
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    if (logger) {
      logger.error('Error saving order metafields', {
        requestId: internalRequestId,
        error: error.message,
        errorStack: error.stack,
        executionTime,
        data: sanitizeDataForLogging(data)
      });
    }

    return {
      success: false,
      message: 'Failed to save order metafields',
      error: error.message,
      requestId: internalRequestId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Validate order metafields data
 */
function validateOrderMetafieldsData(data: OrderMetafieldsData): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('data must be an object');
    return { isValid: false, errors };
  }

  // Must have either orderId or cartId
  if (!data.orderId && !data.cartId) {
    errors.push('either orderId or cartId must be provided');
  }

  // Must have either deliveryDate or shippingMethod
  if (!data.deliveryDate && !data.shippingMethod) {
    errors.push('either deliveryDate or shippingMethod must be provided');
  }

  if (data.deliveryDate && typeof data.deliveryDate !== 'string') {
    errors.push('deliveryDate must be a string if provided');
  }

  if (data.shippingMethod && typeof data.shippingMethod !== 'string') {
    errors.push('shippingMethod must be a string if provided');
  }

  if (data.orderId && typeof data.orderId !== 'string') {
    errors.push('orderId must be a string if provided');
  }

  if (data.cartId && typeof data.cartId !== 'string') {
    errors.push('cartId must be a string if provided');
  }

  if (data.customerId && typeof data.customerId !== 'string') {
    errors.push('customerId must be a string if provided');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Generate storage key for order metafields
 */
function generateMetafieldsStorageKey(data: OrderMetafieldsData, requestId: string): string {
  if (data.orderId) {
    return `order-metafields:${data.orderId}`;
  } else if (data.cartId) {
    return `order-metafields:cart:${data.cartId}`;
  } else {
    return `order-metafields:${requestId}`;
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
  
  if (sanitized.additionalData) {
    // Remove potentially sensitive additional data
    const { additionalData, ...rest } = sanitized;
    sanitized.additionalData = '[redacted]';
  }
  
  return sanitized;
} 