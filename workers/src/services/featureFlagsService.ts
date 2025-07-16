import { Env, WorkerConfig } from '../types/env';
import { FeatureFlags } from '../types/common';

/**
 * Feature flags service for Cloudflare Workers
 * Migrated from Express backend with Workers-specific optimizations
 * Provides centralized feature flag management with environment variable integration
 */
export class WorkersFeatureFlags {
  private cachedFlags: FeatureFlags | null = null;
  private lastCacheTime: number = 0;
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

  constructor(private env: Env) {}

  /**
   * Check if a feature flag is enabled
   * Enhanced with caching and validation
   */
  isEnabled(flag: string): boolean {
    try {
      const normalizedFlag = this.normalizeFlag(flag);
      const envKey = `ENABLE_${normalizedFlag}`;
      const value = this.env[envKey as keyof Env];
      
      return this.parseBooleanValue(value);
    } catch (error) {
      // Return false for invalid flags to be safe
      console.warn(`Feature flag check failed for "${flag}": ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get all feature flags with caching
   * Enhanced from basic implementation with comprehensive flag support
   */
  getFeatureFlags(): FeatureFlags {
    // Return cached flags if still valid
    if (this.cachedFlags && (Date.now() - this.lastCacheTime) < this.cacheTimeout) {
      return this.cachedFlags;
    }

    // Build fresh feature flags from environment
    this.cachedFlags = {
      // Core functionality flags
      useMockData: this.isEnabled('use_mock_delivery_dates'),
      enableCaching: this.isEnabled('caching'),
      enableRateLimiting: this.isEnabled('rate_limiting'),
      enableMockFallback: this.isEnabled('mock_fallback'),
      enableDutchNedApi: this.isEnabled('dutchned_api'),
      enableShippingMethodProcessing: this.isEnabled('shipping_method_processing'),

      // Performance and monitoring flags
      enablePerformanceMonitoring: this.isEnabled('performance_monitoring'),
      enableRequestLogging: this.isEnabled('request_logging'),
      enableErrorTracking: this.isEnabled('error_tracking'),

      // UI/UX flags
      enableDetailedErrors: this.isEnabled('detailed_error_messages'),
      enableLoadingStates: this.isEnabled('loading_states'),
      enableUserFeedback: this.isEnabled('user_feedback'),

      // External services flags
      enableExternalErrorReporting: this.isEnabled('external_error_reporting'),
      enableAnalyticsTracking: this.isEnabled('analytics_tracking'),
      enableWebhookNotifications: this.isEnabled('webhook_notifications'),

      // Debug and development flags
      enableDebugLogging: this.isEnabled('debug_logging'),
      enableVerboseResponses: this.isEnabled('verbose_responses')
    };

    this.lastCacheTime = Date.now();
    return this.cachedFlags;
  }

  /**
   * Get categorized feature flags for better organization
   */
  getCategorizedFlags(): CategorizedFeatureFlags {
    const flags = this.getFeatureFlags();

    return {
      core: {
        useMockData: flags.useMockData,
        enableCaching: flags.enableCaching,
        enableDutchNedApi: flags.enableDutchNedApi,
        enableShippingMethodProcessing: flags.enableShippingMethodProcessing,
        enableMockFallback: flags.enableMockFallback
      },
      performance: {
        enablePerformanceMonitoring: flags.enablePerformanceMonitoring,
        enableRateLimiting: flags.enableRateLimiting,
        enableRequestLogging: flags.enableRequestLogging
      },
      ui: {
        enableDetailedErrors: flags.enableDetailedErrors,
        enableLoadingStates: flags.enableLoadingStates,
        enableUserFeedback: flags.enableUserFeedback,
        enableVerboseResponses: flags.enableVerboseResponses
      },
      external: {
        enableExternalErrorReporting: flags.enableExternalErrorReporting,
        enableAnalyticsTracking: flags.enableAnalyticsTracking,
        enableWebhookNotifications: flags.enableWebhookNotifications,
        enableErrorTracking: flags.enableErrorTracking
      },
      debug: {
        enableDebugLogging: flags.enableDebugLogging,
        enableVerboseResponses: flags.enableVerboseResponses
      }
    };
  }

  /**
   * Check multiple feature flags at once
   */
  areEnabled(flags: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    
    for (const flag of flags) {
      result[flag] = this.isEnabled(flag);
    }
    
    return result;
  }

  /**
   * Check if any of the provided flags are enabled
   */
  isAnyEnabled(flags: string[]): boolean {
    return flags.some(flag => this.isEnabled(flag));
  }

  /**
   * Check if all of the provided flags are enabled
   */
  areAllEnabled(flags: string[]): boolean {
    return flags.every(flag => this.isEnabled(flag));
  }

  /**
   * Get feature flag with fallback value
   */
  getWithFallback(flag: string, fallback: boolean = false): boolean {
    try {
      return this.isEnabled(flag);
    } catch (error) {
      return fallback;
    }
  }

  /**
   * Get environment-specific feature overrides
   */
  getEnvironmentOverrides(): Partial<FeatureFlags> {
    const environment = this.env.ENVIRONMENT || 'production';
    
    // Environment-specific overrides
    switch (environment.toLowerCase()) {
      case 'development':
        return {
          enableDebugLogging: true,
          enableVerboseResponses: true,
          useMockData: this.getWithFallback('use_mock_delivery_dates', true)
        };
        
      case 'staging':
        return {
          enableDebugLogging: true,
          enablePerformanceMonitoring: true,
          enableExternalErrorReporting: this.getWithFallback('external_error_reporting', true)
        };
        
      case 'production':
        return {
          enableDebugLogging: false,
          useMockData: false,
          enableVerboseResponses: false
        };
        
      default:
        return {};
    }
  }

  /**
   * Get merged feature flags with environment overrides
   */
  getMergedFlags(): FeatureFlags {
    const baseFlags = this.getFeatureFlags();
    const environmentOverrides = this.getEnvironmentOverrides();
    
    return {
      ...baseFlags,
      ...environmentOverrides
    };
  }

  /**
   * Validate feature flag configuration
   */
  validateConfiguration(): FeatureFlagValidation {
    const validation: FeatureFlagValidation = {
      valid: true,
      warnings: [],
      errors: [],
      recommendations: []
    };

    const flags = this.getFeatureFlags();

    // Check for conflicting configurations
    if (flags.useMockData && flags.enableDutchNedApi) {
      validation.warnings.push(
        'Mock data is enabled while DutchNed API is also enabled. Mock data will take precedence.'
      );
    }

    if (!flags.enableCaching && flags.enablePerformanceMonitoring) {
      validation.recommendations.push(
        'Consider enabling caching for better performance when performance monitoring is active.'
      );
    }

    if (!flags.enableErrorTracking && flags.enableExternalErrorReporting) {
      validation.warnings.push(
        'External error reporting is enabled but error tracking is disabled. Some errors may not be reported.'
      );
    }

    if (flags.enableDebugLogging && this.env.ENVIRONMENT === 'production') {
      validation.warnings.push(
        'Debug logging is enabled in production environment. This may impact performance and expose sensitive information.'
      );
    }

    if (!flags.enableRateLimiting) {
      validation.recommendations.push(
        'Consider enabling rate limiting to protect against abuse.'
      );
    }

    // Check for missing required environment variables
    const requiredFlags = [
      'ENABLE_CACHING',
      'ENABLE_RATE_LIMITING'
    ];

    for (const flag of requiredFlags) {
      if (!(flag in this.env) || this.env[flag as keyof Env] === undefined) {
        validation.errors.push(`Required environment variable ${flag} is not set.`);
        validation.valid = false;
      }
    }

    return validation;
  }

  /**
   * Get feature flag statistics for monitoring
   */
  getStatistics(): FeatureFlagStatistics {
    const flags = this.getFeatureFlags();
    const categorized = this.getCategorizedFlags();

    const total = Object.keys(flags).length;
    const enabled = Object.values(flags).filter(Boolean).length;
    const disabled = total - enabled;

    return {
      total,
      enabled,
      disabled,
      enabledPercentage: Math.round((enabled / total) * 100),
      disabledPercentage: Math.round((disabled / total) * 100),
      byCategory: {
        core: {
          total: Object.keys(categorized.core).length,
          enabled: Object.values(categorized.core).filter(Boolean).length
        },
        performance: {
          total: Object.keys(categorized.performance).length,
          enabled: Object.values(categorized.performance).filter(Boolean).length
        },
        ui: {
          total: Object.keys(categorized.ui).length,
          enabled: Object.values(categorized.ui).filter(Boolean).length
        },
        external: {
          total: Object.keys(categorized.external).length,
          enabled: Object.values(categorized.external).filter(Boolean).length
        },
        debug: {
          total: Object.keys(categorized.debug).length,
          enabled: Object.values(categorized.debug).filter(Boolean).length
        }
      }
    };
  }

  /**
   * Clear the cache to force fresh flag evaluation
   */
  clearCache(): void {
    this.cachedFlags = null;
    this.lastCacheTime = 0;
  }

  /**
   * Normalize flag name for environment variable lookup
   */
  private normalizeFlag(flag: string): string {
    return flag.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }

  /**
   * Parse boolean value from environment variable
   */
  private parseBooleanValue(value: any): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    
    if (typeof value === 'number') {
      return value === 1;
    }
    
    return false;
  }
}

/**
 * Categorized feature flags for better organization
 */
export interface CategorizedFeatureFlags {
  core: {
    useMockData: boolean;
    enableCaching: boolean;
    enableDutchNedApi: boolean;
    enableShippingMethodProcessing: boolean;
    enableMockFallback: boolean;
  };
  performance: {
    enablePerformanceMonitoring: boolean;
    enableRateLimiting: boolean;
    enableRequestLogging: boolean;
  };
  ui: {
    enableDetailedErrors: boolean;
    enableLoadingStates: boolean;
    enableUserFeedback: boolean;
    enableVerboseResponses: boolean;
  };
  external: {
    enableExternalErrorReporting: boolean;
    enableAnalyticsTracking: boolean;
    enableWebhookNotifications: boolean;
    enableErrorTracking: boolean;
  };
  debug: {
    enableDebugLogging: boolean;
    enableVerboseResponses: boolean;
  };
}

/**
 * Feature flag validation result
 */
export interface FeatureFlagValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
  recommendations: string[];
}

/**
 * Feature flag statistics for monitoring
 */
export interface FeatureFlagStatistics {
  total: number;
  enabled: number;
  disabled: number;
  enabledPercentage: number;
  disabledPercentage: number;
  byCategory: {
    [category: string]: {
      total: number;
      enabled: number;
    };
  };
}

/**
 * Create feature flags service instance
 */
export function createFeatureFlagsService(env: Env): WorkersFeatureFlags {
  return new WorkersFeatureFlags(env);
}

/**
 * Helper function to check if feature is enabled without creating service instance
 */
export function isFeatureEnabled(env: Env, flag: string): boolean {
  const service = new WorkersFeatureFlags(env);
  return service.isEnabled(flag);
}

/**
 * Helper function to get feature flags without creating service instance
 */
export function getFeatureFlags(env: Env): FeatureFlags {
  const service = new WorkersFeatureFlags(env);
  return service.getFeatureFlags();
} 