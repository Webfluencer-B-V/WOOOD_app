import { Env } from '../types/env';
import { WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { Session } from '../types/session';
import { sessionAuthMiddleware } from './sessionAuth';

/**
 * Authentication types for different API endpoints
 */
export type AuthenticationType = 'none' | 'session' | 'session_admin' | 'hmac' | 'webhook';

/**
 * Rate limiting levels
 */
export type RateLimitLevel = 'low' | 'medium' | 'high' | 'strict' | 'webhook';

/**
 * Security rule for API endpoints
 */
export interface SecurityRule {
  auth: AuthenticationType;
  rateLimit: RateLimitLevel;
  adminRequired?: boolean;
}

/**
 * Authentication result
 */
export interface AuthenticationResult {
  authenticated: boolean;
  type: AuthenticationType;
  session?: Session;
  shopDomain?: string;
  rateLimitLevel: RateLimitLevel;
}

/**
 * Authentication error class
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTH_FAILED',
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * API Security Matrix - defines authentication requirements for all endpoints
 */
const API_SECURITY_MATRIX: Record<string, SecurityRule> = {
  // PUBLIC APIs (health check only)
  '/health': { auth: 'none', rateLimit: 'low' },
  '/': { auth: 'none', rateLimit: 'low' },

  // AUTHENTICATED APIs (require OAuth session)
  '/api/delivery-dates/available': { auth: 'session', rateLimit: 'medium' },
  '/api/products/shipping-methods': { auth: 'session', rateLimit: 'medium' },
  '/api/products/metafields': { auth: 'session', rateLimit: 'high' },
  '/api/products/erp-delivery-times': { auth: 'session', rateLimit: 'medium' },
  '/api/orders/metafields': { auth: 'session', rateLimit: 'high' },
  '/api/order-metafields/save': { auth: 'session', rateLimit: 'high' },

  // ADMIN APIs (require OAuth session + admin permissions)
  '/api/admin': { auth: 'session_admin', rateLimit: 'high', adminRequired: true },
  '/api/admin/feature-flags': { auth: 'session_admin', rateLimit: 'high', adminRequired: true },
  '/api/admin/system-health': { auth: 'session_admin', rateLimit: 'high', adminRequired: true },
  '/api/admin/activity-log': { auth: 'session_admin', rateLimit: 'high', adminRequired: true },
  '/api/webhooks/register': { auth: 'session_admin', rateLimit: 'strict', adminRequired: true },

  // WEBHOOK APIs (require HMAC signature)
  '/api/webhooks/orders': { auth: 'hmac', rateLimit: 'webhook' },
  '/api/webhooks/app': { auth: 'hmac', rateLimit: 'webhook' },
  '/api/webhooks/admin': { auth: 'hmac', rateLimit: 'webhook' },

  // AUTH APIs (OAuth flow)
  '/auth/start': { auth: 'none', rateLimit: 'medium' },
  '/auth/callback': { auth: 'none', rateLimit: 'medium' },
  '/auth/status': { auth: 'session', rateLimit: 'medium' }
};

/**
 * Get security rule for a given path
 */
function getSecurityRule(pathname: string): SecurityRule {
  // Direct match
  if (API_SECURITY_MATRIX[pathname]) {
    return API_SECURITY_MATRIX[pathname];
  }

  // Pattern matching for wildcards
  for (const [pattern, rule] of Object.entries(API_SECURITY_MATRIX)) {
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(pathname)) {
        return rule;
      }
    }
  }

  // Default to requiring session authentication for unknown endpoints
  return { auth: 'session', rateLimit: 'high' };
}

/**
 * Validate OAuth session
 */
