import { DeliveryDate, CacheEntry } from '../types/common';
import { Env, WorkerConfig } from '../types/env';
import { generateMockDeliveryDates } from '../utils/mockDataGenerator';
import { fetchDeliveryDatesFromAPI } from '../api/dutchNedClient';
import { requireAuthentication, SessionRequest } from '../middleware/sessionAuth';
import { WorkersLogger } from '../utils/logger';

/**
 * Get delivery dates with KV caching and retry logic
 * Migrated from Express backend to Cloudflare Workers
 */
export async function getDeliveryDates(
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<DeliveryDate[]> {
  const startTime = Date.now();
  const cacheKey = 'delivery-dates';

  if (logger && config.features.enableRequestLogging) {
    logger.info('Starting getDeliveryDates service', {
      requestId,
      timestamp: startTime,
      useMockData: config.features.useMockData,
      cachingEnabled: config.features.enableCaching
    });
  }

  // Check if mock data should be used
  if (config.features.useMockData) {
    if (logger) {
      logger.info('Using mock delivery dates (USE_MOCK_DELIVERY_DATES=true)', { requestId });
    }
    const mockData = generateMockDeliveryDates();

    if (logger && config.features.enableRequestLogging) {
      logger.info(`Generated ${mockData.length} mock delivery dates`, {
        requestId,
        count: mockData.length,
        executionTime: Date.now() - startTime
      });
    }
    return mockData;
  }

  // Check KV cache first if caching is enabled
  if (config.features.enableCaching && env.DELIVERY_CACHE) {
    try {
      const cachedEntry = await env.DELIVERY_CACHE.get(cacheKey, { type: 'json' }) as CacheEntry<DeliveryDate[]> | null;

      if (cachedEntry && isValidCache(cachedEntry, config.cache.duration)) {
        if (logger && config.features.enableRequestLogging) {
          logger.info('Returning cached delivery dates', {
            requestId,
            cacheAge: Date.now() - cachedEntry.timestamp,
            executionTime: Date.now() - startTime,
            cached: true
          });
        }
        return cachedEntry.data;
      }
    } catch (cacheError: any) {
      if (logger) {
        logger.warn('Failed to read from KV cache', {
          requestId,
          error: cacheError.message,
          cacheKey
        });
      }
    }
  }

  try {
    // Attempt to fetch from external API with retry logic
    const deliveryDates = await fetchDeliveryDatesWithRetry(env, config, logger, requestId);

    // Cache the successful result in KV if caching is enabled
    if (config.features.enableCaching && env.DELIVERY_CACHE) {
      try {
        const cacheEntry: CacheEntry<DeliveryDate[]> = {
          data: deliveryDates,
          timestamp: Date.now(),
          ttl: config.cache.duration,
          version: '1.0'
        };

        await env.DELIVERY_CACHE.put(cacheKey, JSON.stringify(cacheEntry), {
          expirationTtl: Math.floor(config.cache.duration / 1000) // Convert to seconds
        });

        if (logger && config.features.enableRequestLogging) {
          logger.info('Successfully cached delivery dates in KV', {
            requestId,
            cacheKey,
            ttl: config.cache.duration
          });
        }
      } catch (cacheError: any) {
        if (logger) {
          logger.warn('Failed to write to KV cache', {
            requestId,
            error: cacheError.message,
            cacheKey
          });
        }
      }
    }

    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully fetched and cached delivery dates', {
        requestId,
        count: deliveryDates.length,
        executionTime: Date.now() - startTime,
        cached: false,
        source: 'api'
      });
    }

    return deliveryDates;
  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    if (logger) {
      logger.error('All attempts to fetch delivery dates failed, falling back to mock data', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        executionTime,
        fallbackUsed: true
      });
    }

    // Fallback to mock data when API consistently fails
    if (config.features.enableMockFallback) {
      const mockData = generateMockDeliveryDates();

      if (logger && config.features.enableRequestLogging) {
        logger.info(`Returning ${mockData.length} fallback mock delivery dates`, {
          requestId,
          count: mockData.length,
          executionTime,
          fallback: true,
          source: 'mock'
        });
      }

      return mockData;
    } else {
      // If mock fallback is disabled, re-throw the error
      throw error;
    }
  }
}

/**
 * Fetch delivery dates with retry logic
 * Migrated from Express backend with exponential backoff
 */
