import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  reactExtension,
  useApplyAttributeChange,
  Banner,
  Button,
  Heading,
  Text,
  View,
  SkeletonText,
  BlockStack,
  useShippingAddress,
  useTranslate,
  ScrollView,
  useDeliveryGroups,
  useSettings,
  useCartLines,
  useMetafield,
  useApi,
} from "@shopify/ui-extensions-react/checkout";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeliveryDates, DeliveryDate } from "./hooks/useDeliveryDates";
import { ErrorBoundary, useErrorHandler } from "./components/ErrorBoundary";
import { config } from "./config/environment";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

export default reactExtension(
  "purchase.checkout.shipping-option-list.render-after",
  () => (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
      <DeliveryDatePicker />
      </QueryClientProvider>
    </ErrorBoundary>
  )
);

/**
 * Convert week number to date (ISO week date calculation)
 * @param year - The year (e.g., 2025)
 * @param week - The week number (e.g., 22)
 * @returns Date object representing the Monday of that week
 */
function weekNumberToDate(year: number, week: number): Date {
  // Find January 4th of the year (which is always in week 1)
  const jan4 = new Date(year, 0, 4);

  // Find the Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4.getDay() + 1);

  // Calculate the target week's Monday
  const targetWeekMonday = new Date(week1Monday);
  targetWeekMonday.setDate(week1Monday.getDate() + (week - 1) * 7);

  return targetWeekMonday;
}

/**
 * Parse ERP delivery time metafield (format: "YYYY-WW")
 * @param erpLevertijd - The metafield value (e.g., "2025-22")
 * @returns Date object or null if invalid
 */
function parseErpLevertijd(erpLevertijd: string | null): Date | null {
  if (!erpLevertijd || typeof erpLevertijd !== 'string') {
    return null;
}

  const match = erpLevertijd.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Validate year and week number
  if (year < 2020 || year > 2030 || week < 1 || week > 53) {
    return null;
  }

  return weekNumberToDate(year, week);
}

/**
 * Custom hook to extract ERP delivery times from all products in cart
 * Uses backend API to fetch metafield data since checkout extensions have limited access
 */
function useCartProductsDeliveryTime(cartLines: any[], enableFiltering: boolean, apiBaseUrl: string, shopDomain: string): Date | null {
  const [minimumDate, setMinimumDate] = useState<Date | null>(null);

  // Memoize product IDs to prevent unnecessary re-renders
  const productIds = useMemo(() => {
    if (!cartLines || cartLines.length === 0) return [];

    return cartLines
      .map(line => line.merchandise?.product?.id)
      .filter(id => id) // Remove null/undefined
      .map(id => id.replace('gid://shopify/Product/', '')); // Extract numeric ID
  }, [cartLines]);

  // Memoize the product IDs string for comparison
  const productIdsKey = useMemo(() => productIds.join(','), [productIds]);

  useEffect(() => {
    console.log('🔍 Cart products delivery time check triggered', {
      enableFiltering,
      cartLinesLength: cartLines?.length || 0,
      productIdsCount: productIds.length
    });

    if (!enableFiltering || productIds.length === 0) {
      console.log('⚠️ No filtering or no product IDs');
      setMinimumDate(null);
      return;
    }

    console.log('🛒 Fetching ERP delivery times for products:', productIds);

    // Call backend API to get ERP delivery times
    fetchErpDeliveryTimes(productIds, apiBaseUrl, shopDomain)
      .then(deliveryTimes => {
        let latestMinimumDate: Date | null = null;

        console.log('📦 Received ERP delivery times:', deliveryTimes);

        Object.entries(deliveryTimes).forEach(([productId, erpValue]) => {
          if (erpValue) {
            console.log(`✅ Product ${productId} has ERP delivery time: ${erpValue}`);
            const parsedDate = parseErpLevertijd(erpValue as string);
            if (parsedDate) {
              if (!latestMinimumDate || parsedDate > latestMinimumDate) {
                latestMinimumDate = parsedDate;
                console.log(`🚀 Updated minimum date to: ${parsedDate.toISOString().split('T')[0]}`);
              }
            }
          }
        });

        // No fallback - if no ERP data found, filtering will be disabled
        if (!latestMinimumDate && productIds.length > 0) {
          console.log('ℹ️ No ERP delivery times found for any products - date filtering disabled');
        }

        console.log(`📊 Final minimum date: ${latestMinimumDate ? 'set' : 'none'}`);
        setMinimumDate(latestMinimumDate);
      })
      .catch(error => {
        console.error('❌ Failed to fetch ERP delivery times:', error);
        console.log('ℹ️ ERP API error - date filtering disabled');
        setMinimumDate(null);
      });
  }, [productIdsKey, enableFiltering, apiBaseUrl, shopDomain]); // Use memoized productIdsKey instead of productIds

  return minimumDate;
}

