import { Env, WorkerConfig } from '../types/env';
import { handleShippingMethodRequest } from '../services/shippingMethodService';

/**
 * Handle shipping methods API requests
 * Main handler for /api/shipping-methods/* endpoints
 */
export async function handleShippingMethods(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Response> {
  return handleShippingMethodRequest(request, env, config, logger, requestId);
} 