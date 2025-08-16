export interface DeliveryDate {
	date: string;
	displayName: string;
}

export interface ApiResponse {
	success: boolean;
	data?: DeliveryDate[];
	error?: string;
	message?: string;
}

export interface FetchConfig {
	timeout?: number;
	retries?: number;
	apiBaseUrl?: string;
	enableMockMode?: boolean;
}

const DEFAULT_CONFIG: FetchConfig = {
	timeout: 15000, // 15 seconds
	retries: 2,
	apiBaseUrl: "https://woood-production.leander-4e0.workers.dev",
	enableMockMode: false,
};

/**
 * Get authentication headers for API requests
 * In a Shopify extension, we extract shop domain from checkout session
 */
function getAuthenticationHeaders(): Record<string, string> {
	const headers: Record<string, string> = {};

	try {
		// Note: All custom headers removed due to CORS restrictions in Shopify checkout iframe
		// Shop domain will be sent in request body instead of headers when needed
		console.log(
			"Using minimal headers for CORS compliance in Shopify checkout",
		);
	} catch (error) {
		console.error("Error getting authentication headers:", error);
	}

	return headers;
}

export async function fetchDeliveryDates(
	config: FetchConfig = DEFAULT_CONFIG,
	shopDomain?: string,
): Promise<DeliveryDate[]> {
	// Use configured API base URL or fallback to default
	const apiBaseUrl = DEFAULT_CONFIG.apiBaseUrl;
	const enableMockMode = config.enableMockMode || DEFAULT_CONFIG.enableMockMode;

	// If mock mode is enabled, return mock data immediately
	if (enableMockMode) {
		console.log("Mock mode enabled, returning mock delivery dates");
		return generateMockDeliveryDates();
	}

	try {
		const url = `${apiBaseUrl}/api/delivery-dates`;

		// Get authentication headers for session-based authentication
		const authHeaders = getAuthenticationHeaders();

		// Use provided shop domain or fallback
		const _domain = shopDomain || "unknown-shop";

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
				...authHeaders,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data: ApiResponse = await response.json();

		if (data.success && Array.isArray(data.data)) {
			console.log(`✅ Successfully fetched ${data.data.length} delivery dates`);
			return data.data;
		} else {
			throw new Error("Invalid response format");
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`❌ Failed to fetch delivery dates: ${message}`);

		// Fallback to mock data on error
		console.log("🔄 Falling back to mock delivery dates");
		return generateMockDeliveryDates();
	}
}

export async function saveOrderMetafields(
	deliveryDate: string,
	shippingMethod: string | null,
	config: FetchConfig = DEFAULT_CONFIG,
): Promise<boolean> {
	const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
	const url = `${apiBaseUrl}/api/order-metafields/save`;

	try {
		console.log("💾 Saving order metafields:", {
			deliveryDate,
			shippingMethod,
		});

		// Get authentication headers for session-based authentication
		const authHeaders = getAuthenticationHeaders();

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				...authHeaders,
			},
			body: JSON.stringify({
				deliveryDate,
				shippingMethod,
				timestamp: new Date().toISOString(),
				source: "checkout_extension",
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result: { success?: boolean; [key: string]: unknown } = await response.json();
		console.log("✅ Successfully saved order metafields:", result);
		return true;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to save order metafields:", message);
		return false;
	}
}

/**
 * Trigger experience center data sync for all shops
 * This calls the same function that runs automatically via cron job
 * @param config API configuration
 * @returns Promise<boolean> Success status
 */
export async function triggerExperienceCenterUpdate(
	config: FetchConfig = DEFAULT_CONFIG,
): Promise<boolean> {
	const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
	const url = `${apiBaseUrl}/api/experience-center/trigger`;

	try {
		console.log("🔄 Triggering experience center data sync...");

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result: { summary?: { successfulShops: number; totalShops: number } } =
			await response.json();
		console.log("✅ Successfully triggered experience center sync:", result);

		if (result.summary) {
			console.log(
				`📊 Summary: ${result.summary.successfulShops}/${result.summary.totalShops} shops processed`,
			);
		}

		return true;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to trigger experience center sync:", message);
		return false;
	}
}

/**
 * Get status of last experience center sync operation
 * @param config API configuration
 * @returns Promise<any> Status information
 */
export async function getExperienceCenterStatus(
	config: FetchConfig = DEFAULT_CONFIG,
): Promise<unknown> {
	const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
	const url = `${apiBaseUrl}/api/experience-center/status`;

	try {
		console.log("📊 Fetching experience center sync status...");

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result: unknown = await response.json();
		console.log("✅ Successfully fetched experience center status:", result);

		return result;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to fetch experience center status:", message);
		return null;
	}
}

/**
 * Trigger store locator data sync for all shops
 * This calls the same function that runs automatically via cron job
 * @param config API configuration
 * @returns Promise<boolean> Success status
 */
export async function triggerStoreLocatorUpdate(
	config: FetchConfig = DEFAULT_CONFIG,
): Promise<boolean> {
	const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
	const url = `${apiBaseUrl}/api/store-locator/trigger`;

	try {
		console.log("🔄 Triggering store locator data sync...");

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result: { summary?: { successfulShops: number; totalShops: number } } =
			await response.json();
		console.log("✅ Successfully triggered store locator sync:", result);

		if (result.summary) {
			console.log(
				`📊 Summary: ${result.summary.successfulShops}/${result.summary.totalShops} shops processed`,
			);
		}

		return true;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to trigger store locator sync:", message);
		return false;
	}
}

/**
 * Get status of last store locator sync operation
 * @param config API configuration
 * @returns Promise<any> Status information
 */
export async function getStoreLocatorStatus(
	config: FetchConfig = DEFAULT_CONFIG,
): Promise<unknown> {
	const apiBaseUrl = config.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
	const url = `${apiBaseUrl}/api/store-locator/status`;

	try {
		console.log("📊 Fetching store locator sync status...");

		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result: unknown = await response.json();
		console.log("✅ Successfully fetched store locator status:", result);

		return result;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to fetch store locator status:", message);
		return null;
	}
}

function generateMockDeliveryDates(): DeliveryDate[] {
	const dates: DeliveryDate[] = [];
	const today = new Date();

	// Generate mock dates for the next 14 weekdays, excluding weekends
	for (let i = 1; i <= 20; i++) {
		const futureDate = new Date(today);
		futureDate.setDate(today.getDate() + i);

		// Skip weekends (Saturday = 6, Sunday = 0)
		const dayOfWeek = futureDate.getDay();
		if (dayOfWeek === 0 || dayOfWeek === 6) {
			continue;
		}

		const dateString = futureDate.toISOString().split("T")[0]; // YYYY-MM-DD format
		const displayName = futureDate.toLocaleDateString("nl-NL", {
			weekday: "long",
			month: "short",
			day: "numeric",
		});

		dates.push({
			date: dateString,
			displayName,
		});

		// Stop when we have 14 weekdays
		if (dates.length >= 14) {
			break;
		}
	}

	return dates;
}