/**
 * Custom hook to extract shipping methods from all products in cart
 * Gets the highest shipping method number and returns the original value for order notes
 */
function useCartProductsShippingMethod(cartLines: any[], apiBaseUrl: string, shopDomain: string): { highestNumber: number; originalValue: string | null } {
  const [shippingMethodData, setShippingMethodData] = useState<{ highestNumber: number; originalValue: string | null }>({
    highestNumber: 0,
    originalValue: null
  });

  // Memoize product IDs to prevent unnecessary re-renders
  const productIds = useMemo(() => {
    if (!cartLines || cartLines.length === 0) return [];

    return cartLines
      .map(line => line.merchandise?.product?.id)
      .filter(id => id) // Remove null/undefined
      .map(id => id.replace('gid://shopify/Product/', '')); // Extract numeric ID
  }, [cartLines]);

  // Memoize the product IDs string for comparison
  const productIdsKey = useMemo(() => productIds.join(','), [productIds]);

  useEffect(() => {
    console.log('🚚 Checking shipping methods for cart products', {
      cartLinesLength: cartLines?.length || 0,
      productIdsCount: productIds.length
    });

    if (productIds.length === 0) {
      console.log('⚠️ No product IDs for shipping method check');
      setShippingMethodData({ highestNumber: 0, originalValue: null });
      return;
    }

    console.log('🚚 Fetching shipping methods for products:', productIds);

    // Call backend API to get shipping method data
    fetchShippingMethods(productIds, apiBaseUrl, shopDomain)
      .then(shippingMethods => {
        let highestNumber = 0;
        let highestOriginalValue: string | null = null;

        console.log('📦 Received shipping methods:', shippingMethods);

        Object.entries(shippingMethods).forEach(([productId, methodData]) => {
          if (methodData && methodData.value) {
            // Extract number from the value string (e.g., "30 - EXPEDITIE STANDAARD" -> 30)
            let extractedNumber = methodData.number || 0;

            // If number is 0, try to extract from the value string
            if (extractedNumber === 0 && methodData.value) {
              const numberMatch = methodData.value.match(/^(\d+)/);
              if (numberMatch) {
                extractedNumber = parseInt(numberMatch[1], 10);
              }
            }

            if (extractedNumber >= highestNumber) { // Changed > to >= to include 0
              highestNumber = extractedNumber;
              highestOriginalValue = methodData.value;
              console.log(`🚚 Product ${productId} has shipping method: ${methodData.value} (number: ${extractedNumber})`);
            }
          }
        });

        if (highestNumber > 0) {
          console.log(`🏆 Highest shipping method number: ${highestNumber} (${highestOriginalValue})`);
        } else {
          console.log('ℹ️ No shipping method data found for any products');
        }

        setShippingMethodData({ highestNumber, originalValue: highestOriginalValue });
      })
      .catch(error => {
        console.error('❌ Failed to fetch shipping methods:', error);
        setShippingMethodData({ highestNumber: 0, originalValue: null });
      });
  }, [productIdsKey, apiBaseUrl, shopDomain]);

  return shippingMethodData;
}

/**
 * Fetch shipping methods from backend API
 */
async function fetchShippingMethods(productIds: string[], apiBaseUrl: string, shopDomain: string): Promise<Record<string, { value: string; number: number } | null>> {
  const url = `${apiBaseUrl}/api/products/shipping-methods`;

  console.log('🌐 Calling shipping methods API:', { url, productIds, shopDomain });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productIds,
      timestamp: new Date().toISOString(),
      source: 'checkout_extension',
      shopDomain
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Failed to fetch shipping methods');
  }

  return result.data || {};
}

/**
 * Fetch ERP delivery times from backend API
 */
async function fetchErpDeliveryTimes(productIds: string[], apiBaseUrl: string, shopDomain: string): Promise<Record<string, string | null>> {
  const url = `${apiBaseUrl}/api/products/erp-delivery-times`;

  console.log('🌐 Calling backend API:', { url, productIds, shopDomain });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productIds,
      timestamp: new Date().toISOString(),
      source: 'checkout_extension',
      shopDomain // Use dynamic shop domain from OAuth context
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Failed to fetch ERP delivery times');
  }

  return result.data || {};
}

