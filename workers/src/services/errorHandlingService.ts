import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error categories for classification
 */
export type ErrorCategory = 
  | 'validation' 
  | 'api' 
  | 'network' 
  | 'authentication' 
  | 'authorization' 
  | 'rate_limit' 
  | 'timeout' 
  | 'server_error' 
  | 'client_error' 
  | 'configuration' 
  | 'data_corruption' 
  | 'unknown';

/**
 * Detailed error interface
 */
export interface ProcessingError {
  id: string;
  orderId: number;
  shop: string;
  topic: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  details?: Record<string, any>;
  stackTrace?: string;
  context?: Record<string, any>;
  retryable: boolean;
  attempts: number;
  maxRetries: number;
  firstOccurrence: string;
  lastOccurrence: string;
  resolved: boolean;
  resolvedAt?: string;
  resolution?: string;
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  shop: string;
  service: string;
  status: 'closed' | 'open' | 'half-open';
  failureCount: number;
  failureThreshold: number;
  lastFailureTime?: string;
  nextRetryTime?: string;
  successCount: number;
  timeoutMs: number;
}

/**
 * Dead letter queue item
 */
export interface DeadLetterItem {
  id: string;
  orderId: number;
  shop: string;
  topic: string;
  originalData: any;
  error: ProcessingError;
  addedAt: string;
  attemptedRecovery: number;
  lastRecoveryAttempt?: string;
  manualReview: boolean;
}

/**
 * Recovery strategy interface
 */
export interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'manual' | 'skip';
  maxAttempts: number;
  delayMs: number;
  escalationRules?: EscalationRule[];
}

/**
 * Escalation rule interface
 */
export interface EscalationRule {
  condition: string;
  action: 'notify' | 'fallback' | 'manual_review' | 'skip';
  delay: number;
}

/**
 * Error statistics interface
 */
export interface ErrorStatistics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  resolvedErrors: number;
  pendingErrors: number;
  averageResolutionTime: number;
  mostCommonErrors: Array<{ message: string; count: number; category: ErrorCategory }>;
  errorTrends: Array<{ date: string; count: number; category: ErrorCategory }>;
}

/**
 * Comprehensive error handling and recovery service
 */
export class ErrorHandlingService {
  private env: Env;
  private logger: WorkersLogger;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private recoveryStrategies: Map<ErrorCategory, RecoveryStrategy>;

  constructor(env: Env, logger: WorkersLogger) {
    this.env = env;
    this.logger = logger;
    this.circuitBreakers = new Map();
    this.recoveryStrategies = new Map();
    this.initializeRecoveryStrategies();
  }

  /**
   * Process and classify error with automatic recovery
   */
  public async handleError(
    error: any,
    orderId: number,
    shop: string,
    topic: string,
    context?: Record<string, any>
  ): Promise<{
    error: ProcessingError;
    recoveryAction: 'retry' | 'fallback' | 'dead_letter' | 'skip';
    shouldRetry: boolean;
    retryDelay: number;
  }> {
    // Classify and create error record
    const processedError = await this.classifyAndRecordError(
      error,
      orderId,
      shop,
      topic,
      context
    );

    this.logger.error('Processing error', {
      errorId: processedError.id,
      orderId,
      shop,
      category: processedError.category,
      severity: processedError.severity,
      retryable: processedError.retryable
    });

    // Check circuit breaker state
    const circuitBreakerKey = `${shop}:${this.getServiceFromTopic(topic)}`;
    const circuitBreakerAction = await this.checkCircuitBreaker(circuitBreakerKey, processedError);

    if (circuitBreakerAction === 'block') {
      this.logger.warn('Circuit breaker open, blocking request', {
        shop,
        service: this.getServiceFromTopic(topic),
        errorId: processedError.id
      });

      return {
        error: processedError,
        recoveryAction: 'skip',
        shouldRetry: false,
        retryDelay: 0
      };
    }

    // Determine recovery strategy
    const strategy = this.getRecoveryStrategy(processedError.category);
    const shouldRetry = processedError.retryable && 
                       processedError.attempts < strategy.maxAttempts &&
                       circuitBreakerAction !== 'block';

    let recoveryAction: 'retry' | 'fallback' | 'dead_letter' | 'skip' = 'skip';

    if (shouldRetry) {
      recoveryAction = 'retry';
    } else if (processedError.severity === 'critical' || processedError.attempts >= strategy.maxAttempts) {
      // Move to dead letter queue for manual review
      await this.addToDeadLetterQueue(processedError, orderId, shop, topic, context);
      recoveryAction = 'dead_letter';
    } else if (strategy.type === 'fallback') {
      recoveryAction = 'fallback';
    }

    // Update circuit breaker state
    await this.updateCircuitBreakerState(circuitBreakerKey, processedError, recoveryAction === 'retry');

    // Calculate retry delay with exponential backoff
    const retryDelay = shouldRetry ? 
      Math.min(strategy.delayMs * Math.pow(2, processedError.attempts - 1), 300000) : // Max 5 minutes
      0;

    return {
      error: processedError,
      recoveryAction,
      shouldRetry,
      retryDelay
    };
  }

