import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { ShopifyOrder } from '../handlers/webhooks';
import { AttributeTransformService } from './attributeTransformService';
import { MetafieldService } from './metafieldService';
import { SimpleTokenService } from './simpleTokenService';

/**
 * Processing result interface
 */
export interface ProcessingResult {
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
  queueId?: string;
}

/**
 * Processing error interface
 */
export interface ProcessingError {
  type: 'validation' | 'api' | 'network' | 'queue' | 'duplicate' | 'unknown';
  message: string;
  field?: string;
  code?: string;
  retryable: boolean;
  timestamp: string;
}

/**
 * Processing status interface
 */
export interface ProcessingStatus {
  orderId: number;
  shop: string;
  queueId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying' | 'duplicate';
  attempts: number;
  maxRetries: number;
  lastAttempt: string;
  nextRetry?: string;
  errors: ProcessingError[];
  createdAt: string;
  updatedAt: string;
  processingTime?: number;
  metafieldsCreated?: number;
}

/**
 * Queue item interface
 */
export interface QueueItem {
  queueId: string;
  orderId: number;
  shop: string;
  topic: string;
  orderData: ShopifyOrder;
  priority: number;
  scheduledAt: string;
  attempts: number;
  maxRetries: number;
  createdAt: string;
}

/**
 * Processing statistics interface
 */
export interface ProcessingStats {
  totalProcessed: number;
  successfulProcessed: number;
  failedProcessed: number;
  currentlyQueued: number;
  currentlyProcessing: number;
  averageProcessingTime: number;
  successRate: number;
  errorsByType: Record<string, number>;
}

/**
 * Order processing pipeline with queue management and monitoring
 */
export class OrderProcessingPipeline {
  private env: Env;
  private logger: WorkersLogger;
  private transformService: AttributeTransformService;
  private metafieldService: MetafieldService;
  private maxRetries: number;
  private retryDelayMs: number;
  private processingTimeout: number;

  constructor(env: Env, logger: WorkersLogger) {
    this.env = env;
    this.logger = logger;
    this.transformService = new AttributeTransformService(env, logger);
    this.metafieldService = new MetafieldService(env, logger);
    this.maxRetries = parseInt(env.MAX_RETRIES || '3', 10);
    this.retryDelayMs = 5000; // 5 seconds base retry delay
    this.processingTimeout = 30000; // 30 seconds processing timeout
  }

