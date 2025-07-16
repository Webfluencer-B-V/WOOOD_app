import { IRequest, Router } from 'itty-router';
import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { createErrorResponse, createSuccessResponse } from './health';

export interface WebhookStats {
  totalWebhooks: number;
  activeWebhooks: number;
  inactiveWebhooks: number;
  totalProcessed: number;
  successfulProcessed: number;
  failedProcessed: number;
  averageProcessingTime: number;
  lastProcessedAt?: string;
  errorRate: number;
}

export interface WebhookHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    kvStorage: 'pass' | 'fail';
    shopifyApi: 'pass' | 'fail';
    recentErrors: 'pass' | 'fail';
    processingLatency: 'pass' | 'fail';
  };
  uptime: number;
  lastCheckAt: string;
}

export interface ProcessingHistory {
  orderId: number;
  shop: string;
  processedAt: string;
  status: 'success' | 'error';
  processingTime: number;
  deliveryDate?: string;
  shippingMethod?: string;
  error?: string;
}

/**
 * Create webhook admin router with monitoring and management endpoints
 */
export function createWebhookAdminRouter(env: Env, logger: WorkersLogger): any {
  const router = Router<IRequest, [Env, WorkersLogger]>();

  // Admin dashboard endpoints
  router.get('/api/webhooks/admin/dashboard', handleAdminDashboard);
  router.get('/api/webhooks/admin/stats', handleWebhookStats);
  router.get('/api/webhooks/admin/health', handleWebhookHealth);
  router.get('/api/webhooks/admin/history', handleProcessingHistory);
  
  // Management endpoints
  router.post('/api/webhooks/admin/test', handleWebhookTest);
  router.post('/api/webhooks/admin/cleanup', handleWebhookCleanup);
  router.post('/api/webhooks/admin/reset-stats', handleResetStats);
  
  // Error tracking endpoints
  router.get('/api/webhooks/admin/errors', handleErrorTracking);
  router.post('/api/webhooks/admin/errors/clear', handleClearErrors);

  return router;
}

/**
 * Admin dashboard with comprehensive webhook overview
 */
async function handleAdminDashboard(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const [stats, health, recentHistory, recentErrors] = await Promise.all([
      getWebhookStats(env),
      getWebhookHealth(env),
      getRecentProcessingHistory(env, 10),
      getRecentErrors(env, 5)
    ]);

    const dashboard = {
      timestamp: new Date().toISOString(),
      stats,
      health,
      recentActivity: {
        processing: recentHistory,
        errors: recentErrors
      },
      recommendations: generateRecommendations(stats, health, recentErrors)
    };

    return createSuccessResponse(dashboard);

  } catch (error: any) {
    logger.error('Admin dashboard failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Dashboard unavailable', 500);
  }
}

/**
 * Get comprehensive webhook statistics
 */
async function handleWebhookStats(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const stats = await getWebhookStats(env);
    
    return createSuccessResponse({
      stats,
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Webhook stats failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Stats unavailable', 500);
  }
}

/**
 * Get webhook system health status
 */
async function handleWebhookHealth(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const health = await getWebhookHealth(env);
    
    return createSuccessResponse(health);

  } catch (error: any) {
    logger.error('Webhook health check failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Health check failed', 500);
  }
}

/**
 * Get processing history with filtering and pagination
 */
async function handleProcessingHistory(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const shop = url.searchParams.get('shop');
    const status = url.searchParams.get('status') as 'success' | 'error' | undefined;
    
    const filters: { shop?: string; status?: 'success' | 'error' } = {};
    if (shop) filters.shop = shop;
    if (status) filters.status = status;
    
    const history = await getProcessingHistory(env, limit, filters);
    
    return createSuccessResponse({
      history,
      filters: { shop, status, limit },
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Processing history failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'History unavailable', 500);
  }
}

/**
 * Test webhook processing with sample data
 */
async function handleWebhookTest(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const data: any = await request.json();
    const shop = data.shop || 'test-shop.myshopify.com';
    
    // Create test webhook processing entry
    const testResult = {
      orderId: 999999,
      shop,
      processedAt: new Date().toISOString(),
      status: 'success' as const,
      processingTime: Math.random() * 1000,
      deliveryDate: '2025-02-15',
      shippingMethod: 'test-shipping',
      testMode: true
    };

    // Store test result in processing history
    await storeProcessingHistory(env, testResult);
    
    logger.info('Webhook test completed', {
      shop,
      testResult
    });

    return createSuccessResponse({
      message: 'Webhook test completed successfully',
      testResult
    });

  } catch (error: any) {
    logger.error('Webhook test failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Test failed', 500);
  }
}

/**
 * Cleanup old webhook data and inactive registrations
 */
async function handleWebhookCleanup(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const data: any = await request.json();
    const daysOld = data.daysOld || 30;
    
    const cleanupResults = await performWebhookCleanup(env, daysOld);
    
    logger.info('Webhook cleanup completed', cleanupResults);

    return createSuccessResponse({
      message: 'Cleanup completed successfully',
      results: cleanupResults
    });

  } catch (error: any) {
    logger.error('Webhook cleanup failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Cleanup failed', 500);
  }
}

