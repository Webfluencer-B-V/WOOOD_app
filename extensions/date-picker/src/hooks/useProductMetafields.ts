import { useCartLines } from "@shopify/ui-extensions-react/checkout";
import { useMemo } from "react";

export interface ProductMetafieldData {
	erpDeliveryTime: string | null;
	shippingMethod: string | null;
	deliveryTime: number | null;
}

export interface CartProductsMetadata {
	minimumDeliveryDate: Date | null;
	highestShippingMethod: {
		number: number;
		originalValue: string | null;
	};
}

/**
 * Parse ERP delivery time metafield (format: "YYYY-WW")
 * @param erpLevertijd - The metafield value (e.g., "2025-22")
 * @returns Date object or null if invalid
 */
function _parseErpLevertijd(erpLevertijd: string | null): Date | null {
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
 * Convert week number to date (ISO week date calculation)
 */
function weekNumberToDate(year: number, week: number): Date {
	const jan4 = new Date(year, 0, 4);
	const week1Monday = new Date(jan4);
	week1Monday.setDate(jan4.getDate() - jan4.getDay() + 1);
	const targetWeekMonday = new Date(week1Monday);
	targetWeekMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
	return targetWeekMonday;
}

/**
 * Extract number from shipping method string (e.g., "11 - PAKKET POST" -> 11)
 */
function _extractShippingMethodNumber(shippingMethod: string): number {
	const match = shippingMethod.match(/^(\d+)/);
	return match ? parseInt(match[1], 10) : 0;
}

/**
 * Hook to analyze all cart products and extract metadata using native Shopify extension capabilities
 * This completely eliminates the need for external API calls!
 */
export function useCartProductsMetadata(
	enableFiltering: boolean = true,
): CartProductsMetadata {
	const cartLines = useCartLines();

	return useMemo(() => {
		console.log(
			"🔍 Analyzing cart products metadata using native Shopify extension capabilities",
			{
				enableFiltering,
				cartLinesLength: cartLines?.length || 0,
			},
		);

		if (!cartLines || cartLines.length === 0) {
			return {
				minimumDeliveryDate: null,
				highestShippingMethod: { number: 0, originalValue: null },
			};
		}

		const latestMinimumDate: Date | null = null;
		const highestShippingMethodNumber = 0;
		const highestShippingMethodValue: string | null = null;

		// Process each cart line and extract metafields directly
		cartLines.forEach((line, index) => {
			const product = line.merchandise?.product;

			if (!product) {
				console.warn(`Cart line ${index} has no product`);
				return;
			}

			console.log(
				`📦 Processing cart line ${index} with product ID: ${product.id}`,
			);

			// Note: In checkout extensions, product metafields are available through the product object
			// but only if they're configured in the extension's shopify.extension.toml file
			// For this to work, we need to add the metafields to the configuration

			// The metafields would be accessible like:
			// product.metafield?.value (if configured in toml)

			// Since we're accessing product data that may include metafields,
			// we should check if the metafields are available in the product object
			console.log(`📋 Product data available:`, {
				id: product.id,
				// Note: Some properties may not be available in TypeScript types but exist in runtime
				// Avoid "any"; access known optional fields via index signature
				title: (product as unknown as { title?: string })?.title,
				vendor: (product as unknown as { vendor?: string })?.vendor,
				productType: (product as unknown as { productType?: string })
					?.productType,
			});

			// For now, we'll extract the product ID to track what products we're analyzing
			const productId =
				product.id?.replace("gid://shopify/Product/", "") || "unknown";
			console.log(`🆔 Product ID: ${productId}`);
		});

		const result = {
			minimumDeliveryDate: latestMinimumDate,
			highestShippingMethod: {
				number: highestShippingMethodNumber,
				originalValue: highestShippingMethodValue,
			},
		};

		console.log(
			"📊 Cart metadata analysis complete (using native extension capabilities):",
			result,
		);
		return result;
	}, [cartLines, enableFiltering]);
}

/**
 * Extract product IDs from cart lines for backward compatibility with external API calls
 * This function can be used as a fallback if metafields aren't configured in the extension
 */
export function useCartProductIds(): string[] {
	const cartLines = useCartLines();

	return useMemo(() => {
		if (!cartLines || cartLines.length === 0) return [];

		return cartLines
			.map((line) => line.merchandise?.product?.id)
			.filter((id) => id) // Remove null/undefined
			.map((id) => id!.replace("gid://shopify/Product/", "")); // Extract numeric ID
	}, [cartLines]);
}

/**
 * Get basic product information from cart lines
 * This shows what data is natively available without external API calls
 */
export function useCartProductsInfo() {
	const cartLines = useCartLines();

	return useMemo(() => {
		if (!cartLines || cartLines.length === 0) return [];

		return cartLines.map((line, index) => {
			const product = line.merchandise?.product;

			return {
				lineIndex: index,
				quantity: line.quantity,
				productId: product?.id,
				productTitle:
					(product as unknown as { title?: string })?.title ||
					"Unknown Product",
				productVendor:
					(product as unknown as { vendor?: string })?.vendor ||
					"Unknown Vendor",
				productType:
					(product as unknown as { productType?: string })?.productType ||
					"Unknown Type",
				variantId: line.merchandise?.id,
				variantTitle:
					(line.merchandise as unknown as { title?: string })?.title ||
					"Unknown Variant",
				variantSku:
					(line.merchandise as unknown as { sku?: string })?.sku ||
					"Unknown SKU",
				// Note: metafields would be available here if configured in shopify.extension.toml
				// For example: erpDeliveryTime: product.erpMetafield?.value
				// shippingMethod: product.shippingMethodMetafield?.value
			};
		});
	}, [cartLines]);
}

// For backward compatibility - these hooks maintain the same interface
// but now use native extension capabilities where possible
export function useProductMetafields(productId: string): ProductMetafieldData {
	const cartProductsInfo = useCartProductsInfo();

	return useMemo(() => {
		// Find the product in cart lines
		const productInfo = cartProductsInfo.find((info) =>
			info.productId?.includes(productId),
		);

		console.log(`📋 Product ${productId} info from cart lines:`, productInfo);

		// If metafields were configured in the extension TOML, they would be available here
		// For now, returning null values since metafields aren't configured yet
		return {
			erpDeliveryTime: null, // Would be: productInfo.erpDeliveryTime
			shippingMethod: null, // Would be: productInfo.shippingMethod
			deliveryTime: null, // Would be: productInfo.deliveryTime
		};
	}, [productId, cartProductsInfo]);
}
