import { Env, WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { Session } from '../types/session';

/**
 * Get default feature flags for a given environment
 */
function getDefaultFeatureFlags(env: Env): Record<string, boolean> {
  return {
    // Core features
    ENABLE_DELIVERY_DATES: env.ENABLE_DUTCHNED_API !== 'false',
    ENABLE_SHIPPING_METHODS: env.ENABLE_SHIPPING_METHOD_PROCESSING === 'true',
    ENABLE_WEBHOOK_PROCESSING: env.ENABLE_WEBHOOK_NOTIFICATIONS === 'true',
    
    // Performance features
    ENABLE_CACHING: env.ENABLE_CACHING === 'true',
    ENABLE_RATE_LIMITING: env.ENABLE_RATE_LIMITING === 'true',
    USE_MOCK_FALLBACK: env.ENABLE_MOCK_FALLBACK === 'true',
    
    // UI features
    ENABLE_DEBUG_LOGGING: env.ENABLE_DEBUG_LOGGING === 'true',
    ENABLE_EXTENSION_ANALYTICS: env.ENABLE_ANALYTICS_TRACKING === 'true',
    ENABLE_VERBOSE_RESPONSES: env.ENABLE_VERBOSE_RESPONSES === 'true',
    
    // External services
    DUTCHNED_API_ENABLED: env.ENABLE_DUTCHNED_API !== 'false',
    SHOPIFY_ADMIN_API_ENABLED: true, // Always enabled for OAuth apps
    
    // Monitoring
    ENABLE_PERFORMANCE_MONITORING: env.ENABLE_PERFORMANCE_MONITORING === 'true',
    ENABLE_ERROR_TRACKING: env.ENABLE_ERROR_TRACKING === 'true',
    ENABLE_REQUEST_LOGGING: env.ENABLE_REQUEST_LOGGING === 'true'
  };
}

/**
 * Validate if a feature flag name is allowed
 */
function isValidFeatureFlag(flagName: string): boolean {
  const allowedFlags = [
    'ENABLE_DELIVERY_DATES',
    'ENABLE_SHIPPING_METHODS', 
    'ENABLE_WEBHOOK_PROCESSING',
    'ENABLE_CACHING',
    'ENABLE_RATE_LIMITING',
    'USE_MOCK_FALLBACK',
    'ENABLE_DEBUG_LOGGING',
    'ENABLE_EXTENSION_ANALYTICS',
    'ENABLE_VERBOSE_RESPONSES',
    'DUTCHNED_API_ENABLED',
    'SHOPIFY_ADMIN_API_ENABLED',
    'ENABLE_PERFORMANCE_MONITORING',
    'ENABLE_ERROR_TRACKING',
    'ENABLE_REQUEST_LOGGING'
  ];
  
  return allowedFlags.includes(flagName);
}

/**
 * Get current feature flags for a shop
 */
export async function handleGetFeatureFlags(
  request: Request,
  env: Env,
  session: Session,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const shop = session.shop;

    logger.info('Getting feature flags', {
      requestId,
      shop
    });

    // Get current feature flags for shop from KV storage
    const flagsKey = `feature_flags:${shop}`;
    const currentFlags = await env.WOOOD_KV.get(flagsKey, 'json') || {};

    // Merge with default flags
    const defaultFlags = getDefaultFeatureFlags(env);
    const allFlags = { ...defaultFlags, ...currentFlags };

    return new Response(JSON.stringify({
      success: true,
      flags: allFlags,
      shop: shop,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    logger.error('Failed to get feature flags', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to retrieve feature flags'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Update a specific feature flag
 */
export async function handleUpdateFeatureFlag(
  request: Request,
  env: Env,
  session: Session,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const shop = session.shop;
    const { flagName, enabled } = await request.json() as { flagName: string; enabled: boolean };

    logger.info('Updating feature flag', {
      requestId,
      shop,
      flagName,
      enabled
    });

    // Validate flag name
    if (!isValidFeatureFlag(flagName)) {
      logger.warn('Invalid feature flag name', {
        requestId,
        shop,
        flagName
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid feature flag name',
        allowedFlags: [
          'ENABLE_DELIVERY_DATES',
          'ENABLE_SHIPPING_METHODS', 
          'ENABLE_WEBHOOK_PROCESSING',
          'ENABLE_CACHING',
          'ENABLE_RATE_LIMITING',
          'USE_MOCK_FALLBACK',
          'ENABLE_DEBUG_LOGGING',
          'ENABLE_EXTENSION_ANALYTICS',
          'ENABLE_VERBOSE_RESPONSES',
          'DUTCHNED_API_ENABLED',
          'ENABLE_PERFORMANCE_MONITORING',
          'ENABLE_ERROR_TRACKING',
          'ENABLE_REQUEST_LOGGING'
        ]
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate enabled value
    if (typeof enabled !== 'boolean') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Feature flag value must be a boolean'
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update flag in KV storage
    const flagsKey = `feature_flags:${shop}`;
    const currentFlags = await env.WOOOD_KV.get(flagsKey, 'json') || {};
    currentFlags[flagName] = enabled;

    await env.WOOOD_KV.put(flagsKey, JSON.stringify(currentFlags), {
      metadata: {
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin-interface',
        shop: shop
      }
    });

    // Log the change for audit trail
    logger.info('Feature flag updated successfully', {
      requestId,
      shop,
      flagName,
      enabled,
      updatedBy: 'admin-interface',
      timestamp: new Date().toISOString()
    });

    // Store change in activity log
    const activityKey = `activity_log:${shop}`;
    const activities = await env.WOOOD_KV.get(activityKey, 'json') || [];
    activities.unshift({
      id: crypto.randomUUID(),
      type: 'feature_flag_update',
      description: `${flagName} ${enabled ? 'enabled' : 'disabled'}`,
      flagName,
      enabled,
      timestamp: new Date().toISOString(),
      source: 'admin-interface'
    });

    // Keep only last 100 activities
    if (activities.length > 100) {
      activities.splice(100);
    }

    await env.WOOOD_KV.put(activityKey, JSON.stringify(activities));

    return new Response(JSON.stringify({
      success: true,
      flagName,
      enabled,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logger.error('Failed to update feature flag', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to update feature flag'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Bulk update multiple feature flags
 */
export async function handleBulkUpdateFeatureFlags(
  request: Request,
  env: Env,
  session: Session,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const shop = session.shop;
    const { flags } = await request.json() as { flags: Record<string, boolean> };

    logger.info('Bulk updating feature flags', {
      requestId,
      shop,
      flagCount: Object.keys(flags).length
    });

    // Validate all flag names
    const invalidFlags = Object.keys(flags).filter(flag => !isValidFeatureFlag(flag));
    if (invalidFlags.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid feature flag names',
        invalidFlags
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate all values are booleans
    const invalidValues = Object.entries(flags).filter(([_, value]) => typeof value !== 'boolean');
    if (invalidValues.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'All feature flag values must be booleans',
        invalidValues: invalidValues.map(([key]) => key)
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update flags in KV storage
    const flagsKey = `feature_flags:${shop}`;
    const currentFlags = await env.WOOOD_KV.get(flagsKey, 'json') || {};
    
    // Merge with new flags
    const updatedFlags = { ...currentFlags, ...flags };

    await env.WOOOD_KV.put(flagsKey, JSON.stringify(updatedFlags), {
      metadata: {
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin-interface-bulk',
        shop: shop,
        flagCount: Object.keys(flags).length
      }
    });

    // Log the bulk change
    logger.info('Bulk feature flags updated successfully', {
      requestId,
      shop,
      flags,
      updatedBy: 'admin-interface-bulk',
      timestamp: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      updatedFlags: flags,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logger.error('Failed to bulk update feature flags', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to bulk update feature flags'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 