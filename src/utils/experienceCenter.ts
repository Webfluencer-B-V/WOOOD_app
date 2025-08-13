export interface ExperienceCenterApiConfig {
	baseUrl: string;
	apiKey: string;
}

export interface ExperienceCenterRecord {
	ean?: string;
	channel?: string;
	itemcode?: string;
	[key: string]: unknown;
}

export async function fetchExperienceCenterData(
	config: ExperienceCenterApiConfig,
): Promise<{ data: ExperienceCenterRecord[]; total: number }> {
	const { baseUrl, apiKey } = config;
	if (!baseUrl || !apiKey) {
		throw new Error("Missing baseUrl or apiKey for Experience Center API");
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
		Authorization: `Bearer ${apiKey}`,
	};

	// Normalize base URL: strip trailing slashes and any trailing /api
	const trimmed = baseUrl.replace(/\/+$/, "");
	const baseWithoutApi = trimmed.endsWith("/api")
		? trimmed.slice(0, -4)
		: trimmed;
	const experienceCenterUrl = `${baseWithoutApi}/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`;
	const response = await fetch(experienceCenterUrl, { headers });
	if (!response.ok) {
		let extra = "";
		try {
			const text = await response.text();
			extra = `; body: ${text.slice(0, 256)}`;
		} catch {}
		throw new Error(
			`Failed to fetch experience center data: ${response.status} ${response.statusText}${extra}`,
		);
	}
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		const textSample = (await response.text()).slice(0, 256);
		throw new Error(
			`Experience Center returned non-JSON (content-type=${contentType}). Sample: ${textSample}`,
		);
	}
	const rawData: unknown = await response.json();
	const allData: unknown[] = Array.isArray(rawData)
		? rawData
		: typeof rawData === "object" &&
				rawData !== null &&
				Array.isArray((rawData as { data?: unknown[] }).data)
			? (rawData as { data: unknown[] }).data
			: [];

	const experienceCenterData = allData
		.filter(
			(item): item is ExperienceCenterRecord =>
				typeof item === "object" && item !== null,
		)
		.filter((item) => item.channel === "EC" && !!item.ean);

	return {
		data: experienceCenterData,
		total: experienceCenterData.length,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ShopifyAdminClient {
	request: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
}

type GraphQLResponse<TData> = { data?: TData; errors?: unknown };

export async function processExperienceCenterWithBulkOperations(
	adminClient: ShopifyAdminClient,
	availableEans: Set<string>,
): Promise<{
	successful: number;
	failed: number;
	errors: string[];
	eanMatches: number;
	totalProducts: number;
}> {
	const bulkQuery = `
{
  products(first: 250) {
    edges {
      node {
        id
        variants(first: 250) {
          edges {
            node {
              id
              barcode
            }
          }
        }
      }
    }
  }
}`;

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
	if (!bulkOperationId) throw new Error("No bulk operation ID returned");

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

	const downloadResponse = await fetch(downloadUrl);
	if (!downloadResponse.ok)
		throw new Error(
			`Failed to download bulk operation data: ${downloadResponse.status} ${downloadResponse.statusText}`,
		);
	const jsonlData: string = await downloadResponse.text();
	const lines = jsonlData.trim().split("\n");

	const products = new Map<
		string,
		{ id: string; variants: Array<{ id: string; barcode: string | null }> }
	>();
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const obj = JSON.parse(line);
			if (obj.id?.includes("/Product/")) {
				products.set(obj.id, { id: obj.id, variants: [] });
			} else if (obj.id?.includes("/ProductVariant/") && obj.__parentId) {
				const product = products.get(obj.__parentId);
				if (product) {
					product.variants.push({ id: obj.id, barcode: obj.barcode || null });
				}
			}
		} catch {}
	}

	const metafieldsToUpdate: Array<{
		productId: string;
		experienceCenter: boolean;
	}> = [];
	let processedProducts = 0;
	let eanMatches = 0;
	for (const [, product] of products) {
		let barcode: string | null = null;
		for (const variant of product.variants) {
			if (variant.barcode) {
				barcode = variant.barcode;
				break;
			}
		}
		if (!barcode) continue;
		const experienceCenter = availableEans.has(barcode);
		if (experienceCenter) eanMatches++;
		metafieldsToUpdate.push({ productId: product.id, experienceCenter });
		processedProducts++;
	}

	const batchSize = 25;
	let totalSuccessful = 0;
	let totalFailed = 0;
	const allErrors: string[] = [];
	for (let i = 0; i < metafieldsToUpdate.length; i += batchSize) {
		const batch = metafieldsToUpdate.slice(i, i + batchSize);
		try {
			const result = await setProductExperienceCenterMetafieldsBulk(
				adminClient,
				batch,
			);
			totalSuccessful += result.successful;
			totalFailed += result.failed;
			allErrors.push(...result.errors);
			if (i + batchSize < metafieldsToUpdate.length) await delay(1000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			allErrors.push(`Batch error: ${message}`);
			totalFailed += batch.length;
		}
	}

	return {
		successful: totalSuccessful,
		failed: totalFailed,
		errors: allErrors.slice(0, 20),
		eanMatches,
		totalProducts: processedProducts,
	};
}