async function validateSession(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Session | null> {
  try {
    const authResult = await sessionAuthMiddleware(request, env, config, logger, requestId);
    
    if (authResult.success && authResult.session) {
      return authResult.session;
    }
    
    return null;
  } catch (error) {
    logger.error('Session validation failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Validate admin session (OAuth session with admin permissions)
 */
async function validateAdminSession(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Session | null> {
  const session = await validateSession(request, env, config, logger, requestId);
  
  if (!session) {
    return null;
  }

  // Check if session has admin scopes
  const requiredScopes = ['read_products', 'read_orders', 'write_orders'];
  const sessionScopes = session.scope ? session.scope.split(',') : [];
  
  const hasRequiredScopes = requiredScopes.every(scope => 
    sessionScopes.includes(scope)
  );

  if (!hasRequiredScopes) {
    logger.warn('Session missing admin scopes', {
      requestId,
      sessionId: session.id,
      required: requiredScopes,
      actual: sessionScopes
    });
    return null;
  }

  return session;
}

/**
 * Validate webhook HMAC signature
 */
async function validateWebhookSignature(
  request: Request,
  env: Env,
  logger: WorkersLogger,
  requestId: string
): Promise<boolean> {
  try {
    const signature = request.headers.get('X-Shopify-Hmac-Sha256');
    const rawBody = await request.text();

    if (!signature) {
      logger.warn('Missing webhook signature', { requestId });
      return false;
    }

    // Use WEBHOOK_SECRET from environment
    const webhookSecret = env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error('WEBHOOK_SECRET not configured', { requestId });
      return false;
    }

    // Create HMAC signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const expectedSignature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(expectedSignature)));

    const isValid = signature === expectedBase64;

    if (!isValid) {
      logger.warn('Invalid webhook signature', {
        requestId,
        expected: expectedBase64.substring(0, 10) + '...',
        received: signature.substring(0, 10) + '...'
      });
    }

    return isValid;
  } catch (error) {
    logger.error('Webhook signature validation failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
}

/**
 * Main API authentication enforcement middleware
 */
export async function enforceAPIAuthentication(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<AuthenticationResult> {
  const url = new URL(request.url);
  const securityRule = getSecurityRule(url.pathname);

  logger.info('Enforcing API authentication', {
    requestId,
    path: url.pathname,
    method: request.method,
    authType: securityRule.auth,
    rateLimit: securityRule.rateLimit
  });

  switch (securityRule.auth) {
    case 'none':
      return { 
        authenticated: true, 
        type: 'none', 
        rateLimitLevel: securityRule.rateLimit 
      };

    case 'session': {
      const session = await validateSession(request, env, config, logger, requestId);
      if (!session) {
        throw new AuthenticationError(
          'Valid OAuth session required',
          'SESSION_REQUIRED',
          401
        );
      }
      return { 
        authenticated: true, 
        type: 'session', 
        session, 
        shopDomain: session.shop,
        rateLimitLevel: securityRule.rateLimit 
      };
    }

    case 'session_admin': {
      const adminSession = await validateAdminSession(request, env, config, logger, requestId);
      if (!adminSession) {
        throw new AuthenticationError(
          'Admin session required',
          'ADMIN_REQUIRED',
          403
        );
      }
      return { 
        authenticated: true, 
        type: 'session_admin', 
        session: adminSession, 
        shopDomain: adminSession.shop,
        rateLimitLevel: securityRule.rateLimit 
      };
    }

    case 'hmac': {
      // Clone request for body reading
      const clonedRequest = request.clone();
      const hmacValid = await validateWebhookSignature(clonedRequest, env, logger, requestId);
      if (!hmacValid) {
        throw new AuthenticationError(
          'Invalid webhook signature',
          'INVALID_SIGNATURE',
          401
        );
      }
      return { 
        authenticated: true, 
        type: 'webhook', 
        rateLimitLevel: securityRule.rateLimit 
      };
    }

    default:
      throw new AuthenticationError(
        'Unknown authentication requirement',
        'UNKNOWN_AUTH_TYPE',
        500
      );
  }
}

/**
 * Create authentication error response
 */
export function createAuthErrorResponse(
  error: AuthenticationError,
  requestId: string,
  shopDomain?: string
): Response {
  const responseBody = {
    error: error.name,
    message: error.message,
    code: error.code,
    requestId,
    timestamp: new Date().toISOString(),
    ...(shopDomain && { shopDomain }),
    ...(error.code === 'SESSION_REQUIRED' && {
      authUrl: shopDomain ? `/auth/start?shop=${encodeURIComponent(shopDomain)}` : '/auth/start'
    })
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId
  };

  // Add appropriate authentication headers
  if (error.code === 'SESSION_REQUIRED' || error.code === 'ADMIN_REQUIRED') {
    headers['WWW-Authenticate'] = 'Bearer realm="Shopify App"';
  }

  return new Response(
    JSON.stringify(responseBody, null, 2),
    {
      status: error.statusCode,
      headers
    }
  );
}

/**
 * Authentication middleware wrapper for route handlers
 */
export function withAuthentication<T extends any[]>(
  handler: (request: Request, env: Env, config: WorkerConfig, logger: WorkersLogger, requestId: string, ...args: T) => Promise<Response>,
  requiredAuth?: AuthenticationType
) {
  return async (
    request: Request,
    env: Env,
    config: WorkerConfig,
    logger: WorkersLogger,
    requestId: string,
    ...args: T
  ): Promise<Response> => {
    try {
      // Override security rule if specified
      if (requiredAuth) {
        const url = new URL(request.url);
        const originalRule = getSecurityRule(url.pathname);
        API_SECURITY_MATRIX[url.pathname] = { 
          ...originalRule, 
          auth: requiredAuth 
        };
      }

      const authResult = await enforceAPIAuthentication(request, env, config, logger, requestId);
      
      // Add authentication context to request
      const authenticatedRequest = request as any;
      authenticatedRequest.auth = authResult;
      
      return await handler(request, env, config, logger, requestId, ...args);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return createAuthErrorResponse(error, requestId);
      }
      
      logger.error('Authentication middleware error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: 'Authentication processing failed',
          requestId
        }),
        { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
  };
} 