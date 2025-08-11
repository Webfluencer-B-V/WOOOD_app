import type { Env } from "./consolidation";

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
	env: Env,
): Promise<boolean> {
	const secret = env.SHOPIFY_API_SECRET_KEY;
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

export async function handleOrderWebhook(
	request: Request,
	env: Env,
): Promise<Response> {
	const signature = request.headers.get("X-Shopify-Hmac-Sha256") || "";
	const shop = (request.headers.get("X-Shopify-Shop-Domain") || "").trim();
	const topic = request.headers.get("X-Shopify-Topic") || "";
	const bodyText = await request.text();
	const valid = await validateWebhookSignature(bodyText, signature, env);
	if (!valid) return new Response("Invalid signature", { status: 401 });
	let payload: any = {};
	try {
		payload = JSON.parse(bodyText);
	} catch {}
	console.log(`Webhook received: ${topic}`, { shop, id: payload?.id });
	return new Response("OK");
}

export async function deleteShopInstallation(
	env: Env,
	shop: string,
): Promise<void> {
	try {
		await env.WOOOD_KV?.delete(`shop_token:${shop}`);
		console.log(`🧹 Deleted shop token for ${shop}`);
	} catch (error) {
		console.error("Failed to delete shop token", { shop, error });
	}
}

export async function handleAppUninstalled(
	request: Request,
	env: Env,
): Promise<Response> {
	const signature = request.headers.get("X-Shopify-Hmac-Sha256") || "";
	const shop = (request.headers.get("X-Shopify-Shop-Domain") || "").trim();
	const topic = request.headers.get("X-Shopify-Topic") || "";
	const bodyText = await request.text();
	const valid = await validateWebhookSignature(bodyText, signature, env);
	if (!valid) return new Response("Invalid signature", { status: 401 });
	await deleteShopInstallation(env, shop);
	console.log(`🚪 App uninstalled processed for ${shop}`, { topic });
	return new Response("OK");
}

export async function registerWebhooks(
	shop: string,
	accessToken: string,
	env: Env,
): Promise<void> {
	const endpoint = `${env.SHOPIFY_APP_URL}/api/webhooks`;
	const webhooks = [
		{ topic: "orders/paid", address: endpoint },
		{ topic: "orders/create", address: endpoint },
		{ topic: "app/uninstalled", address: endpoint },
	];
	for (const webhook of webhooks) {
		try {
			const response = await fetch(
				`https://${shop}/admin/api/2024-10/webhooks.json`,
				{
					method: "POST",
					headers: {
						"X-Shopify-Access-Token": accessToken,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ webhook }),
				},
			);
			if (!response.ok) {
				const errorText = await response.text();
				console.error("Webhook registration failed", {
					status: response.status,
					error: errorText,
					webhook,
				});
			}
		} catch (error) {
			console.error("Exception registering webhook", { webhook, error });
		}
	}
}
