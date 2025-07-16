import { Env, WorkerConfig } from '../types/env';
import { RateLimitResult, RateLimitState } from '../types/common';

/**
 * RateLimiter Durable Object class
 * Implements rate limiting using Cloudflare Durable Objects
 * Enhanced from basic implementation to match plan specifications
 */
export class RateLimiter {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = this.getClientId(request);
    const currentTime = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const limit = 100; // 100 requests per 15 minutes
    const windowStart = currentTime - windowMs;

    try {
      // Get request history from Durable Object storage
      const requests = await this.state.storage.get<number[]>(clientId) || [];

      // Filter requests within current window
      const recentRequests = requests.filter(time => time > windowStart);

      // Check if limit exceeded
      if (recentRequests.length >= limit) {
        const resetTime = windowStart + windowMs;
        const retryAfter = Math.ceil((resetTime - currentTime) / 1000);

        const rateLimitResult: RateLimitResult = {
          allowed: false,
          limit,
          remaining: 0,
          resetTime,
          retryAfter
        };

        return new Response(JSON.stringify(rateLimitResult), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
            'Retry-After': retryAfter.toString()
          }
        });
      }

      // Add current request and save
      recentRequests.push(currentTime);
      await this.state.storage.put(clientId, recentRequests);

      // Clean up old requests periodically (every 50 requests)
      if (recentRequests.length % 50 === 0) {
        await this.cleanupOldRequests(clientId, windowStart);
      }

      const rateLimitResult: RateLimitResult = {
        allowed: true,
        limit,
        remaining: limit - recentRequests.length,
        resetTime: windowStart + windowMs
      };

      return new Response(JSON.stringify(rateLimitResult), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': (limit - recentRequests.length).toString(),
          'X-RateLimit-Reset': Math.ceil((windowStart + windowMs) / 1000).toString()
        }
      });

    } catch (error: any) {
      // Allow request on storage errors to avoid blocking legitimate traffic
      console.error(`Rate limiter storage error: ${error.message}`);
      
      const rateLimitResult: RateLimitResult = {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetTime: windowStart + windowMs
      };

      return new Response(JSON.stringify(rateLimitResult), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Error': 'storage-error',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': (limit - 1).toString(),
          'X-RateLimit-Reset': Math.ceil((windowStart + windowMs) / 1000).toString()
        }
      });
    }
  }

  /**
   * Extract client identifier for rate limiting
   * Enhanced to handle various IP and user agent combinations
   */
  private getClientId(request: Request): string {
    const headers = request.headers;
    
    // Use CF-Connecting-IP header if available, fallback to various other headers
    const ip = headers.get('CF-Connecting-IP') || 
               headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
               headers.get('X-Real-IP') ||
               headers.get('X-Client-IP') ||
               'unknown';
    
    // Get user agent for more specific identification
    const userAgent = headers.get('User-Agent')?.substring(0, 100) || 'unknown';
    
    // Create a hash-like identifier to avoid overly long keys
    const baseId = `${ip}:${userAgent}`;
    
    // For very long identifiers, create a shorter hash
    if (baseId.length > 150) {
      // Simple hash function for consistent short identifiers
      let hash = 0;
      for (let i = 0; i < baseId.length; i++) {
        const char = baseId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `${ip}:${Math.abs(hash).toString(36)}`;
    }
    
    return baseId;
  }

  /**
   * Clean up old requests from storage to prevent unbounded growth
   */
  private async cleanupOldRequests(clientId: string, windowStart: number): Promise<void> {
    try {
      const requests = await this.state.storage.get<number[]>(clientId) || [];
      const recentRequests = requests.filter(time => time > windowStart);
      
      if (recentRequests.length < requests.length) {
        await this.state.storage.put(clientId, recentRequests);
      }
    } catch (error) {
      // Ignore cleanup errors - not critical
      console.warn(`Rate limiter cleanup failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get current rate limit status for a client without incrementing
   */
  async getRateLimitStatus(clientId: string): Promise<RateLimitResult> {
    const currentTime = Date.now();
    const windowMs = 15 * 60 * 1000;
    const limit = 100;
    const windowStart = currentTime - windowMs;

    try {
      const requests = await this.state.storage.get<number[]>(clientId) || [];
      const recentRequests = requests.filter(time => time > windowStart);

      return {
        allowed: recentRequests.length < limit,
        limit,
        remaining: Math.max(0, limit - recentRequests.length),
        resetTime: windowStart + windowMs
      };
    } catch (error) {
      // Return permissive status on error
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetTime: windowStart + windowMs
      };
    }
  }

  /**
   * Reset rate limit for a specific client (admin function)
   */
  async resetRateLimit(clientId: string): Promise<void> {
    try {
      await this.state.storage.delete(clientId);
    } catch (error) {
      console.warn(`Failed to reset rate limit for ${clientId}: ${(error as Error).message}`);
    }
  }

  /**
   * Get all active rate limit states (admin function)
   */
  async getAllRateLimitStates(): Promise<Record<string, RateLimitState>> {
    const currentTime = Date.now();
    const windowMs = 15 * 60 * 1000;
    const windowStart = currentTime - windowMs;
    const states: Record<string, RateLimitState> = {};

    try {
      const allData = await this.state.storage.list();
      
      for (const [clientId, requests] of allData) {
        if (Array.isArray(requests)) {
          const recentRequests = (requests as number[]).filter(time => time > windowStart);
          states[clientId] = {
            requests: recentRequests,
            windowStart,
            limit: 100,
            windowMs
          };
        }
      }
    } catch (error) {
      console.error(`Failed to get rate limit states: ${(error as Error).message}`);
    }

    return states;
  }
}

/**
 * Rate limiting service for integration with the main worker
 */
export class RateLimitingService {
  constructor(
    private env: Env,
    private config: WorkerConfig
  ) {}

  /**
   * Check rate limit for a request
   */
  async checkRateLimit(request: Request): Promise<RateLimitResult> {
    if (!this.config.features.enableRateLimiting || !this.env.RATE_LIMITER) {
      // Rate limiting disabled - allow all requests
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetTime: Date.now() + (15 * 60 * 1000)
      };
    }

    try {
      const rateLimiterId = this.env.RATE_LIMITER.idFromName('global');
      const rateLimiterObj = this.env.RATE_LIMITER.get(rateLimiterId);
      const rateLimitResponse = await rateLimiterObj.fetch(request.clone());
      
      if (!rateLimitResponse.ok) {
        const rateLimitData = await rateLimitResponse.json() as RateLimitResult;
        return rateLimitData;
      }

      const rateLimitData = await rateLimitResponse.json() as RateLimitResult;
      return rateLimitData;
    } catch (error) {
      // On error, allow request to avoid blocking legitimate traffic
      console.warn(`Rate limiting check failed: ${(error as Error).message}`);
      return {
        allowed: true,
        limit: 100,
        remaining: 99,
        resetTime: Date.now() + (15 * 60 * 1000)
      };
    }
  }

  /**
   * Add rate limit headers to a response
   */
  addRateLimitHeaders(headers: Headers, rateLimitResult: RateLimitResult): void {
    if (!this.config.features.enableRateLimiting) {
      return;
    }

    headers.set('X-RateLimit-Limit', rateLimitResult.limit.toString());
    headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    headers.set('X-RateLimit-Reset', Math.ceil(rateLimitResult.resetTime / 1000).toString());

    if (rateLimitResult.retryAfter) {
      headers.set('Retry-After', rateLimitResult.retryAfter.toString());
    }
  }

  /**
   * Create rate limit exceeded response
   */
  createRateLimitResponse(rateLimitResult: RateLimitResult, requestId?: string): Response {
    const errorResponse = {
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
      requestId,
      timestamp: new Date().toISOString(),
      retryAfter: rateLimitResult.retryAfter,
      rateLimit: {
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      }
    };

    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': rateLimitResult.limit.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString()
    });

    if (rateLimitResult.retryAfter) {
      headers.set('Retry-After', rateLimitResult.retryAfter.toString());
    }

    return new Response(JSON.stringify(errorResponse), {
      status: 429,
      headers
    });
  }
}

/**
 * Create rate limiting service instance
 */
export function createRateLimitingService(env: Env, config: WorkerConfig): RateLimitingService {
  return new RateLimitingService(env, config);
} 