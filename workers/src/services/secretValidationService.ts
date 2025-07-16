import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';

/**
 * Validation result interface
 */
interface ValidationResult {
  valid: boolean;
  secrets: string[];
  missing?: string[];
  warnings?: string[];
}

/**
 * Secret rotation result interface
 */
interface SecretRotationResult {
  rotated: string[];
  failed: string[];
  nextRotation: Date;
}

/**
 * Secret validation and management service
 * Ensures all required secrets are present and properly configured
 */
export class SecretValidationService {
  
  /**
   * Validate that all required secrets are present
   * This should be called at worker startup to ensure security compliance
   */
  static validateRequiredSecrets(env: Env, requireRuntimeSecrets: boolean = false): ValidationResult {
    // Secrets required at deployment time (must be pre-configured)
    const deploymentSecrets = [
      'SHOPIFY_APP_CLIENT_SECRET',
      'DUTCHNED_API_CREDENTIALS'
    ];

    // Secrets generated during runtime (OAuth flow, app installation)
    const runtimeSecrets = [
      'SESSION_SECRET',
      'WEBHOOK_SECRET',
      'API_ENCRYPTION_KEY'
    ];

    const optionalSecrets = [
      'WOOOD_OAUTH_CLIENT_ID' // Can be in vars but preferred as secret
    ];

    // Always check deployment secrets
    const missingDeployment = deploymentSecrets.filter(secret => {
      const value = env[secret as keyof Env];
      return !value || typeof value !== 'string' || value.trim().length === 0;
    });

    // Only check runtime secrets if explicitly required (e.g., during actual API calls)
    const missingRuntime = requireRuntimeSecrets ? runtimeSecrets.filter(secret => {
      const value = env[secret as keyof Env];
      return !value || typeof value !== 'string' || value.trim().length === 0;
    }) : [];

    // Check for warnings (optional secrets missing)
    const warnings = optionalSecrets.filter(secret => {
      const value = env[secret as keyof Env];
      return !value || typeof value !== 'string' || value.trim().length === 0;
    }).map(secret => `${secret} should be moved to secrets for enhanced security`);

    // Add info about runtime secrets if they're not present yet
    if (!requireRuntimeSecrets && runtimeSecrets.some(secret => {
      const value = env[secret as keyof Env];
      return !value || typeof value !== 'string' || value.trim().length === 0;
    })) {
      warnings.push('Runtime secrets (SESSION_SECRET, WEBHOOK_SECRET, API_ENCRYPTION_KEY) will be generated during OAuth flow');
    }

    if (missingDeployment.length > 0) {
      const errorMessage = `SECURITY ERROR: Missing required deployment secrets: ${missingDeployment.join(', ')}. ` +
        `Set them using: ${missingDeployment.map(s => `wrangler secret put ${s} --env ${env.ENVIRONMENT}`).join(' && ')}`;
      throw new Error(errorMessage);
    }

    if (missingRuntime.length > 0) {
      const errorMessage = `SECURITY ERROR: Missing required runtime secrets: ${missingRuntime.join(', ')}. ` +
        `These should be generated during OAuth flow. If this error persists, check the OAuth implementation.`;
      throw new Error(errorMessage);
    }

    return { 
      valid: true, 
      secrets: [...deploymentSecrets, ...(requireRuntimeSecrets ? runtimeSecrets : [])],
      ...(warnings.length > 0 && { warnings })
    };
  }

  /**
   * Validate secret quality and security requirements
   */
  static validateSecretQuality(env: Env, logger?: WorkersLogger): ValidationResult {
    const checks = [];
    const warnings = [];

    // Check SESSION_SECRET strength
    const sessionSecret = env.SESSION_SECRET;
    if (sessionSecret) {
      if (sessionSecret.length < 32) {
        warnings.push('SESSION_SECRET should be at least 32 characters long');
      }
      if (!/[A-Z]/.test(sessionSecret) || !/[a-z]/.test(sessionSecret) || !/[0-9]/.test(sessionSecret)) {
        warnings.push('SESSION_SECRET should contain uppercase, lowercase, and numeric characters');
      }
    }

    // Check WEBHOOK_SECRET format
    const webhookSecret = env.WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret.length < 16) {
      warnings.push('WEBHOOK_SECRET should be at least 16 characters long');
    }

    // Check API_ENCRYPTION_KEY
    const encryptionKey = env.API_ENCRYPTION_KEY;
    if (encryptionKey && encryptionKey.length < 32) {
      warnings.push('API_ENCRYPTION_KEY should be at least 32 characters long');
    }

