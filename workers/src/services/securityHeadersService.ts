import { Env } from '../types/env';
import { WorkerConfig } from '../types/env';

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  enableHSTS: boolean;
  enableCSP: boolean;
  enableXFrameOptions: boolean;
  enableXContentTypeOptions: boolean;
  enableReferrerPolicy: boolean;
  enablePermissionsPolicy: boolean;
  enableCORP: boolean;
  customHeaders?: Record<string, string>;
}

/**
 * Content Security Policy configuration
 */
export interface CSPConfig {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  connectSrc: string[];
  fontSrc: string[];
  objectSrc: string[];
  mediaSrc: string[];
  frameSrc: string[];
  childSrc: string[];
  formAction: string[];
  frameAncestors?: string[];
  upgradeInsecureRequests: boolean;
  blockAllMixedContent: boolean;
}

/**
 * Security headers service for implementing enterprise-grade security
 */
export class SecurityHeadersService {
  
  /**
   * Get default security headers configuration
   */
  static getDefaultConfig(env: Env): SecurityHeadersConfig {
    const isProd = env.ENVIRONMENT === 'production';
    
    return {
      enableHSTS: isProd,
      enableCSP: true,
      enableXFrameOptions: true,
      enableXContentTypeOptions: true,
      enableReferrerPolicy: true,
      enablePermissionsPolicy: true,
      enableCORP: true,
      customHeaders: {
        'X-Powered-By': 'WOOOD Delivery API',
        'X-API-Version': '2.0.0'
      }
    };
  }

