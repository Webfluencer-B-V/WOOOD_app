export interface WebhookQueueMessage {
	payload: unknown;
	webhook: {
		subTopic: string;
		apiVersion: string;
		domain: string;
		hmac: string;
		topic: string;
		webhookId: string;
	};
}

export type ScheduledJobType =
  | "experience-center-sync"
  | "store-locator-sync"
  | "token-cleanup";

export interface ScheduledJobMessage {
  type: ScheduledJobType;
  shop?: string;
  scheduledAt: string;
  retryCount?: number;
}

export type QueueMessage = WebhookQueueMessage | ScheduledJobMessage;

// Worker Env (migrated from consolidation)
export interface WorkerEnv {
  ENVIRONMENT?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET_KEY?: string;
  SHOPIFY_APP_URL?: string;
  SHOPIFY_APP_HANDLE?: string;
  SHOPIFY_APP_LOG_LEVEL?: string;
  DUTCHNED_API_URL?: string;
  DUTCHNED_API_CREDENTIALS?: string;
  SHOPIFY_ADMIN_API_ACCESS_TOKEN?: string;
  SHOPIFY_STORE_URL?: string;
  DUTCH_FURNITURE_BASE_URL?: string;
  DUTCH_FURNITURE_API_KEY?: string;
  WOOOD_KV?: KVNamespace;
  STORE_LOCATOR_STATUS?: KVNamespace;
  EXPERIENCE_CENTER_STATUS?: KVNamespace;
  SESSION_STORAGE: KVNamespace;
  WEBHOOK_QUEUE?: unknown;
}

export interface FeatureFlags {
  ENABLE_DELIVERY_DATES_API: boolean;
  ENABLE_STORE_LOCATOR: boolean;
  ENABLE_EXPERIENCE_CENTER: boolean;
  ENABLE_WEBHOOKS: boolean;
}