export async function setProductExperienceCenterMetafieldsBulk(
	adminClient: ShopifyAdminClient,
	metafields: Array<{ productId: string; experienceCenter: boolean }>,
): Promise<{ successful: number; failed: number; errors: string[] }> {
	if (metafields.length > 25) {
		throw new Error(
			`Batch size too large: ${metafields.length}. Maximum allowed: 25 for Shopify metafields API`,
		);
	}

	const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value type ownerType }
        userErrors { field message }
      }
    }
  `;
	const metafieldsInput = metafields.map(({ productId, experienceCenter }) => ({
		key: "experiencecenter",
		namespace: "woood",
		value: experienceCenter.toString(),
		type: "boolean",
		ownerId: productId,
	}));

	const result = (await adminClient.request(mutation, {
		metafields: metafieldsInput,
	})) as {
		data?: {
			metafieldsSet?: {
				userErrors?: Array<{ field?: string; message?: string }>;
				metafields?: unknown[];
			};
		};
	};
	const userErrors = (result.data?.metafieldsSet?.userErrors ?? []) as Array<{
		field?: string;
		message?: string;
	}>;
	const successfulMetafields = result.data?.metafieldsSet?.metafields ?? [];
	return {
		successful: successfulMetafields.length,
		failed: metafields.length - successfulMetafields.length,
		errors: userErrors.map((e) => `${e.field}: ${e.message}`),
	};
}

export interface TokenStorage {
	getShopTokens: () => Promise<string[]>;
}

export async function getInstalledShops(
	storage: TokenStorage,
): Promise<string[]> {
	return await storage.getShopTokens();
}

export interface ShopifyAdminClientFactory {
	createClient: (shop: string) => Promise<ShopifyAdminClient>;
}

export async function processExperienceCenterUpdateAllShops(
	config: ExperienceCenterApiConfig,
	storage: TokenStorage,
	clientFactory: ShopifyAdminClientFactory,
): Promise<{
	success: boolean;
	timestamp: string;
	results: Array<{
		shop: string;
		success: boolean;
		summary?: unknown;
		error?: string;
	}>;
	summary: {
		totalShops: number;
		successfulShops: number;
		failedShops: number;
		totalProducts: number;
		successfulProducts: number;
		failedProducts: number;
	};
}> {
	const experienceCenterData = await fetchExperienceCenterData(config);
	const availableEans = new Set(
		experienceCenterData.data
			.map((item) => item.ean as string | undefined)
			.filter((e): e is string => typeof e === "string" && e.length > 0),
	);
	const installedShops = await getInstalledShops(storage);
	const results: Array<{
		shop: string;
		success: boolean;
		summary?: unknown;
		error?: string;
	}> = [];
	let totalSuccessful = 0;
	let totalFailed = 0;
	for (const shop of installedShops) {
		try {
			const adminClient = await clientFactory.createClient(shop);
			const result = await processExperienceCenterWithBulkOperations(
				adminClient,
				availableEans,
			);
			results.push({ shop, success: true, summary: result });
			totalSuccessful += result.successful;
			totalFailed += result.failed;
			await delay(2000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results.push({ shop, success: false, error: message });
		}
	}
	return {
		success: results.filter((r) => r.success).length > 0,
		timestamp: new Date().toISOString(),
		results,
		summary: {
			totalShops: installedShops.length,
			successfulShops: results.filter((r) => r.success).length,
			failedShops: results.filter((r) => !r.success).length,
			totalProducts: totalSuccessful + totalFailed,
			successfulProducts: totalSuccessful,
			failedProducts: totalFailed,
		},
	};
}
