import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';

/**
 * Note attribute interface from checkout extension
 */
export interface NoteAttribute {
  name: string;
  value: string;
}

/**
 * Order metafield interface for Shopify Admin API
 */
export interface OrderMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error interface
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  severity: 'error' | 'warning';
}

/**
 * Validation warning interface
 */
export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * GraphQL payload for metafield operations
 */
export interface GraphQLPayload {
  query: string;
  variables: Record<string, any>;
}

/**
 * Transformation metrics interface
 */
export interface TransformationMetrics {
  attributesProcessed: number;
  metafieldsGenerated: number;
  validationErrors: number;
  validationWarnings: number;
  processingTimeMs: number;
  transformationRules: string[];
}

/**
 * Note attribute mapping configuration
 */
interface NoteAttributeMapping {
  delivery_date: {
    metafield: 'custom.dutchned_delivery_date';
    type: 'single_line_text_field';
    required: false;
    validator: 'date';
  };
  shipping_method: {
    metafield: 'custom.ShippingMethod2';
    type: 'single_line_text_field';
    required: false;
    validator: 'text';
  };
}

const NOTE_ATTRIBUTE_MAPPING: NoteAttributeMapping = {
  delivery_date: {
    metafield: 'custom.dutchned_delivery_date',
    type: 'single_line_text_field',
    required: false,
    validator: 'date'
  },
  shipping_method: {
    metafield: 'custom.ShippingMethod2',
    type: 'single_line_text_field',
    required: false,
    validator: 'text'
  }
};

/**
 * Data transformation service for converting note attributes to metafields
 */
export class AttributeTransformService {
  private env: Env;
  private logger: WorkersLogger;

  constructor(env: Env, logger: WorkersLogger) {
    this.env = env;
    this.logger = logger;
  }

  /**
   * Transform note attributes to order metafields with validation
   */
  public transformNoteAttributesToMetafields(
    noteAttributes: NoteAttribute[],
    orderId: number,
    shop: string
  ): {
    metafields: OrderMetafield[];
    validation: ValidationResult;
    metrics: TransformationMetrics;
  } {
    const startTime = Date.now();
    const metrics: TransformationMetrics = {
      attributesProcessed: 0,
      metafieldsGenerated: 0,
      validationErrors: 0,
      validationWarnings: 0,
      processingTimeMs: 0,
      transformationRules: []
    };

    this.logger.info('Starting note attributes transformation', {
      orderId,
      shop,
      attributeCount: noteAttributes?.length || 0
    });

    // Validate input
    if (!noteAttributes || !Array.isArray(noteAttributes)) {
      const validation: ValidationResult = {
        isValid: false,
        errors: [{
          field: 'noteAttributes',
          message: 'Note attributes must be a valid array',
          code: 'INVALID_INPUT',
          severity: 'error'
        }],
        warnings: []
      };

      return {
        metafields: [],
        validation,
        metrics: { ...metrics, processingTimeMs: Date.now() - startTime }
      };
    }

    // Extract relevant attributes
    const extractedAttributes = this.extractRelevantAttributes(noteAttributes);
    metrics.attributesProcessed = Object.keys(extractedAttributes).length;

    // Validate extracted attributes
    const validation = this.validateNoteAttributes(extractedAttributes);
    metrics.validationErrors = validation.errors.filter(e => e.severity === 'error').length;
    metrics.validationWarnings = validation.warnings.length;

    // Transform valid attributes to metafields
    const metafields: OrderMetafield[] = [];

    for (const [attributeName, attributeValue] of Object.entries(extractedAttributes)) {
      if (!attributeValue) continue;

      const mapping = NOTE_ATTRIBUTE_MAPPING[attributeName as keyof NoteAttributeMapping];
      if (!mapping) continue;

      // Apply transformation rules
      const transformedValue = this.applyTransformationRules(
        attributeName,
        attributeValue,
        mapping.validator
      );

      if (transformedValue) {
        const [namespace, key] = mapping.metafield.split('.');

        metafields.push({
          namespace,
          key,
          value: transformedValue,
          type: mapping.type
        });

        metrics.transformationRules.push(`${attributeName} -> ${mapping.metafield}`);
        metrics.metafieldsGenerated++;
      }
    }

    metrics.processingTimeMs = Date.now() - startTime;

    this.logger.info('Note attributes transformation completed', {
      orderId,
      shop,
      metrics
    });

    return {
      metafields,
      validation,
      metrics
    };
  }

