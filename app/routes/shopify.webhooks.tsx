import { createShopify } from "../shopify.server";
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
				// Order webhooks are enqueued for processing by the worker
				// No immediate action needed here, just log the webhook
				const orderId = isOrderWebhookPayload(payload)
					? payload.id
					: isBaseWebhookPayload(payload)
						? payload.id
						: undefined;
				shopify.utils.log.debug(`Order webhook received: ${webhook.topic}`, {
					shop: webhook.domain,
					orderId,
				});
				break;
			}
		}

		await context.cloudflare.env.WEBHOOK_QUEUE?.send(
			{
				payload,
				webhook,
			},
			{ contentType: "json" },
		);

		return new Response(undefined, { status: 204 });
		// biome-ignore lint/suspicious/noExplicitAny: catch(err)
	} catch (error: any) {
		return new Response(error.message, {
			status: error.status,
			statusText: "Unauthorized",
		});
	}
}
