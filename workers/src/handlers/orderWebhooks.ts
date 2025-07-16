import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { ShopifyOrder } from './webhooks';
import { SimpleTokenService } from '../services/simpleTokenService';

/**
 * Order processing result interface
 */
export interface OrderProcessingResult {
  success: boolean;
  orderId: number;
  shop: string;
  topic: string;
  metafieldsCreated: number;
  processingTime: number;
  errors?: ProcessingError[];
  noteAttributes?: {
    delivery_date?: string;
    shipping_method?: string;
  };
}

/**
 * Processing error interface
 */
export interface ProcessingError {
  type: 'validation' | 'api' | 'network' | 'unknown';
  message: string;
  field?: string;
  code?: string;
  retryable: boolean;
}

/**
 * Processing status interface
 */
export interface ProcessingStatus {
  orderId: number;
  shop: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  lastAttempt: string;
  nextRetry?: string;
  errors: ProcessingError[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Comprehensive handler for order created webhook
 * Processes note_attributes and creates metafields immediately
 */
export async function handleOrderCreated(
  orderData: ShopifyOrder,
  shop: string,
  env: Env,
  logger: WorkersLogger
): Promise<OrderProcessingResult> {
  const startTime = Date.now();

  logger.info('Processing order created webhook', {
    orderId: orderData.id,
    orderNumber: orderData.order_number,
    shop
  });

  try {
    // Set processing status to pending
    await updateProcessingStatus(orderData.id, shop, {
      status: 'processing',
      attempts: 1,
      lastAttempt: new Date().toISOString()
    }, env);

    // Extract note attributes
    const noteAttributes = extractNoteAttributes(orderData.note_attributes);

    // Validate required data
    const validationErrors = validateNoteAttributes(noteAttributes);
    if (validationErrors.length > 0) {
      logger.warn('Note attributes validation failed', {
        orderId: orderData.id,
        errors: validationErrors
      });

      // Mark as completed with warnings if no critical data
      await updateProcessingStatus(orderData.id, shop, {
        status: 'completed',
        errors: validationErrors,
        updatedAt: new Date().toISOString()
      }, env);

      return {
        success: true,
        orderId: orderData.id,
        shop,
        topic: 'orders/create',
        metafieldsCreated: 0,
        processingTime: Date.now() - startTime,
        errors: validationErrors,
        noteAttributes
      };
    }

    // Get shop configuration for metafield creation
    const shopConfig = await getShopConfiguration(shop, env);
    if (!shopConfig) {
      throw new Error('Shop configuration not found - webhook not properly registered');
    }

    // Create metafields from note attributes
    const metafieldResults = await createOrderMetafieldsFromNoteAttributes(
      shop,
      shopConfig.accessToken,
      orderData.id,
      noteAttributes,
      env,
      logger
    );

    const metafieldsCreated = metafieldResults.filter(r => r.success).length;
    const metafieldErrors = metafieldResults
      .filter(r => !r.success)
      .map(r => ({
        type: 'api' as const,
        message: r.error || 'Unknown metafield creation error',
        field: r.key,
        retryable: true
      }));

    // Update processing status
    await updateProcessingStatus(orderData.id, shop, {
      status: metafieldErrors.length > 0 ? 'failed' : 'completed',
      errors: metafieldErrors,
      updatedAt: new Date().toISOString()
    }, env);

    const result: OrderProcessingResult = {
      success: metafieldErrors.length === 0,
      orderId: orderData.id,
      shop,
      topic: 'orders/create',
      metafieldsCreated,
      processingTime: Date.now() - startTime,
      noteAttributes,
      ...(metafieldErrors.length > 0 && { errors: metafieldErrors })
    };

    logger.info('Order created processing completed', {
      orderId: orderData.id,
      success: result.success,
      metafieldsCreated,
      processingTime: result.processingTime
    });

    return result;

  } catch (error: any) {
    logger.error('Order created processing failed', {
      orderId: orderData.id,
      error: error.message,
      stack: error.stack
    });

    const processingError: ProcessingError = {
      type: 'unknown',
      message: error.message,
      retryable: true
    };

    // Update processing status to failed
    await updateProcessingStatus(orderData.id, shop, {
      status: 'failed',
      errors: [processingError],
      updatedAt: new Date().toISOString()
    }, env);

    return {
      success: false,
      orderId: orderData.id,
      shop,
      topic: 'orders/create',
      metafieldsCreated: 0,
      processingTime: Date.now() - startTime,
      errors: [processingError]
    };
  }
}

/**
 * Handler for order paid webhook
 * Updates processing status and triggers additional fulfillment logic
 */
export async function handleOrderPaid(
  orderData: ShopifyOrder,
  shop: string,
  env: Env,
  logger: WorkersLogger
): Promise<OrderProcessingResult> {
  const startTime = Date.now();

  logger.info('Processing order paid webhook', {
    orderId: orderData.id,
    orderNumber: orderData.order_number,
    shop,
    financialStatus: orderData.financial_status
  });

  try {
    // Check if order was already processed during creation
    const existingStatus = await getProcessingStatus(orderData.id, shop, env);

    if (existingStatus && existingStatus.status === 'completed') {
      logger.info('Order already processed, updating payment status', {
        orderId: orderData.id
      });

      // Update existing metafield to mark as paid
      const shopConfig = await getShopConfiguration(shop, env);
      if (shopConfig) {
        await updatePaymentStatusMetafield(
          shop,
          shopConfig.accessToken,
          orderData.id,
          orderData.financial_status,
          logger
        );
      }

      return {
        success: true,
        orderId: orderData.id,
        shop,
        topic: 'orders/paid',
        metafieldsCreated: 0,
        processingTime: Date.now() - startTime
      };
    }

    // If order wasn't processed during creation, process it now
    logger.info('Order not previously processed, processing note attributes', {
      orderId: orderData.id
    });

    return await handleOrderCreated(orderData, shop, env, logger);

  } catch (error: any) {
    logger.error('Order paid processing failed', {
      orderId: orderData.id,
      error: error.message
    });

    const processingError: ProcessingError = {
      type: 'unknown',
      message: error.message,
      retryable: true
    };

    return {
      success: false,
      orderId: orderData.id,
      shop,
      topic: 'orders/paid',
      metafieldsCreated: 0,
      processingTime: Date.now() - startTime,
      errors: [processingError]
    };
  }
}

/**
 * Handler for order updated webhook
 * Handles changes to note attributes and updates metafields accordingly
 */
export async function handleOrderUpdated(
  orderData: ShopifyOrder,
  shop: string,
  env: Env,
  logger: WorkersLogger
): Promise<OrderProcessingResult> {
  const startTime = Date.now();

  logger.info('Processing order updated webhook', {
    orderId: orderData.id,
    orderNumber: orderData.order_number,
    shop
  });

  try {
    // Get previous processing status
    const existingStatus = await getProcessingStatus(orderData.id, shop, env);

    // Extract current note attributes
    const currentNoteAttributes = extractNoteAttributes(orderData.note_attributes);

    // If order was never processed, process it now
    if (!existingStatus) {
      logger.info('Order never processed, processing note attributes', {
        orderId: orderData.id
      });

      return await handleOrderCreated(orderData, shop, env, logger);
    }

    // Check if note attributes changed
    const previousData = await env.DELIVERY_CACHE.get(`order_processing:${shop}:${orderData.id}`);
    if (!previousData) {
      logger.info('No previous order data found, reprocessing', {
        orderId: orderData.id
      });

      return await handleOrderCreated(orderData, shop, env, logger);
    }

    const previousProcessing = JSON.parse(previousData);
    const previousNoteAttributes = previousProcessing.noteAttributes || {};

    // Compare note attributes
    const hasChanges = (
      currentNoteAttributes.delivery_date !== previousNoteAttributes.delivery_date ||
      currentNoteAttributes.shipping_method !== previousNoteAttributes.shipping_method
    );

    if (!hasChanges) {
      logger.info('No note attribute changes detected', {
        orderId: orderData.id
      });

      return {
        success: true,
        orderId: orderData.id,
        shop,
        topic: 'orders/updated',
        metafieldsCreated: 0,
        processingTime: Date.now() - startTime,
        noteAttributes: currentNoteAttributes
      };
    }

    logger.info('Note attribute changes detected, updating metafields', {
      orderId: orderData.id,
      previousAttributes: previousNoteAttributes,
      currentAttributes: currentNoteAttributes
    });

    // Update metafields with new values
    const shopConfig = await getShopConfiguration(shop, env);
    if (!shopConfig) {
      throw new Error('Shop configuration not found');
    }

    const metafieldResults = await createOrderMetafieldsFromNoteAttributes(
      shop,
      shopConfig.accessToken,
      orderData.id,
      currentNoteAttributes,
      env,
      logger
    );

    const metafieldsCreated = metafieldResults.filter(r => r.success).length;
    const metafieldErrors = metafieldResults
      .filter(r => !r.success)
      .map(r => ({
        type: 'api' as const,
        message: r.error || 'Unknown metafield update error',
        field: r.key,
        retryable: true
      }));

    // Update processing status
    await updateProcessingStatus(orderData.id, shop, {
      status: metafieldErrors.length > 0 ? 'failed' : 'completed',
      errors: metafieldErrors,
      updatedAt: new Date().toISOString()
    }, env);

    const result: OrderProcessingResult = {
      success: metafieldErrors.length === 0,
      orderId: orderData.id,
      shop,
      topic: 'orders/updated',
      metafieldsCreated,
      processingTime: Date.now() - startTime,
      noteAttributes: currentNoteAttributes,
      ...(metafieldErrors.length > 0 && { errors: metafieldErrors })
    };

    logger.info('Order updated processing completed', {
      orderId: orderData.id,
      success: result.success,
      metafieldsCreated,
      hasChanges: true
    });

    return result;

  } catch (error: any) {
    logger.error('Order updated processing failed', {
      orderId: orderData.id,
      error: error.message
    });

    const processingError: ProcessingError = {
      type: 'unknown',
      message: error.message,
      retryable: true
    };

    return {
      success: false,
      orderId: orderData.id,
      shop,
      topic: 'orders/updated',
      metafieldsCreated: 0,
      processingTime: Date.now() - startTime,
      errors: [processingError]
    };
  }
}

/**
 * Extract note attributes from order data
 */
function extractNoteAttributes(noteAttributes: Array<{ name: string; value: string }>): {
  delivery_date?: string;
  shipping_method?: string;
} {
  const extracted: { delivery_date?: string; shipping_method?: string } = {};

  if (!noteAttributes || !Array.isArray(noteAttributes)) {
    return extracted;
  }

  for (const attr of noteAttributes) {
    if (attr.name === 'delivery_date' && attr.value) {
      extracted.delivery_date = attr.value;
    }
    if (attr.name === 'shipping_method' && attr.value) {
      extracted.shipping_method = attr.value;
    }
  }

  return extracted;
}

/**
 * Validate note attributes and return validation errors
 */
function validateNoteAttributes(noteAttributes: {
  delivery_date?: string;
  shipping_method?: string;
}): ProcessingError[] {
  const errors: ProcessingError[] = [];

  // Validate delivery date format if present
  if (noteAttributes.delivery_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(noteAttributes.delivery_date)) {
      errors.push({
        type: 'validation',
        message: 'Invalid delivery date format. Expected YYYY-MM-DD',
        field: 'delivery_date',
        retryable: false
      });
    } else {
      // Check if date is valid
      const date = new Date(noteAttributes.delivery_date);
      if (isNaN(date.getTime())) {
        errors.push({
          type: 'validation',
          message: 'Invalid delivery date value',
          field: 'delivery_date',
          retryable: false
        });
      }
    }
  }

  // Validate shipping method format if present
  if (noteAttributes.shipping_method) {
    if (noteAttributes.shipping_method.length > 255) {
      errors.push({
        type: 'validation',
        message: 'Shipping method value too long (max 255 characters)',
        field: 'shipping_method',
        retryable: false
      });
    }
  }

  return errors;
}

/**
 * Get shop configuration using SimpleTokenService
 */
async function getShopConfiguration(shop: string, env: Env): Promise<{
  accessToken: string;
  webhookId: string;
} | null> {
  try {
    // Use simple token service instead of session storage
    const tokenService = new SimpleTokenService(env);
    const accessToken = await tokenService.getToken(shop);

    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      webhookId: 'token-based' // We don't need the actual webhook ID for processing
    };
  } catch (error) {
    console.error('Failed to get shop configuration:', error);
    return null;
  }
}

