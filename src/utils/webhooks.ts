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
			// First, try to find existing webhook for this topic
			const existingQuery = `
				query webhookSubscriptions($first: Int!, $topics: [WebhookSubscriptionTopic!]) {
					webhookSubscriptions(first: $first, topics: $topics) {
						edges {
							node {
								id
								callbackUrl
								topic
							}
						}
					}
				}
			`;

			const topicEnum = webhook.topic.toUpperCase().replace("/", "_");
			const existingResult = (await adminClient.request(existingQuery, {
				first: 10,
				topics: [topicEnum],
			})) as {
				data?: {
					webhookSubscriptions?: {
						edges?: Array<{
							node?: { id?: string; callbackUrl?: string; topic?: string };
						}>;
					};
				};
			};

			// Check if webhook already exists with correct URL
			const existing = existingResult.data?.webhookSubscriptions?.edges?.find(
				(edge) => edge.node?.callbackUrl === webhook.address,
			);

			if (existing) {
				console.log(`Webhook already exists for ${webhook.topic}`, {
					id: existing.node?.id,
					url: existing.node?.callbackUrl,
				});
				continue;
			}

			// Create new webhook subscription
			const mutation = `
				mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
					webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
						webhookSubscription { id callbackUrl topic }
						userErrors { field message }
					}
				}
			`;

			const variables = {
				topic: topicEnum,
				webhookSubscription: {
					callbackUrl: webhook.address,
					format: "JSON",
				},
			};

			const result = (await adminClient.request(mutation, variables)) as {
				data?: {
					webhookSubscriptionCreate?: {
						webhookSubscription?: {
							id?: string;
							callbackUrl?: string;
							topic?: string;
						};
						userErrors?: Array<{ field?: string; message?: string }>;
					};
				};
			};

			const errors = result.data?.webhookSubscriptionCreate?.userErrors;
			if (errors?.length) {
				// Skip "already taken" errors as they're expected when webhook exists
				const nonDuplicateErrors = errors.filter(
					(error) => !error.message?.includes("already been taken"),
				);
				if (nonDuplicateErrors.length > 0) {
					console.error("Webhook registration failed", {
						errors: nonDuplicateErrors,
						webhook,
					});
				} else {
					console.log(`Webhook for ${webhook.topic} already registered`);
				}
			} else if (result.data?.webhookSubscriptionCreate?.webhookSubscription) {
				console.log(`Successfully registered webhook for ${webhook.topic}`, {
					id: result.data.webhookSubscriptionCreate.webhookSubscription.id,
					url: result.data.webhookSubscriptionCreate.webhookSubscription
						.callbackUrl,
				});
			}
		} catch (error) {
			console.error("Exception registering webhook", { webhook, error });
		}
	}
}

export async function cleanupWebhooks(
	adminClient: ShopifyAdminClient,
	webhookEndpoint: string,
): Promise<void> {
	try {
		const listQuery = `
            query webhookSubscriptions($first: Int!) {
                webhookSubscriptions(first: $first) {
                    edges { node { id callbackUrl topic } }
                }
            }
        `;
		const listResult = (await adminClient.request(listQuery, {
			first: 100,
		})) as {
			data?: {
				webhookSubscriptions?: {
					edges?: Array<{
						node?: { id?: string; callbackUrl?: string; topic?: string };
					}>;
				};
			};
		};
		const edges = listResult.data?.webhookSubscriptions?.edges || [];
		const legacy = edges.filter(
			(e) =>
				typeof e?.node?.callbackUrl === "string" &&
				e!.node!.callbackUrl !== webhookEndpoint,
		);
		for (const edge of legacy) {
			const id = edge?.node?.id;
			if (!id) continue;
			const delMutation = `
                mutation webhookSubscriptionDelete($id: ID!) {
                    webhookSubscriptionDelete(id: $id) {
                        deletedWebhookSubscriptionId
                        userErrors { field message }
                    }
                }
            `;
			try {
				await adminClient.request(delMutation, { id });
				console.log("Deleted legacy webhook subscription", {
					id,
					topic: edge?.node?.topic,
				});
			} catch (error) {
				console.error("Failed deleting legacy webhook subscription", {
					id,
					error,
				});
			}
		}
	} catch (error) {
		console.error("Failed cleaning up webhooks", { error });
	}
}