    // Check for weak/default secrets
    const weakSecrets = ['password', 'secret', '123456', 'admin', 'default'];
    [sessionSecret, webhookSecret, encryptionKey].forEach((secret, index) => {
      const secretNames = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'API_ENCRYPTION_KEY'];
      if (secret && weakSecrets.some(weak => secret.toLowerCase().includes(weak))) {
        warnings.push(`${secretNames[index]} appears to contain weak/default values`);
      }
    });

    if (logger && warnings.length > 0) {
      logger.warn('Secret quality warnings detected', {
        warnings: warnings.length,
        details: warnings
      });
    }

    return {
      valid: warnings.length === 0,
      secrets: ['SESSION_SECRET', 'WEBHOOK_SECRET', 'API_ENCRYPTION_KEY'],
      warnings
    };
  }

  /**
   * Generate a cryptographically secure secret
   */
  static generateSecureSecret(length: number = 32): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset[array[i] % charset.length];
    }
    
    return result;
  }

  /**
   * Check if secrets need rotation based on age
   * In production, secrets should be rotated every 90 days
   */
  static async checkSecretRotationNeeds(env: Env): Promise<{
    rotationNeeded: boolean;
    secretsToRotate: string[];
    lastRotation?: Date;
    nextRotation: Date;
  }> {
    try {
      // Get last rotation timestamp from KV storage
      const rotationData = await env.WOOOD_KV.get('secret_rotation_metadata', 'json') as {
        lastRotation: string;
        rotatedSecrets: string[];
      } | null;

      const lastRotation = rotationData ? new Date(rotationData.lastRotation) : null;
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Check if rotation is needed (no previous rotation or >90 days old)
      const rotationNeeded = !lastRotation || lastRotation < ninetyDaysAgo;

      // In production, rotate SESSION_SECRET and API_ENCRYPTION_KEY
      // WEBHOOK_SECRET and DUTCHNED_API_CREDENTIALS require coordination with external systems
      const secretsToRotate = rotationNeeded ? ['SESSION_SECRET', 'API_ENCRYPTION_KEY'] : [];

      // Calculate next rotation date (90 days from last rotation or now)
      const baseDate = lastRotation || now;
      const nextRotation = new Date(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);

      return {
        rotationNeeded,
        secretsToRotate,
        lastRotation: lastRotation || undefined,
        nextRotation
      };
    } catch (error) {
      // If we can't check rotation metadata, assume rotation is needed for safety
      return {
        rotationNeeded: true,
        secretsToRotate: ['SESSION_SECRET', 'API_ENCRYPTION_KEY'],
        nextRotation: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      };
    }
  }

  /**
   * Rotate session secrets (this generates new secrets but doesn't update Cloudflare)
   * The generated secrets need to be manually updated via wrangler CLI for security
   */
  static async rotateSessionSecrets(env: Env, logger?: WorkersLogger): Promise<SecretRotationResult> {
    const secretsToRotate = ['SESSION_SECRET', 'API_ENCRYPTION_KEY'];
    const rotated: string[] = [];
    const failed: string[] = [];

    try {
      // Generate new secrets
      const newSecrets: Record<string, string> = {};
      
      for (const secretName of secretsToRotate) {
        try {
          newSecrets[secretName] = this.generateSecureSecret(48); // 48 chars for extra security
          rotated.push(secretName);
          
          if (logger) {
            logger.info(`Generated new ${secretName}`, {
              secretName,
              length: newSecrets[secretName].length,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          failed.push(secretName);
          if (logger) {
            logger.error(`Failed to generate new ${secretName}`, {
              secretName,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }

      // Store rotation metadata
      const rotationMetadata = {
        lastRotation: new Date().toISOString(),
        rotatedSecrets: rotated,
        generatedSecrets: Object.keys(newSecrets),
        rotationId: crypto.randomUUID()
      };

      await env.WOOOD_KV.put('secret_rotation_metadata', JSON.stringify(rotationMetadata));

      // Store the generated secrets temporarily for manual update
      // These will expire in 1 hour for security
      await env.WOOOD_KV.put(
        'generated_secrets_for_rotation', 
        JSON.stringify(newSecrets),
        { expirationTtl: 3600 } // 1 hour expiration
      );

      if (logger) {
        logger.info('Secret rotation completed', {
          rotated: rotated.length,
          failed: failed.length,
          rotationId: rotationMetadata.rotationId,
          instructions: 'Use `yarn secrets:update-from-rotation` to apply new secrets'
        });
      }

      const nextRotation = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      return {
        rotated,
        failed,
        nextRotation
      };

    } catch (error) {
      if (logger) {
        logger.error('Secret rotation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          attempted: secretsToRotate
        });
      }

      return {
        rotated: [],
        failed: secretsToRotate,
        nextRotation: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      };
    }
  }

  /**
   * Validate environment configuration for production readiness
   */
  static validateProductionReadiness(env: Env): {
    ready: boolean;
    criticalIssues: string[];
    warnings: string[];
  } {
    const criticalIssues: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate required secrets
      const secretValidation = this.validateRequiredSecrets(env);
      if (!secretValidation.valid) {
        criticalIssues.push('Required secrets missing');
      }

      // Check environment
      if (env.ENVIRONMENT !== 'production') {
        warnings.push(`Environment is ${env.ENVIRONMENT}, not production`);
      }

      // Check security settings
      if (env.ENABLE_DEBUG_LOGGING === 'true') {
        criticalIssues.push('Debug logging enabled in production (security risk)');
      }

      if (env.ENABLE_RATE_LIMITING !== 'true') {
        criticalIssues.push('Rate limiting disabled (DDoS vulnerability)');
      }

      // Check API configuration
      if (!env.SHOPIFY_API_VERSION || env.SHOPIFY_API_VERSION !== '2025-04') {
        warnings.push('Shopify API version should be 2025-04 for latest features');
      }

      // Check CORS configuration
      if (env.CORS_ORIGINS && env.CORS_ORIGINS.includes('*')) {
        // Check for unsafe wildcards (not subdomain wildcards like *.myshopify.com)
        const unsafeWildcards = env.CORS_ORIGINS.split(',').some(origin => {
          const trimmed = origin.trim();
          // Allow subdomain wildcards like *.myshopify.com, *.shopify.com
          return trimmed === '*' || (trimmed.includes('*') && !trimmed.match(/https?:\/\/\*\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/));
        });
        
        if (unsafeWildcards) {
          criticalIssues.push('CORS configured with unsafe wildcard (security risk)');
        }
      }

    } catch (error) {
      criticalIssues.push(`Configuration validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      ready: criticalIssues.length === 0,
      criticalIssues,
      warnings
    };
  }
} 