function DeliveryDatePicker() {
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedShippingMethod, setSelectedShippingMethod] = useState<string | null>(null);

  const shippingAddress = useShippingAddress();
  const deliveryGroups = useDeliveryGroups();
  const settings = useSettings();
  const cartLines = useCartLines();
  const t = useTranslate();
  const { shop } = useApi();

  // Get API base URL from centralized configuration
  const apiBaseUrl = config.apiBaseUrl;

  // Use centralized configuration with extension settings override
  const enableMockMode = typeof settings.enable_mock_mode === 'boolean' ? settings.enable_mock_mode : config.enableMockMode;
  const enableWeekNumberFiltering = typeof settings.enable_week_number_filtering === 'boolean' ? settings.enable_week_number_filtering : true;

  // Show the date picker only for Netherlands
  const countryCode = shippingAddress?.countryCode;
  const showDatePicker = countryCode === 'NL';

  // Use custom hook to get minimum delivery date from cart products
  const minimumDeliveryDate = useCartProductsDeliveryTime(cartLines, enableWeekNumberFiltering, apiBaseUrl, shop.myshopifyDomain);

  // Use custom hook to get shipping method data from cart products
  const shippingMethodData = useCartProductsShippingMethod(cartLines, apiBaseUrl, shop.myshopifyDomain);

  // Use checkout attributes for structured data storage
  const applyAttributeChange = useApplyAttributeChange();

  // Use React Query hook for delivery dates
  const {
    deliveryDates,
    metadata,
    isLoading,
    isError,
    error: fetchError,
    isFetching,
    refetch,
  } = useDeliveryDates(apiBaseUrl, {
    enabled: showDatePicker,
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  });

  // Filter available dates based on minimum delivery date
  // Memoize the filtered dates to prevent unnecessary re-filtering
  const filteredDates = useMemo(() => {
    if (!deliveryDates || deliveryDates.length === 0) {
      return [];
    }

    if (!enableWeekNumberFiltering || !minimumDeliveryDate) {
      // If filtering is disabled or no minimum date, show all dates
      return deliveryDates;
    }

    // Filter dates to only show those on or after the minimum delivery date
    const filtered = deliveryDates.filter((dateItem: DeliveryDate) => {
      try {
        const deliveryDate = new Date(dateItem.date);
        return deliveryDate >= minimumDeliveryDate;
      } catch (error) {
        console.warn('Invalid delivery date format:', dateItem.date);
        return false;
      }
    });

    console.log(`🔍 Filtered ${deliveryDates.length} dates to ${filtered.length} dates based on minimum delivery date`);
    return filtered;
  }, [deliveryDates, minimumDeliveryDate, enableWeekNumberFiltering]);

  // Detect selected shipping method from delivery groups
  useEffect(() => {
    if (deliveryGroups && deliveryGroups.length > 0) {
      for (const group of deliveryGroups) {
        // Get the selected delivery option handle
        const selectedOption = group.selectedDeliveryOption;
        if (selectedOption) {
          const shippingMethodName = selectedOption.handle || 'Unknown';
          if (shippingMethodName !== selectedShippingMethod) {
          setSelectedShippingMethod(shippingMethodName);
            // Note: We'll save the shipping method in a separate useEffect to avoid infinite loops
          }
          break;
        }
      }
    }
  }, [deliveryGroups, selectedShippingMethod]);

  // Handle errors from React Query
  useEffect(() => {
    if (isError) {
      console.error('Error fetching delivery dates:', fetchError);
      setErrorKey('error_loading');
    } else {
        setErrorKey(null);
    }
  }, [isError, fetchError]);

      const handleDateSelect = useCallback(async (dateString: string) => {
    setSelectedDate(dateString);

    try {
      // Save individual note attributes
      const attributes = [
        { key: 'delivery_date', value: dateString },
        { key: 'shipping_method', value: shippingMethodData.originalValue || 'Not specified' },
        { key: 'shipping_method_number', value: (shippingMethodData.highestNumber || 0).toString() }
      ];

      // Apply each attribute separately
      for (const attr of attributes) {
        const result = await applyAttributeChange({
          type: 'updateAttribute',
          key: attr.key,
          value: attr.value,
        });

        if (result.type === 'error') {
          throw new Error(`Failed to save ${attr.key} to attributes`);
        }
      }

      console.log('✅ Successfully saved delivery data to checkout attributes:', {
        delivery_date: dateString,
        shipping_method: shippingMethodData.originalValue || 'Not specified',
        shipping_method_number: shippingMethodData.highestNumber || 0
      });

    } catch (err) {
      console.error('❌ Error saving delivery data:', err);
      setErrorKey('error_saving');
    }
  }, [selectedShippingMethod, shippingMethodData, applyAttributeChange]);

    const handleShippingMethodSave = useCallback(async (shippingMethod: string) => {
    try {
      // Update individual attributes with shipping method info - CLEANED UP TO 3 ESSENTIAL ONLY
      const attributes = [
        { key: 'delivery_date', value: selectedDate || 'Not selected' },
        { key: 'shipping_method', value: shippingMethodData.originalValue || 'Not specified' },
        { key: 'shipping_method_number', value: (shippingMethodData.highestNumber || 0).toString() }
      ];

      // Apply each attribute separately
      for (const attr of attributes) {
        const result = await applyAttributeChange({
          type: 'updateAttribute',
          key: attr.key,
          value: attr.value,
        });

        if (result.type === 'error') {
          throw new Error(`Failed to save ${attr.key} to attributes`);
        }
      }

      console.log('✅ Successfully saved shipping method to attributes:', {
        delivery_date: selectedDate || 'Not selected',
        shipping_method: shippingMethodData.originalValue || 'Not specified',
        shipping_method_number: shippingMethodData.highestNumber || 0
      });

    } catch (err) {
      console.error('❌ Error saving shipping method:', err);
      setErrorKey('error_saving_shipping');
    }
  }, [selectedDate, shippingMethodData, applyAttributeChange]);

  // Save shipping method when it changes (separate effect to avoid infinite loops)
  // Remove handleShippingMethodSave from dependencies to prevent infinite loops
  useEffect(() => {
    if (selectedShippingMethod && selectedShippingMethod !== 'Unknown') {
      handleShippingMethodSave(selectedShippingMethod);
    }
  }, [selectedShippingMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(() => {
    setErrorKey(null);
    refetch();
  }, [refetch]);

  if (!showDatePicker) {
    return null;
  }

  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        <Heading level={2}>{t('title')}</Heading>

        {/* Show API configuration info in development/testing */}
        {enableMockMode && (
          <Banner status="info">
            <Text size="small">Mock mode enabled - using test data</Text>
          </Banner>
        )}



        {/* Show week number filtering info when enabled */}
        {enableWeekNumberFiltering && minimumDeliveryDate && (
          <Banner status="info">
            <Text size="small">
              Dates filtered by delivery time: earliest delivery from {minimumDeliveryDate.toLocaleDateString('nl-NL')}
            </Text>
          </Banner>
        )}



        {/* Show loading state */}
        {isLoading && (
          <BlockStack spacing="tight">
            <SkeletonText />
            <SkeletonText />
            <SkeletonText />
          </BlockStack>
        )}

        {/* Show fetch indicator */}
        {isFetching && !isLoading && (
          <Banner status="info">
            <Text size="small">Refreshing delivery dates...</Text>
          </Banner>
        )}

        {/* Show error with retry button */}
        {errorKey && (
          <Banner status="critical">
            <BlockStack spacing="tight">
            <Text>{t(errorKey)}</Text>
              <Button kind="secondary" onPress={handleRetry}>
                {t('retry')}
              </Button>
            </BlockStack>
          </Banner>
        )}

        {/* Show delivery dates */}
        {!isLoading && !errorKey && filteredDates.length > 0 && (
          <BlockStack spacing="base">
            <View>
              <ScrollView maxBlockSize={300}>
                <BlockStack spacing="tight">
                  {filteredDates.map((dateItem) => {
                    const isSelected = selectedDate === dateItem.date;
                    return (
                      <Button
                        key={dateItem.date}
                        kind={isSelected ? 'primary' : 'secondary'}
                        onPress={() => handleDateSelect(dateItem.date)}
                      >
                        <Text emphasis={isSelected ? "bold" : undefined}>
                          {dateItem.displayName}
                        </Text>
                      </Button>
                    );
                  })}
                </BlockStack>
              </ScrollView>
            </View>
          </BlockStack>
        )}

        {/* Show filtering info when dates are filtered out */}
        {!isLoading && !errorKey && filteredDates.length === 0 && deliveryDates.length > 0 && enableWeekNumberFiltering && minimumDeliveryDate && (
          <Banner status="warning">
            <Text>{t('no_dates_after_minimum_delivery', { date: minimumDeliveryDate.toLocaleDateString('nl-NL') })}</Text>
          </Banner>
        )}

        {/* Show no dates available */}
        {!isLoading && !errorKey && deliveryDates.length === 0 && (
          <Banner status="info">
            <Text>{t('no_dates_available')}</Text>
          </Banner>
        )}
      </BlockStack>
    </View>
  );
}