  /**
   * Validate note attributes according to business rules
   */
  public validateNoteAttributes(attributes: Record<string, string>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate delivery_date
    if (attributes.delivery_date) {
      const dateValidation = this.validateDate(attributes.delivery_date);
      if (!dateValidation.isValid) {
        errors.push({
          field: 'delivery_date',
          message: dateValidation.message,
          code: 'INVALID_DATE_FORMAT',
          severity: 'error'
        });
      } else if (dateValidation.warning) {
        warnings.push({
          field: 'delivery_date',
          message: dateValidation.warning,
          suggestion: 'Consider using a future date for delivery'
        });
      }
    }

    // Validate shipping_method
    if (attributes.shipping_method) {
      const textValidation = this.validateText(attributes.shipping_method, 255);
      if (!textValidation.isValid) {
        errors.push({
          field: 'shipping_method',
          message: textValidation.message,
          code: 'INVALID_TEXT_LENGTH',
          severity: 'error'
        });
      }
    }

    // Business rule: check if any attributes are present
    const hasAnyAttributes = Object.values(attributes).some(value => value && value.trim());
    if (!hasAnyAttributes) {
      warnings.push({
        field: 'general',
        message: 'No valid note attributes found for processing',
        suggestion: 'Ensure checkout extension is properly configured'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Generate GraphQL payload for metafield operations
   */
  public generateMetafieldPayload(
    metafields: OrderMetafield[],
    orderId: number,
    operation: 'create' | 'update' = 'create'
  ): GraphQLPayload {
    if (operation === 'create') {
      return this.generateCreateMetafieldsPayload(metafields, orderId);
    } else {
      return this.generateUpdateMetafieldsPayload(metafields, orderId);
    }
  }

  /**
   * Extract relevant note attributes from the full list
   */
  private extractRelevantAttributes(noteAttributes: NoteAttribute[]): Record<string, string> {
    const extracted: Record<string, string> = {};

    for (const attr of noteAttributes) {
      if (!attr.name || !attr.value) continue;

      // Map known attributes
      if (attr.name === 'delivery_date' && attr.value.trim()) {
        extracted.delivery_date = attr.value.trim();
      }

      if (attr.name === 'shipping_method' && attr.value.trim()) {
        extracted.shipping_method = attr.value.trim();
      }
    }

    return extracted;
  }

  /**
   * Apply transformation rules based on attribute type
   */
  private applyTransformationRules(
    attributeName: string,
    value: string,
    validator: string
  ): string | null {
    if (!value) return null;

    switch (validator) {
      case 'date':
        return this.transformDateValue(value);

      case 'text':
        return this.transformTextValue(value);

      default:
        return value;
    }
  }

  /**
   * Transform and validate date values
   */
  private transformDateValue(value: string): string | null {
    try {
      // Support multiple date formats
      let date: Date;

      // Try ISO format first (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        date = new Date(value + 'T00:00:00.000Z');
      } else {
        date = new Date(value);
      }

      if (isNaN(date.getTime())) {
        this.logger.warn('Invalid date value in transformation', { value });
        return null;
      }

      // Return in ISO date format
      return date.toISOString().split('T')[0];
    } catch (error) {
      this.logger.warn('Error transforming date value', { value, error });
      return null;
    }
  }

  /**
   * Transform and validate text values
   */
  private transformTextValue(value: string): string | null {
    if (!value || typeof value !== 'string') return null;

    // Trim whitespace
    const trimmed = value.trim();

    // Check length limits
    if (trimmed.length > 255) {
      this.logger.warn('Text value exceeds maximum length, truncating', {
        originalLength: trimmed.length,
        value: trimmed.substring(0, 50) + '...'
      });
      return trimmed.substring(0, 255);
    }

    return trimmed;
  }

  /**
   * Validate date format and value
   */
  private validateDate(value: string): {
    isValid: boolean;
    message?: string;
    warning?: string;
  } {
    // Check format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return {
        isValid: false,
        message: 'Date must be in YYYY-MM-DD format'
      };
    }

    // Check if valid date
    const date = new Date(value + 'T00:00:00.000Z');
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        message: 'Invalid date value'
      };
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (date < today) {
      return {
        isValid: true,
        warning: 'Delivery date is in the past'
      };
    }

    return { isValid: true };
  }