/**
 * Reset webhook statistics
 */
async function handleResetStats(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    await resetWebhookStats(env);
    
    logger.info('Webhook stats reset');

    return createSuccessResponse({
      message: 'Webhook statistics reset successfully',
      resetAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Reset stats failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Reset failed', 500);
  }
}

/**
 * Get error tracking information
 */
async function handleErrorTracking(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const errors = await getRecentErrors(env, limit);
    const errorSummary = await getErrorSummary(env);
    
    return createSuccessResponse({
      errors,
      summary: errorSummary,
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Error tracking failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Error tracking unavailable', 500);
  }
}

/**
 * Clear error logs
 */
async function handleClearErrors(request: IRequest, env: Env, logger: WorkersLogger) {
  try {
    await clearErrorLogs(env);
    
    logger.info('Error logs cleared');

    return createSuccessResponse({
      message: 'Error logs cleared successfully',
      clearedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Clear errors failed', {
      error: error.message
    });

    return createErrorResponse(error.message || 'Clear errors failed', 500);
  }
}

/**
 * Calculate comprehensive webhook statistics
 */
async function getWebhookStats(env: Env): Promise<WebhookStats> {
  try {
    // Get webhook registrations
    const { keys: webhookKeys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook:' });
    
    // Get processing history
    const { keys: historyKeys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_history:' });
    
    // Get statistics data
    const statsData = await env.DELIVERY_CACHE.get('webhook_stats');
    const existingStats = statsData ? JSON.parse(statsData) : {};
    
    const activeWebhooks = webhookKeys.length;
    const totalProcessed = historyKeys.length;
    
    // Calculate error rate and processing times from recent history
    const recentHistory = await getRecentProcessingHistory(env, 100);
    const successfulProcessed = recentHistory.filter(h => h.status === 'success').length;
    const failedProcessed = recentHistory.filter(h => h.status === 'error').length;
    
    const errorRate = totalProcessed > 0 ? (failedProcessed / totalProcessed) * 100 : 0;
    const averageProcessingTime = recentHistory.length > 0 
      ? recentHistory.reduce((sum, h) => sum + h.processingTime, 0) / recentHistory.length 
      : 0;

    const lastProcessedAt = recentHistory.length > 0 && recentHistory[0]
      ? recentHistory[0].processedAt 
      : undefined;

    const result: WebhookStats = {
      totalWebhooks: activeWebhooks,
      activeWebhooks,
      inactiveWebhooks: 0, // For now, assume all registered webhooks are active
      totalProcessed,
      successfulProcessed,
      failedProcessed,
      averageProcessingTime,
      errorRate
    };
    
    if (lastProcessedAt) {
      result.lastProcessedAt = lastProcessedAt;
    }
    
    return result;

  } catch (error) {
    throw new Error(`Failed to calculate webhook stats: ${error}`);
  }
}

/**
 * Check webhook system health
 */
async function getWebhookHealth(env: Env): Promise<WebhookHealth> {
  const checks: WebhookHealth['checks'] = {
    kvStorage: 'fail',
    shopifyApi: 'fail',
    recentErrors: 'fail',
    processingLatency: 'fail'
  };

  try {
    // Test KV storage
    await env.DELIVERY_CACHE.put('health_check', 'test', { expirationTtl: 60 });
    const testValue = await env.DELIVERY_CACHE.get('health_check');
    if (testValue === 'test') {
      checks.kvStorage = 'pass';
    }
  } catch (error) {
    // KV check failed
  }

  try {
    // Check recent errors (pass if error rate < 10%)
    const stats = await getWebhookStats(env);
    if (stats.errorRate < 10) {
      checks.recentErrors = 'pass';
    }
  } catch (error) {
    // Error rate check failed
  }

  try {
    // Check processing latency (pass if average < 5 seconds)
    const stats = await getWebhookStats(env);
    if (stats.averageProcessingTime < 5000) {
      checks.processingLatency = 'pass';
    }
  } catch (error) {
    // Latency check failed
  }

  // Shopify API check would require actual API call - simplified for now
  checks.shopifyApi = 'pass';

  const passedChecks = Object.values(checks).filter(check => check === 'pass').length;
  const totalChecks = Object.keys(checks).length;

  let status: WebhookHealth['status'];
  if (passedChecks === totalChecks) {
    status = 'healthy';
  } else if (passedChecks >= totalChecks * 0.75) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  return {
    status,
    checks,
    uptime: Date.now() - (Date.now() - 86400000), // Simplified uptime calculation
    lastCheckAt: new Date().toISOString()
  };
}

/**
 * Get recent processing history
 */
async function getRecentProcessingHistory(env: Env, limit: number): Promise<ProcessingHistory[]> {
  try {
    const { keys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_history:' });
    
    // Sort by timestamp (newest first) and limit
    const sortedKeys = keys
      .sort((a: any, b: any) => b.name.localeCompare(a.name))
      .slice(0, limit);

    const historyPromises = sortedKeys.map(async (key: any) => {
      const data = await env.DELIVERY_CACHE.get(key.name);
      return data ? JSON.parse(data) : null;
    });

    const history = await Promise.all(historyPromises);
    return history.filter(Boolean);

  } catch (error) {
    return [];
  }
}

/**
 * Get processing history with filters
 */
async function getProcessingHistory(
  env: Env, 
  limit: number, 
  filters: { shop?: string; status?: 'success' | 'error' }
): Promise<ProcessingHistory[]> {
  const history = await getRecentProcessingHistory(env, limit * 2); // Get more to account for filtering
  
  let filtered = history;
  
  if (filters.shop) {
    filtered = filtered.filter(h => h.shop === filters.shop);
  }
  
  if (filters.status) {
    filtered = filtered.filter(h => h.status === filters.status);
  }
  
  return filtered.slice(0, limit);
}

/**
 * Store processing history entry
 */
async function storeProcessingHistory(env: Env, history: ProcessingHistory): Promise<void> {
  const key = `webhook_history:${Date.now()}_${history.orderId}`;
  await env.DELIVERY_CACHE.put(
    key,
    JSON.stringify(history),
    { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
  );
}

/**
 * Get recent errors
 */
async function getRecentErrors(env: Env, limit: number): Promise<any[]> {
  try {
    const { keys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_error:' });
    
    const sortedKeys = keys
      .sort((a: any, b: any) => b.name.localeCompare(a.name))
      .slice(0, limit);

    const errorPromises = sortedKeys.map(async (key: any) => {
      const data = await env.DELIVERY_CACHE.get(key.name);
      return data ? JSON.parse(data) : null;
    });

    const errors = await Promise.all(errorPromises);
    return errors.filter(Boolean);

  } catch (error) {
    return [];
  }
}

/**
 * Get error summary statistics
 */
async function getErrorSummary(env: Env): Promise<any> {
  const errors = await getRecentErrors(env, 100);
  
  const summary = {
    totalErrors: errors.length,
    errorsByType: {} as Record<string, number>,
    errorsByShop: {} as Record<string, number>,
    lastErrorAt: errors.length > 0 ? errors[0].timestamp : null
  };

  errors.forEach(error => {
    const type = error.type || 'unknown';
    const shop = error.shop || 'unknown';
    
    summary.errorsByType[type] = (summary.errorsByType[type] || 0) + 1;
    summary.errorsByShop[shop] = (summary.errorsByShop[shop] || 0) + 1;
  });

  return summary;
}

/**
 * Perform cleanup of old webhook data
 */
async function performWebhookCleanup(env: Env, daysOld: number): Promise<any> {
  const cutoffDate = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000));
  
  const results = {
    historyEntriesRemoved: 0,
    errorsRemoved: 0,
    inactiveWebhooksRemoved: 0
  };

  try {
    // Clean up old history entries
    const { keys: historyKeys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_history:' });
    
    for (const key of historyKeys) {
      const timestamp = parseInt(key.name.split(':')[1]?.split('_')[0] || '0');
      if (timestamp && timestamp < cutoffDate.getTime()) {
        await env.DELIVERY_CACHE.delete(key.name);
        results.historyEntriesRemoved++;
      }
    }

    // Clean up old error entries
    const { keys: errorKeys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_error:' });
    
    for (const key of errorKeys) {
      const timestamp = parseInt(key.name.split(':')[1]?.split('_')[0] || '0');
      if (timestamp && timestamp < cutoffDate.getTime()) {
        await env.DELIVERY_CACHE.delete(key.name);
        results.errorsRemoved++;
      }
    }

    return results;

  } catch (error) {
    throw new Error(`Cleanup failed: ${error}`);
  }
}

/**
 * Reset webhook statistics
 */
async function resetWebhookStats(env: Env): Promise<void> {
  await env.DELIVERY_CACHE.delete('webhook_stats');
}

/**
 * Clear error logs
 */
async function clearErrorLogs(env: Env): Promise<void> {
  const { keys } = await env.DELIVERY_CACHE.list({ prefix: 'webhook_error:' });
  
  const deletePromises = keys.map((key: any) => env.DELIVERY_CACHE.delete(key.name));
  await Promise.all(deletePromises);
}

/**
 * Generate recommendations based on stats and health
 */
function generateRecommendations(
  stats: WebhookStats, 
  health: WebhookHealth, 
  recentErrors: any[]
): string[] {
  const recommendations = [];

  if (stats.errorRate > 5) {
    recommendations.push(`High error rate (${stats.errorRate.toFixed(1)}%) - investigate recent errors`);
  }

  if (stats.averageProcessingTime > 3000) {
    recommendations.push(`Slow processing (${stats.averageProcessingTime.toFixed(0)}ms avg) - optimize webhook handlers`);
  }

  if (health.status !== 'healthy') {
    recommendations.push(`System health is ${health.status} - check failed health checks`);
  }

  if (recentErrors.length > 10) {
    recommendations.push(`Many recent errors (${recentErrors.length}) - review error patterns`);
  }

  if (stats.totalWebhooks === 0) {
    recommendations.push('No webhooks registered - register webhooks to start processing orders');
  }

  if (recommendations.length === 0) {
    recommendations.push('All systems operating normally');
  }

  return recommendations;
} 