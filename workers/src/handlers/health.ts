import { Env, WorkerConfig } from '../types/env';
import { HealthCheckResponse } from '../types/common';
import { testDutchNedAPIConnection } from '../api/dutchNedClient';

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify({
    success: true,
    ...data,
    timestamp: new Date().toISOString()
  }), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  }), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Handle health check requests
 * Main handler for /health endpoint
 */
export async function handleHealthCheck(
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Response> {
  const startTime = Date.now();
  
  try {
    const healthData: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.environment,
      ...(requestId && { requestId }),
      services: {
        cache: 'unknown',
        rateLimiter: 'unknown',
        dutchNedApi: 'unknown'
      }
    };

    // Test KV cache availability
    if (env.DELIVERY_CACHE) {
      try {
        await env.DELIVERY_CACHE.put('health-check', 'test', { expirationTtl: 60 });
        await env.DELIVERY_CACHE.delete('health-check');
        healthData.services!.cache = 'available';
      } catch (cacheError) {
        healthData.services!.cache = 'unavailable';
        if (logger) {
          logger.warn('Cache health check failed', {
            requestId,
            error: (cacheError as Error).message
          });
        }
      }
    }

    // Test Rate Limiter availability
    if (env.RATE_LIMITER) {
      try {
        // Simple test - just check if the binding exists
        healthData.services!.rateLimiter = 'available';
      } catch (rateLimiterError) {
        healthData.services!.rateLimiter = 'unavailable';
        if (logger) {
          logger.warn('Rate limiter health check failed', {
            requestId,
            error: (rateLimiterError as Error).message
          });
        }
      }
    }

    // Test DutchNed API connection
    try {
      const apiTest = await testDutchNedAPIConnection(env, config, logger, requestId);
      healthData.services!.dutchNedApi = apiTest.success ? 'available' : 'unavailable';
      
      if (logger && config.features.enableRequestLogging) {
        logger.info('DutchNed API health check completed', {
          requestId,
          success: apiTest.success,
          message: apiTest.message,
          responseTime: apiTest.responseTime
        });
      }
    } catch (apiError) {
      healthData.services!.dutchNedApi = 'unavailable';
      if (logger) {
        logger.warn('DutchNed API health check failed', {
          requestId,
          error: (apiError as Error).message
        });
      }
    }

    // Determine overall health status
    const services = healthData.services!;
    const hasUnavailableServices = Object.values(services).some(status => status === 'unavailable');
    
    if (hasUnavailableServices) {
      healthData.status = 'unhealthy';
    }

    const executionTime = Date.now() - startTime;
    
    if (logger && config.features.enableRequestLogging) {
      logger.info('Health check completed', {
        requestId,
        status: healthData.status,
        executionTime,
        services: healthData.services
      });
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (config.features.enablePerformanceMonitoring) {
      responseHeaders['X-Response-Time'] = `${executionTime}ms`;
      responseHeaders['X-Health-Check-Time'] = new Date().toISOString();
    }

    return new Response(JSON.stringify(healthData), {
      status: healthData.status === 'healthy' ? 200 : 503,
      headers: responseHeaders
    });

  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    if (logger) {
      logger.error('Health check failed with error', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        executionTime
      });
    }

    const errorResponse: HealthCheckResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.environment,
      ...(requestId && { requestId })
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        ...(config.features.enablePerformanceMonitoring && {
          'X-Response-Time': `${executionTime}ms`
        })
      }
    });
  }
} 