/**
 * Update or create processing status in KV storage
 */
async function updateProcessingStatus(
  orderId: number,
  shop: string,
  updates: Partial<ProcessingStatus>,
  env: Env
): Promise<void> {
  try {
    const key = `order_processing_status:${shop}:${orderId}`;
    const existingData = await env.DELIVERY_CACHE.get(key);

    let status: ProcessingStatus;

    if (existingData) {
      status = { ...JSON.parse(existingData), ...updates };
    } else {
      status = {
        orderId,
        shop,
        status: 'pending',
        attempts: 0,
        lastAttempt: new Date().toISOString(),
        errors: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...updates
      };
    }

    await env.DELIVERY_CACHE.put(
      key,
      JSON.stringify(status),
      { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
    );
  } catch (error) {
    // Silently fail - processing status is not critical
  }
}

/**
 * Get processing status from KV storage
 */
async function getProcessingStatus(
  orderId: number,
  shop: string,
  env: Env
): Promise<ProcessingStatus | null> {
  try {
    const key = `order_processing_status:${shop}:${orderId}`;
    const data = await env.DELIVERY_CACHE.get(key);

    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Create order metafields from note attributes
 */
async function createOrderMetafieldsFromNoteAttributes(
  shop: string,
  accessToken: string,
  orderId: number,
  noteAttributes: { delivery_date?: string; shipping_method?: string },
  env: Env,
  logger: WorkersLogger
): Promise<Array<{ key: string; success: boolean; error?: string }>> {
  const results = [];

  // Create delivery date metafield
  if (noteAttributes.delivery_date) {
    const result = await createOrUpdateOrderMetafield(
      shop,
      accessToken,
      orderId,
      'custom.dutchned_delivery_date',
      noteAttributes.delivery_date,
      'single_line_text_field'
    );
    results.push({
      key: 'custom.dutchned_delivery_date',
      success: result.success,
      ...(result.error && { error: result.error })
    });
  }

  // Create shipping method metafield
  if (noteAttributes.shipping_method) {
    const result = await createOrUpdateOrderMetafield(
      shop,
      accessToken,
      orderId,
      'custom.ShippingMethod2',
      noteAttributes.shipping_method,
      'single_line_text_field'
    );
    results.push({
      key: 'custom.ShippingMethod2',
      success: result.success,
      ...(result.error && { error: result.error })
    });
  }

  return results;
}

/**
 * Create or update a single order metafield
 */
async function createOrUpdateOrderMetafield(
  shop: string,
  accessToken: string,
  orderId: number,
  key: string,
  value: string,
  type: string = 'single_line_text_field'
): Promise<{ success: boolean; error?: string }> {
  try {
    const [namespace, metafieldKey] = key.split('.');

    // First try to get existing metafield
    const existingResponse = await fetch(
      `https://${shop}/admin/api/2025-04/orders/${orderId}/metafields.json?namespace=${namespace}&key=${metafieldKey}`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (existingResponse.ok) {
      const existingData = await existingResponse.json() as any;

      if (existingData.metafields && existingData.metafields.length > 0) {
        // Update existing metafield
        const metafieldId = existingData.metafields[0].id;

        const updateResponse = await fetch(
          `https://${shop}/admin/api/2025-04/orders/${orderId}/metafields/${metafieldId}.json`,
          {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              metafield: {
                id: metafieldId,
                value,
                type
              }
            })
          }
        );

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json() as any;
          return {
            success: false,
            error: errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${updateResponse.status}`
          };
        }

        return { success: true };
      }
    }

    // Create new metafield
    const metafieldData = {
      metafield: {
        namespace,
        key: metafieldKey,
        value,
        type
      }
    };

    const createResponse = await fetch(`https://${shop}/admin/api/2025-04/orders/${orderId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metafieldData)
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json() as any;
      return {
        success: false,
        error: errorData.errors ? JSON.stringify(errorData.errors) : `HTTP ${createResponse.status}`
      };
    }

    return { success: true };

  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update payment status metafield
 */
async function updatePaymentStatusMetafield(
  shop: string,
  accessToken: string,
  orderId: number,
  financialStatus: string,
  logger: WorkersLogger
): Promise<void> {
  try {
    const result = await createOrUpdateOrderMetafield(
      shop,
      accessToken,
      orderId,
      'custom.payment_status',
      financialStatus,
      'single_line_text_field'
    );

    if (result.success) {
      logger.info('Payment status metafield updated', {
        orderId,
        financialStatus
      });
    } else {
      logger.warn('Failed to update payment status metafield', {
        orderId,
        error: result.error
      });
    }
  } catch (error: any) {
    logger.error('Error updating payment status metafield', {
      orderId,
      error: error.message
    });
  }
}