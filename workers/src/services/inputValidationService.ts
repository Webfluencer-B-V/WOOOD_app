import { WorkersLogger } from '../utils/logger';

/**
 * Validation schema types
 */
export interface ValidationSchema {
  [key: string]: FieldSchema;
}

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  pattern?: RegExp;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  items?: 'string' | 'number' | FieldSchema;
  properties?: ValidationSchema;
}

/**
 * Validated input result
 */
export interface ValidatedInput {
  valid: boolean;
  data?: any;
  errors: string[];
  sanitized?: any;
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: string[] = [],
    public field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Input validation service for preventing XSS, injection, and other attacks
 */
export class InputValidationService {
  
  /**
   * Validate delivery date request payload
   */
  static validateDeliveryDateRequest(data: any): ValidatedInput {
    const schema: ValidationSchema = {
      postal_code: { 
        type: 'string', 
        pattern: /^[0-9]{4}[A-Z]{2}$/, 
        required: true,
        minLength: 6,
        maxLength: 6
      },
      country: { 
        type: 'string', 
        enum: ['NL'], 
        required: false 
      },
      product_ids: { 
        type: 'array', 
        items: 'number', 
        maxLength: 50, 
        required: false 
      },
      shipping_method_id: {
        type: 'number',
        min: 1,
        required: false
      }
    };

    return this.validateInput(data, schema);
  }

  /**
   * Validate shipping method request payload
   */
  static validateShippingMethodRequest(data: any): ValidatedInput {
    const schema: ValidationSchema = {
      product_id: { 
        type: 'number', 
        min: 1, 
        required: true 
      },
      shop_domain: { 
        type: 'string', 
        pattern: /^[a-zA-Z0-9-]+\.myshopify\.com$/, 
        required: true,
        maxLength: 255
      },
      postal_code: {
        type: 'string',
        pattern: /^[0-9]{4}[A-Z]{2}$/,
        required: false
      }
    };

    return this.validateInput(data, schema);
  }

