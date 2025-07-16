import { useQuery, useQueryClient } from '@tanstack/react-query';

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

const QUERY_KEY = ['delivery-dates'] as const;

/**
 * Fetch delivery dates from the API with proper error handling and timeout
 */
async function fetchDeliveryDates(apiBaseUrl: string): Promise<{
  data: DeliveryDate[];
  metadata?: ApiResponse['metadata'];
}> {
  const url = `${apiBaseUrl}/api/delivery-dates/available`;
  
  console.log('🌐 Fetching delivery dates from:', url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 15000); // 15 second timeout

  try {
    // Get shop domain from checkout context
    const shopDomain = window.location.hostname;
    
    const response = await fetch(url, {
      method: 'POST', // Changed to POST to send shop domain in body
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        shopDomain,
        timestamp: new Date().toISOString(),
        source: 'checkout_extension'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseData: ApiResponse = await response.json();

    // Handle both direct array response and wrapped response
    let data: DeliveryDate[];
    let metadata = responseData.metadata;

    if (responseData.success && Array.isArray(responseData.data)) {
      data = responseData.data;
    } else if (Array.isArray(responseData)) {
      data = responseData;
    } else {
      throw new Error('Invalid response format: expected array of delivery dates');
    }

    console.log(`✅ Successfully fetched ${data.length} delivery dates`);
    return { data, metadata };

  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out after 15 seconds');
    }
    
    console.error('❌ Failed to fetch delivery dates:', error.message);
    throw error;
  }
}

/**
 * React Query hook for fetching delivery dates with caching and retry logic
 */
export function useDeliveryDates(
  apiBaseUrl: string, 
  options: UseDeliveryDatesOptions = {}
) {
  const queryResult = useQuery({
    queryKey: [...QUERY_KEY, apiBaseUrl],
    queryFn: () => fetchDeliveryDates(apiBaseUrl),
    enabled: options.enabled !== false,
    staleTime: options.staleTime || 5 * 60 * 1000, // 5 minutes
    gcTime: options.cacheTime || 10 * 60 * 1000, // 10 minutes (renamed from cacheTime)
    retry: options.retry || 3,
    retryDelay: options.retryDelay || ((attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)),
    select: (response) => ({
      deliveryDates: response.data,
      metadata: response.metadata
    })
  });

  return {
    deliveryDates: queryResult.data?.deliveryDates || [],
    metadata: queryResult.data?.metadata,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error,
    isFetching: queryResult.isFetching,
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
      queryFn: () => fetchDeliveryDates(apiBaseUrl),
      staleTime: 5 * 60 * 1000,
    });
  };

  const getCachedDeliveryDates = (apiBaseUrl: string): DeliveryDate[] | undefined => {
    return queryClient.getQueryData([...QUERY_KEY, apiBaseUrl]);
  };

  return {
    invalidateDeliveryDates,
    prefetchDeliveryDates,
    getCachedDeliveryDates,
  };
} 