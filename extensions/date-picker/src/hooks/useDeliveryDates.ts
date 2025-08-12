import { useQuery, useQueryClient } from "@tanstack/react-query";

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

export interface UseDeliveryDatesOptions {
	enabled?: boolean;
	staleTime?: number;
	cacheTime?: number;
	retry?: number;
	retryDelay?: (attemptIndex: number) => number;
}

const QUERY_KEY = ["delivery-dates"] as const;

/**
 * Fetch delivery dates from the API with proper error handling and timeout
 */
async function fetchDeliveryDates(
	apiBaseUrl: string,
	_shopDomain: string,
): Promise<{
	data: DeliveryDate[];
	metadata?: ApiResponse["metadata"];
}> {
	const url = `${apiBaseUrl}/api/delivery-dates`;

	console.log("🌐 Fetching delivery dates from:", url);

	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, 15000); // 15 second timeout

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const responseData: ApiResponse = await response.json();

		// Handle both direct array response and wrapped response
		let data: DeliveryDate[];
		const metadata = responseData.metadata;

		if (responseData.success && Array.isArray(responseData.data)) {
			data = responseData.data;
		} else if (Array.isArray(responseData)) {
			data = responseData;
		} else {
			throw new Error(
				"Invalid response format: expected array of delivery dates",
			);
		}

		// console.log(`✅ Fetched ${data.length} delivery dates`);
		return { data, metadata };
	} catch (error: unknown) {
		clearTimeout(timeoutId);

		if ((error as { name?: string }).name === "AbortError") {
			throw new Error("Request timed out after 15 seconds");
		}

		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to fetch delivery dates:", message);
		throw new Error(message);
	}
}

/**
 * React Query hook for fetching delivery dates with caching and retry logic
 */
export function useDeliveryDates(
	apiBaseUrl: string,
	_enableMockMode: boolean,
	shopDomain: string,
): {
	deliveryDates: DeliveryDate[];
	loading: boolean;
	error: string | null;
	refetch: () => void;
} {
	const queryResult = useQuery({
		queryKey: [...QUERY_KEY, apiBaseUrl, shopDomain],
		queryFn: () => fetchDeliveryDates(apiBaseUrl, shopDomain),
		enabled: true,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes (renamed from cacheTime)
		retry: 3,
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
		select: (response) => ({
			deliveryDates: response.data,
			metadata: response.metadata,
		}),
	});

	return {
		deliveryDates: queryResult.data?.deliveryDates || [],
		loading: queryResult.isLoading,
		error: queryResult.error as string | null,
		refetch: queryResult.refetch,
	};
}

/**
 * Helper functions for cache management
 */
export function useDeliveryDatesCache() {
	const queryClient = useQueryClient();

	const invalidateDeliveryDates = () => {
		queryClient.invalidateQueries({ queryKey: QUERY_KEY });
	};

	const prefetchDeliveryDates = (apiBaseUrl: string) => {
		queryClient.prefetchQuery({
			queryKey: [...QUERY_KEY, apiBaseUrl],
			queryFn: () => fetchDeliveryDates(apiBaseUrl, ""),
			staleTime: 5 * 60 * 1000,
		});
	};

	const getCachedDeliveryDates = (
		apiBaseUrl: string,
	): DeliveryDate[] | undefined => {
		return queryClient.getQueryData([...QUERY_KEY, apiBaseUrl]);
	};

	return {
		invalidateDeliveryDates,
		prefetchDeliveryDates,
		getCachedDeliveryDates,
	};
}
