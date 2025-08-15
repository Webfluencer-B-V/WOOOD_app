// API response types for the date picker extension

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

export interface InventoryResponse {
	success: boolean;
	inventory?: Record<string, number | null>;
	error?: string;
	message?: string;
}

export interface BulkInventoryResponse {
	summary?: {
		successfulShops: number;
		totalShops: number;
	};
	error?: string;
	message?: string;
}

// Type guard functions
export function isApiResponse(data: unknown): data is ApiResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"success" in data &&
		typeof (data as ApiResponse).success === "boolean"
	);
}

export function isInventoryResponse(data: unknown): data is InventoryResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"success" in data &&
		typeof (data as InventoryResponse).success === "boolean" &&
		(!("inventory" in data) || 
		 typeof (data as InventoryResponse).inventory === "object")
	);
}

export function isBulkInventoryResponse(data: unknown): data is BulkInventoryResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		(!("summary" in data) || 
		 (typeof (data as BulkInventoryResponse).summary === "object" &&
		  (data as BulkInventoryResponse).summary !== null))
	);
}
