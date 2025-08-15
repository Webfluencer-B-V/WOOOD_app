function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

export async function validateWebhookSignature(
	body: string,
	signature: string,
	secret: string,
): Promise<boolean> {
	if (!secret) return false;
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
	return safeEqual(computed, signature);
}

export interface ShopifyAdminClient {
	request: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
}

export interface WebhookStorage {
	deleteShopToken: (shop: string) => Promise<void>;
}

export async function handleOrderWebhook(
	request: Request,
	secret: string,
): Promise<{ valid: boolean; shop: string; topic: string; payload: unknown }> {
	const signature = request.headers.get("X-Shopify-Hmac-Sha256") || "";
	const shop = (request.headers.get("X-Shopify-Shop-Domain") || "").trim();
	const topic = request.headers.get("X-Shopify-Topic") || "";
	const bodyText = await request.text();
	const valid = await validateWebhookSignature(bodyText, signature, secret);
	let payload: unknown = {};
	try {
		payload = JSON.parse(bodyText);
	} catch {}
	return { valid, shop, topic, payload };
}

export async function deleteShopInstallation(
	storage: WebhookStorage,
	shop: string,
): Promise<void> {
	try {
		await storage.deleteShopToken(shop);
		console.log(`🧹 Deleted shop token for ${shop}`);
	} catch (error) {
		console.error("Failed to delete shop token", { shop, error });
	}
}

export async function handleAppUninstalled(
	request: Request,
	secret: string,
	storage: WebhookStorage,
): Promise<{ success: boolean; shop: string }> {
	const { valid, shop, topic } = await handleOrderWebhook(request, secret);
	if (!valid) return { success: false, shop: "" };
	await deleteShopInstallation(storage, shop);
	console.log(`🚪 App uninstalled processed for ${shop}`, { topic });
	return { success: true, shop };
}

export async function registerWebhooks(
	adminClient: ShopifyAdminClient,
	webhookEndpoint: string,
): Promise<void> {
	const webhooks = [
		{ topic: "orders/paid", address: webhookEndpoint },
		{ topic: "orders/create", address: webhookEndpoint },
		{ topic: "app/uninstalled", address: webhookEndpoint },
	];
	for (const webhook of webhooks) {
		try {
			// Note: webhook registration via REST API needs to be handled differently
			// This would typically be done via GraphQL webhookSubscriptionCreate mutation
			const mutation = `
				mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
					webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
						webhookSubscription { id }
						userErrors { field message }
					}
				}
			`;
			const variables = {
				topic: webhook.topic.toUpperCase().replace("/", "_"),
				webhookSubscription: {
					callbackUrl: webhook.address,
					format: "JSON",
				},
			};
			const result = (await adminClient.request(mutation, variables)) as {
				data?: {
					webhookSubscriptionCreate?: {
						webhookSubscription?: { id?: string };
						userErrors?: Array<{ field?: string; message?: string }>;
					};
				};
			};
			if (result.data?.webhookSubscriptionCreate?.userErrors?.length) {
				console.error("Webhook registration failed", {
					errors: result.data.webhookSubscriptionCreate.userErrors,
					webhook,
				});
			}
		} catch (error) {
			console.error("Exception registering webhook", { webhook, error });
		}
	}
}
