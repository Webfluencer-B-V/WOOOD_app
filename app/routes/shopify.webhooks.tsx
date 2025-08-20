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
		shopify.utils.log.debug("shopify.webhooks");

		const webhook = await shopify.webhook(request);
		shopify.utils.log.debug("shopify.webhooks", { ...webhook });

		const session = await shopify.session.get(webhook.domain);
		const rawPayload = await request.json();

		// Type-safe payload handling
		if (!isBaseWebhookPayload(rawPayload)) {
			throw new Error("Invalid webhook payload format");
		}
		const payload = rawPayload as WebhookPayload;

		switch (webhook.topic) {
			case "APP_UNINSTALLED":
				if (session) {
					await shopify.session.delete(session.id);
				}
				break;

			case "APP_SCOPES_UPDATE":
				if (session && isAppScopesUpdatePayload(payload)) {
					await shopify.session.set({
						...session,
						scope: payload.current.toString(),
					});
				}
				break;

			case "ORDERS_PAID":
			case "ORDERS_CREATE":
			case "ORDERS_UPDATED":
			case "ORDERS_CANCELLED": {
				// Process order attributes into order metafields for create/paid
				const orderId = isOrderWebhookPayload(payload)
					? payload.id
					: isBaseWebhookPayload(payload)
						? payload.id
						: undefined;
				shopify.utils.log.debug(`Order webhook received: ${webhook.topic}`, {
					shop: webhook.domain,
					orderId,
				});

				try {
					if (
						(session && (webhook.topic === "ORDERS_CREATE" || webhook.topic === "ORDERS_PAID")) &&
						orderId !== undefined
					) {
						const adminClient = createShopifyClient({
							headers: { "X-Shopify-Access-Token": session.accessToken },
							shop: session.shop,
						});

						// Extract checkout note attributes
						const raw: unknown = rawPayload;
						const noteAttributes = Array.isArray((raw as { note_attributes?: Array<{ name?: unknown; value?: unknown }> }).note_attributes)
							? ((raw as { note_attributes: Array<{ name?: unknown; value?: unknown }> }).note_attributes as Array<{ name?: unknown; value?: unknown }>)
							: [];

						const findAttr = (key: string): string | null => {
							for (const item of noteAttributes) {
								const name = typeof item.name === "string" ? item.name : "";
								if (name === key) {
									const val = item.value;
									return typeof val === "string" ? val : val != null ? String(val) : null;
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
							const mutation = `
								mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
									metafieldsSet(metafields: $metafields) {
										metafields { key namespace value type ownerType }
										userErrors { field message }
									}
								}
							`;
							const result = (await adminClient.request(mutation, { metafields })) as {
								data?: {
									metafieldsSet?: {
										userErrors?: Array<{ field?: string; message?: string }>;
									};
								};
							};
							const errors = result.data?.metafieldsSet?.userErrors || [];
							if (errors.length > 0) {
								shopify.utils.log.debug("metafieldsSet userErrors", { errors, orderId });
							} else {
								shopify.utils.log.debug("Order metafields saved", { orderId, metafields });
							}
						}
					}
				} catch (err) {
					shopify.utils.log.debug("Failed processing order metafields", {
						error: err instanceof Error ? err.message : String(err),
						orderId,
					});
				}
				break;
			}
		}

		// Send to webhook queue if available
		if (context.cloudflare.env.WEBHOOK_QUEUE) {
			await context.cloudflare.env.WEBHOOK_QUEUE.send(
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