  /**
   * Get Content Security Policy for different contexts
   */
  static getCSPConfig(context: 'api' | 'admin' | 'webhook' | 'public'): CSPConfig {
    const baseCSP: CSPConfig = {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      childSrc: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: true,
      blockAllMixedContent: true
    };

    switch (context) {
      case 'admin':
        return {
          ...baseCSP,
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Required for Shopify App Bridge
            "https://cdn.shopify.com",
            "https://unpkg.com/@shopify/app-bridge",
            "https://unpkg.com/@shopify/polaris"
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.shopify.com",
            "https://unpkg.com/@shopify/polaris"
          ],
          connectSrc: [
            "'self'",
            "https://*.myshopify.com",
            "https://cdn.shopify.com",
            "https://eekhoorn-connector.dutchned.com"
          ],
          frameSrc: [
            "https://*.myshopify.com"
          ],
          frameAncestors: [
            "https://*.myshopify.com"
          ]
        };

      case 'webhook':
        return {
          ...baseCSP,
          connectSrc: [
            "'self'",
            "https://*.shopify.com",
            "https://eekhoorn-connector.dutchned.com"
          ]
        };

      case 'public':
        return {
          ...baseCSP,
          connectSrc: [
            "'self'",
            "https://checkout.shopify.com",
            "https://shop.app"
          ]
        };

      case 'api':
      default:
        return baseCSP;
    }
  }

  /**
   * Generate CSP header value from configuration
   */
  static generateCSPHeader(config: CSPConfig): string {
    const directives: string[] = [];

    // Add each directive if it has values
    if (config.defaultSrc.length > 0) {
      directives.push(`default-src ${config.defaultSrc.join(' ')}`);
    }
    if (config.scriptSrc.length > 0) {
      directives.push(`script-src ${config.scriptSrc.join(' ')}`);
    }
    if (config.styleSrc.length > 0) {
      directives.push(`style-src ${config.styleSrc.join(' ')}`);
    }
    if (config.imgSrc.length > 0) {
      directives.push(`img-src ${config.imgSrc.join(' ')}`);
    }
    if (config.connectSrc.length > 0) {
      directives.push(`connect-src ${config.connectSrc.join(' ')}`);
    }
    if (config.fontSrc.length > 0) {
      directives.push(`font-src ${config.fontSrc.join(' ')}`);
    }
    if (config.objectSrc.length > 0) {
      directives.push(`object-src ${config.objectSrc.join(' ')}`);
    }
    if (config.mediaSrc.length > 0) {
      directives.push(`media-src ${config.mediaSrc.join(' ')}`);
    }
    if (config.frameSrc.length > 0) {
      directives.push(`frame-src ${config.frameSrc.join(' ')}`);
    }
    if (config.childSrc.length > 0) {
      directives.push(`child-src ${config.childSrc.join(' ')}`);
    }
    if (config.formAction.length > 0) {
      directives.push(`form-action ${config.formAction.join(' ')}`);
    }

    // Add special directives
    if (config.upgradeInsecureRequests) {
      directives.push('upgrade-insecure-requests');
    }
    if (config.blockAllMixedContent) {
      directives.push('block-all-mixed-content');
    }

    // Handle frame-ancestors for admin context
    if ((config as any).frameAncestors) {
      directives.push(`frame-ancestors ${(config as any).frameAncestors.join(' ')}`);
    }

    return directives.join('; ');
  }

  /**
   * Apply security headers to response
   */
  static applySecurityHeaders(
    response: Response,
    config: SecurityHeadersConfig,
    context: 'api' | 'admin' | 'webhook' | 'public' = 'api',
    env: Env
  ): Response {
    const headers = new Headers(response.headers);
    const isProd = env.ENVIRONMENT === 'production';

    // HSTS (HTTP Strict Transport Security)
    if (config.enableHSTS && isProd) {
      headers.set(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload'
      );
    }

    // Content Security Policy
    if (config.enableCSP) {
      const cspConfig = this.getCSPConfig(context);
      const cspHeader = this.generateCSPHeader(cspConfig);
      headers.set('Content-Security-Policy', cspHeader);
      
      // Also set report-only header for monitoring
      if (!isProd) {
        headers.set('Content-Security-Policy-Report-Only', cspHeader);
      }
    }

    // X-Frame-Options
    if (config.enableXFrameOptions) {
      if (context === 'admin') {
        // Allow framing for Shopify admin embedding
        headers.set('X-Frame-Options', 'ALLOWALL');
      } else {
        headers.set('X-Frame-Options', 'DENY');
      }
    }

    // X-Content-Type-Options
    if (config.enableXContentTypeOptions) {
      headers.set('X-Content-Type-Options', 'nosniff');
    }

    // Referrer Policy
    if (config.enableReferrerPolicy) {
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    // Permissions Policy (Feature Policy)
    if (config.enablePermissionsPolicy) {
      const permissionsPolicy = [
        'geolocation=()',
        'camera=()',
        'microphone=()',
        'payment=(self)',
        'usb=()',
        'magnetometer=()',
        'gyroscope=()',
        'accelerometer=()'
      ].join(', ');
      headers.set('Permissions-Policy', permissionsPolicy);
    }

    // Cross-Origin Resource Policy
    if (config.enableCORP) {
      if (context === 'admin') {
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      } else {
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      }
    }

    // Additional security headers
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('X-Download-Options', 'noopen');
    headers.set('X-Permitted-Cross-Domain-Policies', 'none');
    headers.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    // Custom headers
    if (config.customHeaders) {
      for (const [name, value] of Object.entries(config.customHeaders)) {
        headers.set(name, value);
      }
    }

    // Security monitoring headers
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-DNS-Prefetch-Control', 'off');
    headers.set('Expect-CT', 'max-age=86400, enforce');

    // Request ID for tracking
    if (!headers.has('X-Request-ID')) {
      headers.set('X-Request-ID', crypto.randomUUID());
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  /**
   * Create secure response with headers
   */
  static createSecureResponse(
    body: BodyInit | null,
    options: ResponseInit = {},
    context: 'api' | 'admin' | 'webhook' | 'public' = 'api',
    env: Env
  ): Response {
    const config = this.getDefaultConfig(env);
    const response = new Response(body, options);
    return this.applySecurityHeaders(response, config, context, env);
  }

  /**
   * Apply CORS headers with security considerations
   */
  static applyCORSHeaders(
    response: Response,
    allowedOrigins: string[],
    requestOrigin?: string | null,
    context: 'api' | 'admin' | 'webhook' | 'public' = 'api'
  ): Response {
    const headers = new Headers(response.headers);

    // Validate origin against allowlist
    if (requestOrigin) {
      const isAllowed = allowedOrigins.some(allowed => {
        if (allowed === '*') {
          return context === 'public'; // Only allow wildcard for public APIs
        }
        if (allowed.includes('*')) {
          const pattern = allowed.replace(/\*/g, '.*');
          return new RegExp(`^${pattern}$`).test(requestOrigin);
        }
        return allowed === requestOrigin;
      });

      if (isAllowed) {
        headers.set('Access-Control-Allow-Origin', requestOrigin);
        headers.set('Vary', 'Origin');
      }
    }

    // CORS headers based on context
    if (context === 'admin') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', [
        'Content-Type',
        'Authorization',
        'X-Shopify-Shop-Domain',
        'X-Shopify-Access-Token',
        'X-Request-ID',
        'X-Session-ID'
      ].join(', '));
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Max-Age', '86400'); // 24 hours
    } else if (context === 'webhook') {
      headers.set('Access-Control-Allow-Methods', 'POST');
      headers.set('Access-Control-Allow-Headers', [
        'Content-Type',
        'X-Shopify-Hmac-Sha256',
        'X-Shopify-Topic',
        'X-Shopify-Shop-Domain'
      ].join(', '));
    } else {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', [
        'Content-Type',
        'X-Shopify-Shop-Domain',
        'X-Request-ID'
      ].join(', '));
      headers.set('Access-Control-Max-Age', '3600'); // 1 hour
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  /**
   * Handle preflight CORS requests
   */
  static handlePreflightRequest(
    request: Request,
    allowedOrigins: string[],
    context: 'api' | 'admin' | 'webhook' | 'public' = 'api',
    env: Env
  ): Response {
    const origin = request.headers.get('Origin');
    const requestMethod = request.headers.get('Access-Control-Request-Method');
    const requestHeaders = request.headers.get('Access-Control-Request-Headers');

    // Create base preflight response
    const response = this.createSecureResponse(null, {
      status: 204,
      headers: {
        'Content-Length': '0'
      }
    }, context, env);

    // Apply CORS headers
    return this.applyCORSHeaders(response, allowedOrigins, origin, context);
  }

  /**
   * Validate request for security threats
   */
  static validateRequestSecurity(request: Request): {
    valid: boolean;
    threats: string[];
    blocked: boolean;
  } {
    const threats: string[] = [];
    let blocked = false;

    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';

    // Check for malicious patterns in URL
    if (this.containsMaliciousPatterns(url.pathname + url.search)) {
      threats.push('Malicious URL pattern detected');
      blocked = true;
    }

    // Check for bot/scanner patterns
    if (this.isSuspiciousUserAgent(userAgent)) {
      threats.push('Suspicious User-Agent detected');
    }

    // Check for suspicious referers
    if (referer && this.isSuspiciousReferer(referer)) {
      threats.push('Suspicious referer detected');
    }

    // Check for header injection attempts
    const commonHeaders = ['user-agent', 'referer', 'authorization', 'x-forwarded-for', 'x-real-ip'];
    for (const headerName of commonHeaders) {
      const value = request.headers.get(headerName);
      if (value && this.containsHeaderInjection(headerName, value)) {
        threats.push(`Header injection attempt: ${headerName}`);
        blocked = true;
      }
    }

    return {
      valid: threats.length === 0,
      threats,
      blocked
    };
  }

  /**
   * Check for malicious patterns in URL
   */
  private static containsMaliciousPatterns(urlString: string): boolean {
    const maliciousPatterns = [
      /\.\./,                          // Directory traversal
      /\/etc\/passwd/,                 // System file access
      /\/proc\//,                      // Process information
      /<script/i,                      // XSS attempts
      /javascript:/i,                  // JavaScript injection
      /data:/i,                        // Data URLs
      /vbscript:/i,                    // VBScript injection
      /on\w+=/i,                       // Event handlers
      /union.*select/i,                // SQL injection
      /drop.*table/i,                  // SQL injection
      /insert.*into/i,                 // SQL injection
      /update.*set/i,                  // SQL injection
      /delete.*from/i                  // SQL injection
    ];

    return maliciousPatterns.some(pattern => pattern.test(urlString));
  }

  /**
   * Check for suspicious user agents
   */
  private static isSuspiciousUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /sqlmap/i,
      /nikto/i,
      /nmap/i,
      /masscan/i,
      /zap/i,
      /burp/i,
      /scanner/i,
      /crawler/i,
      /bot.*bot/i,
      /hack/i,
      /exploit/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  /**
   * Check for suspicious referers
   */
  private static isSuspiciousReferer(referer: string): boolean {
    try {
      const refererUrl = new URL(referer);
      
      // Check for suspicious domains
      const suspiciousDomains = [
        'attacker.com',
        'malicious.site',
        'phishing.net'
      ];

      return suspiciousDomains.some(domain => 
        refererUrl.hostname.includes(domain)
      );
    } catch {
      // Invalid URL format is suspicious
      return true;
    }
  }

  /**
   * Check for header injection attempts
   */
  private static containsHeaderInjection(name: string, value: string): boolean {
    // Look for CRLF injection
    const crlfPattern = /\r|\n/;
    
    return crlfPattern.test(name) || crlfPattern.test(value);
  }
} 