  /**
   * Validate webhook payload (Shopify webhook structure)
   */
  static validateWebhookPayload(data: any): ValidatedInput {
    const schema: ValidationSchema = {
      id: { 
        type: 'number', 
        required: true,
        min: 1
      },
      email: { 
        type: 'string', 
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 
        required: false,
        maxLength: 320 // RFC 5321 limit
      },
      note_attributes: { 
        type: 'array', 
        maxLength: 20, 
        required: false,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 100, required: true },
            value: { type: 'string', maxLength: 500, required: false }
          }
        }
      },
      line_items: {
        type: 'array',
        maxLength: 100,
        required: false,
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', required: true },
            product_id: { type: 'number', required: false },
            variant_id: { type: 'number', required: false }
          }
        }
      }
    };

    return this.validateInput(data, schema);
  }

  /**
   * Validate order metafield request
   */
  static validateOrderMetafieldRequest(data: any): ValidatedInput {
    const schema: ValidationSchema = {
      order_id: {
        type: 'number',
        min: 1,
        required: true
      },
      delivery_date: {
        type: 'string',
        pattern: /^\d{4}-\d{2}-\d{2}$/,
        required: true
      },
      shipping_method: {
        type: 'string',
        maxLength: 100,
        required: false
      },
      shop_domain: {
        type: 'string',
        pattern: /^[a-zA-Z0-9-]+\.myshopify\.com$/,
        required: true,
        maxLength: 255
      }
    };

    return this.validateInput(data, schema);
  }

  /**
   * Validate feature flag update request
   */
  static validateFeatureFlagRequest(data: any): ValidatedInput {
    const validFlags = [
      'USE_MOCK_DELIVERY_DATES',
      'ENABLE_CACHING',
      'ENABLE_RATE_LIMITING',
      'ENABLE_MOCK_FALLBACK',
      'ENABLE_DETAILED_ERROR_MESSAGES',
      'ENABLE_PERFORMANCE_MONITORING',
      'ENABLE_REQUEST_LOGGING',
      'ENABLE_ERROR_TRACKING',
      'ENABLE_LOADING_STATES',
      'ENABLE_USER_FEEDBACK',
      'ENABLE_EXTERNAL_ERROR_REPORTING',
      'ENABLE_ANALYTICS_TRACKING',
      'ENABLE_WEBHOOK_NOTIFICATIONS'
    ];

    const schema: ValidationSchema = {
      flag: {
        type: 'string',
        enum: validFlags,
        required: true
      },
      enabled: {
        type: 'boolean',
        required: true
      },
      shop_domain: {
        type: 'string',
        pattern: /^[a-zA-Z0-9-]+\.myshopify\.com$/,
        required: true,
        maxLength: 255
      }
    };

    return this.validateInput(data, schema);
  }

  /**
   * Main input validation function
   */
  private static validateInput(data: any, schema: ValidationSchema): ValidatedInput {
    const errors: string[] = [];
    let sanitized: any;

    try {
      // First, sanitize the input
      sanitized = this.sanitizeInput(data);

      // Then validate against schema
      const validated = this.applySchema(sanitized, schema, errors);

      if (errors.length > 0) {
        return {
          valid: false,
          errors,
          data: sanitized
        };
      }

      return {
        valid: true,
        data: validated,
        sanitized,
        errors: []
      };
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        valid: false,
        errors,
        data: sanitized
      };
    }
  }

  /**
   * Sanitize input to prevent XSS and injection attacks
   */
  private static sanitizeInput(input: any): any {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      return this.sanitizeString(input);
    }

    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }

    if (typeof input === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        // Sanitize both key and value
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeInput(value);
      }
      return sanitized;
    }

    return input;
  }

  /**
   * Sanitize string input to prevent XSS attacks
   */
  private static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return input;
    }

    // Remove HTML tags
    let sanitized = input.replace(/<[^>]*>/g, '');

    // Remove JavaScript protocol
    sanitized = sanitized.replace(/javascript:/gi, '');

    // Remove data URLs
    sanitized = sanitized.replace(/data:[^;]*;/gi, '');

    // Remove event handlers
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    // Limit length to prevent DoS
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }

    return sanitized;
  }

  /**
   * Apply validation schema to sanitized data
   */
  private static applySchema(data: any, schema: ValidationSchema, errors: string[], path: string = ''): any {
    if (typeof data !== 'object' || data === null) {
      errors.push(`${path || 'root'}: Expected object, got ${typeof data}`);
      return data;
    }

    const validated: any = {};

    // Check required fields
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const fieldPath = path ? `${path}.${fieldName}` : fieldName;
      const value = data[fieldName];

      if (fieldSchema.required && (value === undefined || value === null)) {
        errors.push(`${fieldPath}: Required field is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        const validatedValue = this.validateField(value, fieldSchema, errors, fieldPath);
        if (validatedValue !== undefined) {
          validated[fieldName] = validatedValue;
        }
      }
    }

    return validated;
  }

  /**
   * Validate individual field against schema
   */
  private static validateField(value: any, schema: FieldSchema, errors: string[], path: string): any {
    // Type validation
    if (!this.validateType(value, schema.type)) {
      errors.push(`${path}: Expected ${schema.type}, got ${typeof value}`);
      return undefined;
    }

    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.pattern && !schema.pattern.test(value)) {
        errors.push(`${path}: Does not match required pattern`);
        return undefined;
      }

      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: Must be at least ${schema.minLength} characters`);
        return undefined;
      }

      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: Must be at most ${schema.maxLength} characters`);
        return undefined;
      }

      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: Must be one of: ${schema.enum.join(', ')}`);
        return undefined;
      }
    }

    // Number validations
    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.min !== undefined && value < schema.min) {
        errors.push(`${path}: Must be at least ${schema.min}`);
        return undefined;
      }

      if (schema.max !== undefined && value > schema.max) {
        errors.push(`${path}: Must be at most ${schema.max}`);
        return undefined;
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: Array too long (max ${schema.maxLength} items)`);
        return undefined;
      }

      if (schema.items) {
        const validatedItems = value.map((item, index) => {
          if (typeof schema.items === 'string') {
            if (!this.validateType(item, schema.items)) {
              errors.push(`${path}[${index}]: Expected ${schema.items}, got ${typeof item}`);
              return undefined;
            }
            return item;
          } else if (typeof schema.items === 'object') {
            return this.validateField(item, schema.items, errors, `${path}[${index}]`);
          }
          return item;
        }).filter(item => item !== undefined);

        return validatedItems;
      }
    }

    // Object validations
    if (schema.type === 'object' && typeof value === 'object' && schema.properties) {
      return this.applySchema(value, schema.properties, errors, path);
    }

    return value;
  }

  /**
   * Validate type of value
   */
  private static validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Validate SQL injection patterns
   */
  static containsSQLInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b)/i,
      /(UNION\s+SELECT)/i,
      /(\-\-|\#|\/\*|\*\/)/,
      /(;|\||&)/,
      /((\%27)|(\')).*(\%22)|(\")/,
      /((\%27)|(\')).*(\-\-)/,
      /((\%27)|(\')).*(\%23)/
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Validate XSS patterns
   */
  static containsXSS(input: string): boolean {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<img[^>]+src[\\s]*=[\\s]*['"]javascript:/gi,
      /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi
    ];

    return xssPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Log validation errors for security monitoring
   */
  static logSecurityViolation(
    input: any,
    violationType: 'XSS' | 'SQL_INJECTION' | 'INVALID_INPUT',
    errors: string[],
    logger?: WorkersLogger,
    requestId?: string
  ): void {
    if (logger) {
      logger.warn('Security validation violation detected', {
        requestId,
        violationType,
        errors,
        inputSample: typeof input === 'string' ? input.substring(0, 100) : JSON.stringify(input).substring(0, 100),
        timestamp: new Date().toISOString()
      });
    }
  }
} 