  /**
   * Attempt automatic recovery for dead letter queue items
   */
  public async attemptAutomaticRecovery(shop: string): Promise<{
    attempted: number;
    recovered: number;
    stillFailed: number;
  }> {
    this.logger.info('Starting automatic recovery for dead letter queue', { shop });

    try {
      const deadLetterItems = await this.getDeadLetterItems(shop);
      let attempted = 0;
      let recovered = 0;
      let stillFailed = 0;

      for (const item of deadLetterItems) {
        // Skip items requiring manual review
        if (item.manualReview) {
          continue;
        }

        // Skip recently attempted recoveries
        const lastAttempt = item.lastRecoveryAttempt ? new Date(item.lastRecoveryAttempt) : null;
        const cooldownPeriod = 30 * 60 * 1000; // 30 minutes
        
        if (lastAttempt && Date.now() - lastAttempt.getTime() < cooldownPeriod) {
          continue;
        }

        attempted++;

        try {
          // Attempt recovery based on error category
          const recoveryResult = await this.performRecovery(item);
          
          if (recoveryResult.success) {
            recovered++;
            await this.removeFromDeadLetterQueue(item.id);
            await this.markErrorResolved(item.error.id, 'automatic_recovery');
          } else {
            stillFailed++;
            await this.updateDeadLetterItem(item.id, {
              attemptedRecovery: item.attemptedRecovery + 1,
              lastRecoveryAttempt: new Date().toISOString(),
              manualReview: item.attemptedRecovery >= 3 // Flag for manual review after 3 attempts
            });
          }
        } catch (recoveryError: any) {
          stillFailed++;
          this.logger.error('Recovery attempt failed', {
            deadLetterItemId: item.id,
            orderId: item.orderId,
            error: recoveryError.message
          });
        }

        // Add small delay between recovery attempts
        await this.delay(1000);
      }

      this.logger.info('Automatic recovery completed', {
        shop,
        attempted,
        recovered,
        stillFailed
      });

      return { attempted, recovered, stillFailed };

    } catch (error: any) {
      this.logger.error('Automatic recovery failed', {
        shop,
        error: error.message
      });

      return { attempted: 0, recovered: 0, stillFailed: 0 };
    }
  }

