/**
 * Worker utilities and shared types
 */

// Feature flag types
export interface FeatureFlags {
	ENABLE_DELIVERY_DATES_API: boolean;
	ENABLE_STORE_LOCATOR: boolean;
	ENABLE_EXPERIENCE_CENTER: boolean;
	ENABLE_WEBHOOKS: boolean;
}

// Consolidated environment interface
export interface Env {
	// Environment
	ENVIRONMENT?: string;

	// Shopify app configuration
	SHOPIFY_API_KEY?: string;
	SHOPIFY_API_SECRET_KEY?: string;
	SHOPIFY_APP_URL?: string;
	SHOPIFY_APP_HANDLE?: string;
	SHOPIFY_APP_LOG_LEVEL?: string;

	// Delivery dates API
	DUTCHNED_API_URL?: string;
	DUTCHNED_API_CREDENTIALS?: string;

	// Store locator
	SHOPIFY_ADMIN_API_ACCESS_TOKEN?: string;
	SHOPIFY_STORE_URL?: string;
	DUTCH_FURNITURE_BASE_URL?: string;
	DUTCH_FURNITURE_API_KEY?: string;

	// KV namespaces
	WOOOD_KV?: KVNamespace;
	STORE_LOCATOR_STATUS?: KVNamespace;
	EXPERIENCE_CENTER_STATUS?: KVNamespace;

	// Session storage (required by app code)
	SESSION_STORAGE: KVNamespace;

	// Webhook queue
	WEBHOOK_QUEUE?: any;
}

// Delivery date types
export interface DeliveryDate {
	date: string;
	displayName: string;
}

// Store locator types
export interface StoreLocation {
	id: string;
	name: string;
	address: string;
	exclusivity: string[];
}

// Experience center types
export interface ExperienceCenterProduct {
	productId: string;
	experienceCenter: boolean;
}

// Webhook types
export interface WebhookPayload {
	topic: string;
	shop_domain: string;
	body: any;
}

// Consolidation status
export interface WorkerStatus {
	phase: "planning" | "in-progress" | "completed";
	features: {
		deliveryDates: "legacy" | "migrated" | "consolidated";
		storeLocator: "legacy" | "migrated" | "consolidated";
		experienceCenter: "legacy" | "migrated" | "consolidated";
		webhooks: "legacy" | "migrated" | "consolidated";
	};
	lastUpdated: string;
}

// Feature flag checker
export function isFeatureEnabled(
	flags: FeatureFlags,
	feature: keyof FeatureFlags,
): boolean {
	return flags[feature] === true;
}

// Environment validator
export function validateEnvironment(env: Partial<Env>): string[] {
	const errors: string[] = [];

	if (!env.ENVIRONMENT) {
		errors.push("ENVIRONMENT is required");
	}

	if (isFeatureEnabled(DEFAULT_FEATURE_FLAGS, "ENABLE_DELIVERY_DATES_API")) {
		if (!env.DUTCHNED_API_URL) {
			errors.push("DUTCHNED_API_URL is required for delivery dates API");
		}
		if (!env.DUTCHNED_API_CREDENTIALS) {
			errors.push(
				"DUTCHNED_API_CREDENTIALS is required for delivery dates API",
			);
		}
	}

	if (isFeatureEnabled(DEFAULT_FEATURE_FLAGS, "ENABLE_STORE_LOCATOR")) {
		if (!env.SHOPIFY_ADMIN_API_ACCESS_TOKEN) {
			errors.push(
				"SHOPIFY_ADMIN_API_ACCESS_TOKEN is required for store locator",
			);
		}
	}

	return errors;
}

// Migration helper
export function createMigrationPlan(currentStatus: WorkerStatus): string[] {
	const steps: string[] = [];

	if (currentStatus.features.deliveryDates === "legacy") {
		steps.push("Migrate delivery dates API from workers/src/index.ts");
		steps.push("Implement DutchNed API integration in consolidated worker");
	}

	if (currentStatus.features.storeLocator === "legacy") {
		steps.push(
			"Migrate store locator functionality from workers/src/storeLocatorUpserter.ts",
		);
		steps.push("Implement store locator API in consolidated worker");
	}

	if (currentStatus.features.experienceCenter === "legacy") {
		steps.push(
			"Migrate experience center functionality from workers/src/index.ts",
		);
		steps.push("Implement experience center API in consolidated worker");
	}

	if (currentStatus.features.webhooks === "legacy") {
		steps.push("Migrate webhook handlers from workers/src/index.ts");
		steps.push("Implement webhook processing in consolidated worker");
	}

	return steps;
}

// Default feature flags
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
	ENABLE_DELIVERY_DATES_API: true,
	ENABLE_STORE_LOCATOR: true,
	ENABLE_EXPERIENCE_CENTER: true,
	ENABLE_WEBHOOKS: true,
};

// Default consolidation status
export const DEFAULT_WORKER_STATUS: WorkerStatus = {
	phase: "in-progress",
	features: {
		deliveryDates: "migrated",
		storeLocator: "consolidated",
		experienceCenter: "legacy",
		webhooks: "legacy",
	},
	lastUpdated: new Date().toISOString(),
};
