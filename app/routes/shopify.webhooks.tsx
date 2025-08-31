import { cleanupWebhooks } from "../../src/utils/webhooks";
import { createShopify, createShopifyClient } from "../shopify.server";
import {
	isAppScopesUpdatePayload,
	isBaseWebhookPayload,
	isOrderWebhookPayload,
	type WebhookPayload,
} from "../types/webhooks";
import type { Route } from "./+types/shopify.webhooks";

export async function action({ context, request }: Route.ActionArgs) {
	try {
		const shopify = createShopify(context);

		const webhook = await shopify.webhook(request);
		const topic = (webhook.topic || "").toString().toLowerCase();

		const session = await shopify.session.get(webhook.domain);
		const rawPayload = await request.json();

		// Type-safe payload handling
		if (!isBaseWebhookPayload(rawPayload)) {
			throw new Error("Invalid webhook payload format");
		}
		const payload = rawPayload as WebhookPayload;

		switch (topic) {
			case "app/uninstalled":
				{
					// Cleanup legacy webhook endpoints on uninstall
					const cfUrl = (context.cloudflare.env as { CLOUDFLARE_URL?: string })
						.CLOUDFLARE_URL;
					const webhookEndpoint = `${cfUrl || shopify.config.appUrl}/shopify/webhooks`;
					const shopDomain = webhook.domain || undefined;
					try {
						if (shopDomain) {
							const record = (await context.cloudflare.env.WOOOD_KV?.get(
								`shop_token:${shopDomain}`,
								"json",
							)) as { accessToken?: string } | null;
							const accessToken = record?.accessToken || null;
							if (accessToken) {
								const adminClient = createShopifyClient({
									headers: { "X-Shopify-Access-Token": accessToken },
									shop: shopDomain,
								});
								await cleanupWebhooks(adminClient, webhookEndpoint);
							}
						}
					} catch {}
					if (session) {
						await shopify.session.delete(session.id);
					}
				}
				break;

			case "app/scopes_update":
				if (session && isAppScopesUpdatePayload(payload)) {
					await shopify.session.set({
						...session,
						scope: payload.current.toString(),
					});
				}
				break;

			case "orders/paid":
			case "orders/create":
			case "orders/updated":
			case "orders/cancelled": {
				// Process order attributes into order metafields for create/paid
				const orderId = isOrderWebhookPayload(payload)
					? payload.id
					: isBaseWebhookPayload(payload)
						? payload.id
						: undefined;
				// Minimal log; detailed results are logged after mutation

				try {
					if (
						(topic === "orders/create" || topic === "orders/paid") &&
						orderId !== undefined
					) {
						// Always-on backend: prefer online session, fallback to offline token in KV
						let accessToken: string | null = session?.accessToken || null;
						const shopDomain = session?.shop || webhook.domain || undefined;
						if (!accessToken && shopDomain) {
							try {
								const record = (await context.cloudflare.env.WOOOD_KV?.get(
									`shop_token:${shopDomain}`,
									"json",
								)) as { accessToken?: string } | null;
								accessToken = record?.accessToken || null;
							} catch {}
						}
						if (!accessToken || !shopDomain) {
							shopify.utils.log.info("orderMetafieldsReport", {
								orderId,
								shop: shopDomain || webhook.domain,
								values: null,
								result: {
									status: "skipped",
									reason: !shopDomain ? "missing_shop" : "missing_access_token",
								},
							});
							break;
						}

						const adminClient = createShopifyClient({
							headers: { "X-Shopify-Access-Token": accessToken },
							shop: shopDomain,
						});

						// Extract checkout note attributes
						const raw: unknown = rawPayload;
						const noteAttributes = Array.isArray(
							(
								raw as {
									note_attributes?: Array<{ name?: unknown; value?: unknown }>;
								}
							).note_attributes,
						)
							? ((
									raw as {
										note_attributes: Array<{ name?: unknown; value?: unknown }>;
									}
								).note_attributes as Array<{ name?: unknown; value?: unknown }>)
							: [];

						const findAttr = (key: string): string | null => {
							for (const item of noteAttributes) {
								const name = typeof item.name === "string" ? item.name : "";
								if (name === key) {
									const val = item.value;
									return typeof val === "string"
										? val
										: val != null
											? String(val)
											: null;
								}
							}
							return null;
						};

						const deliveryDate = findAttr("delivery_date");
						const shippingMethod = findAttr("shipping_method");

						const metafields: Array<{
							ownerId: string;
							namespace: string;
							key: string;
							value: string;
							type: string;
						}> = [];

						const orderGid = `gid://shopify/Order/${orderId}`;
						if (deliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
							metafields.push({
								ownerId: orderGid,
								namespace: "custom",
								key: "dutchned_delivery_date",
								value: deliveryDate,
								type: "date",
							});
						}
						if (shippingMethod) {
							metafields.push({
								ownerId: orderGid,
								namespace: "custom",
								key: "ShippingMethod2",
								value: shippingMethod,
								type: "single_line_text_field",
							});
						}

						if (metafields.length > 0) {
							// Consolidated pre-report
							shopify.utils.log.info("orderMetafieldsReport", {
								orderId,
								shop: shopDomain,
								values: { deliveryDate, shippingMethod },
								result: { status: "attempt" },
							});
							const mutation = `
								mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
									metafieldsSet(metafields: $metafields) {
										metafields { key namespace value type ownerType }
										userErrors { field message }
									}
								}
							`;
							const result = (await adminClient.request(mutation, {
								variables: { metafields },
							})) as {
								data?: {
									metafieldsSet?: {
										metafields?: Array<{
											key?: string;
											namespace?: string;
											value?: string;
											type?: string;
											ownerType?: string;
										}>;
										userErrors?: Array<{ field?: string; message?: string }>;
									};
								};
							};
							const errors = result.data?.metafieldsSet?.userErrors || [];
							const saved = result.data?.metafieldsSet?.metafields || [];
							if (errors.length > 0) {
								shopify.utils.log.info("orderMetafieldsReport", {
									orderId,
									shop: shopDomain,
									values: { deliveryDate, shippingMethod },
									result: { status: "error", errors },
								});
							} else {
								shopify.utils.log.info("orderMetafieldsReport", {
									orderId,
									shop: shopDomain,
									values: { deliveryDate, shippingMethod },
									result: { status: "saved", metafields: saved },
								});
							}
						} else {
							shopify.utils.log.info("orderMetafieldsReport", {
								orderId,
								shop: shopDomain,
								values: { deliveryDate, shippingMethod },
								result: { status: "skipped", reason: "no_values" },
							});
						}
					}
				} catch (err) {
					shopify.utils.log.error("metafieldsSet exception", {
						error: err instanceof Error ? err.message : String(err),
						orderId,
					});
				}
				break;
			}
		}

		// Send to webhook queue if available
		if (context.cloudflare.env.SCHEDULED_QUEUE) {
			await context.cloudflare.env.SCHEDULED_QUEUE.send(
				{
					payload,
					webhook,
				},
				{ contentType: "json" },
			);
		}

		return new Response(null, { status: 204 });
		// biome-ignore lint/suspicious/noExplicitAny: catch(err)
	} catch (error: any) {
		return new Response(error.message, {
			status: error.status || 500,
			statusText: "Unauthorized",
		});
	}
}
