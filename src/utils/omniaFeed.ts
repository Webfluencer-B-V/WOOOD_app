export interface OmniaFeedApiConfig {
	feedUrl: string;
	userAgent?: string;
}

export interface OmniaFeedRow {
	omniUniqueId: string;
	ean: string;
	recommendedSellingPrice: number;
	priceAdvice: number;
	discountPercentage: number;
}

export interface FeedParseResult {
	success: boolean;
	totalRows: number;
	validRows: number;
	invalidRows: number;
	products: OmniaFeedRow[];
	errors: string[];
}

export interface ShopifyAdminClient {
	request: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
}

export interface ProductPriceMatch {
	productId: string;
	variantId: string;
	ean: string;
	currentPrice: number;
	currentCompareAtPrice: number | null;
	newPrice: number;
	newCompareAtPrice: number;
	discountPercentage: number;
	priceChange: number;
}

export interface ProductUpdateSample {
	productId: string;
	variantId: string;
	ean: string;
	oldPrice: number;
	oldCompareAtPrice: number | null;
	newPrice: number;
	newCompareAtPrice: number;
	priceChange: number;
	productTitle?: string;
	productHandle?: string;
	productFeaturedImageUrl?: string;
	variantSku?: string;
	variantImageUrl?: string;
}

export interface ValidationError {
	productId: string;
	variantId: string;
	ean: string;
	errorCode:
		| "discount_too_large"
		| "base_price_differs"
		| "validation_fails"
		| "price_too_low"
		| "price_too_high";
	errorMessage: string;
	currentPrice: number;
	newPrice: number;
	discountPercentage: number;
}

export interface PricingValidationConfig {
	maxDiscountPercentage: number; // Default: 90
	enforceBasePriceMatch: boolean; // Default: true
	basePriceTolerance: number; // Default: 5% tolerance
	minPriceThreshold: number; // Default: 0.01
	maxPriceThreshold: number; // Default: 10000
}

export async function fetchOmniaFeedData(
	config: OmniaFeedApiConfig,
): Promise<FeedParseResult> {
	const { feedUrl, userAgent = "WOOOD-Shopify-Integration/1.0" } = config;

	if (!feedUrl) {
		throw new Error("Missing feedUrl for Omnia Feed API");
	}

	const headers: Record<string, string> = {
		"User-Agent": userAgent,
		Accept: "text/csv",
	};

	const response = await fetch(feedUrl, { headers });
	if (!response.ok) {
		let extra = "";
		try {
			const text = await response.text();
			extra = `; body: ${text.slice(0, 256)}`;
		} catch {}
		throw new Error(
			`Failed to fetch Omnia feed data: ${response.status} ${response.statusText}${extra}`,
		);
	}

	const csvData = await response.text();
	return parseOmniaCSV(csvData);
}

