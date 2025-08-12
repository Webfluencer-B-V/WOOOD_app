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