  /**
   * Process order with queue management and duplicate prevention
   */
  public async processOrder(
    orderData: ShopifyOrder,
    shop: string,
    topic: string = 'orders/create'
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const queueId = this.generateQueueId(orderData.id, shop, topic);

    this.logger.info('Starting order processing', {
      orderId: orderData.id,
      shop,
      topic,
      queueId
    });

    try {
      // Check for duplicate processing
      const isDuplicate = await this.checkDuplicateProcessing(orderData.id, shop);
      if (isDuplicate) {
        this.logger.warn('Duplicate order processing detected', {
          orderId: orderData.id,
          shop,
          queueId
        });

        return {
          success: true,
          orderId: orderData.id,
          shop,
          topic,
          metafieldsCreated: 0,
          processingTime: Date.now() - startTime,
          queueId,
          errors: [{
            type: 'duplicate',
            message: 'Order already processed',
            retryable: false,
            timestamp: new Date().toISOString()
          }]
        };
      }

      // Add to processing queue
      await this.addToQueue(orderData, shop, topic, queueId);

      // Set initial processing status
      await this.updateProcessingStatus(orderData.id, shop, {
        queueId,
        status: 'processing',
        attempts: 1,
        lastAttempt: new Date().toISOString()
      });

      // Transform note attributes to metafields
      const transformation = this.transformService.transformNoteAttributesToMetafields(
        orderData.note_attributes || [],
        orderData.id,
        shop
      );

      // Record transformation metrics
      await this.transformService.recordTransformationMetrics(
        transformation.metrics,
        orderData.id,
        shop
      );

      // Check if transformation was successful
      if (!transformation.validation.isValid) {
        const errors: ProcessingError[] = transformation.validation.errors.map(err => ({
          type: 'validation',
          message: err.message,
          field: err.field,
          code: err.code,
          retryable: false,
          timestamp: new Date().toISOString()
        }));

        await this.updateProcessingStatus(orderData.id, shop, {
          status: 'failed',
          errors,
          updatedAt: new Date().toISOString()
        });

        return {
          success: false,
          orderId: orderData.id,
          shop,
          topic,
          metafieldsCreated: 0,
          processingTime: Date.now() - startTime,
          queueId,
          errors
        };
      }

      // Create metafields if we have valid data
      let metafieldResults: any[] = [];
      let metafieldsCreated = 0;

      if (transformation.metafields.length > 0) {
        // Get shop configuration for API access
        const shopConfig = await this.getShopConfiguration(shop);
        if (!shopConfig) {
          throw new Error('Shop configuration not found - webhook not properly registered');
        }

        // Create metafields using the metafield service
        metafieldResults = await this.metafieldService.createOrderMetafields(
          orderData.id.toString(),
          transformation.metafields,
          {
            shop,
            accessToken: shopConfig.accessToken
          }
        );

        metafieldsCreated = metafieldResults.filter(r => r.success).length;
      }

      // Check for metafield errors
      const metafieldErrors: ProcessingError[] = metafieldResults
        .filter(r => !r.success)
        .map(r => ({
          type: 'api',
          message: r.error || 'Unknown metafield error',
          retryable: r.retryable || false,
          timestamp: new Date().toISOString()
        }));

      const hasErrors = metafieldErrors.length > 0;
      const processingTime = Date.now() - startTime;

      // Update final processing status
      await this.updateProcessingStatus(orderData.id, shop, {
        status: hasErrors ? 'failed' : 'completed',
        errors: metafieldErrors,
        processingTime,
        metafieldsCreated,
        updatedAt: new Date().toISOString()
      });

      // Remove from processing queue
      await this.removeFromQueue(queueId);

      // Store final processing result
      await this.storeProcessingResult({
        success: !hasErrors,
        orderId: orderData.id,
        shop,
        topic,
        metafieldsCreated,
        processingTime,
        queueId,
        noteAttributes: this.extractNoteAttributes(orderData.note_attributes || []),
        ...(hasErrors && { errors: metafieldErrors })
      });

      this.logger.info('Order processing completed', {
        orderId: orderData.id,
        shop,
        success: !hasErrors,
        metafieldsCreated,
        processingTime,
        queueId
      });

      return {
        success: !hasErrors,
        orderId: orderData.id,
        shop,
        topic,
        metafieldsCreated,
        processingTime,
        queueId,
        noteAttributes: this.extractNoteAttributes(orderData.note_attributes || []),
        ...(hasErrors && { errors: metafieldErrors })
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;

      this.logger.error('Order processing failed', {
        orderId: orderData.id,
        shop,
        queueId,
        error: error.message,
        processingTime
      });

      const processingError: ProcessingError = {
        type: 'unknown',
        message: error.message,
        retryable: this.isRetryableError(error),
        timestamp: new Date().toISOString()
      };

      // Update processing status to failed
      await this.updateProcessingStatus(orderData.id, shop, {
        status: 'failed',
        errors: [processingError],
        processingTime,
        updatedAt: new Date().toISOString()
      });

      // Schedule retry if error is retryable
      if (processingError.retryable) {
        await this.scheduleRetry(orderData, shop, topic, queueId, 1);
      } else {
        await this.removeFromQueue(queueId);
      }

      return {
        success: false,
        orderId: orderData.id,
        shop,
        topic,
        metafieldsCreated: 0,
        processingTime,
        queueId,
        errors: [processingError]
      };
    }
  }

  /**
   * Reprocess order (manual retry)
   */
  public async reprocessOrder(orderId: string, shop: string): Promise<ProcessingResult> {
    this.logger.info('Manual reprocessing requested', { orderId, shop });

    try {
      // Get stored order data
      const storedResult = await this.getStoredProcessingResult(parseInt(orderId), shop);
      if (!storedResult) {
        throw new Error('No stored order data found for reprocessing');
      }

      // Get original order data from webhook storage
      const orderDataKey = `order_processing:${shop}:${orderId}`;
      const orderDataJson = await this.env.DELIVERY_CACHE.get(orderDataKey);
      if (!orderDataJson) {
        throw new Error('Original order data not found');
      }

      const orderProcessingData = JSON.parse(orderDataJson);
      if (!orderProcessingData.orderData) {
        throw new Error('Order data corrupted or missing');
      }

      // Clear previous processing status
      await this.clearProcessingStatus(parseInt(orderId), shop);

      // Reprocess the order
      return await this.processOrder(
        orderProcessingData.orderData,
        shop,
        storedResult.topic
      );

    } catch (error: any) {
      this.logger.error('Manual reprocessing failed', {
        orderId,
        shop,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get processing status for an order
   */
  public async getProcessingStatus(orderId: string): Promise<ProcessingStatus | null> {
    try {
      // We need shop context - try to find it from stored results
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `order_processing_status:`
      });

      for (const key of keys) {
        if (key.name.includes(`:${orderId}`)) {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) : null;
        }
      }

      return null;
    } catch (error: any) {
      this.logger.error('Error getting processing status', {
        orderId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get processing statistics for monitoring
   */
  public async getProcessingStats(shop: string, days: number = 7): Promise<ProcessingStats> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Get all processing results for the shop
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `order_processing_result:${shop}:`
      });

      const results = await Promise.all(
        keys.map(async (key: { name: string }) => {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) : null;
        })
      );

      const validResults = results
        .filter(Boolean)
        .filter(r => new Date(r.timestamp || r.createdAt) >= cutoffDate);

      if (validResults.length === 0) {
        return {
          totalProcessed: 0,
          successfulProcessed: 0,
          failedProcessed: 0,
          currentlyQueued: 0,
          currentlyProcessing: 0,
          averageProcessingTime: 0,
          successRate: 0,
          errorsByType: {}
        };
      }

      const totalProcessed = validResults.length;
      const successfulProcessed = validResults.filter(r => r.success).length;
      const failedProcessed = totalProcessed - successfulProcessed;
      const successRate = (successfulProcessed / totalProcessed) * 100;

      const totalProcessingTime = validResults
        .filter(r => r.processingTime)
        .reduce((sum, r) => sum + r.processingTime, 0);
      const averageProcessingTime = totalProcessingTime / validResults.length;

      // Count errors by type
      const errorsByType: Record<string, number> = {};
      validResults.forEach(result => {
        if (result.errors) {
          result.errors.forEach((error: ProcessingError) => {
            errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
          });
        }
      });

      // Get current queue and processing counts
      const currentlyQueued = await this.getQueueCount(shop);
      const currentlyProcessing = await this.getProcessingCount(shop);

      return {
        totalProcessed,
        successfulProcessed,
        failedProcessed,
        currentlyQueued,
        currentlyProcessing,
        averageProcessingTime,
        successRate,
        errorsByType
      };

    } catch (error: any) {
      this.logger.error('Error getting processing stats', {
        shop,
        error: error.message
      });

      return {
        totalProcessed: 0,
        successfulProcessed: 0,
        failedProcessed: 0,
        currentlyQueued: 0,
        currentlyProcessing: 0,
        averageProcessingTime: 0,
        successRate: 0,
        errorsByType: {}
      };
    }
  }

  /**
   * Generate unique queue ID
   */
  private generateQueueId(orderId: number, shop: string, topic: string): string {
    const timestamp = Date.now();
    return `queue_${shop}_${orderId}_${topic}_${timestamp}`;
  }

  /**
   * Check for duplicate processing
   */
  private async checkDuplicateProcessing(orderId: number, shop: string): Promise<boolean> {
    try {
      const statusKey = `order_processing_status:${shop}:${orderId}`;
      const existingStatus = await this.env.DELIVERY_CACHE.get(statusKey);

      if (!existingStatus) return false;

      const status: ProcessingStatus = JSON.parse(existingStatus);
      return status.status === 'completed' || status.status === 'processing';
    } catch (error) {
      return false;
    }
  }

  /**
   * Add order to processing queue
   */
  private async addToQueue(
    orderData: ShopifyOrder,
    shop: string,
    topic: string,
    queueId: string,
    priority: number = 1
  ): Promise<void> {
    try {
      const queueItem: QueueItem = {
        queueId,
        orderId: orderData.id,
        shop,
        topic,
        orderData,
        priority,
        scheduledAt: new Date().toISOString(),
        attempts: 0,
        maxRetries: this.maxRetries,
        createdAt: new Date().toISOString()
      };

      await this.env.DELIVERY_CACHE.put(
        `processing_queue:${queueId}`,
        JSON.stringify(queueItem),
        { expirationTtl: 24 * 60 * 60 } // 24 hours
      );

      this.logger.debug('Added order to processing queue', {
        queueId,
        orderId: orderData.id,
        shop
      });
    } catch (error: any) {
      this.logger.error('Error adding to queue', {
        queueId,
        error: error.message
      });
    }
  }

  /**
   * Remove order from processing queue
   */
  private async removeFromQueue(queueId: string): Promise<void> {
    try {
      await this.env.DELIVERY_CACHE.delete(`processing_queue:${queueId}`);

      this.logger.debug('Removed order from processing queue', { queueId });
    } catch (error: any) {
      this.logger.error('Error removing from queue', {
        queueId,
        error: error.message
      });
    }
  }

  /**
   * Schedule retry for failed processing
   */
  private async scheduleRetry(
    orderData: ShopifyOrder,
    shop: string,
    topic: string,
    queueId: string,
    attempt: number
  ): Promise<void> {
    if (attempt >= this.maxRetries) {
      this.logger.warn('Max retries exceeded, not scheduling retry', {
        orderId: orderData.id,
        shop,
        attempt
      });
      await this.removeFromQueue(queueId);
      return;
    }

    try {
      const retryDelay = this.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
      const nextRetry = new Date(Date.now() + retryDelay).toISOString();

      await this.updateProcessingStatus(orderData.id, shop, {
        status: 'retrying',
        nextRetry,
        updatedAt: new Date().toISOString()
      });

      // Update queue item with new retry schedule
      const queueItem: QueueItem = {
        queueId,
        orderId: orderData.id,
        shop,
        topic,
        orderData,
        priority: 2, // Higher priority for retries
        scheduledAt: nextRetry,
        attempts: attempt,
        maxRetries: this.maxRetries,
        createdAt: new Date().toISOString()
      };

      await this.env.DELIVERY_CACHE.put(
        `processing_queue:${queueId}`,
        JSON.stringify(queueItem),
        { expirationTtl: 24 * 60 * 60 } // 24 hours
      );

      this.logger.info('Scheduled retry for order processing', {
        orderId: orderData.id,
        shop,
        attempt,
        nextRetry,
        retryDelay
      });
    } catch (error: any) {
      this.logger.error('Error scheduling retry', {
        orderId: orderData.id,
        shop,
        error: error.message
      });
    }
  }

  /**
   * Update processing status in KV storage
   */
  private async updateProcessingStatus(
    orderId: number,
    shop: string,
    updates: Partial<ProcessingStatus>
  ): Promise<void> {
    try {
      const key = `order_processing_status:${shop}:${orderId}`;
      const existingData = await this.env.DELIVERY_CACHE.get(key);

      let status: ProcessingStatus;

      if (existingData) {
        status = { ...JSON.parse(existingData), ...updates };
      } else {
        status = {
          orderId,
          shop,
          queueId: updates.queueId || '',
          status: 'queued',
          attempts: 0,
          maxRetries: this.maxRetries,
          lastAttempt: new Date().toISOString(),
          errors: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...updates
        };
      }

      await this.env.DELIVERY_CACHE.put(
        key,
        JSON.stringify(status),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );
    } catch (error: any) {
      this.logger.error('Error updating processing status', {
        orderId,
        shop,
        error: error.message
      });
    }
  }

  /**
   * Clear processing status (for reprocessing)
   */
  private async clearProcessingStatus(orderId: number, shop: string): Promise<void> {
    try {
      const key = `order_processing_status:${shop}:${orderId}`;
      await this.env.DELIVERY_CACHE.delete(key);
    } catch (error: any) {
      this.logger.error('Error clearing processing status', {
        orderId,
        shop,
        error: error.message
      });
    }
  }

  /**
   * Store final processing result
   */
  private async storeProcessingResult(result: ProcessingResult): Promise<void> {
    try {
      const key = `order_processing_result:${result.shop}:${result.orderId}`;
      const resultData = {
        ...result,
        timestamp: new Date().toISOString()
      };

      await this.env.DELIVERY_CACHE.put(
        key,
        JSON.stringify(resultData),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );
    } catch (error: any) {
      this.logger.error('Error storing processing result', {
        orderId: result.orderId,
        shop: result.shop,
        error: error.message
      });
    }
  }

  /**
   * Get stored processing result
   */
  private async getStoredProcessingResult(orderId: number, shop: string): Promise<ProcessingResult | null> {
    try {
      const key = `order_processing_result:${shop}:${orderId}`;
      const data = await this.env.DELIVERY_CACHE.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get shop configuration from webhooks or SimpleTokenService
   */
  private async getShopConfiguration(shop: string): Promise<{
    accessToken: string;
    webhookId: string;
  } | null> {
    try {
      // First try to get from webhook configurations
      const topics = ['orders/create', 'orders/paid', 'orders/updated'];

      for (const topic of topics) {
        const configData = await this.env.DELIVERY_CACHE.get(`webhook:${shop}:${topic}`);
        if (configData) {
          const config = JSON.parse(configData);
          if (config.accessToken) {
            return {
              accessToken: config.accessToken,
              webhookId: config.webhookId
            };
          }
        }
      }

      // Fallback to SimpleTokenService
      const tokenService = new SimpleTokenService(this.env);
      const accessToken = await tokenService.getToken(shop);

      if (accessToken) {
        return {
          accessToken,
          webhookId: 'token-based'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract note attributes from order data
   */
  private extractNoteAttributes(noteAttributes: Array<{ name: string; value: string }>): {
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
   * Get current queue count for a shop
   */
  private async getQueueCount(shop: string): Promise<number> {
    try {
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `processing_queue:`
      });

      let count = 0;
      for (const key of keys) {
        const data = await this.env.DELIVERY_CACHE.get(key.name);
        if (data) {
          const queueItem: QueueItem = JSON.parse(data);
          if (queueItem.shop === shop) {
            count++;
          }
        }
      }

      return count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get current processing count for a shop
   */
  private async getProcessingCount(shop: string): Promise<number> {
    try {
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `order_processing_status:${shop}:`
      });

      let count = 0;
      for (const key of keys) {
        const data = await this.env.DELIVERY_CACHE.get(key.name);
        if (data) {
          const status: ProcessingStatus = JSON.parse(data);
          if (status.status === 'processing') {
            count++;
          }
        }
      }

      return count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    const message = error.message?.toLowerCase() || '';

    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500') ||
      message.includes('connection') ||
      message.includes('rate limit')
    );
  }
}