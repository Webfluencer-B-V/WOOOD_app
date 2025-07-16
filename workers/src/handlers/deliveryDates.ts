import { Env, WorkerConfig } from '../types/env';
import { handleDeliveryDatesRequest } from '../services/deliveryDatesService';

/**
 * Handle delivery dates API requests
 * Main handler for /api/delivery-dates/available endpoint
 */
export async function handleDeliveryDates(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger?: any,
  requestId?: string
): Promise<Response> {
  return handleDeliveryDatesRequest(request, env, config, logger, requestId);
} 