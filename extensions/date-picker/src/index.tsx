import {
	Banner,
	BlockStack,
	Button,
	Heading,
	reactExtension,
	ScrollView,
	SkeletonText,
	Text,
	useApi,
	useApplyAttributeChange,
	useAppMetafields,
	useCartLines,
	useDeliveryGroups,
	useSettings,
	useShippingAddress,
	useTranslate,
	View,
} from "@shopify/ui-extensions-react/checkout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type DeliveryDate, useDeliveryDates } from "./hooks/useDeliveryDates";

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
	),
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
	if (!erpLevertijd || typeof erpLevertijd !== "string") {
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
function _isWithinTwoWeeks(date: Date): boolean {
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
	const lastProcessedRef = useRef<string>("");
	const lastResultRef = useRef<MetadataResult | null>(null);

	// Get metafields with stable queries
	const erpMetafields = useAppMetafields({
		type: "product",
		namespace: "erp",
		key: "levertijd",
	});

	const shippingMetafields = useAppMetafields({
		type: "product",
		namespace: "custom",
		key: "ShippingMethod2",
	});

	// Create stable cart identifier to prevent unnecessary recalculations
	const cartIdentifier = useMemo(() => {
		if (!cartLines) return "empty";
		return cartLines
			.map(
				(line) =>
					`${line.merchandise?.product?.id || "unknown"}-${line.quantity}`,
			)
			.join("|");
	}, [cartLines]);

	// Create stable metafield identifier
	const metafieldIdentifier = useMemo(() => {
		const erpCount = erpMetafields?.length || 0;
		const shippingCount = shippingMetafields?.length || 0;
		const erpData =
			erpMetafields
				?.map((m) => `${m.target.id}:${m.metafield?.value}`)
				.join("|") || "";
		const shippingData =
			shippingMetafields
				?.map((m) => `${m.target.id}:${m.metafield?.value}`)
				.join("|") || "";
		return `erp-${erpCount}-${erpData}|shipping-${shippingCount}-${shippingData}`;
	}, [erpMetafields, shippingMetafields]);

	// Combine identifiers to detect real changes
	const combinedIdentifier = `${cartIdentifier}|${metafieldIdentifier}`;

	// Process metafields only when cart or metafields actually change
	const metadataResult = useMemo((): MetadataResult => {
		// Check if we've already processed this exact combination
		if (
			combinedIdentifier === lastProcessedRef.current &&
			lastResultRef.current
		) {
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
					processed: false,
				},
			};
		}

		let latestMinimumDate: Date | null = null;
		let highestShippingMethodNumber = 0;
		let highestShippingMethodValue: string | null = null;
		let productsWithErpData = 0;
		let productsWithShippingData = 0;
		let rawErpLevertijd: string | null = null;

		cartLines.forEach((line, _index) => {
			const product = line.merchandise?.product;
			if (!product) return;
			const productId = product.id;

			// Find ERP metafield for this specific product
			const erpMetafield = erpMetafields?.find(({ target }) => {
				return `gid://shopify/Product/${target.id}` === productId;
			});

			// Always process ERP data when available (no enableFiltering check)
			if (erpMetafield?.metafield?.value) {
				const erpValue = String(erpMetafield.metafield.value);
				productsWithErpData++;

				const parsedDate = parseErpLevertijd(erpValue);
				if (
					parsedDate &&
					(!latestMinimumDate || parsedDate > latestMinimumDate)
				) {
					latestMinimumDate = parsedDate;
					rawErpLevertijd = erpValue;
					console.log(
						`🚀 Product minimum levertijd date to: ${parsedDate.toISOString().split("T")[0]} from ERP: ${erpValue}`,
					);
				}
			}

			const shippingMetafield = shippingMetafields?.find(({ target }) => {
				return `gid://shopify/Product/${target.id}` === productId;
			});

			if (shippingMetafield?.metafield?.value) {
				const shippingValue = String(shippingMetafield.metafield.value);
				const methodNumber = extractShippingMethodNumber(shippingValue);

				// console.log(`🚚 Product ${productId} has shipping method: ${shippingValue} (number: ${methodNumber})`);
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
				latestMinimumDate: latestMinimumDate
					? (latestMinimumDate as Date).toISOString().split("T")[0]
					: null,
				highestShippingMethod: highestShippingMethodValue,
				rawErpLevertijd: rawErpLevertijd,
				processed: true,
			},
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
function useSaveMetadataToAttributes(
	metadataResult: MetadataResult,
	shouldSave: boolean = true,
) {
	const applyAttributeChange = useApplyAttributeChange();
	const lastSavedRef = useRef<string>("");

	useEffect(() => {
		if (!metadataResult.debugInfo.processed || !shouldSave) return;

		// Create a unique signature for this metadata to prevent duplicate saves
		const metadataSignature = JSON.stringify({
			minDate: metadataResult.debugInfo.latestMinimumDate,
			shippingMethod: metadataResult.highestShippingMethod,
			erpCount: metadataResult.debugInfo.productsWithErpData,
		});

		// Only save if metadata actually changed
		if (metadataSignature === lastSavedRef.current) {
			// console.log('📊 Skipping metadata save - no changes detected');
			return;
		}

		lastSavedRef.current = metadataSignature;

		const saveAttributes = async () => {
			try {
				// console.log('💾 Saving cart metadata to order attributes...');

				const attributes = [
					{
						key: "shipping_method",
						value: metadataResult.highestShippingMethod || "none",
					},
				];

				for (const attr of attributes) {
					const result = await applyAttributeChange({
						type: "updateAttribute",
						key: attr.key,
						value: attr.value,
					});

					if (result.type === "error") {
						// console.warn(`⚠️ Failed to save ${attr.key} to attributes`);
					}
				}

				// console.log('✅ Saved cart metadata to order attributes');
			} catch (_err) {
				// console.error('❌ Error saving cart metadata to attributes:', err);
			}
		};

		saveAttributes();
	}, [metadataResult, applyAttributeChange, shouldSave]);
}

function DeliveryDatePicker() {
	const [errorKey, setErrorKey] = useState<string | null>(null);
	const [selectedDate, setSelectedDate] = useState<string | null>(null);
	const [selectedShippingMethod, setSelectedShippingMethod] = useState<
		string | null
	>(null);

	const shippingAddress = useShippingAddress();
	const deliveryGroups = useDeliveryGroups();
	const settings = useSettings();
	const t = useTranslate();
	const { shop } = useApi();
	const applyAttributeChange = useApplyAttributeChange();

	// API base URL - hardcoded for production
	const apiBaseUrl = "https://woood-production.leander-4e0.workers.dev";

	// Extension settings
	const extensionMode = settings.extension_mode || "Full";
	const datePickerFiltering = settings.date_picker_filtering || "ERP Filtered";
	const hidePicker =
		typeof settings.hide_picker_within_days === "number"
			? settings.hide_picker_within_days
			: 14;
	const maxDatesToShow =
		typeof settings.max_dates_to_show === "number"
			? settings.max_dates_to_show
			: 15;
	const activeCountryCodes = settings.active_country_codes || "NL";
	const enableMockMode =
		typeof settings.enable_mock_mode === "boolean"
			? settings.enable_mock_mode
			: false;
	const isCheckoutPreview =
		typeof settings.preview_mode === "boolean" ? settings.preview_mode : false;
	const deliveryMethodCutoff =
		typeof settings.delivery_method_cutoff === "number"
			? settings.delivery_method_cutoff
			: 30;

	console.log(
		`🔧 [Settings] Extension Mode: ${extensionMode}, Cutoff: ${deliveryMethodCutoff}, Preview: ${isCheckoutPreview}`,
	);

	// Derived settings
	const isExtensionDisabled = extensionMode === "Disabled";
	const onlyShippingData = extensionMode === "Shipping Data Only";
	const shouldShowDatePicker =
		extensionMode === "Date Picker Only" || extensionMode === "Full";
	const enableWeekNumberFiltering = datePickerFiltering === "ERP Filtered";

	// Parse active country codes and determine if date picker should show
	const activeCountryCodesList = (activeCountryCodes as string)
		.split(",")
		.map((code: string) => code.trim().toUpperCase())
		.filter((code: string) => code.length > 0); // Remove empty strings

	const countryCode = shippingAddress?.countryCode;
	const canShowPicker =
		countryCode &&
		activeCountryCodesList.includes(countryCode) &&
		shouldShowDatePicker;

	// Always process cart metadata (needed for order attributes even when picker is hidden)
	const metadataResult = useCartMetadataOptimized();
	const { minimumDeliveryDate, highestShippingMethod } = metadataResult;

	// Save metadata to attributes based on extension mode
	const shouldSaveShippingData =
		extensionMode === "Shipping Data Only" || extensionMode === "Full";
	useSaveMetadataToAttributes(metadataResult, shouldSaveShippingData);

	// Hide extension completely if disabled
	const isExtensionDisabledUI = isExtensionDisabled;
	const onlyShippingDataUI = onlyShippingData;
	const hidePickerDueToEarlyDelivery = useMemo(() => {
		if (!minimumDeliveryDate || hidePicker === 0) return false;
		const today = new Date();
		const daysUntilDelivery = Math.ceil(
			(minimumDeliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
		);
		return daysUntilDelivery <= hidePicker;
	}, [minimumDeliveryDate, hidePicker]);

	// Country allow-listing combined with picker mode (computed above)

	const cartLines = useCartLines();
	const [inventory, setInventory] = useState<Record<
		string,
		number | null
	> | null>(null);
	const [inventoryLoading, setInventoryLoading] = useState(false);
	const [inventoryError, setInventoryError] = useState<string | null>(null);

	// Fetch inventory from worker API when cart lines or shop changes
	useEffect(() => {
		if (!cartLines || cartLines.length === 0 || !shop?.myshopifyDomain) {
			setInventory(null);
			setInventoryLoading(false);
			setInventoryError(null);
			return;
		}
		const variantIds = cartLines
			.map((line) => line.merchandise?.id)
			.filter(Boolean);
		if (variantIds.length === 0) {
			setInventory(null);
			setInventoryLoading(false);
			setInventoryError(null);
			return;
		}

		console.log(
			`🔍 [Inventory Check] Starting for ${variantIds.length} variants in shop: ${shop.myshopifyDomain}`,
		);
		console.log(`🔍 [Inventory Check] Variant IDs:`, variantIds);

		setInventoryLoading(true);
		setInventoryError(null);
		fetch(`${apiBaseUrl}/api/inventory`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": "Scuffed~v4ns",
			},
			body: JSON.stringify({ shop: shop.myshopifyDomain, variantIds }),
		})
			.then(async (res) => {
				if (!res.ok) throw new Error(await res.text());
				return res.json();
			})
			.then((data) => {
				console.log(`✅ [Inventory Check] API Response:`, data);
				if (data?.success && data.inventory) {
					setInventory(data.inventory);

					// Log inventory details for debugging
					const inventoryDetails = Object.entries(data.inventory).map(
						([variantId, qty]) => ({
							variantId,
							quantity: qty,
							inStock:
								qty === null ||
								qty === undefined ||
								(typeof qty === "number" && qty > 0),
						}),
					);
					console.log(
						`📊 [Inventory Check] Inventory details:`,
						inventoryDetails,
					);
				} else {
					console.warn(`⚠️ [Inventory Check] Invalid API response:`, data);
					setInventoryError("Inventory API error");
					setInventory(null);
				}
			})
			.catch((err) => {
				console.error(`❌ [Inventory Check] Error:`, err);
				setInventoryError(
					typeof err === "string" ? err : err.message || "Unknown error",
				);
				setInventory(null);
			})
			.finally(() => setInventoryLoading(false));
	}, [cartLines, shop?.myshopifyDomain]);

	// Determine if all products are in stock using fetched inventory
	const allProductsInStock = useMemo(() => {
		if (!cartLines || cartLines.length === 0) return true; // Empty cart = in stock
		if (inventoryLoading) return false; // Don't show picker while loading
		if (inventoryError) {
			console.log(
				`🔍 [Stock Check] Inventory error, assuming in stock:`,
				inventoryError,
			);
			return true; // If inventory check fails, assume in stock (don't block customers)
		}
		if (!inventory) {
			console.log(`🔍 [Stock Check] No inventory data, assuming in stock`);
			return true; // If no inventory data, assume in stock
		}

		const stockResults = cartLines.map((line) => {
			const variantId = line.merchandise?.id;
			if (!variantId) {
				console.log(
					`🔍 [Stock Check] No variant ID for line, assuming in stock`,
				);
				return true; // If no variant ID, assume in stock
			}
			const qty = inventory[variantId];
			const inStock =
				qty === null ||
				qty === undefined ||
				(typeof qty === "number" && qty > 0);
			console.log(
				`🔍 [Stock Check] Variant ${variantId}: qty=${qty}, inStock=${inStock}`,
			);
			return inStock;
		});

		const allInStock = stockResults.every((result) => result);
		console.log(
			`🔍 [Stock Check] Final result: allInStock=${allInStock}, individual results:`,
			stockResults,
		);
		return allInStock;
	}, [cartLines, inventory, inventoryLoading, inventoryError]);

	// STEP 1: Stock Check Logic - More lenient to avoid false negatives
	const stockCheckPassed = useMemo(() => {
		console.log(
			`🔍 [Stock Check Passed] enableOnlyShowIfInStock: ${allProductsInStock}`,
		);
		if (!allProductsInStock) {
			console.log(
				`🔍 [Stock Check Passed] Stock check failed, returning false`,
			);
			return false; // Stock check failed
		}
		console.log(`🔍 [Stock Check Passed] Stock check passed, returning true`);
		return true; // Stock check passed
	}, [allProductsInStock]);

	// STEP 2: Dutch Order Check Logic - REMOVED, now always proceed
	const _isDutchOrder = true; // Always proceed regardless of country

	// STEP 3: Delivery Method Check Logic
	const deliveryMethodNumber = useMemo(() => {
		// Use highestShippingMethod from cart metadata instead of selectedShippingMethod
		// This is more reliable as it's calculated from product metafields
		const methodToUse = highestShippingMethod || selectedShippingMethod;
		if (!methodToUse) return null;
		const number = extractShippingMethodNumber(methodToUse);
		console.log(
			`🚚 [Shipping Method] Using: "${methodToUse}" (source: ${highestShippingMethod ? "cart metadata" : "delivery groups"}) → Number: ${number}`,
		);
		return number;
	}, [highestShippingMethod, selectedShippingMethod]);

	const isDutchnedDelivery = useMemo(() => {
		const result =
			deliveryMethodNumber !== null &&
			deliveryMethodNumber >= deliveryMethodCutoff;
		console.log(
			`🎯 [Delivery Type] Method: ${deliveryMethodNumber}, Cutoff: ${deliveryMethodCutoff}, Is Dutchned: ${result}`,
		);
		return result;
	}, [deliveryMethodNumber, deliveryMethodCutoff]);

	// Determine overall delivery type for logging
	const deliveryType = useMemo(() => {
		if (stockCheckPassed === false) return "ERP";
		if (isDutchnedDelivery) return "DUTCHNED";
		return "POST";
	}, [stockCheckPassed, isDutchnedDelivery]);

	console.log(
		`📋 [Flow Summary] Stock: ${stockCheckPassed}, Highest Method: "${highestShippingMethod}", Delivery Type: ${deliveryType}`,
	);

	// Generate localized mock delivery dates for POST delivery
	const generateLocalizedMockDates = useCallback((): DeliveryDate[] => {
		const dates: DeliveryDate[] = [];
		const today = new Date();

		// Generate mock dates for the next 20 days, excluding weekends
		for (let i = 1; i <= 20; i++) {
			const futureDate = new Date(today);
			futureDate.setDate(today.getDate() + i);

			// Skip weekends (Saturday = 6, Sunday = 0)
			const dayOfWeek = futureDate.getDay();
			if (dayOfWeek === 0 || dayOfWeek === 6) {
				continue;
			}

			const dateString = futureDate.toISOString().split("T")[0]; // YYYY-MM-DD format

			// Use localized weekday and month names from translations
			const weekdayName = t(`weekday_${dayOfWeek}`);
			const monthName = t(`month_${futureDate.getMonth()}`);
			const dayNumber = futureDate.getDate();

			const displayName = `${weekdayName}, ${monthName} ${dayNumber}`;

			dates.push({
				date: dateString,
				displayName,
			});

			// Stop when we have enough dates
			if (dates.length >= maxDatesToShow) {
				break;
			}
		}

		return dates;
	}, [maxDatesToShow, t]);

	// External API call for delivery dates (only for Dutchned)
	const {
		deliveryDates: apiDeliveryDates,
		loading: apiLoading,
		error: fetchError,
		refetch,
	} = useDeliveryDates(apiBaseUrl, false, shop.myshopifyDomain);

	// Determine which dates to use based on delivery type
	const deliveryDates = useMemo(() => {
		let dates: Array<{ date: string; displayName: string }> = [];

		if (deliveryType === "POST") {
			// Use mock data for POST delivery
			dates = generateLocalizedMockDates();
			console.log(
				`📅 [Date Source] POST delivery - Using ${dates.length} mock dates`,
			);
		} else if (deliveryType === "DUTCHNED") {
			// Use API data for Dutchned delivery
			dates = apiDeliveryDates || [];
			console.log(
				`📅 [Date Source] DUTCHNED delivery - Using ${dates.length} API dates from Dutchned`,
			);
		} else {
			// ERP delivery - no dates
			dates = [];
			console.log(`📅 [Date Source] ERP delivery - No dates available`);
		}

		return dates;
	}, [deliveryType, apiDeliveryDates, generateLocalizedMockDates]);

	// Loading state based on delivery type
	const loading = useMemo(() => {
		if (deliveryType === "POST") {
			return false; // Mock data is generated instantly
		} else if (deliveryType === "DUTCHNED") {
			return apiLoading; // Use API loading state
		} else {
			return false; // ERP delivery - no loading
		}
	}, [deliveryType, apiLoading]);

	// Filter available dates based on delivery type
	const filteredDates = useMemo(() => {
		console.log(
			`🔍 [Date Filtering] Starting with ${deliveryDates?.length || 0} ${deliveryType} dates`,
		);

		if (!deliveryDates || deliveryDates.length === 0) {
			console.log(`🔍 [Date Filtering] No dates available to filter`);
			return [];
		}

		let filtered: DeliveryDate[];
		if (!enableWeekNumberFiltering || !minimumDeliveryDate) {
			filtered = deliveryDates;
			console.log(
				`🔍 [Date Filtering] No ERP filtering applied - showing all ${filtered.length} dates`,
			);
		} else {
			const minDateStr = minimumDeliveryDate.toISOString().split("T")[0];
			console.log(
				`🔍 [Date Filtering] ERP filtering enabled - minimum date: ${minDateStr}`,
			);

			filtered = deliveryDates.filter((dateItem: DeliveryDate) => {
				try {
					const deliveryDate = new Date(dateItem.date);
					const isAfterMin = deliveryDate >= minimumDeliveryDate;
					console.log(
						`🔍 [Date Filtering] ${dateItem.date} >= ${minDateStr}: ${isAfterMin}`,
					);
					return isAfterMin;
				} catch (_error) {
					console.log(`🔍 [Date Filtering] Invalid date: ${dateItem.date}`);
					return false;
				}
			});
			console.log(
				`🔍 [Date Filtering] After ERP filtering: ${filtered.length} dates remain`,
			);
		}

		// Apply delivery type specific limits
		const originalLength = filtered.length;
		if (deliveryType === "DUTCHNED") {
			filtered = filtered.slice(0, 14);
			console.log(
				`🔍 [Date Filtering] DUTCHNED limit applied: ${originalLength} → ${filtered.length} dates (max 14)`,
			);
		} else {
			filtered = filtered.slice(0, maxDatesToShow);
			console.log(
				`🔍 [Date Filtering] POST limit applied: ${originalLength} → ${filtered.length} dates (max ${maxDatesToShow})`,
			);
		}

		console.log(
			`🔍 [Date Filtering] Final result: ${filtered.length} ${deliveryType} dates available`,
		);
		return filtered;
	}, [
		deliveryDates,
		minimumDeliveryDate,
		enableWeekNumberFiltering,
		maxDatesToShow,
		deliveryType,
	]);

	// Detect selected shipping method from delivery groups
	useEffect(() => {
		if (deliveryGroups && deliveryGroups.length > 0) {
			for (const group of deliveryGroups) {
				const selectedOption = group.selectedDeliveryOption;
				if (selectedOption) {
					const shippingMethodName = selectedOption.handle || "Unknown";
					if (shippingMethodName !== selectedShippingMethod) {
						setSelectedShippingMethod(shippingMethodName);
					}
					break;
				}
			}
		}
	}, [deliveryGroups, selectedShippingMethod]);

	// Handle errors from React Query (only for Dutchned)
	useEffect(() => {
		if (deliveryType === "DUTCHNED" && fetchError) {
			setErrorKey("error_loading");
		} else {
			setErrorKey(null);
		}
	}, [fetchError, deliveryType]);

	// Save selected delivery date separately
	const handleDateSelect = useCallback(
		async (dateString: string) => {
			setSelectedDate(dateString);

			try {
				const result = await applyAttributeChange({
					type: "updateAttribute",
					key: "delivery_date",
					value: dateString,
				});

				if (result.type === "error") {
					throw new Error("Failed to save delivery date");
				}

				console.log("✅ Saved delivery date:", dateString);
			} catch (_err) {
				setErrorKey("error_saving");
			}
		},
		[applyAttributeChange],
	);

	const handleRetry = useCallback(() => {
		setErrorKey(null);
		if (deliveryType === "DUTCHNED") {
			refetch();
		}
	}, [refetch, deliveryType]);

	// Don't show date picker if not enabled for this country (removed NL requirement)
	if (!shouldShowDatePicker) {
		if (isCheckoutPreview) {
			return (
				<View border="base" cornerRadius="base" padding="base">
					<BlockStack spacing="base">
						<Heading level={2}>{t("title")}</Heading>
						<Banner status="info">
							<Text size="small">
								🌍 Delivery date picker is available for countries:{" "}
								{activeCountryCodes}
							</Text>
						</Banner>
					</BlockStack>
				</View>
			);
		}
		return null;
	}

	// Show ERP delivery message when stock check fails
	if (stockCheckPassed === false) {
		// Don't show stock check failures to customers - only in preview mode for debugging
		if (isCheckoutPreview) {
			return (
				<View border="base" cornerRadius="base" padding="base">
					<BlockStack spacing="base">
						<Heading level={2}>{t("title")}</Heading>
						<Banner status="warning">
							<Text size="small">
								📦 {t("stock_check_out_of_stock")} (Preview only - hidden from
								customers)
							</Text>
						</Banner>
					</BlockStack>
				</View>
			);
		}
		// In actual checkout, don't show anything - let the flow continue
		return null;
	}

	// Show loading state for stock check
	if (stockCheckPassed === null) {
		// Only show loading in preview mode - customers shouldn't see stock check loading
		if (isCheckoutPreview) {
			return (
				<View border="base" cornerRadius="base" padding="base">
					<BlockStack spacing="base">
						<Heading level={2}>{t("title")}</Heading>
						<Banner status="info">
							<Text size="small">
								🔍 {t("stock_check_loading")} (Preview only - hidden from
								customers)
							</Text>
						</Banner>
					</BlockStack>
				</View>
			);
		}
		// In actual checkout, don't show loading state
		return null;
	}

	// Don't show date picker if minimum delivery date is within configured days
	if (hidePickerDueToEarlyDelivery) {
		if (isCheckoutPreview) {
			return (
				<View border="base" cornerRadius="base" padding="base">
					<BlockStack spacing="base">
						<Heading level={2}>{t("title")}</Heading>
						<Banner status="info">
							<Text size="small">
								📅 Delivery date picker is hidden because products can be
								delivered within {hidePicker} days (by{" "}
								{minimumDeliveryDate?.toLocaleDateString("nl-NL")})
							</Text>
						</Banner>
					</BlockStack>
				</View>
			);
		} else {
			return null;
		}
	}

	return (
		<View border="base" cornerRadius="base" padding="base">
			<BlockStack spacing="base">
				<Heading level={2}>{t("title")}</Heading>

				{/* Show configuration info */}
				{enableMockMode && isCheckoutPreview && (
					<Banner status="info">
						<Text size="small">Mock mode enabled - using test data</Text>
					</Banner>
				)}

				{/* Show delivery type info */}
				{isCheckoutPreview && (
					<Banner status="info">
						<Text size="small">
							{deliveryType === "DUTCHNED" &&
								`${t("dutchned_delivery")} (>= ${deliveryMethodCutoff})`}
							{deliveryType === "POST" &&
								`${t("post_delivery")} (< ${deliveryMethodCutoff})`}
							{deliveryType === "ERP" && t("erp_delivery_info")}
						</Text>
					</Banner>
				)}

				{/* Show POST delivery info */}
				{deliveryType === "POST" && (
					<Banner status="info">
						<Text size="small">{t("post_delivery_info")}</Text>
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
								{t("retry")}
							</Button>
						</BlockStack>
					</Banner>
				)}

				{/* Show delivery dates for Dutchned and POST delivery */}
				{!loading &&
					!errorKey &&
					filteredDates.length > 0 &&
					(deliveryType === "DUTCHNED" || deliveryType === "POST") && (
						<BlockStack spacing="base">
							<View>
								<ScrollView maxBlockSize={300}>
									<BlockStack spacing="tight">
										{filteredDates.map((dateItem) => {
											const isSelected = selectedDate === dateItem.date;
											return (
												<Button
													key={dateItem.date}
													kind={isSelected ? "primary" : "secondary"}
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
				{!loading &&
					!errorKey &&
					filteredDates.length === 0 &&
					deliveryDates.length > 0 &&
					enableWeekNumberFiltering &&
					minimumDeliveryDate && (
						<Banner status="warning">
							<Text>
								{t("no_dates_after_minimum_delivery", {
									date: minimumDeliveryDate.toLocaleDateString("nl-NL"),
								})}
							</Text>
						</Banner>
					)}

				{/* Show no dates available */}
				{!loading && !errorKey && deliveryDates.length === 0 && (
					<Banner status="info">
						<Text>{t("no_dates_available")}</Text>
					</Banner>
				)}
			</BlockStack>
		</View>
	);
}
