import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  useAppMetafields,
  useApi,
} from "@shopify/ui-extensions-react/checkout";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeliveryDates, DeliveryDate } from "./hooks/useDeliveryDates";
import { ErrorBoundary } from "./components/ErrorBoundary";

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
  // ISO 8601 week calculation
  // Week 1 is the first week with at least 4 days in the new year
  const jan4 = new Date(year, 0, 4);

  // Find the Monday of week 1 (ISO week 1)
  const week1Monday = new Date(jan4);
  const dayOfWeek = jan4.getDay() || 7; // Make Sunday = 7
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);

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
 * Extract shipping method number from string (e.g., "30 - EXPEDITIE STANDAARD" -> 30)
 */
function extractShippingMethodNumber(shippingMethod: string): number {
  const match = shippingMethod.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if date is within the next 2 weeks
 */
function isWithinTwoWeeks(date: Date): boolean {
  const twoWeeksFromNow = new Date();
  twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
  return date <= twoWeeksFromNow;
}

// Define proper types for the metadata result
interface MetadataResult {
  minimumDeliveryDate: Date | null;
  highestShippingMethod: string | null;
  debugInfo: {
    cartLines: number;
    productsWithErpData: number;
    productsWithShippingData: number;
    latestMinimumDate: string | null;
    highestShippingMethod: string | null;
    rawErpLevertijd: string | null;
    processed: boolean;
  };
}

/**
 * Optimized hook to process cart metadata once per cart change
 */
function useCartMetadataOptimized(): MetadataResult {
  const cartLines = useCartLines();
  const lastProcessedRef = useRef<string>('');
  const lastResultRef = useRef<MetadataResult | null>(null);

  // Get metafields with stable queries
  const erpMetafields = useAppMetafields({
    type: "product",
    namespace: "erp",
    key: "levertijd"
  });

  const shippingMetafields = useAppMetafields({
    type: "product",
    namespace: "custom",
    key: "ShippingMethod2"
  });

  // Create stable cart identifier to prevent unnecessary recalculations
  const cartIdentifier = useMemo(() => {
    if (!cartLines) return 'empty';
    return cartLines.map(line => `${line.merchandise?.product?.id || 'unknown'}-${line.quantity}`).join('|');
  }, [cartLines]);

  // Create stable metafield identifier
  const metafieldIdentifier = useMemo(() => {
    const erpCount = erpMetafields?.length || 0;
    const shippingCount = shippingMetafields?.length || 0;
    const erpData = erpMetafields?.map(m => `${m.target.id}:${m.metafield?.value}`).join('|') || '';
    const shippingData = shippingMetafields?.map(m => `${m.target.id}:${m.metafield?.value}`).join('|') || '';
    return `erp-${erpCount}-${erpData}|shipping-${shippingCount}-${shippingData}`;
  }, [erpMetafields, shippingMetafields]);

  // Combine identifiers to detect real changes
  const combinedIdentifier = `${cartIdentifier}|${metafieldIdentifier}`;

  // Process metafields only when cart or metafields actually change
  const metadataResult = useMemo((): MetadataResult => {
    // Check if we've already processed this exact combination
    if (combinedIdentifier === lastProcessedRef.current && lastResultRef.current) {
      return lastResultRef.current;
    }

    lastProcessedRef.current = combinedIdentifier;
    // console.log('🔄 Processing cart metadata (triggered by cart/metafield change)');

    if (!cartLines || cartLines.length === 0) {
      return {
        minimumDeliveryDate: null,
        highestShippingMethod: null,
        debugInfo: {
          cartLines: 0,
          productsWithErpData: 0,
          productsWithShippingData: 0,
          latestMinimumDate: null,
          highestShippingMethod: null,
          rawErpLevertijd: null,
          processed: false
        }
      };
    }

    let latestMinimumDate: Date | null = null;
    let highestShippingMethodNumber = 0;
    let highestShippingMethodValue: string | null = null;
    let productsWithErpData = 0;
    let productsWithShippingData = 0;
    let rawErpLevertijd: string | null = null;

    cartLines.forEach((line, index) => {
      const product = line.merchandise?.product;
      if (!product) return;
      const productId = product.id;

      // Find ERP metafield for this specific product
      const erpMetafield = erpMetafields?.find(({target}) => {
        return `gid://shopify/Product/${target.id}` === productId;
      });

      // Always process ERP data when available (no enableFiltering check)
      if (erpMetafield?.metafield?.value) {
        const erpValue = String(erpMetafield.metafield.value);
        productsWithErpData++;

        const parsedDate = parseErpLevertijd(erpValue);
        if (parsedDate && (!latestMinimumDate || parsedDate > latestMinimumDate)) {
          latestMinimumDate = parsedDate;
          rawErpLevertijd = erpValue;
          console.log(`🚀 Product minimum levertijd date to: ${parsedDate.toISOString().split('T')[0]} from ERP: ${erpValue}`);
        }
      }

      const shippingMetafield = shippingMetafields?.find(({target}) => {
        return `gid://shopify/Product/${target.id}` === productId;
      });

      if (shippingMetafield?.metafield?.value) {
        const shippingValue = String(shippingMetafield.metafield.value);
        const methodNumber = extractShippingMethodNumber(shippingValue);

        console.log(`🚚 Product ${productId} has shipping method: ${shippingValue} (number: ${methodNumber})`);
        productsWithShippingData++;

        if (methodNumber >= highestShippingMethodNumber) {
          highestShippingMethodNumber = methodNumber;
          highestShippingMethodValue = shippingValue;
            }
          }
        });

    const result: MetadataResult = {
      minimumDeliveryDate: latestMinimumDate,
      highestShippingMethod: highestShippingMethodValue,
      debugInfo: {
        cartLines: cartLines.length,
        productsWithErpData,
        productsWithShippingData,
        latestMinimumDate: latestMinimumDate ? (latestMinimumDate as Date).toISOString().split('T')[0] : null,
        highestShippingMethod: highestShippingMethodValue,
        rawErpLevertijd: rawErpLevertijd,
        processed: true
      }
    };

    // Save result for future cache hits
    lastResultRef.current = result;

    // console.log('✅ Cart processing complete:', result);
    return result;

  }, [combinedIdentifier, cartLines, erpMetafields, shippingMetafields]);

  return metadataResult;
}

/**
 * Separate hook for saving attributes to prevent dependency cycles
 */
function useSaveMetadataToAttributes(metadataResult: MetadataResult) {
  const applyAttributeChange = useApplyAttributeChange();
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    if (!metadataResult.debugInfo.processed) return;

    // Create a unique signature for this metadata to prevent duplicate saves
    const metadataSignature = JSON.stringify({
      minDate: metadataResult.debugInfo.latestMinimumDate,
      shippingMethod: metadataResult.highestShippingMethod,
      erpCount: metadataResult.debugInfo.productsWithErpData
    });

    // Only save if metadata actually changed
    if (metadataSignature === lastSavedRef.current) {
      console.log('📊 Skipping metadata save - no changes detected');
      return;
    }

    lastSavedRef.current = metadataSignature;

    const saveAttributes = async () => {
      try {
        console.log('💾 Saving cart metadata to order attributes...');

        const attributes = [
          {
            key: 'erp_minimum_delivery_date',
            value: metadataResult.debugInfo.latestMinimumDate || 'none'
          },
          {
            key: 'cart_shipping_method',
            value: metadataResult.highestShippingMethod || 'none'
          },
          {
            key: 'cart_products_with_erp_data',
            value: metadataResult.debugInfo.productsWithErpData.toString()
          }
        ];

        for (const attr of attributes) {
          const result = await applyAttributeChange({
            type: 'updateAttribute',
            key: attr.key,
            value: attr.value,
          });

          if (result.type === 'error') {
            console.warn(`⚠️ Failed to save ${attr.key} to attributes`);
          }
        }

        console.log('✅ Saved cart metadata to order attributes');
      } catch (err) {
        console.error('❌ Error saving cart metadata to attributes:', err);
      }
    };

    saveAttributes();
  }, [metadataResult, applyAttributeChange]);
}

