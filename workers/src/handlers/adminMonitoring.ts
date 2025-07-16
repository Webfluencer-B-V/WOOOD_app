import { Env, WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { Session } from '../types/session';

/**
 * System health response interface
 */
interface SystemHealth {
  shop: string;
  timestamp: string;
  services: {
    dutchned_api: ServiceStatus;
    shopify_admin_api: ServiceStatus;
    kv_storage: ServiceStatus;
    webhook_processing: ServiceStatus;
  };
  performance: {
    average_response_time: number;
    request_count_24h: number;
    error_rate_24h: number;
    cache_hit_rate: number;
  };
  feature_flags: Record<string, boolean>;
}

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'error';
  response_time?: number;
  last_check: string;
  error?: string;
}

/**
 * Test DutchNed API connection
 */
async function testDutchNedConnection(env: Env, config: WorkerConfig): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(config.dutchNedApi.url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${config.dutchNedApi.credentials}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'healthy',
        response_time: responseTime,
        last_check: new Date().toISOString()
      };
    } else {
      return {
        status: 'degraded',
        response_time: responseTime,
        last_check: new Date().toISOString(),
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    return {
      status: 'error',
      response_time: Date.now() - startTime,
      last_check: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Test Shopify Admin API connection
 */
async function testShopifyAdminAPI(session: Session, config: WorkerConfig): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const response = await fetch(`https://${session.shop}/admin/api/${config.shopifyOAuth.apiVersion}/shop.json`, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': session.accessToken || '',
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'healthy',
        response_time: responseTime,
        last_check: new Date().toISOString()
      };
    } else {
      return {
        status: 'degraded',
        response_time: responseTime,
        last_check: new Date().toISOString(),
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    return {
      status: 'error',
      response_time: Date.now() - startTime,
      last_check: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Test KV storage functionality
 */
async function testKVStorage(env: Env): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const testKey = `health_check:${Date.now()}`;
    const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() });

    // Test write
    await env.WOOOD_KV.put(testKey, testValue);

    // Test read
    const retrievedValue = await env.WOOOD_KV.get(testKey);

    // Test delete
    await env.WOOOD_KV.delete(testKey);

    const responseTime = Date.now() - startTime;

    if (retrievedValue === testValue) {
      return {
        status: 'healthy',
        response_time: responseTime,
        last_check: new Date().toISOString()
      };
    } else {
      return {
        status: 'degraded',
        response_time: responseTime,
        last_check: new Date().toISOString(),
        error: 'KV read/write mismatch'
      };
    }
  } catch (error) {
    return {
      status: 'error',
      response_time: Date.now() - startTime,
      last_check: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get webhook processing health
 */
async function getWebhookProcessingHealth(shop: string, env: Env): Promise<ServiceStatus> {
  try {
    // Check recent webhook processing activity
    const recentKey = `webhook_stats:${shop}:recent`;
    const recentStats = await env.WOOOD_KV.get(recentKey, 'json') || { processed: 0, errors: 0, last_processed: null };

    // Consider healthy if we've processed webhooks recently or have no errors
    const isHealthy = recentStats.errors === 0 || (recentStats.processed > 0 && recentStats.errors / recentStats.processed < 0.1);

    const result: ServiceStatus = {
      status: isHealthy ? 'healthy' : 'degraded',
      last_check: new Date().toISOString()
    };
    
    if (!isHealthy) {
      result.error = `Error rate: ${((recentStats.errors / Math.max(recentStats.processed, 1)) * 100).toFixed(1)}%`;
    }
    
    return result;
  } catch (error) {
    return {
      status: 'error',
      last_check: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get average response time from performance metrics
 */
async function getAverageResponseTime(shop: string, env: Env): Promise<number> {
  try {
    const perfKey = `performance_metrics:${shop}:24h`;
    const metrics = await env.WOOOD_KV.get(perfKey, 'json') || { total_time: 0, request_count: 0 };
    
    return metrics.request_count > 0 ? Math.round(metrics.total_time / metrics.request_count) : 0;
  } catch {
    return 0;
  }
}

/**
 * Get request count for last 24 hours
 */
async function getRequestCount24h(shop: string, env: Env): Promise<number> {
  try {
    const perfKey = `performance_metrics:${shop}:24h`;
    const metrics = await env.WOOOD_KV.get(perfKey, 'json') || { request_count: 0 };
    
    return metrics.request_count || 0;
  } catch {
    return 0;
  }
}

/**
 * Get error rate for last 24 hours
 */
async function getErrorRate24h(shop: string, env: Env): Promise<number> {
  try {
    const perfKey = `performance_metrics:${shop}:24h`;
    const metrics = await env.WOOOD_KV.get(perfKey, 'json') || { request_count: 0, error_count: 0 };
    
    return metrics.request_count > 0 ? Math.round((metrics.error_count / metrics.request_count) * 100) : 0;
  } catch {
    return 0;
  }
}

/**
 * Get cache hit rate
 */
async function getCacheHitRate(shop: string, env: Env): Promise<number> {
  try {
    const cacheKey = `cache_stats:${shop}:24h`;
    const stats = await env.WOOOD_KV.get(cacheKey, 'json') || { hits: 0, misses: 0 };
    
    const total = stats.hits + stats.misses;
    return total > 0 ? Math.round((stats.hits / total) * 100) : 0;
  } catch {
    return 0;
  }
}

/**
 * Get active feature flags for a shop
 */
async function getActiveFeatureFlags(shop: string, env: Env): Promise<Record<string, boolean>> {
  try {
    const flagsKey = `feature_flags:${shop}`;
    return await env.WOOOD_KV.get(flagsKey, 'json') || {};
  } catch {
    return {};
  }
}

/**
 * Handle system health request
 */
export async function handleSystemHealth(
  request: Request,
  env: Env,
  session: Session,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const shop = session.shop;

    logger.info('System health check requested', {
      requestId,
      shop
    });

    // Test all services concurrently for better performance
    const [
      dutchned_api,
      shopify_admin_api,
      kv_storage,
      webhook_processing,
      average_response_time,
      request_count_24h,
      error_rate_24h,
      cache_hit_rate,
      feature_flags
    ] = await Promise.all([
      testDutchNedConnection(env, config),
      testShopifyAdminAPI(session, config),
      testKVStorage(env),
      getWebhookProcessingHealth(shop, env),
      getAverageResponseTime(shop, env),
      getRequestCount24h(shop, env),
      getErrorRate24h(shop, env),
      getCacheHitRate(shop, env),
      getActiveFeatureFlags(shop, env)
    ]);

    const health: SystemHealth = {
      shop: shop,
      timestamp: new Date().toISOString(),
      services: {
        dutchned_api,
        shopify_admin_api,
        kv_storage,
        webhook_processing
      },
      performance: {
        average_response_time,
        request_count_24h,
        error_rate_24h,
        cache_hit_rate
      },
      feature_flags
    };

    return new Response(JSON.stringify({
      success: true,
      health: health
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=30' // Cache for 30 seconds
      }
    });

  } catch (error) {
    logger.error('System health check failed', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to retrieve system health'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle activity log request
 */
export async function handleActivityLog(
  request: Request,
  env: Env,
  session: Session,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const shop = session.shop;
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100); // Max 100 activities

    logger.info('Activity log requested', {
      requestId,
      shop,
      limit
    });

    // Get recent activity from KV storage
    const activityKey = `activity_log:${shop}`;
    const activities = await env.WOOOD_KV.get(activityKey, 'json') || [];

    const recentActivities = activities
      .slice(0, limit)
      .map((activity: any) => ({
        ...activity,
        timestamp: new Date(activity.timestamp).toLocaleString(),
        timeAgo: getTimeAgo(new Date(activity.timestamp))
      }));

    return new Response(JSON.stringify({
      success: true,
      activities: recentActivities,
      total: activities.length,
      showing: recentActivities.length
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=10' // Cache for 10 seconds
      }
    });

  } catch (error) {
    logger.error('Activity log request failed', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to retrieve activity log'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Utility function to get human-readable time ago
 */
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString();
} 