import { createShopify } from "~/shopify.server";
import type { Route } from "./+types/shopify.webhooks";

export async function action({ context, request }: Route.ActionArgs) {
	try {
		const shopify = createShopify(context);
		shopify.utils.log.debug("shopify.webhooks");

		const webhook = await shopify.webhook(request);
		shopify.utils.log.debug("shopify.webhooks", { ...webhook });

		const session = await shopify.session.get(webhook.domain);
		const payload = (await request.json()) as unknown;

		switch (webhook.topic) {
			case "APP_UNINSTALLED":
				if (session) {
					await shopify.session.delete(session.id);
				}
				break;

			case "APP_SCOPES_UPDATE":
				if (session) {
					await shopify.session.set({
						...session,
						scope: (payload as { current: string[] }).current.toString(),
					});
				}
				break;

			case "ORDERS_PAID":
			case "ORDERS_CREATE":
			case "ORDERS_UPDATED":
			case "ORDERS_CANCELLED":
				// Order webhooks are enqueued for processing by the worker
				// No immediate action needed here, just log the webhook
				shopify.utils.log.debug(`Order webhook received: ${webhook.topic}`, {
					shop: webhook.domain,
					orderId: (payload as { id?: string | number })?.id,
				});
				break;
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
