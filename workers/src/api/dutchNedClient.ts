import { DeliveryDate } from '../types/common';
import { Env, WorkerConfig } from '../types/env';

/**
 * Fetch delivery dates from DutchNed API
 * Migrated from Express backend to Cloudflare Workers
 * Uses native Workers fetch API with built-in AbortController
 */
export async function fetchDeliveryDatesFromAPI(
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<DeliveryDate[]> {
  const apiUrl = config.dutchNedApi.url;
  const credentials = config.dutchNedApi.credentials;
  const apiTimeout = config.dutchNedApi.timeout;
  const requestStartTime = Date.now();

  // Validate required configuration
  if (!apiUrl) {
    throw new Error('DUTCHNED_API_URL is not configured');
  }

  if (!credentials) {
    throw new Error('DUTCHNED_API_CREDENTIALS is not configured');
  }

  // Create AbortController for timeout (built-in to Workers)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, apiTimeout);

  try {
    if (logger && config.features.enableRequestLogging) {
      logger.info('Making request to DutchNed API', {
        requestId,
        url: apiUrl,
        timeout: apiTimeout,
        timestamp: requestStartTime,
        hasCredentials: !!credentials
      });
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
        'User-Agent': 'WOOOD-Delivery-API/1.0 (Cloudflare Workers)',
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - requestStartTime;

    if (logger && config.features.enableRequestLogging) {
      logger.info('Received response from DutchNed API', {
        requestId,
        status: response.status,
        statusText: response.statusText,
        responseTime,
        ok: response.ok,
        headers: {
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length')
        }
      });
    }

    if (!response.ok) {
      let errorText = 'Unknown error';
      try {
        errorText = await response.text();
      } catch (parseError) {
        // If we can't read the error text, use the status
        errorText = `HTTP ${response.status}: ${response.statusText}`;
      }

      if (logger) {
        logger.error('DutchNed API request failed with non-OK status', {
          requestId,
          status: response.status,
          statusText: response.statusText,
          responseTime,
          errorBody: errorText.substring(0, 1000) // Limit error body size for logging
        });
      }

      throw new Error(`DutchNed API request failed with status: ${response.status} ${response.statusText}`);
    }

    let apiData: any;
    try {
      apiData = await response.json();
    } catch (parseError: any) {
      if (logger) {
        logger.error('Failed to parse DutchNed API response as JSON', {
          requestId,
          responseTime,
          error: parseError.message,
          contentType: response.headers.get('content-type')
        });
      }
      throw new Error('Invalid JSON response from DutchNed API');
    }

    if (logger && config.features.enableRequestLogging) {
      logger.info('Successfully parsed DutchNed API response', {
        requestId,
        responseTime,
        dataType: Array.isArray(apiData) ? 'array' : typeof apiData,
        dataLength: Array.isArray(apiData) ? apiData.length : 'N/A'
      });
    }

    return formatApiResponse(apiData, logger, requestId);
  } catch (error: any) {
    clearTimeout(timeoutId);
    const responseTime = Date.now() - requestStartTime;

    if (error.name === 'AbortError') {
      if (logger) {
        logger.error('DutchNed API request timed out', {
          requestId,
          timeout: apiTimeout,
          responseTime,
          error: 'Request aborted due to timeout'
        });
      }
      throw new Error(`DutchNed API request timed out after ${apiTimeout}ms`);
    }

    if (logger) {
      logger.error('DutchNed API request failed with error', {
        requestId,
        error: error.message,
        errorName: error.name,
        errorStack: error.stack,
        responseTime,
        url: apiUrl
      });
    }

    throw error;
  }
}

/**
 * Format API response data into DeliveryDate objects
 * Enhanced with better error handling and validation
 */
function formatApiResponse(apiData: any, logger?: any, requestId?: string): DeliveryDate[] {
  const dates: DeliveryDate[] = [];

  if (!Array.isArray(apiData)) {
    if (logger) {
      logger.warn('DutchNed API response is not an array', {
        requestId,
        dataType: typeof apiData,
        data: typeof apiData === 'object' ? JSON.stringify(apiData).substring(0, 500) : apiData
      });
    }

    // Try to extract array from object wrapper if it exists
    if (apiData && typeof apiData === 'object') {
      // Common API response patterns
      const possibleArrays = ['data', 'dates', 'results', 'items'];
      for (const key of possibleArrays) {
        if (Array.isArray(apiData[key])) {
          if (logger) {
            logger.info(`Found array data in response.${key}`, {
              requestId,
              arrayLength: apiData[key].length
            });
          }
          return formatApiResponse(apiData[key], logger, requestId);
        }
      }
    }

    return dates;
  }

  let validCount = 0;
  let invalidCount = 0;

  for (const item of apiData) {
    if (item && item.date) {
      try {
        const date = new Date(item.date);
        if (!isNaN(date.getTime())) {
          // Use provided displayName or generate one
          let displayName = item.displayName;
          if (!displayName) {
            displayName = formatDateInDutch(date);
          }

          dates.push({
            date: item.date, // Keep original format from API
            displayName: displayName
          });
          validCount++;
        } else {
          if (logger) {
            logger.warn('Invalid date found in API response', {
              requestId,
              invalidDate: item.date,
              item: JSON.stringify(item).substring(0, 200)
            });
          }
          invalidCount++;
        }
      } catch (dateError: any) {
        if (logger) {
          logger.warn('Error processing date from API response', {
            requestId,
            error: dateError.message,
            item: JSON.stringify(item).substring(0, 200)
          });
        }
        invalidCount++;
      }
    } else {
      if (logger) {
        logger.warn('Invalid item found in API response (missing date)', {
          requestId,
          item: JSON.stringify(item).substring(0, 200)
        });
      }
      invalidCount++;
    }
  }

  if (logger) {
    logger.info(`Formatted delivery dates from API response`, {
      requestId,
      validCount,
      invalidCount,
      totalProcessed: apiData.length,
      finalCount: dates.length
    });
  }

  return dates;
}

/**
 * Format date in Dutch locale for display
 * Utility function for API response formatting
 */
function formatDateInDutch(date: Date): string {
  try {
    return new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    // Fallback formatting
    const weekdays = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

    const weekday = weekdays[date.getDay()] || 'onbekend';
    const day = date.getDate();
    const month = months[date.getMonth()] || 'onbekend';

    return `${weekday} ${day} ${month}`;
  }
}

/**
 * Test DutchNed API connection
 * Utility function for health checks and diagnostics
 */
export async function testDutchNedAPIConnection(
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<{ success: boolean; message: string; responseTime?: number }> {
  const startTime = Date.now();

  try {
    // Quick test with shorter timeout
    const testConfig = {
      ...config,
      dutchNedApi: {
        ...config.dutchNedApi,
        timeout: 5000 // 5 second timeout for health check
      }
    };

    await fetchDeliveryDatesFromAPI(env, testConfig, logger, requestId);

    const responseTime = Date.now() - startTime;
    return {
      success: true,
      message: 'DutchNed API connection successful',
      responseTime
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      message: `DutchNed API connection failed: ${error.message}`,
      responseTime
    };
  }
}