function DeliveryDatePicker() {
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedShippingMethod, setSelectedShippingMethod] = useState<string | null>(null);

  const shippingAddress = useShippingAddress();
  const deliveryGroups = useDeliveryGroups();
  const settings = useSettings();
  const t = useTranslate();
  const { shop } = useApi();
  const applyAttributeChange = useApplyAttributeChange();

  // API base URL - for delivery dates (essential external call)
  const apiBaseUrl = 'https://woood-production.leander-4e0.workers.dev';

  // Extension settings
  const hideDatePicker = typeof settings.hide_date_picker === 'boolean' ? settings.hide_date_picker : false;
  const enableMockMode = typeof settings.enable_mock_mode === 'boolean' ? settings.enable_mock_mode : false;
  const enableWeekNumberFiltering = typeof settings.enable_week_number_filtering === 'boolean' ? settings.enable_week_number_filtering : true;

  // Detect if we're in checkout preview mode
  const isCheckoutPreview = typeof window !== 'undefined' && window.location.href.includes('preview');

  // Show the date picker only for Netherlands
  const countryCode = shippingAddress?.countryCode;
  const showDatePicker = countryCode === 'NL';

  // Always process cart metadata (needed for order attributes even when picker is hidden)
  const metadataResult = useCartMetadataOptimized();
  const { minimumDeliveryDate, highestShippingMethod, debugInfo } = metadataResult;

  // Save metadata to attributes (separate from processing to prevent cycles)
  useSaveMetadataToAttributes(metadataResult);

  // Hide date picker completely if setting is enabled
  if (hideDatePicker) {
    // In preview mode, show a message explaining why it's hidden
    if (isCheckoutPreview) {
      return (
        <View border="base" cornerRadius="base" padding="base">
          <BlockStack spacing="base">
            <Heading level={2}>{t('title')}</Heading>
            <Banner status="info">
              <Text size="small">
                🚫 Date picker is hidden via extension settings
              </Text>
            </Banner>
          </BlockStack>
        </View>
      );
    }
    // In actual checkout, return an empty div to avoid React errors
    return <View />;
  }

  // Check if minimum date is within 2 weeks (hide date picker if so)
  const hidePickerDueToEarlyDelivery = useMemo(() => {
    if (!minimumDeliveryDate) return false;
    return isWithinTwoWeeks(minimumDeliveryDate);
  }, [minimumDeliveryDate]);

  // External API call for delivery dates (essential)
  const {
    deliveryDates,
    loading,
    error: fetchError,
    refetch,
  } = useDeliveryDates(apiBaseUrl, enableMockMode, shop.myshopifyDomain);

  // Filter available dates based on product metafield data and limit to first 14
  const filteredDates = useMemo(() => {
    if (!deliveryDates || deliveryDates.length === 0) {
      return [];
    }

    let filtered;
    if (!enableWeekNumberFiltering || !minimumDeliveryDate) {
      filtered = deliveryDates;
    } else {
      filtered = deliveryDates.filter((dateItem: DeliveryDate) => {
      try {
        const deliveryDate = new Date(dateItem.date);
        return deliveryDate >= minimumDeliveryDate;
      } catch (error) {
        console.warn('Invalid delivery date format:', dateItem.date);
        return false;
      }
    });
    }

    // Limit to first 14 dates
    const limitedDates = filtered.slice(0, 14);

    console.log(`🔍 Filtered ${deliveryDates.length} dates to ${filtered.length} dates, showing first ${limitedDates.length} dates`);
    return limitedDates;
  }, [deliveryDates, minimumDeliveryDate, enableWeekNumberFiltering]);

  // Detect selected shipping method from delivery groups
  useEffect(() => {
    if (deliveryGroups && deliveryGroups.length > 0) {
      for (const group of deliveryGroups) {
        const selectedOption = group.selectedDeliveryOption;
        if (selectedOption) {
          const shippingMethodName = selectedOption.handle || 'Unknown';
          if (shippingMethodName !== selectedShippingMethod) {
          setSelectedShippingMethod(shippingMethodName);
          }
          break;
        }
      }
    }
  }, [deliveryGroups, selectedShippingMethod]);

  // Handle errors from React Query
  useEffect(() => {
    if (fetchError) {
      console.error('Error fetching delivery dates:', fetchError);
      setErrorKey('error_loading');
    } else {
        setErrorKey(null);
    }
  }, [fetchError]);

  // Save selected delivery date separately
      const handleDateSelect = useCallback(async (dateString: string) => {
    setSelectedDate(dateString);

    try {
        const result = await applyAttributeChange({
          type: 'updateAttribute',
        key: 'selected_delivery_date',
        value: dateString,
        });

        if (result.type === 'error') {
        throw new Error('Failed to save selected delivery date');
      }

      console.log('✅ Saved selected delivery date:', dateString);
    } catch (err) {
      console.error('❌ Error saving selected delivery date:', err);
      setErrorKey('error_saving');
    }
  }, [applyAttributeChange]);

  const handleRetry = useCallback(() => {
    setErrorKey(null);
    refetch();
  }, [refetch]);

  // Don't show date picker if not in Netherlands
  if (!showDatePicker) {
    return null;
  }

  // Don't show date picker if minimum delivery date is within 2 weeks
  if (hidePickerDueToEarlyDelivery) {
    // Only show the banner in checkout preview mode
    if (isCheckoutPreview) {
      return (
        <View border="base" cornerRadius="base" padding="base">
          <BlockStack spacing="base">
            <Heading level={2}>{t('title')}</Heading>
            <Banner status="info">
              <Text size="small">
                📅 Delivery date picker is hidden because products can be delivered within 2 weeks (by {minimumDeliveryDate?.toLocaleDateString('nl-NL')})
              </Text>
            </Banner>
          </BlockStack>
        </View>
      );
    } else {
      // In actual checkout, just return null (completely hidden)
      return null;
    }
  }

  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="base">
        <Heading level={2}>{t('title')}</Heading>

        {/* Show configuration info */}
        {enableMockMode && isCheckoutPreview &&  (
          <Banner status="info">
            <Text size="small">Mock mode enabled - using test data</Text>
          </Banner>
        )}

        {/* Show loading state */}
        {loading && (
          <BlockStack spacing="tight">
            <SkeletonText />
            <SkeletonText />
            <SkeletonText />
          </BlockStack>
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
        {!loading && !errorKey && filteredDates.length > 0 && (
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
        {!loading && !errorKey && filteredDates.length === 0 && deliveryDates.length > 0 && enableWeekNumberFiltering && minimumDeliveryDate && (
          <Banner status="warning">
            <Text>{t('no_dates_after_minimum_delivery', { date: minimumDeliveryDate.toLocaleDateString('nl-NL') })}</Text>
          </Banner>
        )}

        {/* Show no dates available */}
        {!loading && !errorKey && deliveryDates.length === 0 && (
          <Banner status="info">
            <Text>{t('no_dates_available')}</Text>
          </Banner>
        )}
      </BlockStack>
    </View>
  );
}