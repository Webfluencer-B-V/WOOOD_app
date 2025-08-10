import { useQuery, useQueryClient } from "@tanstack/react-query";

// Types for delivery dates
export interface DeliveryDate {
	date: string;
	displayName: string;
	available?: boolean;
}

export interface DeliveryDatesResponse {
	success: boolean;
	data: DeliveryDate[];
	metadata?: {
		mockDataEnabled?: boolean;
		cacheHit?: boolean;
		responseTime?: number;
		requestId?: string;
		environment?: string;
	};
	error?: string;
	message?: string;
}

export interface UseDeliveryDatesOptions {
	postalCode?: string;
	country?: string;
	enabled?: boolean;
	refetchInterval?: number;
	staleTime?: number;
	cacheTime?: number;
}

// Default options
const DEFAULT_OPTIONS: Required<
	Omit<UseDeliveryDatesOptions, "postalCode" | "country">
> = {
	enabled: true,
	refetchInterval: 0, // No automatic refetch
	staleTime: 5 * 60 * 1000, // 5 minutes
	cacheTime: 10 * 60 * 1000, // 10 minutes
};

/**
 * Fetch delivery dates from the Workers API
 */
export const fetchDeliveryDates = async (
	apiBaseUrl: string,
	postalCode?: string,
	country?: string,
): Promise<DeliveryDatesResponse> => {
	const params = new URLSearchParams();
	if (postalCode) params.append("postalCode", postalCode);
	if (country) params.append("country", country);

	const url = `${apiBaseUrl}/api/delivery-dates/available${params.toString() ? `?${params.toString()}` : ""}`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		// Use AbortController for timeout (15 seconds)
		signal: AbortSignal.timeout(15000),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const data: DeliveryDatesResponse = await response.json();

	if (!data.success) {
		throw new Error(
			data.error || data.message || "Failed to fetch delivery dates",
		);
	}

	return data;
};

/**
 * React Query hook for delivery dates with professional data fetching
 */
export const useDeliveryDates = (
	apiBaseUrl: string,
	options: UseDeliveryDatesOptions = {},
) => {
	const queryClient = useQueryClient();
	const finalOptions = { ...DEFAULT_OPTIONS, ...options };

	// Create query key based on parameters
	const queryKey = [
		"deliveryDates",
		apiBaseUrl,
		finalOptions.postalCode,
		finalOptions.country,
	];

	const query = useQuery({
		queryKey,
		queryFn: () =>
			fetchDeliveryDates(
				apiBaseUrl,
				finalOptions.postalCode,
				finalOptions.country,
			),
		enabled: finalOptions.enabled,
		staleTime: finalOptions.staleTime,
		gcTime: finalOptions.cacheTime, // Changed from cacheTime to gcTime in v5
		refetchInterval: finalOptions.refetchInterval,
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
		retry: (failureCount, error) => {
			// Don't retry on 4xx errors (client errors)
			if (error instanceof Error && error.message.includes("HTTP 4")) {
				return false;
			}
			// Retry up to 3 times with exponential backoff
			return failureCount < 3;
		},
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
	});

	const {
		data,
		isLoading,
		isError,
		error,
		isFetching,
		isSuccess,
		refetch,
		status,
	} = query;

	// Helper functions
	const invalidateQuery = () => {
		return queryClient.invalidateQueries({ queryKey });
	};

	const prefetchDeliveryDates = (postalCode?: string, country?: string) => {
		const prefetchKey = ["deliveryDates", apiBaseUrl, postalCode, country];
		return queryClient.prefetchQuery({
			queryKey: prefetchKey,
			queryFn: () => fetchDeliveryDates(apiBaseUrl, postalCode, country),
			staleTime: finalOptions.staleTime,
		});
	};

	const removeFromCache = () => {
		return queryClient.removeQueries({ queryKey });
	};

	// Extract delivery dates safely
	const deliveryDates = data?.data || [];
	const metadata = data?.metadata;
	const errorMessage = error instanceof Error ? error.message : "Unknown error";

	return {
		// Data
		deliveryDates,
		metadata,

		// State
		isLoading,
		isError,
		error: errorMessage,
		isFetching,
		isSuccess,
		status,

		// Actions
		refetch,
		invalidateQuery,
		prefetchDeliveryDates,
		removeFromCache,

		// Raw query for advanced usage
		query,
	};
};

/**
 * Hook for prefetching delivery dates (useful for hover states)
 */
export const usePrefetchDeliveryDates = (apiBaseUrl: string) => {
	const queryClient = useQueryClient();

	const prefetch = (postalCode?: string, country?: string) => {
		const queryKey = ["deliveryDates", apiBaseUrl, postalCode, country];
		return queryClient.prefetchQuery({
			queryKey,
			queryFn: () => fetchDeliveryDates(apiBaseUrl, postalCode, country),
			staleTime: 5 * 60 * 1000, // 5 minutes
		});
	};

	return { prefetch };
};

/**
 * Hook for invalidating all delivery dates queries
 */
export const useInvalidateDeliveryDates = () => {
	const queryClient = useQueryClient();

	const invalidateAll = () => {
		return queryClient.invalidateQueries({
			queryKey: ["deliveryDates"],
			exact: false,
		});
	};

	const removeAll = () => {
		return queryClient.removeQueries({
			queryKey: ["deliveryDates"],
			exact: false,
		});
	};

	return { invalidateAll, removeAll };
};