async function fetchDeliveryDatesWithRetry(
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<DeliveryDate[]> {
  const maxRetries = config.dutchNedApi.maxRetries;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();

    try {
      if (logger && config.features.enableRequestLogging) {
        logger.info(`Attempting to fetch delivery dates (attempt ${attempt}/${maxRetries})`, {
          requestId,
          attempt,
          timestamp: attemptStartTime
        });
      }

      const deliveryDates = await fetchDeliveryDatesFromAPI(env, config, logger, requestId);

      if (logger && config.features.enableRequestLogging) {
        logger.info(`Successfully fetched delivery dates on attempt ${attempt}`, {
          requestId,
          attempt,
          count: deliveryDates.length,
          responseTime: Date.now() - attemptStartTime
        });
      }

      return deliveryDates;
    } catch (error: any) {
      lastError = error;
      const responseTime = Date.now() - attemptStartTime;

      if (logger) {
        logger.warn(`Attempt ${attempt} failed to fetch delivery dates`, {
          requestId,
          attempt,
          error: error.message,
          responseTime,
          willRetry: attempt < maxRetries
        });
      }

      // Don't wait after the last attempt
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;

        if (logger && config.features.enableRequestLogging) {
          logger.info(`Waiting ${waitTime}ms before retry`, {
            requestId,
            waitTime,
            nextAttempt: attempt + 1
          });
        }

        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * Check if cache entry is still valid
 */
function isValidCache(entry: CacheEntry<any>, cacheDuration: number): boolean {
  if (!entry || !entry.timestamp) {
    return false;
  }

  const age = Date.now() - entry.timestamp;
  return age < cacheDuration;
}

/**
 * Get delivery dates and return formatted response
 * This is the main handler function for the Workers endpoint
 * NOW REQUIRES OAUTH AUTHENTICATION - NO MORE PUBLIC ACCESS
 */
export async function handleDeliveryDatesRequest(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: WorkersLogger,
  requestId?: string
): Promise<Response> {
  const startTime = Date.now();

  // SECURITY: Require valid OAuth session for delivery dates API
  if (!logger) {
    logger = new WorkersLogger(env, config);
  }

  const authResult = await requireAuthentication(request, env, config, logger, requestId || 'unknown');
  
  // If authentication failed, return the error response
  if (authResult instanceof Response) {
    logger.warn('Delivery dates API access denied - authentication required', {
      requestId,
      path: new URL(request.url).pathname,
      userAgent: request.headers.get('User-Agent') ?? undefined
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
  
  // Extract query parameters
  const postalCode = url.searchParams.get('postalCode');
  const country = url.searchParams.get('country');

  // Log authenticated request
  logger.info('Authenticated delivery dates request', {
    requestId,
    shop: shopDomain,
    postalCode,
    country,
    sessionId: authenticatedRequest.sessionId
  });

  try {
    const deliveryDates = await getDeliveryDates(env, config, logger, requestId);

    const responseData = {
      success: true,
      data: deliveryDates,
      cached: false, // Will be updated if from cache
      source: config.features.useMockData ? 'mock' : 'api',
      shop: shopDomain, // Include shop context in response
      requestId,
      timestamp: new Date().toISOString(),
      ...(config.features.enableVerboseResponses && {
        metadata: {
          postalCode,
          country,
          executionTime: Date.now() - startTime,
          cacheEnabled: config.features.enableCaching,
          fallbackEnabled: config.features.enableMockFallback,
          authenticatedShop: shopDomain
        }
      })
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(config.features.enablePerformanceMonitoring && {
          'X-Response-Time': `${Date.now() - startTime}ms`,
          'X-Cache-Status': 'MISS',
          'X-Shop-Context': shopDomain
        })
      }
    });

  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    logger.error('Failed to handle authenticated delivery dates request', {
      requestId,
      shop: shopDomain,
      error: error.message,
      errorStack: error.stack,
      executionTime,
      postalCode,
      country
    });

    const errorResponse = {
      success: false,
      error: 'API_ERROR',
      message: config.features.enableDetailedErrors
        ? error.message
        : 'Failed to fetch delivery dates',
      shop: shopDomain,
      requestId,
      timestamp: new Date().toISOString(),
      ...(config.features.enableVerboseResponses && {
        metadata: {
          executionTime,
          postalCode,
          country,
          authenticatedShop: shopDomain
        }
      })
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...(config.features.enablePerformanceMonitoring && {
          'X-Response-Time': `${Date.now() - startTime}ms`,
          'X-Shop-Context': shopDomain
        })
      }
    });
  }
}