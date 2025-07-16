/**
 * Common interfaces for the Cloudflare Workers API
 * Migrated and updated from the original backend types
 */

/**
 * Delivery date structure from DutchNed API
 */
export interface DeliveryDate {
  date: string; // YYYY-MM-DD format
  displayName: string; // Human-readable date in Dutch
}

/**
 * API response wrapper for delivery dates
 */
export interface DeliveryDatesResponse {
  success: boolean;
  data: DeliveryDate[];
  cached?: boolean;
  source?: 'api' | 'mock' | 'worker-placeholder';
  error?: string;
  message?: string;
  fallback?: boolean;
  requestId?: string;
  timestamp?: string;
}

/**
 * Shipping method data structure
 */
export interface ShippingMethodData {
  shippingMethod: string;
  deliveryDate?: string;
  timestamp?: string;
  cartId?: string;
  customerId?: string;
  orderId?: string;
  additionalData?: Record<string, any>;
}

/**
 * Shipping method processing result
 */
export interface ShippingMethodProcessingResult {
  success: boolean;
  data?: ShippingMethodData;
  error?: string;
  message?: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Order metafields data structure
 */
export interface OrderMetafieldsData {
  deliveryDate?: string;
  shippingMethod?: string;
  orderId?: string;
  cartId?: string;
  customerId?: string;
  additionalData?: Record<string, any>;
}

/**
 * Order metafields save result
 */
export interface OrderMetafieldsSaveResult {
  success: boolean;
  data?: OrderMetafieldsData;
  error?: string;
  message?: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Error tracking data structure
 */
export interface ErrorTrackingData {
  error: string;
  message: string;
  stack?: string;
  userAgent?: string;
  url?: string;
  timestamp: string;
  additionalContext?: Record<string, any>;
}

/**
 * Error tracking result
 */
export interface ErrorTrackingResult {
  success: boolean;
  errorId?: string;
  message?: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Cache entry structure for KV storage
 */
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  version?: string;
}

/**
 * Health check response structure
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime?: number;
  version: string;
  environment?: string;
  requestId?: string;
  services?: {
    dutchNedApi?: 'available' | 'unavailable' | 'unknown';
    cache?: 'available' | 'unavailable' | 'unknown';
    rateLimiter?: 'available' | 'unavailable' | 'unknown';
  };
}

/**
 * Request metadata for logging and tracking
 */
export interface RequestMetadata {
  requestId: string;
  method: string;
  pathname: string;
  userAgent?: string | null;
  origin?: string | null;
  timestamp: string;
  ipAddress?: string;
  country?: string;
}

/**
 * Response metadata for logging and tracking
 */
export interface ResponseMetadata {
  requestId: string;
  status: number;
  pathname: string;
  method: string;
  responseTime?: number;
  cacheHit?: boolean;
  rateLimited?: boolean;
  errorId?: string;
}

/**
 * Log entry structure for structured logging
 */
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  timestamp: string;
  worker: string;
  requestId?: string;
  errorId?: string;
}

/**
 * Rate limiting state structure
 */
export interface RateLimitState {
  requests: number[];
  windowStart: number;
  limit: number;
  windowMs: number;
}

/**
 * Rate limiting result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Feature flags structure (derived from environment)
 */
export interface FeatureFlags {
  useMockData: boolean;
  enableCaching: boolean;
  enableRateLimiting: boolean;
  enableMockFallback: boolean;
  enableDetailedErrors: boolean;
  enablePerformanceMonitoring: boolean;
  enableRequestLogging: boolean;
  enableErrorTracking: boolean;
  enableLoadingStates: boolean;
  enableUserFeedback: boolean;
  enableExternalErrorReporting: boolean;
  enableAnalyticsTracking: boolean;
  enableWebhookNotifications: boolean;
  enableDebugLogging: boolean;
  enableVerboseResponses: boolean;
  enableDutchNedApi: boolean;
  enableShippingMethodProcessing: boolean;
}

/**
 * API endpoint configuration
 */
export interface APIEndpointConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  requiresAuth?: boolean;
  rateLimitOverride?: {
    limit: number;
    windowMs: number;
  };
  cacheConfig?: {
    enabled: boolean;
    ttl: number;
  };
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  origins: string[];
  methods: string[];
  headers: string[];
  maxAge: number;
  credentials?: boolean;
}

/**
 * Workers-specific error types
 */
export type WorkerErrorType = 
  | 'VALIDATION_ERROR'
  | 'API_ERROR'
  | 'CACHE_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'INTERNAL_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'TIMEOUT_ERROR'
  | 'NETWORK_ERROR';

/**
 * Standardized error response structure
 */
export interface WorkerErrorResponse {
  error: WorkerErrorType | string;
  message: string;
  details?: Record<string, any>;
  requestId?: string;
  errorId?: string;
  timestamp: string;
  retryable?: boolean;
  retryAfter?: number;
}

/**
 * Success response wrapper
 */
export interface WorkerSuccessResponse<T = any> {
  success: true;
  data: T;
  metadata?: {
    requestId?: string;
    timestamp?: string;
    cached?: boolean;
    source?: string;
    version?: string;
  };
}

/**
 * Union type for all worker responses
 */
export type WorkerResponse<T = any> = WorkerSuccessResponse<T> | WorkerErrorResponse;

/**
 * Utility type for extracting data from successful responses
 */
export type ExtractData<T> = T extends WorkerSuccessResponse<infer U> ? U : never;

/**
 * Utility type for API handler functions
 */
export type APIHandler = (
  request: Request,
  env: any,
  config: any,
  logger?: any,
  requestId?: string
) => Promise<Response>;

/**
 * Utility type for middleware functions
 */
export type Middleware = (
  request: Request,
  env: any,
  config: any,
  next: () => Promise<Response>
) => Promise<Response>; 