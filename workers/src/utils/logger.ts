import { Env, WorkerConfig } from '../types/env';
import { LogEntry } from '../types/common';

/**
 * Enhanced logger for Cloudflare Workers
 * Provides structured logging with external service integration
 * Migrated from Express backend with Workers-specific optimizations
 */
export class WorkersLogger {
  constructor(
    private env: Env,
    private config: WorkerConfig
  ) {}

  /**
   * Log info level message
   */
  info(message: string, metadata?: LogMetadata): void {
    if (!this.config.features.enableRequestLogging) {
      return;
    }

    const logEntry = this.createLogEntry('info', message, metadata);
    console.log(JSON.stringify(logEntry));

    // Send to external logging service if configured
    if (this.shouldSendToExternalService('info')) {
      this.sendToExternalService(logEntry);
    }
  }

  /**
   * Log warning level message
   */
  warn(message: string, metadata?: LogMetadata): void {
    const logEntry = this.createLogEntry('warn', message, metadata);
    console.warn(JSON.stringify(logEntry));

    // Send to external logging service if configured
    if (this.shouldSendToExternalService('warn')) {
      this.sendToExternalService(logEntry);
    }
  }

  /**
   * Log error level message
   */
  error(message: string, metadata?: LogMetadata): void {
    const logEntry = this.createLogEntry('error', message, metadata);
    console.error(JSON.stringify(logEntry));

    // Always send errors to external service if configured
    if (this.shouldSendToExternalService('error')) {
      this.sendToExternalService(logEntry);
    }
  }

  /**
   * Log debug level message
   */
  debug(message: string, metadata?: LogMetadata): void {
    if (!this.config.features.enableDebugLogging) {
      return;
    }

    const logEntry = this.createLogEntry('debug', message, metadata);
    console.debug(JSON.stringify(logEntry));

    // Send to external logging service if debug logging and external reporting are enabled
    if (this.shouldSendToExternalService('debug')) {
      this.sendToExternalService(logEntry);
    }
  }

  /**
   * Create structured log entry with enhanced metadata
   */
  private createLogEntry(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: LogMetadata
  ): LogEntry {
    const baseEntry: LogEntry = {
      level,
      message,
      metadata: this.sanitizeMetadata(metadata || {}),
      timestamp: new Date().toISOString(),
      worker: 'delivery-api',
      ...(metadata?.requestId && { requestId: metadata.requestId }),
      ...(metadata?.errorId && { errorId: metadata.errorId })
    };

    // Add environment context if verbose responses are enabled
    if (this.config.features.enableVerboseResponses) {
      baseEntry.metadata = {
        ...baseEntry.metadata,
        environment: this.config.environment,
        workerVersion: '1.0.0',
        executionContext: {
          cacheEnabled: this.config.features.enableCaching,
          rateLimitEnabled: this.config.features.enableRateLimiting,
          mockDataEnabled: this.config.features.useMockData
        }
      };
    }

    return baseEntry;
  }

  /**
   * Sanitize metadata to remove sensitive information
   */
  private sanitizeMetadata(metadata: LogMetadata): LogMetadata {
    const sanitized = { ...metadata };

    // Remove or truncate sensitive fields
    if (sanitized.credentials) {
      sanitized.credentials = '[REDACTED]';
    }

    if (sanitized.apiKey) {
      sanitized.apiKey = '[REDACTED]';
    }

    if (sanitized.authorization) {
      sanitized.authorization = '[REDACTED]';
    }

    // Truncate long stack traces
    if (sanitized.errorStack && sanitized.errorStack.length > 2000) {
      sanitized.errorStack = sanitized.errorStack.substring(0, 2000) + '... [truncated]';
    }

    // Truncate long URLs
    if (sanitized.url && sanitized.url.length > 500) {
      sanitized.url = sanitized.url.substring(0, 500) + '... [truncated]';
    }

    return sanitized;
  }

  /**
   * Determine if log should be sent to external service
   */
  private shouldSendToExternalService(level: string): boolean {
    // Always send errors if external error reporting is enabled
    if (level === 'error' && this.config.features.enableExternalErrorReporting) {
      return !!(this.config.endpoints.errorTracking || this.config.endpoints.logging);
    }

    // Send other levels only if external logging endpoint is configured
    if (this.config.endpoints.logging) {
      // Debug logs only if debug logging is enabled
      if (level === 'debug') {
        return this.config.features.enableDebugLogging;
      }
      return true;
    }

    return false;
  }

