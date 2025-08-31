export interface DeliveryDate {
	date: string;
	displayName: string;
}

export interface ApiResponse {
	success: boolean;
	data?: DeliveryDate[];
	error?: string;
	message?: string;
	metadata?: {
		mockDataEnabled: boolean;
		cacheHit: boolean;
		responseTime: number;
	};
}

// Removed: InventoryResponse (inventory API removed)

export interface BulkInventoryResponse {
	summary?: { totalShops: number; successfulShops: number };
	[key: string]: unknown;
}

export function isApiResponse(x: unknown): x is ApiResponse {
	return !!x && typeof x === "object" && "success" in (x as Record<string, unknown>);
}

export function isBulkInventoryResponse(x: unknown): x is BulkInventoryResponse {
	return !!x && typeof x === "object" && "summary" in (x as Record<string, unknown>);
}

// Removed: isInventoryResponse


