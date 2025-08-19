// Webhook payload type definitions for type safety

export interface BaseWebhookPayload {
	id?: string | number;
	[key: string]: unknown;
}

export interface AppScopesUpdatePayload {
	current: string[];
}

export interface OrderWebhookPayload extends BaseWebhookPayload {
	id: string | number;
	order_number?: number;
	customer?: {
		id: string | number;
		email?: string;
	};
	line_items?: Array<{
		id: string | number;
		product_id?: string | number;
		variant_id?: string | number;
		quantity?: number;
	}>;
	total_price?: string;
	currency?: string;
	financial_status?: string;
	fulfillment_status?: string;
}

export type WebhookPayload = BaseWebhookPayload | AppScopesUpdatePayload | OrderWebhookPayload;

// Type guard functions
export function isAppScopesUpdatePayload(payload: unknown): payload is AppScopesUpdatePayload {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"current" in payload &&
		Array.isArray((payload as AppScopesUpdatePayload).current)
	);
}

export function isOrderWebhookPayload(payload: unknown): payload is OrderWebhookPayload {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"id" in payload &&
		((payload as OrderWebhookPayload).id !== undefined)
	);
}

export function isBaseWebhookPayload(payload: unknown): payload is BaseWebhookPayload {
	return typeof payload === "object" && payload !== null;
}