  /**
   * Send log entry to external service
   * Enhanced with retry logic and multiple service support
   */
  private sendToExternalService(logEntry: LogEntry): void {
    // Use setTimeout to make this non-blocking
    setTimeout(async () => {
      try {
        const endpoints = this.getExternalServiceEndpoints(logEntry.level);
        
        // Try each endpoint with basic retry logic
        for (const endpoint of endpoints) {
          try {
            await this.sendToSingleEndpoint(endpoint, logEntry);
            break; // Success, stop trying other endpoints
          } catch (endpointError) {
            // Continue to next endpoint if this one fails
            continue;
          }
        }
      } catch (error) {
        // Silently ignore external logging failures
        // We don't want logging to break the main functionality
        if (this.config.features.enableDebugLogging) {
          console.debug(`External logging failed: ${(error as Error).message}`);
        }
      }
    }, 0);
  }

  /**
   * Get appropriate external service endpoints for log level
   */
  private getExternalServiceEndpoints(level: string): string[] {
    const endpoints: string[] = [];

    // For errors, try error tracking endpoint first
    if (level === 'error' && this.config.endpoints.errorTracking) {
      endpoints.push(this.config.endpoints.errorTracking);
    }

    // Add general logging endpoint
    if (this.config.endpoints.logging) {
      endpoints.push(this.config.endpoints.logging);
    }

    return endpoints;
  }

  /**
   * Send log entry to a single external endpoint
   */
  private async sendToSingleEndpoint(endpoint: string, logEntry: LogEntry): Promise<void> {
    const payload = {
      service: 'woood-delivery-api',
      environment: this.config.environment,
      ...logEntry
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WOOOD-Delivery-API/1.0 (Cloudflare Workers)',
        'X-Service': 'woood-delivery-api',
        'X-Environment': this.config.environment
      },
      body: JSON.stringify(payload),
      // Short timeout for external logging to avoid blocking
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`External service responded with status ${response.status}`);
    }
  }

  /**
   * Create a child logger with additional context
   */
  createChildLogger(additionalMetadata: LogMetadata): WorkersLogger {
    const childLogger = new WorkersLogger(this.env, this.config);
    
    // Override the createLogEntry method to include additional metadata
    const originalCreateLogEntry = childLogger['createLogEntry'].bind(childLogger);
    childLogger['createLogEntry'] = (level: any, message: string, metadata?: LogMetadata) => {
      const combinedMetadata = {
        ...additionalMetadata,
        ...metadata
      };
      return originalCreateLogEntry(level, message, combinedMetadata);
    };

    return childLogger;
  }

  /**
   * Log performance metrics
   */
  logPerformance(operation: string, startTime: number, metadata?: LogMetadata): void {
    if (!this.config.features.enablePerformanceMonitoring) {
      return;
    }

    const duration = Date.now() - startTime;
    this.info(`Performance: ${operation}`, {
      ...metadata,
      operation,
      duration,
      performanceMetric: true
    });
  }

  /**
   * Log API requests with standard format
   */
  logRequest(method: string, pathname: string, status: number, duration: number, metadata?: LogMetadata): void {
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    
    this[level](`${method} ${pathname} ${status}`, {
      ...metadata,
      method,
      pathname,
      status,
      duration,
      requestLog: true
    });
  }

  /**
   * Log cache operations
   */
  logCache(operation: 'hit' | 'miss' | 'set' | 'delete', key: string, metadata?: LogMetadata): void {
    if (!this.config.features.enableCaching) {
      return;
    }

    this.debug(`Cache ${operation}: ${key}`, {
      ...metadata,
      cacheOperation: operation,
      cacheKey: key
    });
  }
}

/**
 * Log metadata interface for type safety with flexible optional properties
 */
export interface LogMetadata {
  requestId?: string | undefined;
  errorId?: string | undefined;
  userId?: string | undefined;
  operation?: string | undefined;
  duration?: number | undefined;
  status?: number | undefined;
  method?: string | undefined;
  pathname?: string | undefined;
  url?: string | undefined;
  userAgent?: string | undefined;
  error?: string | undefined;
  errorStack?: string | undefined;
  cacheOperation?: string | undefined;
  cacheKey?: string | undefined;
  performanceMetric?: boolean | undefined;
  requestLog?: boolean | undefined;
  credentials?: string | undefined;
  apiKey?: string | undefined;
  authorization?: string | undefined;
  sessionId?: string | undefined;
  shop?: string | undefined;
  orderId?: string | number | undefined;
  [key: string]: any;
}

/**
 * Create a global logger instance for use throughout the worker
 */
export function createLogger(env: Env, config: WorkerConfig): WorkersLogger {
  return new WorkersLogger(env, config);
}

/**
 * Log levels enum for consistency
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * External logging service configurations
 */
export interface ExternalLoggingConfig {
  logflare?: {
    endpoint: string;
    apiKey: string;
  };
  datadog?: {
    endpoint: string;
    apiKey: string;
  };
  newrelic?: {
    endpoint: string;
    licenseKey: string;
  };
  custom?: {
    endpoint: string;
    headers?: Record<string, string>;
  };
} 