  /**
   * Validate text length and content
   */
  private validateText(value: string, maxLength: number = 255): {
    isValid: boolean;
    message?: string;
  } {
    if (!value || typeof value !== 'string') {
      return {
        isValid: false,
        message: 'Value must be a non-empty string'
      };
    }

    if (value.length > maxLength) {
      return {
        isValid: false,
        message: `Value exceeds maximum length of ${maxLength} characters`
      };
    }

    return { isValid: true };
  }

  /**
   * Generate GraphQL payload for creating metafields
   */
  private generateCreateMetafieldsPayload(metafields: OrderMetafield[], orderId: number): GraphQLPayload {
    const metafieldInputs = metafields.map(mf => ({
      namespace: mf.namespace,
      key: mf.key,
      value: mf.value,
      type: mf.type
    }));

    return {
      query: `
        mutation CreateOrderMetafields($orderId: ID!, $metafields: [MetafieldInput!]!) {
          order(id: $orderId) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        }
      `,
      variables: {
        orderId: `gid://shopify/Order/${orderId}`,
        metafields: metafieldInputs
      }
    };
  }

  /**
   * Generate GraphQL payload for updating metafields
   */
  private generateUpdateMetafieldsPayload(metafields: OrderMetafield[], orderId: number): GraphQLPayload {
    const metafieldInputs = metafields.map(mf => ({
      namespace: mf.namespace,
      key: mf.key,
      value: mf.value,
      type: mf.type
    }));

    return {
      query: `
        mutation UpdateOrderMetafields($orderId: ID!, $metafields: [MetafieldInput!]!) {
          order(id: $orderId) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
                updatedAt
              }
              userErrors {
                field
                message
              }
            }
          }
        }
      `,
      variables: {
        orderId: `gid://shopify/Order/${orderId}`,
        metafields: metafieldInputs
      }
    };
  }

  /**
   * Create transformation metrics for monitoring
   */
  public async recordTransformationMetrics(
    metrics: TransformationMetrics,
    orderId: number,
    shop: string
  ): Promise<void> {
    try {
      const metricsKey = `transformation_metrics:${shop}:${orderId}`;
      const metricsData = {
        ...metrics,
        timestamp: new Date().toISOString(),
        orderId,
        shop
      };

      await this.env.DELIVERY_CACHE.put(
        metricsKey,
        JSON.stringify(metricsData),
        { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
      );

      this.logger.info('Transformation metrics recorded', {
        orderId,
        shop,
        metricsKey
      });
    } catch (error: any) {
      this.logger.warn('Failed to record transformation metrics', {
        orderId,
        shop,
        error: error.message
      });
    }
  }

  /**
   * Get transformation statistics for monitoring
   */
  public async getTransformationStats(shop: string, days: number = 7): Promise<{
    totalTransformations: number;
    successRate: number;
    averageProcessingTime: number;
    commonErrors: Array<{ error: string; count: number }>;
  }> {
    try {
      const { keys } = await this.env.DELIVERY_CACHE.list({
        prefix: `transformation_metrics:${shop}:`
      });

      const metrics = await Promise.all(
        keys.map(async (key) => {
          const data = await this.env.DELIVERY_CACHE.get(key.name);
          return data ? JSON.parse(data) : null;
        })
      );

      const validMetrics = metrics
        .filter(Boolean)
        .filter(m => {
          const metricDate = new Date(m.timestamp);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - days);
          return metricDate >= cutoffDate;
        });

      if (validMetrics.length === 0) {
        return {
          totalTransformations: 0,
          successRate: 0,
          averageProcessingTime: 0,
          commonErrors: []
        };
      }

      const totalTransformations = validMetrics.length;
      const successfulTransformations = validMetrics.filter(m => m.validationErrors === 0).length;
      const successRate = (successfulTransformations / totalTransformations) * 100;
      const averageProcessingTime = validMetrics.reduce((sum, m) => sum + m.processingTimeMs, 0) / totalTransformations;

      return {
        totalTransformations,
        successRate,
        averageProcessingTime,
        commonErrors: [] // TODO: Implement error aggregation
      };
    } catch (error: any) {
      this.logger.error('Failed to get transformation stats', {
        shop,
        error: error.message
      });

      return {
        totalTransformations: 0,
        successRate: 0,
        averageProcessingTime: 0,
        commonErrors: []
      };
    }
  }
}