function parseOmniaCSV(csvData: string): FeedParseResult {
	const lines = csvData.split("\n").filter((line) => line.trim());
	if (lines.length === 0) {
		throw new Error("Empty CSV data received");
	}

	const result: FeedParseResult = {
		success: false,
		totalRows: lines.length - 1,
		validRows: 0,
		invalidRows: 0,
		products: [],
		errors: [],
	};

	// Skip header row
	for (let i = 1; i < lines.length; i++) {
		const values = lines[i].split(";").map((v) => v.replace(/"/g, "").trim());

		if (values.length < 4) {
			result.invalidRows++;
			result.errors.push(`Row ${i}: Insufficient columns (${values.length}/4)`);
			continue;
		}

		const [omniUniqueId, ean, recommendedSellingPrice, priceAdvice] = values;

		// Validate required fields
		if (!ean || !recommendedSellingPrice || !priceAdvice) {
			result.invalidRows++;
			result.errors.push(`Row ${i}: Missing required fields`);
			continue;
		}

		// Validate numeric values
		const price = parseFloat(recommendedSellingPrice);
		const advice = parseFloat(priceAdvice);

		if (
			Number.isNaN(price) ||
			Number.isNaN(advice) ||
			price <= 0 ||
			advice <= 0
		) {
			result.invalidRows++;
			result.errors.push(
				`Row ${i}: Invalid price values (price: ${recommendedSellingPrice}, advice: ${priceAdvice})`,
			);
			continue;
		}

		const discountPercentage = ((advice - price) / advice) * 100;

		result.products.push({
			omniUniqueId: omniUniqueId || "",
			ean,
			recommendedSellingPrice: price,
			priceAdvice: advice,
			discountPercentage,
		});
		result.validRows++;
	}

	result.success = result.validRows > 0;
	return result;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function revertOmniaPricing(
	adminClient: ShopifyAdminClient,
	shop: string,
	runId: string,
	historyKV: KVNamespace,
): Promise<{
	successful: number;
	failed: number;
	errors: string[];
	revertedVariants: string[];
}> {
	// Get all history entries for this run
	const historyKeys = await historyKV.list({ prefix: `omnia:update:${shop}:` });
	const historyEntries: Array<{
		key: string;
		entry: import("app/types/app").OmniaPricingHistoryEntry;
	}> = [];

	// Filter by runId and fetch entries
	for (const key of historyKeys.keys) {
		try {
			const value = await historyKV.get(key.name, "json");
			if (
				value &&
				typeof value === "object" &&
				"runId" in value &&
				value.runId === runId
			) {
				historyEntries.push({
					key: key.name,
					entry: value as import("app/types/app").OmniaPricingHistoryEntry,
				});
			}
		} catch (error) {
			console.warn(`Failed to fetch history entry ${key.name}:`, error);
		}
	}

	if (historyEntries.length === 0) {
		throw new Error(`No pricing history found for runId: ${runId}`);
	}

	console.log(
		`🔄 Reverting ${historyEntries.length} price changes from runId: ${runId}`,
	);

	// Revert prices in batches
	const batchSize = 10;
	let totalSuccessful = 0;
	let totalFailed = 0;
	const allErrors: string[] = [];
	const revertedVariants: string[] = [];

	for (let i = 0; i < historyEntries.length; i += batchSize) {
		const batch = historyEntries.slice(i, i + batchSize);

		try {
			const productVariants = batch.map(({ entry }) => ({
				id: entry.variantId,
				price: entry.oldPrice.toFixed(2),
				compareAtPrice: entry.oldCompareAtPrice?.toFixed(2) || null,
			}));

			const mutation = `
				mutation productVariantsBulkUpdate($productVariants: [ProductVariantsBulkInput!]!) {
					productVariantsBulkUpdate(productVariants: $productVariants) {
						productVariants {
							id
							price
							compareAtPrice
						}
						userErrors {
							field
							message
						}
					}
				}
			`;

			const result = (await adminClient.request(mutation, {
				productVariants,
			})) as {
				data?: {
					productVariantsBulkUpdate?: {
						userErrors?: Array<{ field?: string; message?: string }>;
						productVariants?: Array<{ id: string }>;
					};
				};
			};

			const userErrors =
				result.data?.productVariantsBulkUpdate?.userErrors ?? [];
			const successfulVariants =
				result.data?.productVariantsBulkUpdate?.productVariants ?? [];

			totalSuccessful += successfulVariants.length;
			totalFailed += batch.length - successfulVariants.length;

			if (userErrors.length > 0) {
				allErrors.push(...userErrors.map((e) => `${e.field}: ${e.message}`));
			}

			// Track successfully reverted variants
			for (const variant of successfulVariants) {
				revertedVariants.push(variant.id);
			}

			// Delete successfully reverted history entries
			for (const { key, entry } of batch) {
				if (successfulVariants.some((v) => v.id === entry.variantId)) {
					historyKV
						.delete(key)
						.catch((error) =>
							console.warn(`Failed to delete history entry ${key}:`, error),
						);
				}
			}

			if (i + batchSize < historyEntries.length) await delay(1000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			allErrors.push(`Batch revert error: ${message}`);
			totalFailed += batch.length;
		}
	}

	return {
		successful: totalSuccessful,
		failed: totalFailed,
		errors: allErrors,
		revertedVariants,
	};
}

type GraphQLResponse<TData> = { data?: TData; errors?: unknown };

export async function processOmniaFeedWithBulkOperations(
	adminClient: ShopifyAdminClient,
	omniaProducts: OmniaFeedRow[],
	validationConfig?: PricingValidationConfig,
	shop?: string,
	historyKV?: KVNamespace,
	triggeredBy: "manual" | "cron" = "manual",
	// Optional: when provided, limit the number of valid matches processed (applied post-match)
	testLimit?: number,
): Promise<{
	successful: number;
	failed: number;
	errors: string[];
	totalMatches: number;
	validMatches: number;
	invalidMatches: number;
	priceIncreases: number;
	priceDecreases: number;
	priceUnchanged: number;
	sourceTotal: number;
	updatedSamples: ProductUpdateSample[];
	invalidSamples: ValidationError[];
	runId: string;
}> {
	// Use same bulk operations pattern as Experience Center
	const bulkQuery = `
{
  products(first: 250) {
    edges {
      node {
        id
        title
        handle
        featuredImage {
          url
          altText
        }
        variants(first: 250) {
          edges {
            node {
              id
              barcode
              price
              compareAtPrice
              sku
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
}`;

	// Preflight: ensure no running QUERY bulk op blocks us
	try {
		const preflight = (await adminClient.request(`
			query { currentBulkOperation(type: QUERY) { id status } }
		`)) as {
			data?: { currentBulkOperation?: { id?: string; status?: string } };
		};
		const current = preflight?.data?.currentBulkOperation;
		if (current?.status === "RUNNING" && current?.id) {
			// Cancel stale/previous query to avoid ID-less response
			await adminClient.request(`
				mutation { bulkOperationCancel(id: "${current.id}") { userErrors { field message } } }
			`);
		}
	} catch (_e) {
		// Non-fatal; proceed
	}

	// Create bulk operation (same pattern as EC)
	const createBulkOperationMutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
        ${bulkQuery}
        """
      ) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }
  `;

	const createResult = (await adminClient.request(
		createBulkOperationMutation,
	)) as GraphQLResponse<{
		bulkOperationRunQuery?: {
			bulkOperation?: { id?: string };
			userErrors?: Array<{ field?: string; message?: string }>;
		};
	}>;

	const userErrors = createResult.data?.bulkOperationRunQuery?.userErrors ?? [];
	if (userErrors.length > 0) {
		throw new Error(
			`Bulk operation creation failed: ${JSON.stringify(userErrors)}`,
		);
	}

	const bulkOperationId =
		createResult.data?.bulkOperationRunQuery?.bulkOperation?.id;
	if (!bulkOperationId) {
		console.error("❌ No bulk operation ID. Raw result:", createResult);
		throw new Error("No bulk operation ID returned");
	}

	// Poll for completion (same pattern as EC)
	const maxWaitTime = 10 * 60 * 1000;
	const pollInterval = 5000;
	const start = Date.now();
	let status = "CREATED";
	let downloadUrl: string | null = null;

	while (
		status !== "COMPLETED" &&
		status !== "FAILED" &&
		status !== "CANCELED"
	) {
		if (Date.now() - start > maxWaitTime)
			throw new Error("Bulk operation timeout - exceeded 10 minutes");
		await delay(pollInterval);

		const statusQuery = `
      query { node(id: "${bulkOperationId}") { ... on BulkOperation { id status errorCode objectCount fileSize url partialDataUrl } } }
    `;
		const statusResult = (await adminClient.request(
			statusQuery,
		)) as GraphQLResponse<{
			node?: { status?: string; errorCode?: string; url?: string };
		}>;

		const node = statusResult.data?.node;
		if (!node) throw new Error("Could not retrieve bulk operation status");

		if (typeof node.status === "string") {
			status = node.status;
		}
		if (typeof node.url === "string") {
			downloadUrl = node.url;
		}
		if (status === "FAILED")
			throw new Error(`Bulk operation failed: ${node.errorCode || "Unknown"}`);
		if (status === "CANCELED") throw new Error("Bulk operation was canceled");
	}

	if (!downloadUrl)
		throw new Error("No download URL available for completed bulk operation");

	// Parse JSONL data (same pattern as EC)
	const downloadResponse = await fetch(downloadUrl);
	if (!downloadResponse.ok)
		throw new Error(
			`Failed to download bulk operation data: ${downloadResponse.status} ${downloadResponse.statusText}`,
		);

	const jsonlData: string = await downloadResponse.text();
	const lines = jsonlData.trim().split("\n");

	const products = new Map<
		string,
		{
			id: string;
			title?: string;
			handle?: string;
			featuredImageUrl?: string;
			variants: Array<{
				id: string;
				barcode: string | null;
				price: string;
				compareAtPrice: string | null;
				sku?: string;
				imageUrl?: string;
			}>;
		}
	>();

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const obj = JSON.parse(line);
			if (obj.id?.includes("/Product/")) {
				products.set(obj.id, {
					id: obj.id,
					title: obj.title || undefined,
					handle: obj.handle || undefined,
					featuredImageUrl: obj.featuredImage?.url || undefined,
					variants: [],
				});
			} else if (obj.id?.includes("/ProductVariant/") && obj.__parentId) {
				const product = products.get(obj.__parentId);
				if (product) {
					product.variants.push({
						id: obj.id,
						barcode: obj.barcode || null,
						price: obj.price || "0",
						compareAtPrice: obj.compareAtPrice || null,
						sku: obj.sku || undefined,
						imageUrl: obj.image?.url || undefined,
					});
				}
			}
		} catch {}
	}

	// High-level summary only
	console.log(`📦 Parsed ${products.size} products from bulk operation`);

	// Match products by EAN
	const eanMap = new Map<string, OmniaFeedRow>();
	omniaProducts.forEach((product) => {
		eanMap.set(product.ean, product);
	});

	const matches: ProductPriceMatch[] = [];
	let totalMatches = 0;

	for (const [, product] of products) {
		for (const variant of product.variants) {
			if (variant.barcode && eanMap.has(variant.barcode)) {
				const omniaProduct = eanMap.get(variant.barcode)!;
				const currentPrice = parseFloat(variant.price);
				const currentCompareAtPrice = variant.compareAtPrice
					? parseFloat(variant.compareAtPrice)
					: null;
				// Map Omnia fields to Shopify: price = PriceAdvice, compareAtPrice = RecommendedSellingPrice
				const newPrice = omniaProduct.priceAdvice;
				const newCompareAtPrice = omniaProduct.recommendedSellingPrice;
				const priceChange = newPrice - currentPrice;

				matches.push({
					productId: product.id,
					variantId: variant.id,
					ean: variant.barcode,
					currentPrice,
					currentCompareAtPrice,
					newPrice,
					newCompareAtPrice,
					discountPercentage: omniaProduct.discountPercentage,
					priceChange,
				});
				totalMatches++;
			}
		}
	}

	console.log(`🎯 Found ${totalMatches} product matches from ${omniaProducts.length} Omnia feed items`);

	// Validate matches
	const config = validationConfig || {
		maxDiscountPercentage: 90,
		enforceBasePriceMatch: true,
		basePriceTolerance: 5,
		minPriceThreshold: 0.01,
		maxPriceThreshold: 10000,
	};

	// Filter out no-op updates before validation (Shopify often returns no changes)
	const filtered = matches.filter((m) => {
		const pOld = +m.currentPrice.toFixed(2);
		const pNew = +m.newPrice.toFixed(2);
		const capOld =
			m.currentCompareAtPrice != null
				? +m.currentCompareAtPrice.toFixed(2)
				: null;
		const capNewValid =
			m.newCompareAtPrice > m.newPrice ? +m.newCompareAtPrice.toFixed(2) : null;
		return pOld !== pNew || capOld !== capNewValid;
	});

	const validationResult = validatePriceMatches(filtered, config);
	let validMatches = validationResult.valid;

	console.log(`✅ Validation: ${validMatches.length} valid, ${validationResult.invalid.length} invalid from ${totalMatches} total matches`);

	if (typeof testLimit === "number" && testLimit > 0) {
		const limited = validMatches.slice(0, testLimit);
		console.log("🧪 Post-match test limit", {
			taking: limited.length,
			of: validMatches.length,
		});
		validMatches = limited;
	}

	if (validMatches.length === 0) {
		console.log("ℹ️ No valid matches - skipping price updates");
	}

	// Generate a unique runId for this pricing sync
	const runId = `omnia-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	const timestamp = new Date().toISOString();

	// Update prices in larger batches for better performance
	const batchSize = 100;
	let totalSuccessful = 0;
	let totalFailed = 0;
	let priceIncreases = 0;
	let priceDecreases = 0;
	let priceUnchanged = 0;
	const allErrors: string[] = [];

	const updatedSamples: ProductUpdateSample[] = [];

	for (let i = 0; i < validMatches.length; i += batchSize) {
		const batch = validMatches.slice(i, i + batchSize);
		try {
			const result = await updateProductPricesBulk(adminClient, batch);
			totalSuccessful += result.successful;
			totalFailed += result.failed;
			allErrors.push(...result.errors);

			// Count price changes
			for (const match of batch) {
				if (match.priceChange > 0.01) priceIncreases++;
				else if (match.priceChange < -0.01) priceDecreases++;
				else priceUnchanged++;
			}

			// Collect ALL successful samples (no cap) and persist to history
			for (const variantId of result.successfulVariantIds) {
				const matched = batch.find((m) => m.variantId === variantId);
				if (matched) {
					// Find the product to get title, handle, and images
					const product = Array.from(products.values()).find(
						(p) => p.id === matched.productId,
					);
					const variant = product?.variants.find(
						(v) => v.id === matched.variantId,
					);

					const updateSample = {
						productId: matched.productId,
						variantId: matched.variantId,
						ean: matched.ean,
						oldPrice: matched.currentPrice,
						oldCompareAtPrice: matched.currentCompareAtPrice,
						newPrice: matched.newPrice,
						newCompareAtPrice: matched.newCompareAtPrice,
						priceChange: matched.priceChange,
						productTitle: product?.title,
						productHandle: product?.handle,
						productFeaturedImageUrl: product?.featuredImageUrl,
						variantSku: variant?.sku,
						variantImageUrl: variant?.imageUrl,
					};
					updatedSamples.push(updateSample);

					// Persist to history KV if available
					if (historyKV && shop) {
						const historyKey = `omnia:update:${shop}:${matched.variantId}:${timestamp}`;
						const historyEntry = {
							...updateSample,
							timestamp,
							runId,
							triggeredBy,
							shop,
						};

						// Fire and forget - don't block on KV writes
						historyKV
							.put(historyKey, JSON.stringify(historyEntry))
							.catch((error) =>
								console.warn(`Failed to persist history entry: ${error}`),
							);
					}
				}
			}

			// Reduced delay for better performance
			if (i + batchSize < validMatches.length) await delay(200);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("❌ Batch update failed", { message, variantCount: batch.length });
			allErrors.push(
				`Batch error: ${message}; ${batch.length} variants failed`,
			);
			totalFailed += batch.length;
		}
	}

	// High-level summary instead of per-product details
	console.log(`🎉 Bulk update complete: ${totalSuccessful} successful, ${totalFailed} failed from ${validMatches.length} valid matches`);

	return {
		successful: totalSuccessful,
		failed: totalFailed,
		errors: allErrors.slice(0, 50),
		totalMatches,
		validMatches: validMatches.length,
		invalidMatches: validationResult.invalid.length,
		priceIncreases,
		priceDecreases,
		priceUnchanged,
		sourceTotal: omniaProducts.length,
		updatedSamples,
		invalidSamples: validationResult.invalid.slice(0, 50),
		runId,
	};
}

function validatePriceMatches(
	matches: ProductPriceMatch[],
	config: PricingValidationConfig,
): { valid: ProductPriceMatch[]; invalid: ValidationError[] } {
	const valid: ProductPriceMatch[] = [];
	const invalid: ValidationError[] = [];

	for (const match of matches) {
		const errors = validateSinglePriceMatch(match, config);
		if (errors.length === 0) {
			valid.push(match);
		} else {
			invalid.push(...errors);
		}
	}

	return { valid, invalid };
}

function validateSinglePriceMatch(
	match: ProductPriceMatch,
	config: PricingValidationConfig,
): ValidationError[] {
	const errors: ValidationError[] = [];

	// Rule 1: Discount limit check
	if (match.discountPercentage > config.maxDiscountPercentage) {
		errors.push({
			productId: match.productId,
			variantId: match.variantId,
			ean: match.ean,
			errorCode: "discount_too_large",
			errorMessage: `Discount ${match.discountPercentage.toFixed(1)}% exceeds maximum ${config.maxDiscountPercentage}%`,
			currentPrice: match.currentPrice,
			newPrice: match.newPrice,
			discountPercentage: match.discountPercentage,
		});
	}

	// Rule 2: Price threshold checks
	if (match.newPrice < config.minPriceThreshold) {
		errors.push({
			productId: match.productId,
			variantId: match.variantId,
			ean: match.ean,
			errorCode: "price_too_low",
			errorMessage: `New price €${match.newPrice} below minimum threshold €${config.minPriceThreshold}`,
			currentPrice: match.currentPrice,
			newPrice: match.newPrice,
			discountPercentage: match.discountPercentage,
		});
	}

	if (match.newPrice > config.maxPriceThreshold) {
		errors.push({
			productId: match.productId,
			variantId: match.variantId,
			ean: match.ean,
			errorCode: "price_too_high",
			errorMessage: `New price €${match.newPrice} exceeds maximum threshold €${config.maxPriceThreshold}`,
			currentPrice: match.currentPrice,
			newPrice: match.newPrice,
			discountPercentage: match.discountPercentage,
		});
	}

	// Rule 3: Base price comparison check
	if (match.currentCompareAtPrice && config.enforceBasePriceMatch) {
		const priceDifference = Math.abs(
			match.currentCompareAtPrice - match.newCompareAtPrice,
		);
		const toleranceAmount =
			match.newCompareAtPrice * (config.basePriceTolerance / 100);

		if (priceDifference > toleranceAmount) {
			errors.push({
				productId: match.productId,
				variantId: match.variantId,
				ean: match.ean,
				errorCode: "base_price_differs",
				errorMessage: `Base price differs by €${priceDifference.toFixed(2)} (tolerance: €${toleranceAmount.toFixed(2)})`,
				currentPrice: match.currentPrice,
				newPrice: match.newPrice,
				discountPercentage: match.discountPercentage,
			});
		}
	}

	// Rule 4: Price validation (ensure compareAtPrice is greater than price if provided)
	if (match.newCompareAtPrice && match.newCompareAtPrice <= match.newPrice) {
		// We'll allow this through, because we will null-out compareAtPrice at write time
		// and only block truly invalid thresholds elsewhere.
	}

	return errors;
}

async function updateProductPricesBulk(
	adminClient: ShopifyAdminClient,
	matches: ProductPriceMatch[],
): Promise<{
	successful: number;
	failed: number;
	errors: string[];
	successfulVariantIds: string[];
}> {
	// Group by productId; productVariantsBulkUpdate requires productId + variants of that product
	const productIdToVariants = new Map<
		string,
		Array<{ id: string; price: string; compareAtPrice: string | null }>
	>();

	for (const match of matches) {
		const compareAtValid = match.newCompareAtPrice > match.newPrice;
		const input = {
			id: match.variantId,
			price: match.newPrice.toFixed(2),
			compareAtPrice: compareAtValid
				? match.newCompareAtPrice.toFixed(2)
				: null,
		};
		const arr = productIdToVariants.get(match.productId) ?? [];
		arr.push(input);
		productIdToVariants.set(match.productId, arr);
	}

	// Mutation per product
	const mutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartial: Boolean) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: $allowPartial) {
        product { id }
        productVariants { id }
        userErrors { field message }
      }
    }
  `;

	let totalSuccessful = 0;
	let totalFailed = 0;
	const errors: string[] = [];
	const successfulVariantIds: string[] = [];

	for (const [productId, variants] of productIdToVariants) {
		// Shopify limit: up to 250 variants per call
		for (let i = 0; i < variants.length; i += 250) {
			const slice = variants.slice(i, i + 250);

			// Reduced logging - only log every 10th batch to prevent log bloat
			if (i === 0) {
				console.log(`💰 Updating ${slice.length} variants for product batch (${productId.split('/').pop()})`);
			}

			const result = (await adminClient.request(mutation, {
				productId,
				variants: slice,
				allowPartial: true,
			})) as {
				data?: {
					productVariantsBulkUpdate?: {
						userErrors?: Array<{ field?: string; message?: string }>;
						productVariants?: Array<{ id: string }>;
					};
				};
				errors?: unknown[];
			};

			if (Array.isArray(result?.errors) && result.errors.length > 0) {
				console.error("❌ GraphQL top-level errors:", result.errors);
			}

			const userErrors = (result.data?.productVariantsBulkUpdate?.userErrors ??
				[]) as Array<{
				field?: string;
				message?: string;
			}>;
			const updated = (result.data?.productVariantsBulkUpdate
				?.productVariants ?? []) as Array<{
				id: string;
			}>;

			totalSuccessful += updated.length;
			totalFailed += slice.length - updated.length;
			successfulVariantIds.push(...updated.map((u) => u.id));
			if (userErrors.length > 0 && errors.length < 100) {
				// Cap errors to prevent log bloat
				const remainingCapacity = 100 - errors.length;
				const errorsToAdd = userErrors.slice(0, remainingCapacity);
				errors.push(...errorsToAdd.map((e) => `${e.field}: ${e.message}`));
			}

			// Only log errors or significant issues, not every successful update
			if (userErrors.length > 0) {
				console.log(`⚠️ Product ${productId.split('/').pop()}: ${updated.length} successful, ${slice.length - updated.length} failed, ${userErrors.length} errors`);
			}
		}
	}

	return {
		successful: totalSuccessful,
		failed: totalFailed,
		errors,
		successfulVariantIds,
	};
}
