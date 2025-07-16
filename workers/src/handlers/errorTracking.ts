import { Env, WorkerConfig } from '../types/env';
import { ErrorTrackingData, ErrorTrackingResult } from '../types/common';

/**
 * Handle error tracking requests
 * Main handler for /api/errors/track endpoint
 */
export async function handleErrorTracking(
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

    let data: ErrorTrackingData;
    try {
      data = await request.json() as ErrorTrackingData;
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

    const result = await trackError(data, env, config, logger, requestId);
    
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
      logger.error('Failed to handle error tracking request', {
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
 * Track and store error information
 */
async function trackError(
  data: ErrorTrackingData,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<ErrorTrackingResult> {
  const startTime = Date.now();
  const internalRequestId = requestId || crypto.randomUUID();
  const errorId = crypto.randomUUID();

  if (logger && config.features.enableErrorTracking) {
    logger.info('Tracking frontend error', {
      requestId: internalRequestId,
      errorId,
      error: data.error,
      message: data.message,
      hasStack: !!data.stack,
      hasUrl: !!data.url,
      hasUserAgent: !!data.userAgent,
      startTime
    });
  }

  try {
    // Validate input data
    const validationResult = validateErrorTrackingData(data);
    if (!validationResult.isValid) {
      if (logger) {
        logger.error('Invalid error tracking data', {
          requestId: internalRequestId,
          errorId,
          errors: validationResult.errors,
          data: sanitizeErrorDataForLogging(data)
        });
      }
      return {
        success: false,
        message: 'Invalid error tracking data',
        errorId,
        requestId: internalRequestId,
        timestamp: new Date().toISOString()
      };
    }

    // Prepare error data for storage
    const errorData = {
      errorId,
      requestId: internalRequestId,
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
      trackedAt: new Date().toISOString(),
      additionalContext: {
        ...data.additionalContext,
        workerVersion: '1.0.0',
        environment: config.environment
      }
    };

    // Log the error
    if (logger) {
      logger.error('Frontend error tracked', {
        errorId,
        requestId: internalRequestId,
        error: data.error,
        message: data.message,
        url: data.url,
        userAgent: data.userAgent ? data.userAgent.substring(0, 100) : undefined,
        stack: data.stack ? data.stack.substring(0, 500) : undefined
      });
    }

    // Store error in KV for analysis (if error tracking is enabled)
    if (config.features.enableErrorTracking && env.DELIVERY_CACHE) {
      try {
        const storageKey = `error:${errorId}`;
        await env.DELIVERY_CACHE.put(
          storageKey,
          JSON.stringify(errorData),
          {
            expirationTtl: 30 * 24 * 60 * 60 // 30 days for error analysis
          }
        );

        if (logger && config.features.enableRequestLogging) {
          logger.info('Successfully stored error in KV', {
            requestId: internalRequestId,
            errorId,
            storageKey,
            ttl: 30 * 24 * 60 * 60
          });
        }
      } catch (storageError: any) {
        if (logger) {
          logger.warn('Failed to store error in KV', {
            requestId: internalRequestId,
            errorId,
            error: storageError.message
          });
        }
        // Don't fail the request if storage fails
      }
    }

    // Send to external error reporting service if configured
    if (config.features.enableExternalErrorReporting && config.endpoints.errorTracking) {
      try {
        await sendToExternalErrorService(errorData, config, logger, internalRequestId);
      } catch (externalError: any) {
        if (logger) {
          logger.warn('Failed to send error to external service', {
            requestId: internalRequestId,
            errorId,
            error: externalError.message
          });
        }
        // Don't fail the request if external service fails
      }
    }

    const executionTime = Date.now() - startTime;
    
    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully tracked error', {
        requestId: internalRequestId,
        errorId,
        executionTime,
        stored: config.features.enableErrorTracking,
        externalReported: config.features.enableExternalErrorReporting
      });
    }

    return {
      success: true,
      errorId,
      message: 'Error tracked successfully',
      requestId: internalRequestId,
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    if (logger) {
      logger.error('Error tracking frontend error', {
        requestId: internalRequestId,
        errorId,
        error: error.message,
        errorStack: error.stack,
        executionTime,
        originalError: data.error
      });
    }

    return {
      success: false,
      message: 'Failed to track error',
      errorId,
      requestId: internalRequestId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Validate error tracking data
 */
function validateErrorTrackingData(data: ErrorTrackingData): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('data must be an object');
    return { isValid: false, errors };
  }

  if (!data.error || typeof data.error !== 'string') {
    errors.push('error is required and must be a string');
  }

  if (!data.message || typeof data.message !== 'string') {
    errors.push('message is required and must be a string');
  }

  if (!data.timestamp || typeof data.timestamp !== 'string') {
    errors.push('timestamp is required and must be a string');
  } else {
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) {
      errors.push('timestamp must be a valid ISO date string');
    }
  }

  if (data.stack && typeof data.stack !== 'string') {
    errors.push('stack must be a string if provided');
  }

  if (data.userAgent && typeof data.userAgent !== 'string') {
    errors.push('userAgent must be a string if provided');
  }

  if (data.url && typeof data.url !== 'string') {
    errors.push('url must be a string if provided');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize error data for logging (limit stack trace and URL length)
 */
function sanitizeErrorDataForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };
  
  // Limit stack trace length for logging
  if (sanitized.stack && sanitized.stack.length > 1000) {
    sanitized.stack = sanitized.stack.substring(0, 1000) + '... [truncated]';
  }
  
  // Limit URL length for logging
  if (sanitized.url && sanitized.url.length > 500) {
    sanitized.url = sanitized.url.substring(0, 500) + '... [truncated]';
  }
  
  // Limit user agent length for logging
  if (sanitized.userAgent && sanitized.userAgent.length > 200) {
    sanitized.userAgent = sanitized.userAgent.substring(0, 200) + '... [truncated]';
  }
  
  return sanitized;
}

/**
 * Send error to external error reporting service
 */
async function sendToExternalErrorService(
  errorData: any,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<void> {
  if (!config.endpoints.errorTracking) {
    return;
  }

  try {
    const response = await fetch(config.endpoints.errorTracking, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WOOOD-Delivery-API/1.0 (Cloudflare Workers)'
      },
      body: JSON.stringify({
        service: 'woood-delivery-api',
        environment: config.environment,
        ...errorData
      })
    });

    if (!response.ok) {
      throw new Error(`External error service responded with status ${response.status}`);
    }

    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully sent error to external service', {
        requestId,
        errorId: errorData.errorId,
        endpoint: config.endpoints.errorTracking,
        status: response.status
      });
    }
  } catch (error: any) {
    if (logger) {
      logger.warn('Failed to send error to external service', {
        requestId,
        errorId: errorData.errorId,
        endpoint: config.endpoints.errorTracking,
        error: error.message
      });
    }
    throw error;
  }
} 