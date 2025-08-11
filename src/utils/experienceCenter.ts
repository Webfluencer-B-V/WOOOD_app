import type { Env } from "./consolidation";

export async function fetchExperienceCenterData(
	env: Env,
): Promise<{ data: any[]; total: number }> {
	const { DUTCH_FURNITURE_BASE_URL, DUTCH_FURNITURE_API_KEY } = env;
	if (!DUTCH_FURNITURE_BASE_URL || !DUTCH_FURNITURE_API_KEY) {
		throw new Error(
			"Missing DUTCH_FURNITURE_BASE_URL or DUTCH_FURNITURE_API_KEY",
		);
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${DUTCH_FURNITURE_API_KEY}`,
	};

	const experienceCenterUrl = `${DUTCH_FURNITURE_BASE_URL}/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`;
	const response = await fetch(experienceCenterUrl, { headers });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch experience center data: ${response.status} ${response.statusText}`,
		);
	}

	const rawData = (await response.json()) as any;
	const allData = Array.isArray(rawData) ? rawData : rawData.data || [];

	const experienceCenterData = allData.filter(
		(item: any) => item.channel === "EC" && item.ean,
	);

	return {
		data: experienceCenterData,
		total: experienceCenterData.length,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getShopAccessToken(
	env: Env,
	shop: string,
): Promise<string | null> {
	if (!env.WOOOD_KV) return null;
	const tokenRecord = (await env.WOOOD_KV.get(
		`shop_token:${shop}`,
		"json",
	)) as any;
	return tokenRecord?.accessToken || null;
}

export async function processExperienceCenterWithBulkOperations(
	env: Env,
	shop: string,
	availableEans: Set<string>,
): Promise<{
	successful: number;
	failed: number;
	errors: string[];
	eanMatches: number;
	totalProducts: number;
}> {
	const accessToken = await getShopAccessToken(env, shop);
	if (!accessToken) {
		throw new Error(`No access token found for shop: ${shop}`);
	}

	const bulkQuery = `
    {
      products {
          edges {
            node {
              id
            variants {
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

	const createResponse = await fetch(
		`https://${shop}/admin/api/2023-10/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": accessToken,
			},
			body: JSON.stringify({ query: createBulkOperationMutation }),
		},
	);
	if (!createResponse.ok) {
		throw new Error(
			`Failed to create bulk operation: ${createResponse.status} ${createResponse.statusText}`,
		);
	}
	const createResult = (await createResponse.json()) as any;
	const userErrors = createResult.data?.bulkOperationRunQuery?.userErrors || [];
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
		const statusResponse = await fetch(
			`https://${shop}/admin/api/2023-10/graphql.json`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Shopify-Access-Token": accessToken,
				},
				body: JSON.stringify({ query: statusQuery }),
			},
		);
		if (!statusResponse.ok)
			throw new Error(
				`Failed to check bulk operation status: ${statusResponse.status} ${statusResponse.statusText}`,
			);
		const statusResult = (await statusResponse.json()) as any;
		const node = statusResult.data?.node;
		if (!node) throw new Error("Could not retrieve bulk operation status");
		status = node.status;
		downloadUrl = node.url;
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
	const jsonlData = await downloadResponse.text();
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
				env,
				shop,
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
	env: Env,
	shop: string,
	metafields: Array<{ productId: string; experienceCenter: boolean }>,
): Promise<{ successful: number; failed: number; errors: string[] }> {
	if (metafields.length > 25) {
		throw new Error(
			`Batch size too large: ${metafields.length}. Maximum allowed: 25 for Shopify metafields API`,
		);
	}
	const accessToken = await getShopAccessToken(env, shop);
	if (!accessToken) throw new Error(`No access token found for shop: ${shop}`);

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
	const response = await fetch(
		`https://${shop}/admin/api/2023-10/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": accessToken,
			},
			body: JSON.stringify({
				query: mutation,
				variables: { metafields: metafieldsInput },
			}),
		},
	);
	if (!response.ok)
		throw new Error(
			`Failed to set experience center metafields: ${response.status} ${response.statusText}`,
		);
	const result = (await response.json()) as any;
	const userErrors = result.data?.metafieldsSet?.userErrors || [];
	const successfulMetafields = result.data?.metafieldsSet?.metafields || [];
	return {
		successful: successfulMetafields.length,
		failed: metafields.length - successfulMetafields.length,
		errors: userErrors.map((e: any) => `${e.field}: ${e.message}`),
	};
}

export async function getInstalledShops(env: Env): Promise<string[]> {
	if (!env.WOOOD_KV) return [];
	const keys = await env.WOOOD_KV.list({ prefix: "shop_token:" });
	return keys.keys.map((key: any) => key.name.replace("shop_token:", ""));
}

export async function processExperienceCenterUpdateAllShops(
	env: Env,
): Promise<any> {
	const experienceCenterData = await fetchExperienceCenterData(env);
	const availableEans = new Set(
		experienceCenterData.data.map((item: any) => item.ean),
	);
	const installedShops = await getInstalledShops(env);
	const results: any[] = [];
	let totalSuccessful = 0;
	let totalFailed = 0;
	for (const shop of installedShops) {
		try {
			const result = await processExperienceCenterWithBulkOperations(
				env,
				shop,
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
