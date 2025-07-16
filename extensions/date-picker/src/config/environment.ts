/**
 * Centralized environment configuration for the date-picker extension
 * Uses production API URL as single source of truth
 */

export const config = {
  // API Configuration - single instance using production URL
  apiBaseUrl: 'https://woood-production.leander-4e0.workers.dev',

  // Feature flags - defaults for production
  enableMockMode: false,
  debugMode: false,

  // Environment info (for logging/debugging)
  environment: 'production',
  isDevelopment: false,
  isProduction: true,
} as const;

/**
 * Log configuration on import (only in development)
 */
if (config.debugMode) {
  console.log('🔧 Extension Configuration:', {
    apiBaseUrl: config.apiBaseUrl,
    enableMockMode: config.enableMockMode,
    environment: config.environment,
    isDevelopment: config.isDevelopment,
    isProduction: config.isProduction
  });
}