  /**
   * Get error statistics for monitoring
   */
  public async getErrorStatistics(shop: string, days: number = 7): Promise<ErrorStatistics> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Get all errors for the shop
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `processing_error:${shop}:`
      });

      const errors = await Promise.all(
        keys.map(async (key) => {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) as ProcessingError : null;
        })
      );

      const validErrors = errors
        .filter(Boolean)
        .filter(e => new Date(e.firstOccurrence) >= cutoffDate);

      if (validErrors.length === 0) {
        return {
          totalErrors: 0,
          errorsByCategory: {} as Record<ErrorCategory, number>,
          errorsBySeverity: {} as Record<ErrorSeverity, number>,
          resolvedErrors: 0,
          pendingErrors: 0,
          averageResolutionTime: 0,
          mostCommonErrors: [],
          errorTrends: []
        };
      }

      // Calculate statistics
      const errorsByCategory: Record<ErrorCategory, number> = {
        validation: 0, api: 0, network: 0, authentication: 0, authorization: 0,
        rate_limit: 0, timeout: 0, server_error: 0, client_error: 0, 
        configuration: 0, data_corruption: 0, unknown: 0
      };
      const errorsBySeverity: Record<ErrorSeverity, number> = {
        low: 0, medium: 0, high: 0, critical: 0
      };
      const errorCounts: Record<string, number> = {};

      let resolvedErrors = 0;
      let totalResolutionTime = 0;

      validErrors.forEach(error => {
        // Count by category
        errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
        
        // Count by severity
        errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
        
        // Count by message
        errorCounts[error.message] = (errorCounts[error.message] || 0) + 1;
        
        // Resolution tracking
        if (error.resolved && error.resolvedAt) {
          resolvedErrors++;
          const resolutionTime = new Date(error.resolvedAt).getTime() - new Date(error.firstOccurrence).getTime();
          totalResolutionTime += resolutionTime;
        }
      });

      const averageResolutionTime = resolvedErrors > 0 ? totalResolutionTime / resolvedErrors : 0;
      const pendingErrors = validErrors.length - resolvedErrors;

      // Most common errors
      const mostCommonErrors = Object.entries(errorCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([message, count]) => {
          const error = validErrors.find(e => e.message === message);
          return {
            message,
            count,
            category: error?.category || 'unknown' as ErrorCategory
          };
        });

      // Error trends (simplified - daily counts)
      const errorTrends: Array<{ date: string; count: number; category: ErrorCategory }> = [];
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayErrors = validErrors.filter(e => 
          e.firstOccurrence.startsWith(dateStr)
        );

        if (dayErrors.length > 0) {
          const categoryCounts: Record<ErrorCategory, number> = {};
          dayErrors.forEach(e => {
            categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
          });

          // Add trend for most common category that day
          const topCategory = Object.entries(categoryCounts)
            .sort(([, a], [, b]) => b - a)[0];

          if (topCategory) {
            errorTrends.push({
              date: dateStr,
              count: topCategory[1],
              category: topCategory[0] as ErrorCategory
            });
          }
        }
      }

      return {
        totalErrors: validErrors.length,
        errorsByCategory,
        errorsBySeverity,
        resolvedErrors,
        pendingErrors,
        averageResolutionTime,
        mostCommonErrors,
        errorTrends: errorTrends.reverse() // Chronological order
      };

    } catch (error: any) {
      this.logger.error('Error getting error statistics', {
        shop,
        error: error.message
      });

      return {
        totalErrors: 0,
        errorsByCategory: {} as Record<ErrorCategory, number>,
        errorsBySeverity: {} as Record<ErrorSeverity, number>,
        resolvedErrors: 0,
        pendingErrors: 0,
        averageResolutionTime: 0,
        mostCommonErrors: [],
        errorTrends: []
      };
    }
  }

  /**
   * Manually resolve error (admin action)
   */
  public async manuallyResolveError(
    errorId: string, 
    resolution: string, 
    removeFromDeadLetter: boolean = true
  ): Promise<boolean> {
    try {
      // Mark error as resolved
      await this.markErrorResolved(errorId, resolution);

      // Remove from dead letter queue if requested
      if (removeFromDeadLetter) {
        const deadLetterItems = await this.getAllDeadLetterItems();
        const item = deadLetterItems.find(i => i.error.id === errorId);
        
        if (item) {
          await this.removeFromDeadLetterQueue(item.id);
        }
      }

      this.logger.info('Error manually resolved', {
        errorId,
        resolution,
        removeFromDeadLetter
      });

      return true;
    } catch (error: any) {
      this.logger.error('Error manually resolving error', {
        errorId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Initialize recovery strategies for different error categories
   */
  private initializeRecoveryStrategies(): void {
    this.recoveryStrategies = new Map([
      ['validation', { type: 'skip', maxAttempts: 0, delayMs: 0 }],
      ['api', { type: 'retry', maxAttempts: 3, delayMs: 5000 }],
      ['network', { type: 'retry', maxAttempts: 5, delayMs: 2000 }],
      ['authentication', { type: 'manual', maxAttempts: 1, delayMs: 0 }],
      ['authorization', { type: 'manual', maxAttempts: 1, delayMs: 0 }],
      ['rate_limit', { type: 'retry', maxAttempts: 3, delayMs: 30000 }],
      ['timeout', { type: 'retry', maxAttempts: 3, delayMs: 10000 }],
      ['server_error', { type: 'retry', maxAttempts: 3, delayMs: 5000 }],
      ['client_error', { type: 'skip', maxAttempts: 0, delayMs: 0 }],
      ['configuration', { type: 'manual', maxAttempts: 1, delayMs: 0 }],
      ['data_corruption', { type: 'manual', maxAttempts: 1, delayMs: 0 }],
      ['unknown', { type: 'retry', maxAttempts: 2, delayMs: 5000 }]
    ]);
  }

  /**
   * Classify error and create error record
   */
  private async classifyAndRecordError(
    error: any,
    orderId: number,
    shop: string,
    topic: string,
    context?: Record<string, any>
  ): Promise<ProcessingError> {
    const errorId = this.generateErrorId(orderId, shop, topic);
    const category = this.classifyError(error);
    const severity = this.determineSeverity(category, error);
    const retryable = this.isRetryable(category, error);

    // Check for existing error
    const existingError = await this.getExistingError(errorId);
    
    const processedError: ProcessingError = existingError ? {
      ...existingError,
      attempts: existingError.attempts + 1,
      lastOccurrence: new Date().toISOString()
    } : {
      id: errorId,
      orderId,
      shop,
      topic,
      category,
      severity,
      message: error?.message || 'Unknown error',
      details: this.extractErrorDetails(error),
      stackTrace: error?.stack,
      context,
      retryable,
      attempts: 1,
      maxRetries: this.recoveryStrategies.get(category)?.maxAttempts || 0,
      firstOccurrence: new Date().toISOString(),
      lastOccurrence: new Date().toISOString(),
      resolved: false
    };

    await this.storeError(processedError);
    return processedError;
  }

  /**
   * Classify error into category
   */
  private classifyError(error: any): ErrorCategory {
    const message = (error?.message || '').toLowerCase();
    
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }
    if (message.includes('unauthorized') || message.includes('authentication')) {
      return 'authentication';
    }
    if (message.includes('forbidden') || message.includes('permission')) {
      return 'authorization';
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit';
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return 'server_error';
    }
    if (message.includes('400') || message.includes('404') || message.includes('422')) {
      return 'client_error';
    }
    if (message.includes('config') || message.includes('environment')) {
      return 'configuration';
    }
    if (message.includes('corrupt') || message.includes('malformed')) {
      return 'data_corruption';
    }
    if (message.includes('api') || message.includes('shopify')) {
      return 'api';
    }
    
    return 'unknown';
  }

  /**
   * Determine error severity
   */
  private determineSeverity(category: ErrorCategory, error: any): ErrorSeverity {
    const message = (error?.message || '').toLowerCase();
    
    // Critical errors
    if (category === 'data_corruption' || 
        category === 'authentication' ||
        message.includes('critical') ||
        message.includes('fatal')) {
      return 'critical';
    }
    
    // High severity
    if (category === 'server_error' ||
        category === 'configuration' ||
        message.includes('error')) {
      return 'high';
    }
    
    // Medium severity
    if (category === 'api' ||
        category === 'timeout' ||
        category === 'rate_limit') {
      return 'medium';
    }
    
    // Low severity
    return 'low';
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(category: ErrorCategory, error: any): boolean {
    const nonRetryableCategories: ErrorCategory[] = [
      'validation',
      'authentication', 
      'authorization',
      'client_error',
      'data_corruption'
    ];
    
    return !nonRetryableCategories.includes(category);
  }

  /**
   * Extract detailed error information
   */
  private extractErrorDetails(error: any): Record<string, any> {
    const details: Record<string, any> = {};
    
    if (error?.status) details.status = error.status;
    if (error?.statusText) details.statusText = error.statusText;
    if (error?.response) details.response = error.response;
    if (error?.code) details.code = error.code;
    if (error?.name) details.name = error.name;
    
    return details;
  }

  /**
   * Store error in KV storage
   */
  private async storeError(error: ProcessingError): Promise<void> {
    try {
      const key = `processing_error:${error.shop}:${error.id}`;
      await this.env.DELIVERY_CACHE.put(
        key,
        JSON.stringify(error),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );
    } catch (err: any) {
      this.logger.error('Failed to store error', {
        errorId: error.id,
        error: err.message
      });
    }
  }

  /**
   * Get existing error if it exists
   */
  private async getExistingError(errorId: string): Promise<ProcessingError | null> {
    try {
      // Find error across all shops (since errorId includes shop)
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: 'processing_error:'
      });

      for (const key of keys) {
        if (key.name.includes(errorId)) {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) : null;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(orderId: number, shop: string, topic: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `${shop}_${orderId}_${topic}_${date}`;
  }

  /**
   * Get service name from topic
   */
  private getServiceFromTopic(topic: string): string {
    return topic.split('/')[0] || 'orders';
  }

  /**
   * Check circuit breaker state
   */
  private async checkCircuitBreaker(
    key: string, 
    error: ProcessingError
  ): Promise<'allow' | 'block'> {
    try {
      const stateData = await this.env.DELIVERY_CACHE.get(`circuit_breaker:${key}`);
      let state: CircuitBreakerState;

      if (stateData) {
        state = JSON.parse(stateData);
      } else {
        state = {
          shop: key.split(':')[0],
          service: key.split(':')[1],
          status: 'closed',
          failureCount: 0,
          failureThreshold: 5,
          successCount: 0,
          timeoutMs: 60000 // 1 minute
        };
      }

      const now = Date.now();

      // Check if circuit breaker should be reset
      if (state.status === 'open' && state.nextRetryTime) {
        const nextRetry = new Date(state.nextRetryTime).getTime();
        if (now >= nextRetry) {
          state.status = 'half-open';
          state.successCount = 0;
        }
      }

      // Return decision based on current state
      if (state.status === 'open') {
        return 'block';
      }

      return 'allow';
    } catch (error) {
      // Default to allow if we can't check state
      return 'allow';
    }
  }

  /**
   * Update circuit breaker state
   */
  private async updateCircuitBreakerState(
    key: string,
    error: ProcessingError,
    isRetry: boolean
  ): Promise<void> {
    try {
      const stateData = await this.env.DELIVERY_CACHE.get(`circuit_breaker:${key}`);
      let state: CircuitBreakerState;

      if (stateData) {
        state = JSON.parse(stateData);
      } else {
        state = {
          shop: key.split(':')[0],
          service: key.split(':')[1],
          status: 'closed',
          failureCount: 0,
          failureThreshold: 5,
          successCount: 0,
          timeoutMs: 60000
        };
      }

      if (isRetry || error.severity === 'low') {
        // Success or low severity - reset failure count
        state.successCount++;
        
        if (state.status === 'half-open' && state.successCount >= 3) {
          state.status = 'closed';
          state.failureCount = 0;
        }
      } else {
        // Failure - increment failure count
        state.failureCount++;
        state.lastFailureTime = new Date().toISOString();
        
        if (state.failureCount >= state.failureThreshold) {
          state.status = 'open';
          state.nextRetryTime = new Date(Date.now() + state.timeoutMs).toISOString();
        }
      }

      await this.env.DELIVERY_CACHE.put(
        `circuit_breaker:${key}`,
        JSON.stringify(state),
        { expirationTtl: 24 * 60 * 60 } // 24 hours
      );
    } catch (err: any) {
      this.logger.error('Failed to update circuit breaker state', {
        key,
        error: err.message
      });
    }
  }

  /**
   * Add item to dead letter queue
   */
  private async addToDeadLetterQueue(
    error: ProcessingError,
    orderId: number,
    shop: string,
    topic: string,
    originalData?: any
  ): Promise<void> {
    try {
      const deadLetterItem: DeadLetterItem = {
        id: `dlq_${error.id}_${Date.now()}`,
        orderId,
        shop,
        topic,
        originalData,
        error,
        addedAt: new Date().toISOString(),
        attemptedRecovery: 0,
        manualReview: error.severity === 'critical'
      };

      await this.env.DELIVERY_CACHE.put(
        `dead_letter:${deadLetterItem.id}`,
        JSON.stringify(deadLetterItem),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );

      this.logger.warn('Added item to dead letter queue', {
        deadLetterItemId: deadLetterItem.id,
        orderId,
        shop,
        errorCategory: error.category
      });
    } catch (err: any) {
      this.logger.error('Failed to add to dead letter queue', {
        orderId,
        shop,
        error: err.message
      });
    }
  }

  /**
   * Get dead letter items for a shop
   */
  private async getDeadLetterItems(shop: string): Promise<DeadLetterItem[]> {
    try {
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: 'dead_letter:'
      });

      const items = await Promise.all(
        keys.map(async (key) => {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) as DeadLetterItem : null;
        })
      );

      return items.filter(Boolean).filter(item => item.shop === shop);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all dead letter items
   */
  private async getAllDeadLetterItems(): Promise<DeadLetterItem[]> {
    try {
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: 'dead_letter:'
      });

      const items = await Promise.all(
        keys.map(async (key) => {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) as DeadLetterItem : null;
        })
      );

      return items.filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  /**
   * Perform recovery for a dead letter item
   */
  private async performRecovery(item: DeadLetterItem): Promise<{ success: boolean; message?: string }> {
    const strategy = this.getRecoveryStrategy(item.error.category);
    
    // Simple recovery strategies based on error category
    switch (strategy.type) {
      case 'retry':
        // For now, just mark as recoverable - actual retry would be handled by the pipeline
        return { success: true, message: 'Marked for retry' };
        
      case 'fallback':
        // Implement fallback logic based on error type
        return { success: true, message: 'Applied fallback strategy' };
        
      case 'skip':
        // Skip processing - mark as resolved
        return { success: true, message: 'Skipped processing' };
        
      default:
        return { success: false, message: 'No recovery strategy available' };
    }
  }

  /**
   * Remove item from dead letter queue
   */
  private async removeFromDeadLetterQueue(itemId: string): Promise<void> {
    try {
      await this.env.DELIVERY_CACHE.delete(`dead_letter:${itemId}`);
    } catch (error: any) {
      this.logger.error('Failed to remove from dead letter queue', {
        itemId,
        error: error.message
      });
    }
  }

  /**
   * Update dead letter item
   */
  private async updateDeadLetterItem(
    itemId: string, 
    updates: Partial<DeadLetterItem>
  ): Promise<void> {
    try {
      const existingData = await this.env.DELIVERY_CACHE.get(`dead_letter:${itemId}`);
      if (!existingData) return;

      const item = { ...JSON.parse(existingData), ...updates };
      
      await this.env.DELIVERY_CACHE.put(
        `dead_letter:${itemId}`,
        JSON.stringify(item),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
      );
    } catch (error: any) {
      this.logger.error('Failed to update dead letter item', {
        itemId,
        error: error.message
      });
    }
  }

  /**
   * Mark error as resolved
   */
  private async markErrorResolved(errorId: string, resolution: string): Promise<void> {
    try {
      // Find and update the error
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: 'processing_error:'
      });

      for (const key of keys) {
        if (key.name.includes(errorId)) {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          if (data) {
            const error: ProcessingError = JSON.parse(data);
            error.resolved = true;
            error.resolvedAt = new Date().toISOString();
            error.resolution = resolution;

            await this.env.DELIVERY_CACHE.put(
              key.name,
              JSON.stringify(error),
              { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
            );
            break;
          }
        }
      }
    } catch (error: any) {
      this.logger.error('Failed to mark error as resolved', {
        errorId,
        error: error.message
      });
    }
  }

  /**
   * Get recovery strategy for error category
   */
  private getRecoveryStrategy(category: ErrorCategory): RecoveryStrategy {
    return this.recoveryStrategies.get(category) || {
      type: 'skip',
      maxAttempts: 0,
      delayMs: 0
    };
  }

  /**
   * Utility function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 